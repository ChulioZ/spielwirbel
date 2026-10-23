'use strict';

/* The member screen's „Stärkstes Spiel" tile (#920).
 *
 * It named the game with the highest summed per-game SIEGWERTUNG until
 * 2026-09-22, when that measure was withdrawn from the whole app (operator).
 * What replaces it is the game this member wins most OFTEN when they play it —
 * wins over contested plays. Since #1715 it is RANKED by that rate adjusted
 * toward the member's own overall win rate (`bestGameValue`, member-stats.js),
 * so one lucky win cannot take the tile, and it no longer has a play floor —
 * a floor named a 0 % game for a member whose every win sat below it.
 *
 * TWO PROPERTIES OF THE DENOMINATOR ARE LOAD-BEARING and are what the cases
 * below spend most of their effort on:
 *
 *   - it is `contested`, the same denominator `winRate` uses, so a SOLO night
 *     is not a play. Counting solo nights would read 100 % for a pure solo
 *     logger, which is the naive rate that is worse than the count it replaced
 *     — the trap #895 was originally written to close;
 *   - the adjustment only RANKS: the tile still prints the raw rate and plays
 *     of the game it names, never the adjusted value.
 *
 * Plus everything the derivation deliberately leaves to its caller:
 *
 *   - which games may be NAMED (the `isNameableGame` bar — a retired game still
 *     counts toward the rate but may not be named by it),
 *   - the tie convention, broken by plays before sharing,
 *   - the empty state, which is "no game won yet" — a never-won game is never
 *     named,
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
// helper because spelling every night out per game buries the case in fixture.
const nights = (gid, n, wins, winner = 'm1') =>
  Array.from({ length: n }, (_, i) => night(gid, i < wins ? winner : 'm2'));

const CATAN = { id: 'g1', title: 'Catan', tagIds: [] };
const AZUL = { id: 'g2', title: 'Azul', tagIds: [] };
/* A RETIRED game, used only to set the member's overall rate — the prior the
   adjustment pulls toward. It counts toward that rate but may never be named
   (`isNameableGame`), so it moves the prior without competing for the tile. */
const DIXIT = { id: 'g3', title: 'Dixit', tagIds: [], retired: true };

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

/* The adjusted value, read from the implementation so a case can state the
   prior it was designed around rather than restating K. */
const { bestGameValue, BEST_GAME_PRIOR_PLAYS } = require('../public/js/member-stats');

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

test('the live shape: wins only in games under three plays still name a WON game', async (t) => {
  /* #1715, seen live as „Castle Combo · 0% · 3×" beside 7 Siege. Every win sat
     in a game with fewer than three contested plays, so under the old floor the
     only rankable game was one the member had never won. Azul is 2/2, Catan 0/3. */
  const round = roundWith([CATAN, AZUL], [...nights('g1', 3, 0), ...nights('g2', 2, 2)]);
  const { titles, sub } = await bestTile(t, round);
  assert.deepEqual(titles, ['Azul'], 'a won game takes the tile, not the 0 % one');
  assert.match(sub, /100\s*%/, 'the sub-line prints the RAW rate, never the adjusted one');
  assert.match(sub, /2/, 'and the raw plays it rests on');
});

test('4/5 ranks above 1/1 — one lucky win does not beat a solid record', async (t) => {
  // Dixit (retired, 0/5) brings the member's rate to 5/11 ≈ 0.45, the case the
  // issue specifies. 1/1 has the higher raw rate and must still lose.
  const round = roundWith(
    [CATAN, AZUL, DIXIT],
    [...nights('g1', 5, 4), ...nights('g2', 1, 1), ...nights('g3', 5, 0)]
  );
  const prior = 5 / 11;
  assert.ok(bestGameValue(4, 5, prior) > bestGameValue(1, 1, prior), 'the fixture is the case it names');
  const { titles, sub } = await bestTile(t, round);
  assert.deepEqual(titles, ['Catan']);
  assert.match(sub, /80\s*%/);
});

test('1/1 ranks above 1/4', async (t) => {
  // Dixit (retired, 3/6) puts the prior at 5/11 again.
  const round = roundWith(
    [CATAN, AZUL, DIXIT],
    [...nights('g1', 4, 1), ...nights('g2', 1, 1), ...nights('g3', 6, 3)]
  );
  const { titles, sub } = await bestTile(t, round);
  assert.deepEqual(titles, ['Azul']);
  assert.match(sub, /100\s*%/);
});

test('ties are broken by PLAYS before the tile is shared', async (t) => {
  /* Equal ADJUSTED values off different plays: the record is 3/6, a prior of
     exactly 1/2, and a game AT the prior adjusts to the prior whatever its plays
     — so 2/4 and 1/2 tie on the value. They are not equal evidence, and without
     the tie-break the tile would name both.

     Azul (the THINNER record) is played first on purpose: the ranking keeps the
     first game it meets on a tie, so in the other order insertion would answer
     for the tie-break and the test would pass with it deleted. */
  const round = roundWith([CATAN, AZUL], [...nights('g2', 2, 1), ...nights('g1', 4, 2)]);
  assert.equal(bestGameValue(2, 4, 0.5), bestGameValue(1, 2, 0.5), 'the fixture is a genuine tie on the adjusted value');
  const { titles, sub } = await bestTile(t, round);
  assert.deepEqual(titles, ['Catan'], 'the better-evidenced game takes the tile alone');
  assert.match(sub, /50\s*%/);
  assert.match(sub, /4/);
});

test('every genuinely tied game shares the tile', async (t) => {
  // Same rate AND same plays: nothing separates them, so both are named.
  const round = roundWith([CATAN, AZUL], [...nights('g1', 3, 3), ...nights('g2', 3, 3)]);
  const { titles } = await bestTile(t, round);
  assert.deepEqual(titles.sort(), ['Azul', 'Catan']);
});

test('a member with contested plays but no win sees the empty state', async (t) => {
  /* A never-won game is never named (#1715). This used to show „Catan · 0 %" as
     the member's strongest game, which is the live bug's shape with nothing else
     beside it; the tile now says no game has been won yet. */
  const round = roundWith([CATAN, AZUL], [...nights('g1', 3, 0), ...nights('g2', 1, 0)]);
  const { titles, sub, empty } = await bestTile(t, round);
  assert.deepEqual(titles, []);
  assert.ok(empty, 'the empty state must appear');
  assert.equal(sub, '', 'and it carries no rate line');
});

test('bestGameValue pulls a rate toward the prior by BEST_GAME_PRIOR_PLAYS plays', () => {
  assert.ok(Number.isFinite(BEST_GAME_PRIOR_PLAYS) && BEST_GAME_PRIOR_PLAYS > 0);
  // K plays at the prior: the formula's own shape, pinned so a swapped
  // argument order (plays before wins) cannot pass.
  assert.equal(bestGameValue(0, 0, 0.5), 0.5, 'with no plays the value IS the prior');
  assert.equal(bestGameValue(2, 4, 0.5), 0.5, 'a game AT the prior adjusts to the prior');
  assert.ok(bestGameValue(3, 4, 0.5) < 0.75 && bestGameValue(3, 4, 0.5) > 0.5, 'and one above it is pulled toward it, not past it');
});

// ---- the denominator -------------------------------------------------------

test('a SOLO night is not a play — it can neither lift nor create a best game', async (t) => {
  /* The sharpest case in this file. Five solo nights at Azul are five wins, and
     counting them would make Azul a 100 % game off five plays and hand it the
     tile. The denominator is `contested`, so they are not plays at all and Azul
     is never a candidate. */
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
