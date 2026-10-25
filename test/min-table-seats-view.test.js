'use strict';

/* The minimum-table-size stepper on the setup screen and its effect on the
   table builder (#1730), rendered for real under jsdom.

   Run through the harness rather than `require`, like every other view spec
   (.claude/rules/frontend-helper-modules-and-coverage.md). The route half —
   pool, storage, proposals, validation — is test/min-table-seats.test.js. */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { drawPool } = require('../lib/draw');
const { loadApp } = require('./support/dom');

// Four members: 'Duo' (2-2) seats no table of three, so it is the box the
// stepper moves in and out of the multi-table pool.
const round = {
  id: 'r1',
  name: 'Freitagsrunde',
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
    { id: 'm3', name: 'Cleo' },
    { id: 'm4', name: 'Dana' },
  ],
  games: [
    { id: 'g1', title: 'Azul' },
    { id: 'g4', title: 'Duo', minPlayers: 2, maxPlayers: 2 },
    { id: 'g5', title: 'Catan', minPlayers: 3, maxPlayers: 4 },
    { id: 'g6', title: 'Trio', minPlayers: 3, maxPlayers: 3 },
  ],
};

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);

const previewed = () =>
  [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort();
const drawable = (over) =>
  drawPool(round, { playerCount: 4, multiTable: true, ...over }).map((g) => g.title).sort();
const opts = () => dom.app.querySelector('#multiTableOpts');
const value = () => dom.app.querySelector('#minTableSeats').value;
const step = (d) => opts().querySelector(`.stepper__btn[data-d="${d}"]`).click();
const multiChip = () => dom.app.querySelector('.setup-addons__chip[data-addon="multi"]');

test('the stepper exists only while „Mehrere Tische" is on, and starts at 3', async () => {
  await dom.call('showStartSession', round);
  assert.equal(opts().hidden, true, 'no control for a single-table evening');
  multiChip().click();
  assert.equal(opts().hidden, false);
  assert.equal(value(), '3');
  multiChip().click();
  assert.equal(opts().hidden, true);
});

test('stepping the minimum moves the preview exactly as the draw would', async () => {
  await dom.call('showStartSession', round);
  multiChip().click();
  assert.deepEqual(previewed(), drawable({}), 'default');
  assert.deepEqual(previewed(), ['Azul', 'Catan', 'Trio']);

  step(-1);
  assert.equal(value(), '2');
  assert.deepEqual(previewed(), drawable({ minTableSeats: 2 }));
  assert.deepEqual(previewed(), ['Azul', 'Catan', 'Duo', 'Trio'], 'at 2 the duo box joins');

  step(1);
  step(1);
  assert.equal(value(), '4');
  assert.deepEqual(previewed(), drawable({ minTableSeats: 4 }));
  assert.deepEqual(previewed(), ['Azul', 'Catan'], 'at 4 the trio box leaves');
});

test('the stepper clamps to 2–6, by button and by typing', async () => {
  await dom.call('showStartSession', round);
  multiChip().click();
  for (let i = 0; i < 5; i++) step(-1);
  assert.equal(value(), '2');
  for (let i = 0; i < 10; i++) step(1);
  assert.equal(value(), '6');
  const input = dom.app.querySelector('#minTableSeats');
  input.value = '1';
  input.dispatchEvent(new dom.window.Event('change'));
  assert.equal(value(), '2');
});

test('it does not hijack the game-count stepper, nor the other way round', async () => {
  // Both are `.stepper`s in one form; the count's wiring used to take every
  // `.stepper__btn` it found.
  await dom.call('showStartSession', round);
  multiChip().click();
  const count = dom.app.querySelector('#count');
  const before = count.value;
  step(-1);
  assert.equal(count.value, before, 'the minimum stepper moved the game count');
  dom.app.querySelector('.setup-bar .stepper__btn[data-d="1"]').click();
  assert.equal(value(), '2', 'the count stepper moved the minimum');
});

test('the draw carries the minimum, and a remembered one is restored', async () => {
  dom.window.matchMedia = (q) => ({ matches: /prefers-reduced-motion:\s*reduce/.test(q) });
  const bodies = [];
  dom.set('api', async (method, path, body) => {
    bodies.push({ ...body });
    return { session: { id: 's1', gameIds: [] }, games: [], members: [], guests: [], teams: [] };
  });
  dom.set('showSessionLobby', () => {});

  await dom.call('showStartSession', round);
  multiChip().click();
  step(-1);
  dom.app.querySelector('#go').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(bodies[0].multiTable, true);
  assert.equal(bodies[0].minTableSeats, 2);

  await dom.call('showStartSession', { ...round, lastSessionFilters: { multiTable: true, minTableSeats: 5, tagIds: [], excludeTagIds: [], count: 3 } });
  assert.equal(opts().hidden, false);
  assert.equal(value(), '5');
});

test('a saved filter without the key replays the default, not last week\'s minimum', async () => {
  const prefill = dom.call('savedFilterPrefill', { id: 'f', name: 'x', tagIds: [], excludeTagIds: [], count: 2, multiTable: true });
  assert.equal(prefill.minTableSeats, null);
  await dom.call('showStartSession', { ...round, lastSessionFilters: { multiTable: true, minTableSeats: 5, count: 3 } }, prefill);
  assert.equal(value(), '3');
  assert.equal(dom.call('savedFilterPrefill', { multiTable: true, minTableSeats: 4 }).minTableSeats, 4);
});

/* ---- the builder reads the SESSION's minimum ---- */

const MEMBERS = ['Anna', 'Ben', 'Dana', 'Eli', 'Frida', 'Georg'].map((name, i) => ({ id: 'm' + i, name }));
const GAMES = [
  { id: 'g1', title: 'Catan', minPlayers: 2, maxPlayers: 4 },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4 },
];
const votes = {};
MEMBERS.forEach((m) => { votes[m.id] = { g1: { rating: 4 }, g2: { rating: 4 } }; });

async function builder(t, session, tables) {
  const bdom = loadApp({ locale: 'de' });
  t.after(() => bdom.close());
  bdom.set('api', async (method, path) => (path.endsWith('/tables') ? { proposals: [{ tables }] } : {}));
  bdom.set('toast', () => {});
  bdom.set('roundCan', () => true);
  const rnd = { id: 7, name: 'R', members: MEMBERS, games: GAMES, sessions: [], tags: [] };
  await bdom.call('showTableBuilder', rnd, {
    id: 's1', createdAt: '2026-10-20T18:00:00.000Z', memberIds: MEMBERS.map((m) => m.id),
    gameIds: ['g1', 'g2'], votes, multiTable: true, done: true, finished: false, cancelled: false,
    chosenGameId: null, winnerIds: [], events: [], ...session,
  }, GAMES);
  return [...bdom.app.querySelectorAll('.tables-card')];
}
const TWO_AND_FOUR = [
  { gameId: 'g1', personIds: ['m0', 'm1'] },
  { gameId: 'g2', personIds: ['m2', 'm3', 'm4', 'm5'] },
];
const THREE_AND_THREE = [
  { gameId: 'g1', personIds: ['m0', 'm1', 'm2'] },
  { gameId: 'g2', personIds: ['m3', 'm4', 'm5'] },
];
const warn = (card) => card.querySelector('.tables-card__warn').textContent;

test('a table of two is flagged on a legacy session and accepted at minimum 2', async (t) => {
  const legacy = await builder(t, {}, TWO_AND_FOUR);
  assert.ok(legacy[0].classList.contains('is-invalid'), 'no key: the default of 3 applies');
  assert.match(warn(legacy[0]), /Mindestens 3 Plätze/);

  const atTwo = await builder(t, { minTableSeats: 2 }, TWO_AND_FOUR);
  assert.equal(atTwo[0].classList.contains('is-invalid'), false);
});

test('at minimum 4 a table of three is flagged, naming the session\'s number', async (t) => {
  const cards = await builder(t, { minTableSeats: 4 }, THREE_AND_THREE);
  assert.ok(cards[0].classList.contains('is-invalid'));
  assert.match(warn(cards[0]), /Mindestens 4 Plätze/);
});
