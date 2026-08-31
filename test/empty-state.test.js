'use strict';

/* #869 — the round hub's content-light states.

   A round with games but no sessions rendered three of its four hub tabs as a
   single element over 650–820px of bare page, and the three did not even agree
   on a visual language: Pokale used `.empty` (a centred sentence in a dashed
   box), the Chronik used a bare `<div class="muted">`, and the Start tab
   rendered NOTHING at all from 1280px up — its hero and its big CTA are both
   `.rail-owned`, so the rail hides them and, with no session tickets to take
   their place, the pane was left holding only `.hub-actions`.

   What is pinned here:

   - the shared component exists and every hub tab reaches it, so the two
     sibling tabs are indistinguishable in treatment;
   - the title line is OPTIONAL, because the five `suggest.empty.*` strings are
     one explanatory thought each and get no invented headline;
   - the Start tab's stand-in is NOT `rail-owned` — that is the whole bug. A
     stand-in carrying that class would be hidden by the very rule that created
     the void, and would look correct in jsdom, which has no layout.

   The CSS half is asserted as text (`test/support/css.js`) because jsdom
   applies no external stylesheet — see
   `.claude/rules/testing-views-under-jsdom.md`. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RULES, bodyOf, bodyOfIn, mediaBlocks } = require('./support/css');
const { loadApp } = require('./support/dom');

/* A young round: games on the shelf, nothing played yet. This is the exact
   state the issue measured, and it is every round's first weeks. */
const youngRound = () => ({
  id: 3,
  name: 'Freitagsrunde',
  members: [{ id: 1, name: 'Anna' }, { id: 2, name: 'Ben' }],
  games: [{ id: 10, title: 'Azul' }, { id: 11, title: 'Cascadia' }],
  sessions: [],
  tags: [],
});

const played = () => ({
  id: 900,
  done: true,
  finished: true,
  createdAt: '2026-08-10T18:00:00.000Z',
  chosenGameId: 10,
  gameIds: [10],
  winnerIds: [1],
  // gameStats() indexes this per member; an absent map throws rather than
  // reading as "nobody rated", so the shape has to be real (#602's fixture note).
  votes: { 1: { 10: { rating: 4 } }, 2: { 10: { rating: 5 } } },
});

// ---- the component ---------------------------------------------------------

test('the empty state renders a medallion, and the title line is optional', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  const titled = dom.call('emptyState', { icon: 'ti-trophy', title: 'Noch keine Pokale', text: 'Die erste Session entscheidet.' });
  assert.equal(titled.className, 'empty', 'the component is not the shared .empty box');
  assert.ok(titled.querySelector('.empty__icon .ti-trophy'), 'the medallion did not render its glyph');
  assert.equal(titled.querySelector('.empty__title').textContent, 'Noch keine Pokale');
  assert.equal(titled.querySelector('.empty__text').textContent, 'Die erste Session entscheidet.');

  /* Sub-only, for the recommender's five explanatory strings. Asserted because
     a component that always renders the element would leave an empty heading
     box there — visible, and invisible to a test that only checks the text. */
  const bare = dom.call('emptyState', { icon: 'ti-sparkles', text: 'Nichts mehr vorzuschlagen.' });
  assert.equal(bare.querySelector('.empty__title'), null, 'a titleless empty state still rendered a title element');
  assert.equal(bare.querySelector('.empty__text').textContent, 'Nichts mehr vorzuschlagen.');
});

test('the empty state escapes its text', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  const box = dom.call('emptyState', { icon: 'ti-cards', title: '<b>t</b>', text: '<img src=x>' });
  assert.equal(box.querySelector('.empty__text').querySelector('img'), null, 'the text was interpolated as markup');
  assert.equal(box.querySelector('.empty__title').querySelector('b'), null, 'the title was interpolated as markup');
});

// ---- the hub tabs ----------------------------------------------------------

test('the Chronik and Pokale empty states are the same component', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  dom.call('renderChronikTab', youngRound(), []);
  const chronik = dom.app.querySelector('.timeline .empty');
  assert.ok(chronik, 'the Chronik empty state is not the shared component (it was a bare .muted)');
  assert.ok(chronik.querySelector('.empty__icon'), 'the Chronik empty state has no medallion');
  assert.ok(chronik.querySelector('.empty__title'), 'the Chronik empty state has no title line');

  dom.app.innerHTML = '';
  await dom.call('renderPokaleTab', youngRound());
  const pokale = dom.app.querySelector('.empty');
  assert.ok(pokale, 'the Pokale empty state vanished');

  /* The acceptance criterion is that the two are indistinguishable in
     TREATMENT, so compare the structure rather than the words. */
  assert.equal(chronik.className, pokale.className, 'the two hub tabs style their empty state differently');
  assert.deepEqual(
    [...chronik.children].map((c) => c.className),
    [...pokale.children].map((c) => c.className),
    'the two hub tabs compose their empty state differently',
  );
});

test('the Start tab composes a stand-in when the rail takes its hero, and it is not rail-owned', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  const r = youngRound();

  dom.call('renderStartTab', r, r.games);
  const gap = dom.app.querySelector('.empty--rail-gap');
  assert.ok(gap, 'the Start tab still leaves the pane empty from 1280px up');
  assert.ok(gap.classList.contains('empty'), 'the Start stand-in is not built from the shared component');
  assert.ok(
    !gap.classList.contains('rail-owned'),
    'the Start stand-in is rail-owned — hidden by the very rule that created the void',
  );

  /* Anti-vacuous: a round that HAS something to show in the pane must not get
     the stand-in, or every populated Start screen grows a spurious card. */
  dom.app.innerHTML = '';
  const busy = youngRound();
  busy.sessions = [played()];
  dom.call('renderStartTab', busy, busy.games);
  assert.equal(
    dom.app.querySelector('.empty--rail-gap'),
    null,
    'the stand-in rendered on a Start tab that already has a ticket to show',
  );
});

// ---- the CSS ---------------------------------------------------------------

test('.empty carries the .lobby-cta treatment, factored rather than duplicated', () => {
  /* The issue asks for the shared bits to be FACTORED. bodyOfIn() looks a
     selector up as one member of a group, so this goes red both if the
     medallion is gone and if it was copy-pasted into a rule of its own —
     the copy being how `.lobby-cta` and `.empty` drift apart again. */
  const icon = bodyOfIn('.empty__icon', RULES);
  assert.ok(icon, '.empty__icon is not sharing a rule with .lobby-cta__icon');
  assert.ok(
    RULES.some(([sel]) => sel.split(',').map((s) => s.trim()).includes('.lobby-cta__icon')
      && sel.split(',').map((s) => s.trim()).includes('.empty__icon')),
    'the medallion was duplicated instead of shared with .lobby-cta__icon',
  );
  assert.match(icon, /var\(--brand-tint\)/, 'the medallion lost its --brand-tint disc');

  const box = bodyOf('.empty', RULES);
  assert.match(box, /var\(--brand-edge\)/, '.empty is back on the near-invisible --line border');
  /* No raw hex anywhere in the component, so the medallion follows a round's
     own accent (`.claude/rules/theme-derived-colors.md`).

     Matched per selector MEMBER, not on the whole selector text: the shared
     rules are written `.lobby-cta__icon,\n.empty__icon`, and `whole('.empty')`
     rejects `.empty--rail-gap` outright (its `-` is in `[\w-]`). Both mistakes
     leave a loop that runs over one rule and reads exactly like one that
     covers the component. */
  const emptyRules = RULES.filter(([sel]) => sel.split(',').some((s) => s.trim().startsWith('.empty')));
  assert.ok(emptyRules.length >= 4, `the component's rules vanished — only ${emptyRules.length} left`);
  for (const [sel, body] of emptyRules) {
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, `${sel.replace(/\s+/g, ' ')} hard-codes a colour instead of deriving one`);
  }
});

test('the Start stand-in is hidden below the rail breakpoint and shown above it', () => {
  /* It stands in for what the rail takes, so it must appear ONLY where the rail
     exists. Both halves are asserted: a modifier that forgets the default
     renders a duplicate card under the CTA at phone widths, where the issue
     says the screen already composes correctly. */
  assert.match(bodyOf('.empty--rail-gap', RULES) || '', /display:\s*none/, '.empty--rail-gap is not hidden by default');
  const wide = mediaBlocks().filter(([q]) => /min-width:\s*1280px/.test(q));
  assert.ok(wide.length, 'the 1280px block vanished');
  const shown = wide.some(([, css]) => /\.empty--rail-gap\s*\{[^}]*display:\s*block/.test(css));
  assert.ok(shown, 'the Start stand-in is never shown, so the pane stays empty at 1280px');
});
