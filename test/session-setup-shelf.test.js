'use strict';

/* „Wer hat seine Spiele nicht dabei?" (#1002) — marking a seated member as
 * present WITHOUT their shelf, on the session setup screen.
 *
 * Its own spec rather than more of test/filter-panel.test.js: that file is about
 * the one filter control, and this is deliberately NOT a filter — it is a fact
 * about the people at the table, so it lives beside the seats, stays out of the
 * applied-filter chips and is never remembered as a preset.
 *
 * What cannot be seen from the unit tests in test/draw-pool.test.js is whether
 * the SCREEN is wired to the reduction at all: a control that renders, toggles
 * its own chip and narrows nothing looks finished and does nothing. So every
 * assertion below drives the real view and reads the real pool preview, and the
 * preview is pinned against `drawPool()` over the same round — the same
 * agreement the metadata filters are held to
 * (.claude/rules/shared-constants-across-the-stack.md).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { drawPool } = require('../lib/draw');
const { shelfParty } = require('../public/js/draw-pool');
const { loadApp } = require('./support/dom');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
dom.set('showSessionLobby', () => {});

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Cleo' }];
// One game per ownership shape, all with a range wide enough that `fitsPlayerCount`
// never decides anything here — the point is to isolate the owner clause.
const OWNED_GAMES = [
  { id: 'g1', title: 'Annas', minPlayers: 1, maxPlayers: 8, ownerIds: ['m1'] },
  { id: 'g2', title: 'Bens', minPlayers: 1, maxPlayers: 8, ownerIds: ['m2'] },
  { id: 'g3', title: 'Beide', minPlayers: 1, maxPlayers: 8, ownerIds: ['m1', 'm2'] },
  { id: 'g4', title: 'Unmarkiert', minPlayers: 1, maxPlayers: 8 },
];

let rid = 0;
const roundFixture = (games = OWNED_GAMES) => ({
  id: `shelf-${++rid}`,
  name: 'Freitagsrunde',
  members: MEMBERS.map((m) => ({ ...m })),
  tags: [],
  sessions: [],
  games: games.map((g) => ({ ...g })),
});

/* Since #1015 the control sits behind the „Ohne Spiele dabei" add-on chip, so a
   spec has to open it before the chips it drives are in the document. `showAddon`
   is the whole difference; nothing below it changed, and every pool assertion is
   still pinned against `drawPool()` over the same round. */
const addonChip = () => dom.app.querySelector('.setup-addons__chip[data-addon="shelf"]');
const showAddon = () => {
  const chip = addonChip();
  assert.ok(chip, 'the shelf add-on chip is not offered on this round');
  if (chip.getAttribute('aria-expanded') !== 'true') chip.click();
};
const chipRow = () => dom.app.querySelector('#shelfChips');
const chips = () => [...dom.app.querySelectorAll('#shelfChips .chip')];
// The chip's own text sits AFTER the avatar span, so `textContent` would read
// „ANAnna" — the initials the avatar paints.
const chipName = (chip) => chip.lastChild.textContent.trim();
const chipFor = (name) => chips().find((c) => chipName(c) === name);
const previewed = () =>
  [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort();
const seatFor = (name) =>
  [...dom.app.querySelectorAll('.nr-seat')].find((s) => s.title === name);

test('an unmarked shelf is not offered the control at all', async () => {
  const unmarked = OWNED_GAMES.map((g) =>
    ({ id: g.id, title: g.title, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers }));
  await dom.call('showStartSession', roundFixture(unmarked));

  assert.equal(addonChip(), null,
    'with nobody recorded as owning anything the control could not change a single row');
  assert.equal(chipRow(), null, 'and no chip row was built behind it either');
  assert.deepEqual(previewed(), ['Annas', 'Beide', 'Bens', 'Unmarkiert']);
});

test('a marked shelf offers one chip per SEATED member, all off', async () => {
  await dom.call('showStartSession', roundFixture());
  showAddon();

  assert.deepEqual(chips().map(chipName), ['Anna', 'Ben', 'Cleo']);
  assert.deepEqual(chips().map((c) => c.getAttribute('aria-pressed')), ['false', 'false', 'false'],
    'the normal evening ticks nothing, so the control starts inert');
  assert.deepEqual(previewed(), ['Annas', 'Beide', 'Bens', 'Unmarkiert'],
    'and the pool is exactly what it was before this existed');
});

test('marking a seated member drops their solely-owned games — and KEEPS the co-owned one', async () => {
  const round = roundFixture();
  await dom.call('showStartSession', round);
  showAddon();

  chipFor('Anna').click();

  // The case a "remove their games" implementation written from the issue title
  // gets wrong: Ben is here and Ben owns „Beide" too, so it is still on the table.
  assert.deepEqual(previewed(), ['Beide', 'Bens', 'Unmarkiert']);
  assert.equal(chipFor('Anna').getAttribute('aria-pressed'), 'true');

  // …and the preview agrees with what the server would actually draw.
  assert.deepEqual(previewed(), drawPool(round, {
    playerCount: 3,
    memberIds: shelfParty(['m1', 'm2', 'm3'], ['m1']),
  }).map((g) => g.title).sort());
});

test('marking EVERY owner leaves only the games nobody is recorded as owning', async () => {
  const round = roundFixture();
  await dom.call('showStartSession', round);
  showAddon();

  chipFor('Anna').click();
  chipFor('Ben').click();

  assert.deepEqual(previewed(), ['Unmarkiert'],
    'no box in the cupboard is here, so only the unmarked games stay drawable');
  assert.deepEqual(previewed(), drawPool(round, {
    playerCount: 3,
    memberIds: shelfParty(['m1', 'm2', 'm3'], ['m1', 'm2']),
  }).map((g) => g.title).sort());
});

test('the count of games hidden by absent owners follows the marks, not only the seats', async () => {
  await dom.call('showStartSession', roundFixture());
  showAddon();
  const note = () => dom.app.querySelector('.pool-owners-note').textContent;

  assert.equal(note(), '', 'everyone is here with their shelf — nothing to explain');
  chipFor('Anna').click();
  assert.match(note(), /1 weiteres Spiel fehlt/,
    'the footnote must account for the game the mark just removed, or it goes missing silently');
});

test('taking a member off the table takes their mark with them', async () => {
  await dom.call('showStartSession', roundFixture());
  showAddon();

  chipFor('Anna').click();
  assert.deepEqual(previewed(), ['Beide', 'Bens', 'Unmarkiert']);

  seatFor('Anna').click(); // Anna is not playing after all
  assert.deepEqual(chips().map(chipName), ['Ben', 'Cleo'],
    'an absent member is not offered a chip about a shelf nobody is waiting for');

  seatFor('Anna').click(); // …and comes back
  assert.equal(chipFor('Anna').getAttribute('aria-pressed'), 'false',
    're-seating is a fresh statement about tonight, not a resurrected old one');
  assert.deepEqual(previewed(), ['Annas', 'Beide', 'Bens', 'Unmarkiert'],
    'so her shelf is back with her rather than staying invisibly excluded');
});

test('the draw sends the MARKS, and the full seat list beside them', async () => {
  let sent = null;
  dom.set('api', async (method, path, body) => {
    sent = { method, path, body };
    return { session: { id: 's1' } };
  });
  await dom.call('showStartSession', roundFixture());
  showAddon();

  chipFor('Ben').click();
  dom.app.querySelector('#go').click();
  await new Promise((resolve) => setImmediate(resolve));

  // Spread across the realm boundary: an array built inside the vm context has
  // its own Array.prototype, which deepStrictEqual reports as "same structure,
  // not reference-equal" — a confusing failure that says nothing about the app.
  assert.deepEqual([...sent.body.withoutShelfIds], ['m2']);
  assert.deepEqual([...sent.body.memberIds], ['m1', 'm2', 'm3'],
    'the seat means everything it always did: Ben still plays, votes and counts for teams');
});
