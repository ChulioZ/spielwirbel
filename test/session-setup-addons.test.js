'use strict';

/* The session setup screen's add-on chip row and its sticky action bar (#1015).
 *
 * The screen used to stack five always-open questions in its left column, four
 * of which are exceptions — measured at ~640px of height on every visit, for an
 * evening with no guests, no teams, everyone's shelf present and one table. They
 * are chips now, and „Loswirbeln" moved into a bar that sticks to the bottom of
 * the viewport instead of sitting at y=1454 on a phone.
 *
 * Three chips rather than four since #1016: guests moved out of the row onto the
 * seat ring, because „wer ist am Tisch" is the question the ring already answers
 * (test/session-seat-guests.test.js).
 *
 * What the specs below can and cannot see is worth stating, because the feature
 * is a layout one and this file is not a layout test: jsdom applies no external
 * stylesheet, so nothing here proves the screen FITS. What it does prove is the
 * structure the fit rests on — that the options are really collapsed, that the
 * control behind a chip is still reachable and still wired, that the bar holds
 * the button, and that the two places stating the pool size agree. The height
 * claim itself is a browser measurement (see the PR).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
dom.set('showSessionLobby', () => {});
dom.set('showResults', () => {});

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }];
// Ranges wide enough that nothing below is decided by the player count — these
// specs are about the controls, not about the pool predicate (draw-pool.test.js).
const GAMES = [
  { id: 'g1', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
  { id: 'g2', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
];

let rid = 0;
const roundFixture = (games = GAMES) => ({
  id: `addons-${++rid}`,
  name: 'Freitagsrunde',
  members: MEMBERS.map((m) => ({ ...m })),
  tags: [],
  sessions: [],
  games: games.map((g) => ({ ...g })),
});

// The shelf chip is only offered when somebody is recorded as owning something
// (#1002), so a spec that needs a SECOND body to open must use this fixture.
const ownedFixture = () =>
  roundFixture([{ id: 'g1', title: 'Azul', minPlayers: 1, maxPlayers: 8, ownerIds: ['m1'] }]);

const chips = () => [...dom.app.querySelectorAll('.setup-addons__chip')];
const chip = (key) => dom.app.querySelector(`.setup-addons__chip[data-addon="${key}"]`);
const body = () => dom.app.querySelector('.setup-addon-body');
const openBodies = () => [...dom.app.querySelectorAll('.setup-addon-body:not([hidden])')];
// Guests are added on the ring now, not behind a chip — see the sibling spec.
const addGuest = (name) => {
  const box = dom.app.querySelector('.nr-guest-add');
  if (box.hidden) dom.app.querySelector('.nr-seat--add').click();
  box.querySelector('input').value = name;
  box.querySelector('button').click();
};
// Form a team out of the first two people the pool offers.
const makeTeam = (root = dom.app) => {
  const pool = [...root.querySelectorAll('.team-chip')];
  pool[0].click();
  pool[1].click();
  root.querySelector('#teamMake').click();
};

test('the three options are chips, and every body starts closed', async () => {
  await dom.call('showStartSession', ownedFixture());

  assert.deepEqual(chips().map((c) => c.dataset.addon), ['team', 'shelf', 'multi']);
  assert.equal(body().hidden, true, 'a body is open on arrival — the row saves nothing');
  // The controls themselves must be out of the column entirely, not merely
  // hidden inside it: a `hidden` field still sits in the DOM, and the point of
  // the row is that the ~640px is not there at all.
  assert.equal(dom.app.querySelector('#teamPool'), null, 'the team field is in the column before anyone asked for it');
  assert.equal(dom.app.querySelector('#shelfChips'), null, 'the shelf chips are in the column before anyone asked for them');
  // Guests left the row entirely in #1016 rather than moving to another chip.
  assert.equal(chip('guest'), null, 'the guest chip is back, asking who is at the table a second time');
});

test('opening one option closes whichever was open', async () => {
  await dom.call('showStartSession', ownedFixture());

  chip('team').click();
  assert.equal(chip('team').getAttribute('aria-expanded'), 'true');
  assert.ok(dom.app.querySelector('#teamPool'), 'the team field did not unfold');

  chip('shelf').click();
  assert.equal(chip('team').getAttribute('aria-expanded'), 'false',
    'two bodies open at once puts the height this row reclaims straight back');
  assert.equal(chip('shelf').getAttribute('aria-expanded'), 'true');
  assert.equal(dom.app.querySelector('#teamPool'), null);
  assert.equal(openBodies().length, 1);

  // A second click on the open chip closes it again.
  chip('shelf').click();
  assert.equal(chip('shelf').getAttribute('aria-expanded'), 'false');
  assert.equal(body().hidden, true);
});

test('a closed body keeps what the user put in it', async () => {
  /* The bodies are MOVED in and out of the one host rather than rebuilt, so the
     pickers' listeners and the user's picks survive. Rebuilding would look
     identical on the first open and silently drop a team on the second. */
  await dom.call('showStartSession', ownedFixture());

  chip('team').click();
  makeTeam();

  chip('shelf').click();  // closes the team body
  chip('team').click();   // …and back
  assert.deepEqual([...dom.app.querySelectorAll('.team-card__name')].map((el) => el.textContent.trim()),
    ['Anna und Ben'], 'the team field was rebuilt empty, so reopening loses the teams');
});

test('the body is never inside the chip row', async () => {
  /* The whole shape of this feature. A disclosure whose body is a sibling of
     other content in a `flex-wrap` row has to claim the full line to hold its
     content, and the flex algorithm then moves the TRIGGER onto the next line
     with it — one click moving two things the user never touched (#844,
     .claude/rules/an-inline-disclosure-moves-its-own-trigger.md).
     Asserted over the DOM rather than over the stylesheet, because that is the
     assertion no future CSS rule can invalidate: with the body outside the row
     there is nothing in the row for any rule to widen. */
  await dom.call('showStartSession', roundFixture());
  chip('team').click();

  const row = dom.app.querySelector('.setup-addons');
  assert.equal(row.contains(body()), false, 'the open body sits inside the chip row — the chips will jump lines');
  assert.equal(body().previousElementSibling, row, 'and it must sit directly below it, not somewhere else on the screen');
});

test('a chip states what its option is set to, so a used option is never hidden', async () => {
  await dom.call('showStartSession', roundFixture());

  assert.equal(chip('team').textContent.trim(), 'Team bilden');
  chip('team').click();
  makeTeam();
  assert.equal(chip('team').textContent.trim(), '1 Team',
    'the count must inflect — the chip is the only statement of this option once the body is closed');
  assert.equal(chip('team').classList.contains('is-on'), true);
});

test('the bar states the headcount and the pool, and never disagrees with the panel', async () => {
  /* Two presentations of one number (the panel title above, the bar below), and
     on a phone the bar is the only one on screen. They are resolved from the
     same string in updateHint(); this is what would catch a second tn() call. */
  await dom.call('showStartSession', roundFixture());
  const summary = () => dom.app.querySelector('#barSummary').textContent;
  const title = () => dom.app.querySelector('#poolTitle').textContent;

  assert.equal(summary(), `2 spielen mit · ${title()}`);
  assert.match(title(), /2 Spiele im Topf/);

  addGuest('Kim');
  assert.equal(summary(), `3 spielen mit · ${title()}`, 'the bar did not follow the guest onto the table');
});

test('the draw button is in the bar, after everything that shapes the draw', async () => {
  await dom.call('showStartSession', roundFixture());

  const go = dom.app.querySelector('#go');
  assert.ok(go.closest('.setup-bar'), '„Loswirbeln" is outside the sticky bar, so it scrolls away again');
  assert.ok(dom.app.querySelector('.setup-bar #count'), 'the draw count must travel with the button it feeds');

  /* DOM order IS the phone order below 860px — the columns are real DOM groups
     and nothing uses CSS `order`, so tab order can never disagree with what is
     on screen (.claude/rules/setup-screens-two-column-layout.md §4). */
  const order = ['.nr-table', '.setup-addons', '.setup-filterbar', '.setup-panel', '.setup-bar'];
  const found = order.map((sel) => dom.app.querySelector(sel));
  found.forEach((el, i) => assert.ok(el, `${order[i]} is not on the screen at all`));
  for (let i = 1; i < found.length; i++) {
    assert.ok(
      found[i - 1].compareDocumentPosition(found[i]) & 4 /* DOCUMENT_POSITION_FOLLOWING */,
      `${order[i]} comes before ${order[i - 1]} in the DOM, so it comes before it on a phone`
    );
  }
});

test('the direct-play sheet gets the one chip that applies there, and no others', async () => {
  /* The same row, so the two ways into a session look the same (#532). It draws
     nothing, so neither the shelf question nor multi-table means anything there —
     and offering a control that cannot change an outcome is the thing
     metadataFilterOptions drops a filter to avoid. Guests are on the ring in both
     places since #1016, which is what took this row from two chips to one. */
  const round = ownedFixture();
  await dom.call('startDirectSession', round, round.games[0]);

  const sheet = dom.document.querySelector('.sheet');
  assert.deepEqual([...sheet.querySelectorAll('.setup-addons__chip')].map((c) => c.dataset.addon),
    ['team']);
  assert.equal(sheet.querySelector('.setup-addon-body').hidden, true);

  sheet.querySelector('.setup-addons__chip[data-addon="team"]').click();
  makeTeam(sheet);
  assert.equal(sheet.querySelector('.setup-addons__chip[data-addon="team"]').textContent.trim(), '1 Team',
    'the sheet mounted the row without wiring its relabel, so the chip never states the team');
});
