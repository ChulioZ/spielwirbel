'use strict';

/* The member screen's „Stärkstes Spiel" tile (#920).
 *
 * It named the game with the highest summed per-game SIEGWERTUNG until
 * 2026-09-22, when that measure was withdrawn from the whole app (operator).
 * What replaces it is the game this member wins most OFTEN when they play it —
 * wins over contested plays — with a floor of BEST_GAME_MIN_PLAYS so one lucky
 * win cannot take the tile.
 *
 * TWO PROPERTIES OF THE DENOMINATOR ARE LOAD-BEARING and are what the cases
 * below spend most of their effort on:
 *
 *   - it is `contested`, the same denominator `winRate` uses, so a SOLO night
 *     is not a play. Counting solo nights would read 100 % for a pure solo
 *     logger, which is the naive rate that is worse than the count it replaced
 *     — the trap #895 was originally written to close;
 *   - the floor is on PLAYS, and a game below it is UNRANKED rather than
 *     ranked at zero: an unproven game is not a weak one.
 *
 * Plus everything the derivation deliberately leaves to its caller:
 *
 *   - which games may be NAMED (the `isNameableGame` bar — a retired game still
 *     counts toward the rate but may not be named by it),
 *   - the tie convention, broken by plays before sharing,
 *   - the empty state, whose trap is that 0 % is a real answer and must not be
 *     mistaken for "nothing",
 *   - and that the named game actually LINKS.
 *
 * Run through the view rather than matched against its source
 * (`.claude/rules/testing-views-under-jsdom.md`) — a regex over
 * `views-member.js` cannot see a link wired to the wrong element.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';

// One finished, contested night: `winner` takes a two-party evening at `gid`,
// which is +0,5 to them and −0,5 to the other seat.
let seq = 0;
const night = (gid, winner, extra = {}) => ({
  id: `s${++seq}`,
  createdAt: '2026-07-01T20:00:00.000Z',
  gameIds: [gid].filter(Boolean),
  memberIds: ['m1', 'm2'],
  votes: {},
  votedIds: [],
  finished: true,
  cancelled: false,
  done: true,
  winnerIds: [winner],
  chosenGameId: gid,
  events: [],
  ...extra,
});

const roundWith = (games, sessions) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
  ],
  games,
  sessions,
});

// N contested nights at `gid`, `wins` of them won by `winner`. Written as a
// helper because every case below needs at least BEST_GAME_MIN_PLAYS of them,
// and spelling three nights out per game buries the case in fixture.
const nights = (gid, n, wins, winner = 'm1') =>
  Array.from({ length: n }, (_, i) => night(gid, i < wins ? winner : 'm2'));

const CATAN = { id: 'g1', title: 'Catan', tagIds: [] };
const AZUL = { id: 'g2', title: 'Azul', tagIds: [] };

function bootApp(t, round) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

async function bestTile(t, round, mid = 'm1') {
  const dom = bootApp(t, round);
  await dom.call('showMember', RID, mid);
  const tile = dom.app.querySelector('.member-stats__best');
  assert.ok(tile, 'the „Stärkstes Spiel" tile must render');
  return {
    tile,
    titles: [...tile.querySelectorAll('.pokale-game__title')].map((a) => a.textContent),
    sub: tile.querySelector('.pokale-card__sub').textContent,
    empty: tile.querySelector('.muted'),
  };
}

/* The floor, read from the implementation rather than restated: a case written
   against "three" is only meaningful while three is the number, and a spec that
   hard-codes it silently stops testing the boundary when it moves. */
const dom0BestFloor = () => require('../public/js/member-stats').BEST_GAME_MIN_PLAYS;

// ---- the happy path --------------------------------------------------------

test('the tile names the game with the highest win RATE, and links it', async (t) => {
  const round = roundWith(
    [CATAN, AZUL],
    // Catan 3/3 = 100 %, Azul 1/3 = 33 %.
    [...nights('g1', 3, 3), ...nights('g2', 3, 1)]
  );
  const { tile, titles, sub } = await bestTile(t, round);

  assert.deepEqual(titles, ['Catan']);
  assert.match(sub, /100\s*%/, 'the sub-line leads with the rate');
  assert.match(sub, /3/, 'and states the plays it rests on — 100 % off three nights is not off thirty');

  const link = tile.querySelector('.pokale-game__title');
  assert.ok(link.classList.contains('game-link'), 'the title must be a real game link');
  assert.match(link.getAttribute('href') || '', /g1/, 'and it must point at that game');
});

test('a game below the play floor is UNRANKED, not ranked low', async (t) => {
  /* The whole point of the floor: at two plays a perfect record is a coin toss.
     Azul is 2/2 — a higher rate than Catan's 2/3 — and must not take the tile.
     An unproven game is not a weak one, so it is absent rather than last. */
  const round = roundWith([CATAN, AZUL], [...nights('g1', 3, 2), ...nights('g2', 2, 2)]);
  const { titles, sub } = await bestTile(t, round);
  assert.equal(dom0BestFloor(), 3, 'this case is written against a floor of three');
  assert.deepEqual(titles, ['Catan'], 'a 2/2 game outrates Catan and is still below the floor');
  assert.match(sub, /67\s*%/);
});

test('ties are broken by PLAYS before the tile is shared', async (t) => {
  // Both at 100 %, one off three nights and one off five. They are not equal
  // evidence, and without the tie-break the tile would name both.
  const round = roundWith([CATAN, AZUL], [...nights('g1', 5, 5), ...nights('g2', 3, 3)]);
  const { titles, sub } = await bestTile(t, round);
  assert.deepEqual(titles, ['Catan'], 'the better-evidenced game takes the tile alone');
  assert.match(sub, /5/);
});

test('every genuinely tied game shares the tile', async (t) => {
  // Same rate AND same plays: nothing separates them, so both are named.
  const round = roundWith([CATAN, AZUL], [...nights('g1', 3, 3), ...nights('g2', 3, 3)]);
  const { titles } = await bestTile(t, round);
  assert.deepEqual(titles.sort(), ['Azul', 'Catan']);
});

test('a 0 % best is shown, not hidden', async (t) => {
  /* This is the member's own stats page, not a leaderboard. A member who has
     only lost has a strongest game; it is simply their least bad one, and the
     tile says so rather than pretending they have none. */
  const round = roundWith([CATAN], nights('g1', 3, 0));
  const { titles, sub, empty } = await bestTile(t, round);
  assert.deepEqual(titles, ['Catan']);
  assert.equal(empty, null, '0 % is an answer, not an empty state');
  assert.match(sub, /0\s*%/);
});

// ---- the denominator -------------------------------------------------------

test('a SOLO night is not a play — it can neither lift nor create a best game', async (t) => {
  /* The sharpest case in this file. Five solo nights at Azul are five wins, and
     counting them would make Azul a 100 % game off five plays and hand it the
     tile. The denominator is `contested`, so they are not plays at all and Azul
     never reaches the floor. */
  const solo = (gid) => night(gid, 'm1', { memberIds: ['m1'], winnerIds: ['m1'] });
  const round = roundWith(
    [CATAN, AZUL],
    [...nights('g1', 3, 2), ...Array.from({ length: 5 }, () => solo('g2'))]
  );
  const { titles, sub } = await bestTile(t, round);
  assert.deepEqual(titles, ['Catan'], 'five solo wins did not buy Azul the tile');
  assert.match(sub, /67\s*%/);
});

test('a member whose only contested plays are solo sees the empty state', async (t) => {
  const solo = night('g1', 'm1', { memberIds: ['m1'], winnerIds: ['m1'] });
  const round = roundWith([CATAN], [solo, { ...solo, id: 's90' }, { ...solo, id: 's91' }]);
  const { titles, empty } = await bestTile(t, round);
  assert.deepEqual(titles, [], 'three solo nights are not three plays');
  assert.ok(empty);
});

// ---- what may be NAMED -----------------------------------------------------

test('a retired game is never named, even when it is where the member wins most', async (t) => {
  /* The bar is `isNameableGame` (recap.js), shared with the Lieblingsspiel tile
     so a game cannot vanish from the Pokale favourites while still sitting
     here. Deliberately the OPPOSITE call from `avgGiven` (#643), which counts
     every rating including retired games: the split is between measuring and
     naming. */
  const round = roundWith(
    [{ ...CATAN, retired: true }, AZUL],
    [...nights('g1', 3, 3), ...nights('g2', 3, 2)]
  );
  const { titles, sub } = await bestTile(t, round);
  assert.deepEqual(titles, ['Azul'], 'the retired game outrates Azul and is still skipped');
  assert.match(sub, /67\s*%/, 'and the rate shown is Azul’s, not the retired game’s');
});

test('a member whose only plays are at retired games sees the empty state', async (t) => {
  const round = roundWith([{ ...CATAN, retired: true }], nights('g1', 3, 3));
  const { titles, sub, empty } = await bestTile(t, round);
  assert.deepEqual(titles, []);
  assert.ok(empty, 'the empty state must appear');
  assert.equal(sub, '', 'and it carries no rate line');
});

test('a game that has left the round entirely is never named', async (t) => {
  const round = roundWith([AZUL], [...nights('gone', 3, 3), ...nights('g2', 3, 2)]);
  const { titles } = await bestTile(t, round);
  assert.deepEqual(titles, ['Azul']);
});

// ---- the empty states that used to crash this screen -----------------------

test('a round where no evening ever recorded a game renders the empty state', async (t) => {
  /* `chosenGameId: null` is the split parent's shape and the shape of any
     evening abandoned before a pick. The whole round being like that is the
     degenerate case, and this screen has crashed on exactly that class of input
     before — see the `st.joined === 0` comment in showMember. */
  const round = roundWith([CATAN], [night(null, 'm1', { chosenGameId: null })]);
  const { titles, empty } = await bestTile(t, round);
  assert.deepEqual(titles, []);
  assert.ok(empty);
});

test('a member with no finished sessions at all renders the tile, not an exception', async (t) => {
  const round = roundWith([CATAN], []);
  const { titles, empty } = await bestTile(t, round);
  assert.deepEqual(titles, []);
  assert.ok(empty);
});
