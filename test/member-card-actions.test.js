'use strict';

/* Die Tischkarte's action surfaces (#1074): the „…" page menu's branch matrix,
 * the colour editor behind the avatar, and the seat strip in the card's foot.
 *
 * The screen's actions used to be three stacked `.round-footer` blocks; they are
 * now one menu with the SAME gates, so the assertion worth having is the matrix
 * — which item each state offers, and which it must not. A source match over
 * `menuItems` would pass against a gate that lets the wrong branch through, so
 * every case runs the real view and opens the real popover.
 *
 * Named for what it covers: member-retire-views.test.js drives the retire dialog
 * and member-hero.test.js the card's tone, so neither name was free
 * (.claude/rules/test-file-names-collide-silently.md).
 *
 * The pane's two lies do not apply here — jsdom dispatches a real click and the
 * popover is a real element — but Escape is still worth nothing to check in this
 * harness (.claude/rules/escape-keypresses-never-reach-the-preview-pane.md is
 * about the browser pane, not jsdom).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

/* A FRESH round id per fixture, the trick member-retire-views.test.js uses.
   `fetchRound` is stale-while-revalidate, so a second fixture under the same id
   is served the FIRST one out of cache — and the failure is a perfect false
   negative: the view renders, the menu opens, and it offers the previous test's
   branches. Measured before this: a claimed seat's menu showed the unclaimed
   seat's items. */
let seq = 0;

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('showRound', () => {});
/* jsdom has no matchMedia, and openEditor asks it which presentation to use —
   without the stub the avatar's click handler throws instead of opening
   anything. `matches: true` is the >= 860px side, i.e. the popover: a sheet's
   own path (the focus trap, the Back marker) belongs to the sheet's spec, and
   what this file is about is that the editor opens at all and offers the
   palette. */
dom.run('window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });');

const roundFixture = (over = {}) => ({
  id: `r${++seq}`,
  name: 'Freitagsrunde',
  background: null,
  members: [
    { id: 'm1', name: 'Anna', color: '#7f77dd' },
    { id: 'm2', name: 'Ben' },
    { id: 'm3', name: 'Clara', retired: true },
  ],
  games: [],
  sessions: [],
  tags: [],
  ...over,
});

async function open(round, mid, opts = {}) {
  const rid = round.id;
  dom.set('isLoggedIn', () => opts.loggedIn !== false);
  dom.set('currentUserId', () => opts.me || null);
  // roundCan() reads the round's own role; the fixture has none, so the caller
  // states what this round lets them do rather than the view guessing.
  dom.set('roundCan', (r, cap) => (opts.can || ['member.link']).includes(cap));
  dom.set('api', async (method, url) => {
    if (/\/shares$/.test(url)) return opts.shares || [];
    if (new RegExp(`^/api/rounds/${rid}$`).test(url)) return round;
    return {};
  });
  dom.document.querySelectorAll('.popover, .sheet-backdrop').forEach((el) => el.remove());
  await dom.call('showMember', rid, mid);
}

// The labels the menu offers, in order. `null` when there is no menu at all.
function menuLabels() {
  const trigger = dom.app.querySelector('.gd-menu');
  if (!trigger) return null;
  trigger.click();
  const labels = [...dom.document.querySelectorAll('.popover--menu .popover__opt')]
    .map((b) => b.textContent.trim());
  dom.document.querySelectorAll('.popover').forEach((el) => el.remove());
  return labels;
}

const label = (key) => dom.run(`t('${key}')`);

/* ------------------------------ the branch matrix -------------------------- */

test('an unclaimed seat offers retire, and the claim stays a button in the card', async () => {
  await open(roundFixture(), 'm2', { me: 'acct-me' });

  assert.deepEqual(menuLabels(), [label('member.retire')],
    'an ordinary seat in a round I may not delete from offers exactly one action');

  /* „Das bin ich" is the one action deliberately left OUT of the menu: it is
     what a newcomer is looking for, and burying it behind „…" would hide the
     screen's only common action behind its rarest ones. */
  const claim = dom.app.querySelector('.member-card__claim');
  assert.ok(claim, 'the claim button is not in the card');
  assert.equal(claim.textContent.trim(), label('member.claim'));
});

test('MY seat offers „Das bin ich nicht" and no claim button', async () => {
  const round = roundFixture();
  round.members[1].userId = 'acct-me';
  /* `round.shares.manage` is granted on PURPOSE, and it is what makes the
     negative below mean anything: with it withheld, revoke is kept out by the
     capability rather than by the branch, and the assertion passes against an
     `if` where the code says `else if`. Measured — the break was green until
     this line was added. */
  await open(round, 'm2', { me: 'acct-me', can: ['round.shares.manage', 'member.link'] });

  const labels = menuLabels();
  assert.ok(labels.includes(label('member.unclaim')));
  assert.ok(!labels.includes(label('share.revoke')),
    'a seat I claimed myself is linked but UN-GRANTED — offering revoke would 404 (#421)');
  assert.equal(dom.app.querySelector('.member-card__claim'), null, 'my own seat still offers a claim');
  assert.equal(dom.app.querySelector('.member-card__chip--mine').textContent.trim(), label('member.mySeat'));
});

test('a GRANTEE\'s seat offers revoke to an owner — and never unclaim', async () => {
  const round = roundFixture();
  round.members[1].userId = 'acct-them';
  await open(round, 'm2', { me: 'acct-me', can: ['round.shares.manage'] });

  const labels = menuLabels();
  assert.ok(labels.includes(label('share.revoke')));
  assert.ok(!labels.includes(label('member.unclaim')),
    'unclaim nulls MY link; on someone else\'s seat it is the wrong verb entirely');
});

test('a retired seat offers the way back, never a second retirement', async () => {
  await open(roundFixture(), 'm3', { me: 'acct-me' });

  const labels = menuLabels();
  assert.ok(labels.includes(label('member.restore')));
  assert.ok(!labels.includes(label('member.retire')));
  assert.equal(dom.app.querySelector('.member-card__chip--retired').textContent.trim(),
    label('member.retiredChip'));
});

test('delete is offered only where the round allows it AND nothing is lost', async () => {
  const clean = roundFixture();
  await open(clean, 'm2', { me: 'acct-me', can: ['round.delete'] });
  assert.ok(menuLabels().includes(label('member.delete')), 'a seat with no votes can simply go');

  // One vote anywhere is enough to withdraw it — the seat now holds history.
  const voted = roundFixture({
    sessions: [{ id: 's1', finished: true, votes: { m2: { g1: { rating: 4 } } }, winnerIds: [], memberIds: ['m2'] }],
  });
  await open(voted, 'm2', { me: 'acct-me', can: ['round.delete'] });
  assert.ok(!menuLabels().includes(label('member.delete')));
});

test('the trigger and its items cannot disagree, and a visitor is offered nothing personal', async () => {
  /* The anti-vacuous half: every negative assertion above reads a popover, and
     one that opened EMPTY would satisfy all of them for the wrong reason.

     The menu is never actually empty — retire is ungated for an active seat, as
     it was in the footer this replaced — so the invariant worth pinning is that
     the trigger exists exactly when items do, and `back-row--split` goes with it.
     A logged-out visitor is the narrowest state the screen has. */
  await open(roundFixture(), 'm2', { me: null, loggedIn: false, can: [] });

  assert.ok(dom.app.querySelector('.gd-menu'), 'no trigger, so every negative assertion above is vacuous');
  assert.ok(dom.app.querySelector('.back-row--split'), 'the trigger is in the back row without splitting it');

  const labels = menuLabels();
  assert.ok(labels.length > 0, 'the trigger opens an empty panel');
  for (const key of ['member.unclaim', 'share.revoke', 'member.delete']) {
    assert.ok(!labels.includes(label(key)), `${key} is offered to a logged-out visitor`);
  }
  assert.equal(dom.app.querySelector('.member-card__claim'), null, 'a logged-out visitor is offered a seat');
});

/* --------------------------- the colour editor ----------------------------- */

test('the avatar is the colour control, and it opens the eight swatches', async () => {
  await open(roundFixture(), 'm1', { me: 'acct-me' });
  const avatar = dom.app.querySelector('.member-avatar');

  assert.equal(avatar.tagName, 'BUTTON', 'a focusable span is neither focusable nor announced as a control');
  assert.equal(avatar.getAttribute('aria-label'), label('member.colorChange'),
    'an icon-only control needs its name on the control itself');
  assert.equal(avatar.getAttribute('aria-expanded'), 'false');

  // No „Avatar-Farbe" section on the page any more — it was the second block,
  // above the record, answering a question asked once per member.
  assert.equal(dom.app.querySelector('.member-swatches'), null, 'the picker is still a page section');

  avatar.click();
  const swatches = dom.document.querySelectorAll('.member-swatch');
  assert.equal(swatches.length, dom.run('MEMBER_COLORS.length'),
    'the editor offers a different number of colours than the palette holds');
  assert.equal(avatar.getAttribute('aria-expanded'), 'true');
  // Exactly one is the member's own, and it is not clickable.
  assert.equal([...swatches].filter((s) => s.classList.contains('is-active')).length, 1);
});

/* ----------------------------- the seat strip ------------------------------ */

test('the card\'s foot seats the ACTIVE members, and marks the current one', async () => {
  await open(roundFixture(), 'm1', { me: 'acct-me' });
  const seats = [...dom.app.querySelectorAll('.member-seat')];

  assert.deepEqual(seats.map((s) => s.getAttribute('title')), ['Anna', 'Ben'],
    'Clara is retired — a forward-facing strip must not seat her');
  assert.equal(seats[0].getAttribute('aria-current'), 'page');
  assert.equal(seats[1].getAttribute('aria-current'), null);
  seats.forEach((s) => assert.ok(s.getAttribute('href'), 'a seat is not a link to its member page'));
});

test('a retired member is absent from the strip but still IS the page\'s subject', async () => {
  /* The distinction the whole retirement feature rests on: they leave the
     forward-looking surfaces and stay reachable, or there would be no way to
     bring them back (.claude/rules/retired-members-filter-sites.md). */
  await open(roundFixture(), 'm3', { me: 'acct-me' });
  assert.equal(dom.app.querySelector('.member-card h1').textContent.trim(), 'Clara');
  assert.ok(![...dom.app.querySelectorAll('.member-seat')].some((s) => s.getAttribute('title') === 'Clara'));
});

test('a one-member round renders no strip — a table of one is not a table', async () => {
  await open(roundFixture({ members: [{ id: 'm1', name: 'Anna' }] }), 'm1', { me: 'acct-me' });
  assert.equal(dom.app.querySelector('.member-card__table'), null);
});
