'use strict';

/* Guests on the seat ring (#1016) — the „+" seat that adds one, the dashed guest
 * seats beside the members, and what removing one does to everything downstream.
 *
 * Its own spec rather than more of test/session-setup-addons.test.js: that file
 * is about the add-on chip row, and this feature exists precisely because guests
 * LEFT that row. What cannot be seen from the unit tests in
 * test/draw-pool.test.js is whether the ring is wired to any of it — a „+" seat
 * that renders, opens its input and adds a name nobody counts looks finished and
 * changes nothing — so every assertion below drives a real screen, and the pool
 * preview is pinned against `drawPool()` over the same round, the same agreement
 * the metadata and shelf filters are held to
 * (.claude/rules/shared-constants-across-the-stack.md).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { drawPool } = require('../lib/draw');
const { MAX_SESSION_GUESTS, GUEST_NAME_MAX } = require('../public/js/session-people');
const { loadApp } = require('./support/dom');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
dom.set('showSessionLobby', () => {});
dom.set('showResults', () => {});

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }];
// „Duo" drops out the moment a third person sits down, „Trio" needs them — so a
// single guest moves the pool in BOTH directions and neither assertion below can
// be satisfied by a preview that simply never changes.
const GAMES = [
  { id: 'g1', title: 'Duo', minPlayers: 1, maxPlayers: 2 },
  { id: 'g2', title: 'Trio', minPlayers: 3, maxPlayers: 4 },
];

let rid = 0;
const roundFixture = () => ({
  id: `seatguests-${++rid}`,
  name: 'Freitagsrunde',
  members: MEMBERS.map((m) => ({ ...m })),
  tags: [],
  sessions: [],
  games: GAMES.map((g) => ({ ...g })),
});

/* Scope every query to a root, because the direct-play sheet opens OVER the
   setup screen and both carry a ring — an unscoped `.nr-seat--add` would find
   the screen's one and the sheet's spec would silently drive the wrong table
   (.claude/rules/blur-events-never-fire-in-the-preview-pane.md names the same
   accumulation trap for the preview pane). */
const memberSeats = (root = dom.app) => [...root.querySelectorAll('.nr-seat[aria-pressed]')];
const guestSeats = (root = dom.app) => [...root.querySelectorAll('.nr-seat--guest')];
const addSeat = (root = dom.app) => root.querySelector('.nr-seat--add');
const addBox = (root = dom.app) => root.querySelector('.nr-guest-add');
const centre = (root = dom.app) => root.querySelector('.nr-table__center').textContent;
const previewed = () =>
  [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort();
const drawable = (playerCount) =>
  drawPool(dom.app.__round, { playerCount }).map((g) => g.title).sort();

const openAdd = (root = dom.app) => {
  if (addBox(root).hidden) addSeat(root).click();
  return addBox(root);
};
const addGuest = (name, root = dom.app) => {
  const box = openAdd(root);
  box.querySelector('input').value = name;
  box.querySelector('button').click();
};
// Enter in the name field, the other way in.
const typeGuest = (name, root = dom.app) => {
  const box = openAdd(root);
  const input = box.querySelector('input');
  input.value = name;
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
};
const seatName = (seat) => seat.querySelector('.nr-seat__name').textContent;
/* The POST body is built in the jsdom realm, so its arrays and objects do not
   share a prototype with this file's literals and `deepStrictEqual` reports
   "same structure but not reference-equal". Round-trip through JSON rather than
   loosening the assertion. */
const plain = (v) => JSON.parse(JSON.stringify(v));

const showSetup = async () => {
  const round = roundFixture();
  await dom.call('showStartSession', round);
  dom.app.__round = round;   // what `drawable()` pins the preview against
  return round;
};

test('with nobody invited the ring is the members plus one „+" seat, and the input is folded away', async () => {
  await showSetup();

  assert.deepEqual(memberSeats().map(seatName), ['Anna', 'Ben']);
  assert.deepEqual(guestSeats(), []);
  assert.ok(addSeat(), 'the ring offers no way to add a guest at all');
  assert.equal(addSeat().getAttribute('aria-expanded'), 'false');
  assert.equal(addBox().hidden, true, 'the name input stands open, which is the height the ring exists to save');
  assert.equal(centre(), '2 spielen mit');

  // The field the ring replaced must be gone, not merely moved out of sight:
  // two controls answering „wer ist am Tisch" is the thing #1016 removed.
  assert.equal(dom.app.querySelector('#guestName'), null);
  assert.equal(dom.app.querySelector('.guest-chip'), null);
});

test('the „+" seat opens the input, with focus in it and its name bound to the limit', async () => {
  await showSetup();

  addSeat().click();
  assert.equal(addBox().hidden, false);
  assert.equal(addSeat().getAttribute('aria-expanded'), 'true');
  const input = addBox().querySelector('input');
  assert.equal(dom.document.activeElement, input, 'the input opened without focus, so a phone keyboard never appears');
  assert.equal(input.getAttribute('maxlength'), String(GUEST_NAME_MAX),
    'the input takes a longer name than the server stores, which it truncates silently');
  assert.equal(addSeat().getAttribute('aria-controls'), addBox().id);
});

test('a guest takes a seat, counts at the table, and narrows the pool the draw will use', async () => {
  await showSetup();

  assert.deepEqual(previewed(), ['Duo'], 'fixture sanity: two people can only play Duo');

  addGuest('Kim');

  assert.deepEqual(guestSeats().map(seatName), ['Kim']);
  assert.equal(centre(), '3 spielen mit', 'the centre count still reads the members only');
  assert.deepEqual(previewed(), ['Trio']);
  // …and the preview agrees with what the server would actually draw for three.
  assert.deepEqual(previewed(), drawable(3));
});

test('Enter adds one too, and the „(Gast)" marker survives on its own line', async () => {
  await showSetup();

  typeGuest('Kim');

  const seat = guestSeats()[0];
  assert.equal(seatName(seat), 'Kim');
  assert.equal(seat.querySelector('.nr-seat__guest').textContent, 'Gast',
    'the marker is the half that must not be lost — a bare name reads as a member of the round');
  assert.equal(seat.getAttribute('aria-label'), 'Gast Kim entfernen');
  assert.equal(seat.getAttribute('aria-pressed'), null,
    'a guest seat is not a toggle — aria-pressed would announce them as out of the session');
});

test('an empty name is refused, and adding stays open for the next one', async () => {
  await showSetup();
  const toasts = [];
  dom.set('toast', (m) => toasts.push(m));

  addGuest('   ');
  assert.deepEqual(guestSeats(), []);
  assert.deepEqual(toasts, ['Bitte einen Namen für den Gast eingeben']);

  addGuest('Kim');
  assert.deepEqual(guestSeats().map(seatName), ['Kim']);
  assert.equal(addBox().hidden, false, 'the box folded away after one guest, so the second costs an extra tap');
  dom.set('toast', () => {});
});

test('tapping a guest sends them home, and the pool opens back up', async () => {
  await showSetup();

  addGuest('Kim');
  addGuest('Lea');
  assert.deepEqual(guestSeats().map(seatName), ['Kim', 'Lea']);

  guestSeats()[0].click();
  assert.deepEqual(guestSeats().map(seatName), ['Lea'], 'the wrong guest left — the seats hold a stale index');
  assert.equal(centre(), '3 spielen mit');
  assert.deepEqual(previewed(), drawable(3));

  guestSeats()[0].click();
  assert.equal(centre(), '2 spielen mit');
  assert.deepEqual(previewed(), ['Duo']);
});

test('the „+" seat disappears at the cap and comes back below it', async () => {
  await showSetup();

  for (let i = 0; i < MAX_SESSION_GUESTS; i++) addGuest(`G${i}`);
  assert.equal(guestSeats().length, MAX_SESSION_GUESTS);
  assert.equal(addSeat(), null, 'the ring still offers a seat the server would refuse to fill');
  assert.equal(addBox().hidden, true, 'the input is still open over a „+" seat that is no longer there');

  guestSeats()[0].click();
  assert.ok(addSeat(), 'one seat free and no way to use it');
});

test('a member seat stays a toggle, and the last member cannot leave', async () => {
  await showSetup();
  const toasts = [];
  dom.set('toast', (m) => toasts.push(m));

  assert.deepEqual(memberSeats().map((s) => s.getAttribute('aria-pressed')), ['true', 'true']);
  memberSeats()[1].click();
  assert.deepEqual(memberSeats().map((s) => s.getAttribute('aria-pressed')), ['true', 'false']);
  assert.equal(centre(), '1 spielt mit');

  memberSeats()[0].click();
  assert.deepEqual(memberSeats().map((s) => s.getAttribute('aria-pressed')), ['true', 'false'],
    'the last member was allowed out, which leaves a session nobody is in');
  assert.deepEqual(toasts, ['Mindestens eine Person muss mitspielen']);
  dom.set('toast', () => {});
});

test('Escape folds the input away and hands focus back to the „+" seat', async () => {
  await showSetup();

  const input = openAdd().querySelector('input');
  input.value = 'Kim';
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  assert.equal(addBox().hidden, true);
  assert.equal(addSeat().getAttribute('aria-expanded'), 'false');
  assert.equal(dom.document.activeElement, addSeat(), 'focus fell to the body, so a keyboard user loses their place');
  assert.deepEqual(guestSeats(), [], 'Escape added the half-typed name instead of discarding it');
});

/* ---- Teams (#575) ---- */

test('removing a guest takes them out of their team, and the positions stay right', async () => {
  const round = roundFixture();
  await dom.call('startDirectSession', round, round.games[0]);
  const sheet = dom.document.querySelector('.sheet');

  addGuest('Kim', sheet);
  addGuest('Lea', sheet);
  // Anna plays with Lea — the SECOND guest, so a payload built from positions
  // rather than from the stable keys will point at Kim once she leaves.
  sheet.querySelector('.setup-addons__chip[data-addon="team"]').click();
  const pick = (label) => [...sheet.querySelectorAll('.team-chip')].find((c) => c.textContent === label);
  pick('Anna').click();
  pick('Lea (Gast)').click();
  sheet.querySelector('#teamMake').click();
  assert.deepEqual([...sheet.querySelectorAll('.team-card__name')].map((el) => el.textContent.trim()),
    ['Anna und Lea (Gast)']);

  const sent = [];
  dom.set('api', (method, path, body) => {
    sent.push({ method, path, body });
    return Promise.resolve({ session: { id: 's1' }, games: round.games });
  });
  sheet.querySelector('#startDirect').click();
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(plain(sent[0].body.guests), ['Kim', 'Lea']);
  assert.deepEqual(plain(sent[0].body.teams), [{ memberIds: ['m1'], guestIndices: [1] }]);
});

test('… and the team dissolves when the guest holding it up goes home', async () => {
  const round = roundFixture();
  await dom.call('startDirectSession', round, round.games[0]);
  const sheet = dom.document.querySelector('.sheet');

  addGuest('Kim', sheet);
  addGuest('Lea', sheet);
  sheet.querySelector('.setup-addons__chip[data-addon="team"]').click();
  const pick = (label) => [...sheet.querySelectorAll('.team-chip')].find((c) => c.textContent === label);
  pick('Anna').click();
  pick('Lea (Gast)').click();
  sheet.querySelector('#teamMake').click();

  // Kim leaves: Lea shifts from position 1 to position 0, and the team must
  // follow her rather than the index she used to sit at.
  guestSeats(sheet).find((s) => seatName(s) === 'Kim').click();

  const sent = [];
  dom.set('api', (method, path, body) => {
    sent.push({ method, path, body });
    return Promise.resolve({ session: { id: 's1' }, games: round.games });
  });
  sheet.querySelector('#startDirect').click();
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(plain(sent[0].body.guests), ['Lea']);
  assert.deepEqual(plain(sent[0].body.teams), [{ memberIds: ['m1'], guestIndices: [0] }],
    'the team kept a position instead of the person, so it now names whoever moved into that slot');
});

test('… and a team left with one person is no team at all', async () => {
  const round = roundFixture();
  await dom.call('startDirectSession', round, round.games[0]);
  const sheet = dom.document.querySelector('.sheet');

  addGuest('Lea', sheet);
  sheet.querySelector('.setup-addons__chip[data-addon="team"]').click();
  const pick = (label) => [...sheet.querySelectorAll('.team-chip')].find((c) => c.textContent === label);
  pick('Anna').click();
  pick('Lea (Gast)').click();
  sheet.querySelector('#teamMake').click();
  assert.equal(sheet.querySelectorAll('.team-card').length, 1, 'fixture sanity: there is a team to dissolve');

  guestSeats(sheet)[0].click();
  assert.equal(sheet.querySelectorAll('.team-card').length, 0,
    'Anna is still shown as a "team" on her own, and will appear twice on the winner picker');

  const sent = [];
  dom.set('api', (method, path, body) => {
    sent.push({ method, path, body });
    return Promise.resolve({ session: { id: 's1' }, games: round.games });
  });
  sheet.querySelector('#startDirect').click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(plain(sent[0].body.teams), []);
  assert.deepEqual(plain(sent[0].body.guests), []);
});

/* ---- The direct-play sheet ---- */

test('the direct-play sheet carries the same ring, and no guest field either', async () => {
  const round = roundFixture();
  await dom.call('startDirectSession', round, round.games[0]);
  const sheet = dom.document.querySelector('.sheet');

  assert.deepEqual(memberSeats(sheet).map(seatName), ['Anna', 'Ben']);
  assert.ok(addSeat(sheet));
  assert.equal(sheet.querySelector('#guestName'), null, 'the sheet still has the old guest field');

  addGuest('Kim', sheet);
  assert.deepEqual(guestSeats(sheet).map(seatName), ['Kim']);
  assert.equal(centre(sheet), '3 spielen mit');
});

test('Escape in the guest input does NOT close the sheet around it', async () => {
  /* The sheet's own Escape handler sits on `document` in the CAPTURE phase, so
     it runs BEFORE the input's — and without the deferral it takes the whole
     sheet down and the half-typed name with it. Dispatching from the input is
     what exercises that ordering; dispatching on `document` would not. */
  const round = roundFixture();
  await dom.call('startDirectSession', round, round.games[0]);
  const sheet = dom.document.querySelector('.sheet');

  const input = openAdd(sheet).querySelector('input');
  input.value = 'Kim';
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  assert.ok(dom.document.querySelector('.sheet'), 'Escape closed the sheet instead of the guest input');
  assert.equal(addBox(sheet).hidden, true, 'the input stayed open, so the next Escape is the only way out');

  // With the input closed, Escape belongs to the sheet again.
  dom.document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(dom.document.querySelector('.sheet'), null, 'the sheet no longer closes on Escape at all');
});
