'use strict';

/* Guest games on the screens (#1681): a guest's sheet on the setup ring, the
 * brought games in the pool preview and in the start request, the results
 * screen's offer, and the „Gastspiele" list. The server half — what a brought id
 * may be, and how the draw admits it — is test/guest-games.test.js; this file
 * pins that the screens hand it the right thing and show the right thing back,
 * and that the setup preview promises exactly the pool `drawPool` builds
 * (.claude/rules/shared-constants-across-the-stack.md).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { drawPool } = require('../lib/draw');
const { MAX_GUEST_GAMES } = require('../public/js/session-people');
const { loadApp } = require('./support/dom');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
dom.set('showSessionLobby', () => {});
dom.set('toast', () => {});

let rid = 0;
// „Gross" seats 5–8, so it is only ever in the pool as a BROUGHT guest game
// that ignores nothing but tags and owners — never by accident of the range.
const roundFixture = (over = {}) => ({
  id: `guestview-${++rid}`,
  name: 'Freitagsrunde',
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  tags: [],
  sessions: [],
  games: [
    { id: 'g1', title: 'Duo', minPlayers: 1, maxPlayers: 4 },
    { id: 'x1', title: 'Azul', minPlayers: 1, maxPlayers: 4, guestGame: true },
    { id: 'x2', title: 'Gross', minPlayers: 5, maxPlayers: 8, guestGame: true },
  ],
  ...over,
});

const guestSeats = () => [...dom.app.querySelectorAll('.nr-seat--guest')];
const sheet = () => dom.document.querySelector('.guest-sheet');
const previewed = () => [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort();
const plain = (v) => JSON.parse(JSON.stringify(v));

const addGuest = (name) => {
  const box = dom.app.querySelector('.nr-guest-add');
  if (box.hidden) dom.app.querySelector('.nr-seat--add').click();
  box.querySelector('input').value = name;
  box.querySelector('button').click();
};

async function setup(round = roundFixture()) {
  dom.app.innerHTML = '';
  await dom.call('showStartSession', round);
  return round;
}

test('a guest\'s seat opens their sheet, and an earlier guest game is one tap away', async () => {
  const round = await setup();
  addGuest('Dana');
  guestSeats()[0].click();
  assert.ok(sheet(), 'the seat did not open the guest sheet');
  assert.match(sheet().querySelector('.guest-sheet__intro').textContent, /^Spiele, die Dana mitbringt/,
    'the intro names the guest rather than printing its placeholder');
  const picks = [...sheet().querySelectorAll('.guest-sheet__picks .chip')].map((c) => c.textContent.trim());
  assert.deepEqual(picks, ['Azul', 'Gross'], 'earlier guest games are offered, shelf games are not');

  sheet().querySelector('.guest-sheet__picks .chip').click();
  assert.deepEqual([...sheet().querySelectorAll('.guest-sheet__title')].map((x) => x.textContent), ['Azul']);
  assert.equal(guestSeats()[0].querySelector('.nr-seat__brought').textContent, '1', 'the seat shows what they brought');
  sheet().querySelector('.guest-sheet__picks .chip').click(); // Gross, too
  // Three at the table: Duo and the brought Azul fit; the brought Gross (5–8)
  // does NOT — a brought game still obeys the range — and the preview must say
  // exactly what the draw would.
  const ids = new Set(['x1', 'x2']);
  assert.deepEqual(previewed(), drawPool(round, { playerCount: 3, broughtIds: ids }).map((g) => g.title).sort());
  assert.deepEqual(previewed(), ['Azul', 'Duo']);
  dom.call('closeSheet');
});

test('a guest game nobody brought stays out of the preview', async () => {
  await setup();
  addGuest('Dana');
  assert.deepEqual(previewed(), ['Duo']);
});

test('the start request carries each guest\'s brought games, and a bare name otherwise', async () => {
  const round = await setup();
  const posts = [];
  dom.set('api', async (method, path, body) => {
    if (method === 'POST') posts.push(plain(body));
    return { session: { id: 's1' } };
  });
  addGuest('Dana');
  addGuest('Eli');
  guestSeats()[0].click();
  sheet().querySelector('.guest-sheet__picks .chip').click();
  dom.call('closeSheet');
  dom.app.querySelector('#go').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].guests, [{ name: 'Dana', gameIds: ['x1'] }, 'Eli']);
  assert.ok(round);
});

test('one box is brought by one guest, and the sheet stops offering at the cap', async () => {
  const many = Array.from({ length: MAX_GUEST_GAMES + 1 }, (_, i) => ({ id: `y${i}`, title: `Box ${i}`, guestGame: true }));
  await setup(roundFixture({ games: many }));
  addGuest('Dana');
  addGuest('Eli');
  guestSeats()[0].click();
  for (let i = 0; i < MAX_GUEST_GAMES; i++) sheet().querySelector('.guest-sheet__picks .chip').click();
  assert.equal(sheet().querySelector('[data-act="bring"]').hidden, true, 'the sheet offers a game the server would drop');
  assert.equal(sheet().querySelector('.guest-sheet__cap').hidden, false);
  dom.call('closeSheet');
  guestSeats()[1].click();
  assert.deepEqual([...sheet().querySelectorAll('.guest-sheet__picks .chip')].map((c) => c.textContent.trim()),
    [`Box ${MAX_GUEST_GAMES}`], 'a box Dana brought is offered to Eli as well');
  dom.call('closeSheet');
});

test('„Spiel mitbringen" opens the add-game form as a guest game, and a save brings it', async () => {
  const round = await setup(roundFixture({ games: [{ id: 'g1', title: 'Duo', minPlayers: 1, maxPlayers: 4 }] }));
  const sent = [];
  dom.set('api', async (method, path, body) => {
    sent.push([method, path, body && typeof body.get === 'function' ? body.get('guestGame') : null]);
    return { id: 'new1', title: 'Cascadia', minPlayers: 1, maxPlayers: 4, guestGame: true };
  });
  addGuest('Dana');
  guestSeats()[0].click();
  sheet().querySelector('[data-act="bring"]').click();
  const form = dom.document.querySelector('.sheet');
  assert.equal(form.querySelector('#ownerField'), null, 'a guest game has no owners to pick');
  assert.equal(form.querySelector('#saveMore'), null);
  form.querySelector('#title').value = 'Cascadia';
  form.querySelector('#save').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent[0], ['POST', `/api/rounds/${round.id}/games`, 'true']);
  assert.ok(sheet(), 'the guest sheet came back with the new game');
  assert.deepEqual([...sheet().querySelectorAll('.guest-sheet__title')].map((x) => x.textContent), ['Cascadia']);
  assert.deepEqual(previewed(), ['Cascadia', 'Duo'], 'the new guest game joined the pool preview');
  dom.call('closeSheet');
});

test('the results offer appears for the guest game a finished session PLAYED, and releases it', async () => {
  const round = roundFixture();
  const session = {
    id: 's1', finished: true, chosenGameId: 'x1', gameIds: ['x1', 'x2', 'g1'],
    guests: [{ id: 'q', name: 'Dana', gameIds: ['x1', 'x2'] }],
  };
  const games = round.games.filter((g) => session.gameIds.includes(g.id));
  const sent = [];
  dom.set('api', async (method, path, body) => { sent.push([method, path, plain(body)]); return {}; });
  assert.equal(dom.call('guestGameOffers', round, { ...session, finished: false }, games), null,
    'a running session is not asked what becomes of a box nobody has played yet');
  const el = dom.call('guestGameOffers', round, session, games);
  assert.ok(el);
  assert.equal(el.querySelectorAll('.guest-offer__row').length, 1,
    'only the PLAYED guest game is offered — x2 was drawn but not played');
  assert.match(el.textContent, /Azul/);
  assert.equal(dom.call('guestGameOffers', round, { ...session, finished: false, cancelled: true }, games), null,
    'a cancelled session played nothing');
  assert.equal(dom.call('guestGameNote', session, round.games[1]), 'mitgebracht von Dana');
  el.querySelector('[data-to="wish"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, [['POST', `/api/rounds/${round.id}/games/x1/guest-game`, { to: 'wish' }]]);
});

test('a guest game that was later shelved and retired keeps BOTH badges on the results row', () => {
  const session = { guests: [{ id: 'q', name: 'Dana', gameIds: ['x1'] }] };
  const html = dom.call('resultArchivedBadge', { id: 'x1', title: 'Azul', retired: true }, session);
  assert.match(html, /tag--guest/);
  assert.match(html, /tag--retired/, 'the guest tag hid the game\'s current state');
});

test('a box the server REUSES moves to the guest who brought it last', async () => {
  // Eli enters „Azul" by hand while Dana already brought it: the server hands
  // back Dana's row (the reuse), and it must not end up brought twice.
  await setup();
  dom.set('api', async () => ({ id: 'x1', title: 'Azul', minPlayers: 1, maxPlayers: 4, guestGame: true }));
  addGuest('Dana');
  addGuest('Eli');
  guestSeats()[0].click();
  sheet().querySelector('.guest-sheet__picks .chip').click();
  dom.call('closeSheet');
  guestSeats()[1].click();
  sheet().querySelector('[data-act="bring"]').click();
  const form = dom.document.querySelector('.sheet');
  form.querySelector('#title').value = 'Azul';
  form.querySelector('#save').click();
  await new Promise((r) => setTimeout(r, 0));
  dom.call('closeSheet');
  assert.deepEqual(guestSeats().map((seat) => (seat.querySelector('.nr-seat__brought') || {}).textContent || '0'), ['0', '1']);
});

test('„Gastspiele" lists guest games with both ways out, and hides from the strip while empty', async () => {
  const round = roundFixture({ sessions: [{ id: 's1', gameIds: ['x1'], guests: [{ id: 'q', name: 'Dana', gameIds: ['x1'] }] }] });
  dom.set('api', async () => round);
  dom.app.innerHTML = '';
  await dom.call('showGuestGames', round.id);
  const rows = [...dom.app.querySelectorAll('.archive-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.archive-row__title').textContent), ['Azul', 'Gross']);
  assert.match(rows[0].querySelector('.archive-row__meta').textContent, /mitgebracht von Dana/);
  assert.ok(rows[0].querySelector('[data-act="restore"]') && rows[0].querySelector('[data-act="alt"]'));

  const plainRound = roundFixture({ games: [{ id: 'g1', title: 'Duo' }] });
  const subs = dom.call('offShelfEntries', plainRound).map((e) => e.sub);
  assert.equal(subs.includes('guestgames'), false, 'an empty Gastspiele list is advertised on every Regal');
  assert.ok(dom.call('offShelfEntries', round).some((e) => e.sub === 'guestgames'));
});

test('the Chronik names a guest game and who brought it, in the entry itself', async () => {
  const round = roundFixture({
    sessions: [{
      id: 's1', createdAt: '2026-10-01T18:00:00Z', finished: true, chosenGameId: 'x1', gameIds: ['x1'],
      memberIds: ['m1'], votes: {}, votedIds: [], winnerIds: [], cancelled: false, done: true, events: [],
      guests: [{ id: 'q', name: 'Dana', gameIds: ['x1'] }],
    }],
  });
  dom.set('accountsActive', () => false);
  dom.set('api', async (method, url) => {
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return url.endsWith('/activities') ? [] : {};
  });
  dom.app.innerHTML = '';
  await dom.call('showRound', round.id, 'chronik');
  const entry = dom.app.querySelector('.session-card__title');
  assert.ok(entry, 'no session entry rendered');
  assert.match(entry.textContent, /Azul\s+mitgebracht von Dana/);
});
