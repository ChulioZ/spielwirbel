'use strict';

/* The member screen's STATISTIKEN section on phone widths (#694).
 *
 * `.pokale-cards` is auto-fit/minmax(200px), so below ~430px the five stat
 * cards collapse to one column — ~1200px of scrolling for five short facts,
 * with each card's number rendered last and smallest. The fix is a scoped
 * 2-column grid with the value promoted, and it has two halves that fail in
 * completely different ways:
 *
 *   - the CLASSES the view renders (without them the CSS is inert), and
 *   - the CSS itself (without it the classes are decoration).
 *
 * Both are asserted, because either half alone stays green while the section
 * renders exactly as it did before. The classes are checked by RUNNING the view
 * (`.claude/rules/testing-views-under-jsdom.md`) rather than by matching the
 * view's source; the CSS is parsed as text, since jsdom applies no external
 * stylesheet.
 *
 * The third assertion is the one with teeth: the recomposition must NOT reach
 * the Pokale tab, whose category and Rückblick tiles share `.pokale-card`. That
 * is the regression a future "simplification" to a bare `.pokale-card` selector
 * would cause, and it is invisible on the member screen itself.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { rulesOf, bodyOf, mediaBlocks, specificity } = require('./support/css');

const RID = 'r1';

/* One finished session with ratings, so every stat card has a real value and
   `favorite` resolves to a game — a fixture with no sessions renders the same
   five cards but would let a broken favourite path pass unnoticed. */
const ROUND = {
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
  ],
  games: [
    { id: 'g1', title: 'Catan', tagIds: [] },
    { id: 'g2', title: 'Azul', tagIds: [] },
  ],
  sessions: [
    {
      id: 's1',
      createdAt: '2026-07-01T20:00:00.000Z',
      gameIds: ['g1', 'g2'],
      memberIds: ['m1', 'm2'],
      votes: { m1: { g1: { rating: 3 }, g2: { rating: 5 } }, m2: { g1: { rating: 4 } } },
      votedIds: ['m1', 'm2'],
      finished: true,
      cancelled: false,
      done: true,
      winnerIds: ['m1'],
      chosenGameId: 'g2',
      events: [],
    },
  ],
};

function bootApp(t) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return ROUND;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

// ---- the classes the CSS hangs off ----------------------------------------

test('the member stats grid carries its own scoping class', async (t) => {
  const dom = bootApp(t);
  await dom.call('showMember', RID, 'm1');
  const grid = dom.app.querySelector('.member-stats');
  assert.ok(grid, 'the STATISTIKEN grid must carry .member-stats');
  assert.ok(
    grid.classList.contains('pokale-cards'),
    'it still reuses the .pokale-cards component — the phone block only overrides it'
  );
});

test('every numeric stat card is marked, and the favourite tile is exempt', async (t) => {
  const dom = bootApp(t);
  await dom.call('showMember', RID, 'm1');
  const grid = dom.app.querySelector('.member-stats');

  /* Five numeric cards + the favourite — the fifth is the Siegwertung (#895),
     which sits beside the win rate it corrects. The count is asserted rather
     than "at least one": the reorder is applied per card, so a helper that
     stopped marking one of them would leave a single label-first tile in the
     grid. */
  const marked = grid.querySelectorAll('.member-stats__card');
  assert.equal(marked.length, 5, 'all five numeric stat cards must be marked');
  marked.forEach((c) =>
    assert.ok(c.querySelector('.pokale-card__value'), 'a marked card must have a value to promote')
  );

  const fav = grid.querySelectorAll('.member-stats__fav');
  assert.equal(fav.length, 1);
  /* The exemption exists BECAUSE this card has no `__value`: the shared reorder
     would otherwise move its game list above its own label. If the card ever
     gains a `__value`, this assertion fails and the exemption gets re-decided
     deliberately instead of quietly doing the wrong thing. */
  assert.equal(fav[0].querySelector('.pokale-card__value'), null);
  assert.ok(fav[0].querySelector('.pokale-card__games'), 'it holds a list of game links');
  assert.ok(!fav[0].classList.contains('member-stats__card'));
});

test('the recomposition cannot reach the Pokale tab', async (t) => {
  const dom = bootApp(t);
  await dom.call('showRound', RID, 'pokale');
  assert.ok(
    dom.app.querySelectorAll('.pokale-card').length > 0,
    'the tab must actually have rendered its cards, or this proves nothing'
  );
  ['.member-stats', '.member-stats__card', '.member-stats__fav'].forEach((sel) =>
    assert.equal(
      dom.app.querySelector(sel),
      null,
      `the Pokale tab must not carry ${sel} — its tiles are composed for their own content`
    )
  );
});

// ---- the CSS the classes hang off -----------------------------------------

/* Every rule under a `max-width: <= 859px` query. The member block is scoped
   next to the component it overrides, and the sheet has several such blocks. */
const PHONE_RULES = mediaBlocks()
  .filter(([q]) => {
    const m = q.match(/max-width:\s*(\d+)px/);
    return m && Number(m[1]) <= 859;
  })
  .flatMap(([, css]) => rulesOf(css));

test('the phone grid is two fixed columns, not the auto-fit default', () => {
  const body = bodyOf('.member-stats', PHONE_RULES);
  assert.ok(body, '.member-stats must be re-gridded inside a phone media block');
  /* `repeat(2, 1fr)`, not a smaller minmax floor: a floor only *usually* yields
     two columns and silently returns to one on a narrow enough phone, which is
     the exact defect being fixed. */
  assert.match(body, /grid-template-columns:\s*repeat\(2,\s*1fr\)/);
  assert.doesNotMatch(body, /auto-fit|auto-fill/);
});

test('the value leads and outgrows its label', () => {
  const value = bodyOf('.member-stats__card .pokale-card__value', PHONE_RULES);
  const label = bodyOf('.member-stats__card .pokale-card__label', PHONE_RULES);
  assert.ok(value && label, 'both the value and the label must be re-ordered');

  const order = (b) => Number((b.match(/order:\s*(\d+)/) || [])[1]);
  assert.ok(
    order(value) < order(label),
    'the number must render above its label — that is the whole recomposition'
  );

  /* Token, not a literal px: `--text-3xl` is the design scale (U-005), and a
     hardcoded size here is the copy problem `shared-constants-across-the-stack`
     is about, one level down. */
  const size = value.match(/font-size:\s*([^;]+)/);
  assert.ok(size, 'the value must be resized');
  assert.match(size[1], /var\(--text-3xl\)/);
});

test('the favourite tile spans the full row', () => {
  const body = bodyOf('.member-stats__fav', PHONE_RULES);
  assert.ok(body, 'the favourite tile must be re-spanned inside a phone media block');
  assert.match(body, /grid-column:\s*1\s*\/\s*-1/);
});

test('no phone rule restyles the .pokale-* component unscoped', () => {
  /* The isolation claim, asserted over the CSS rather than only over the DOM —
     jsdom applies no stylesheet, so the render test above cannot see a leak.

     The filter matches the whole BEM family (`.pokale-card`, `.pokale-cards`,
     `.pokale-card__value`, `.pokale-game`), NOT just the bare block. That is the
     correction that matters: `test/support/css.js`'s `whole()` appends
     `(?![\w-])`, and `_` is a word character — so `whole('.pokale-card')` does
     not match `.pokale-card__value`, i.e. the naive guard was blind to exactly
     the leak written in this comment. Verified by adding an unscoped
     `.pokale-card__label { order: 9 }` to a phone block: the naive form stayed
     green, this one names it.

     BOTH sides need the prefix form, and the scoping half is the easier one to
     get wrong: `whole('.member-stats')` does not match `.member-stats__card`
     either, so a `whole()`-based exemption would report this file's own scoped
     rules as leaks. */
  const SCOPE = /\.member-stats[\w-]*/;
  const scoped = PHONE_RULES.filter(([sel]) => SCOPE.test(sel));
  assert.ok(scoped.length >= 5, 'the member phone block must be in view, or this scans nothing');

  const leaks = PHONE_RULES
    .map(([sel]) => sel)
    .filter((sel) => /\.pokale-[\w-]*/.test(sel))
    .filter((sel) => !SCOPE.test(sel));
  assert.deepEqual(leaks, [], 'these phone rules restyle .pokale-* outside the member screen');
});

test('the member grid override outranks .pokale-cards, or loses silently on source order', () => {
  /* `.member-stats` and `.pokale-cards` are both (0,1,0), so the grid override
     is a TIE decided purely by source order. Moving the member block above the
     component restores the one-column layout with every other test still green,
     which is precisely the failure this asserts against. */
  const { CSS } = require('./support/css');
  assert.deepEqual(specificity('.member-stats'), specificity('.pokale-cards'));
  const component = CSS.search(/\.pokale-cards\s*\{/);
  const override = CSS.search(/\.member-stats\s*\{/);
  assert.ok(component >= 0 && override >= 0);
  assert.ok(
    override > component,
    '.member-stats must be declared AFTER .pokale-cards — at equal specificity, source order is the only thing making the override apply'
  );
});
