'use strict';

/*
 * The account-wide aggregate behind /u/<username> (issue #1089, lib/user-stats.js).
 *
 * Seeded straight into the store rather than driven over HTTP: every assertion
 * here is about ARITHMETIC ACROSS SEATS, and the interesting fixtures — two
 * seats whose win rates differ, the same game on two shelves, a grant pointing
 * at a round in another tenant — are a dozen lines of data and would be a
 * hundred of API calls. The HTTP surface (who may see this, and when) is pinned
 * in test/profile.test.js instead.
 *
 * The sharpest case is `winRate`: an implementation that averages the two
 * per-seat rates passes every other assertion in this file.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { store } = require('./helpers');
const { BEST_GAME_MIN_PLAYS } = require('../public/js/member-stats');
const { accountStats, gameKey } = require('../lib/user-stats');

const UID = 'u-ada';

// --- fixtures ---------------------------------------------------------------

let n = 0;
const uid = () => `x${(n += 1)}`;

function seatUser({ id = UID, tenantId = 't-ada', createdAt } = {}) {
  store.data.users = store.data.users || [];
  store.data.users.push({ id, tenantId, email: `${id}@example.com`, username: id, ...(createdAt ? { createdAt } : {}) });
  return id;
}

// One round with `mine` seated, plus a second member so a session can be a
// CONTEST (sessionPartyCount > 1 — a solo night is not one, #895).
function round({ tenantId = 't-ada', games = [], sessions = [], seat = UID }) {
  const r = {
    id: uid(),
    tenantId,
    name: 'Runde',
    members: [
      { id: 'm-me', name: 'Ada', userId: seat },
      { id: 'm-other', name: 'Bo', userId: null },
    ],
    games,
    sessions,
    activity: [],
  };
  store.data.rounds.push(r);
  return r;
}

const game = (id, title, over = {}) => ({
  id, title, minPlayers: 1, maxPlayers: 4, retired: false, completed: false, image: null, ...over,
});

// A finished, contested session: both members at the table, one winner.
const played = (id, gid, { winner = 'm-me', votes = {} } = {}) => ({
  id,
  finished: true,
  cancelled: false,
  memberIds: ['m-me', 'm-other'],
  winnerIds: winner ? [winner] : [],
  gameIds: [gid],
  chosenGameId: gid,
  votes,
  createdAt: '2026-01-01T10:00:00.000Z',
  finishedAt: '2026-01-01T12:00:00.000Z',
});

function reset() {
  store.data.rounds = [];
  store.data.users = [];
  store.data.roundGrants = [];
}

// --- the merge identity -----------------------------------------------------

test('a game is identified across rounds by its provider id, else by folded title', () => {
  const src = { provider: 'bgg', externalId: '224517' };
  assert.equal(
    gameKey(game('a', 'Brass', { source: src })),
    gameKey(game('b', 'Brass: Birmingham', { source: src })),
    'the same provider entry under two local titles is ONE game',
  );
  assert.equal(
    gameKey(game('a', '  Azul ')),
    gameKey(game('b', 'azul')),
    'an unsourced entry folds case and trims',
  );
  // Deliberately NOT merged: a title match across two shelves is a guess, a
  // provider id is an identity, so the conservative direction is two tiles.
  assert.notEqual(
    gameKey(game('a', 'Azul', { source: src })),
    gameKey(game('b', 'Azul')),
    'a sourced and an unsourced entry of the same name stay apart',
  );
});

// --- aggregation across seats ----------------------------------------------

test('the win rate is Σ contested wins / Σ contested sessions, not a mean of rates', async () => {
  reset();
  seatUser();
  // Seat A: 1 of 1 contested won (100%). Seat B: 1 of 3 (33.3%).
  round({ games: [game('g1', 'Azul')], sessions: [played('s1', 'g1')] });
  round({
    games: [game('g2', 'Kingdomino')],
    sessions: [
      played('s2', 'g2'),
      played('s3', 'g2', { winner: 'm-other' }),
      played('s4', 'g2', { winner: 'm-other' }),
    ],
  });

  const st = await accountStats(UID);
  assert.equal(st.sessions, 4);
  assert.equal(st.wins, 2);
  // 2/4 = 0.5. The averaged-rates implementation gives (1 + 1/3) / 2 = 0.667.
  assert.equal(st.winRate, 0.5);
  assert.equal(st.rounds, 2, 'one seat per round');
});

test('the rating average is weighted by COUNT, not averaged per seat', async () => {
  reset();
  seatUser();
  // Seat A: three 5s. Seat B: one 1. Weighted: 16/4 = 4. Per-seat mean: 3.
  round({
    games: [game('g1', 'Azul')],
    sessions: [played('s1', 'g1', {
      votes: { 'm-me': { g1: { rating: 5 } } },
    }), played('s1b', 'g1', {
      votes: { 'm-me': { g1: { rating: 5 } } },
    }), played('s1c', 'g1', {
      votes: { 'm-me': { g1: { rating: 5 } } },
    })],
  });
  round({
    games: [game('g2', 'Kingdomino')],
    sessions: [played('s2', 'g2', { votes: { 'm-me': { g2: { rating: 1 } } } })],
  });

  const st = await accountStats(UID);
  assert.equal(st.avgGiven, 4);
});

test('the same game on two shelves resolves to ONE favourite, merged by provider id', async () => {
  reset();
  seatUser();
  const src = { provider: 'bgg', externalId: '230802' };
  // Azul is rated 5 in one round and 5 in the other; Kingdomino 4 twice. Were
  // the rounds ranked separately, each would name its own local row.
  round({
    games: [game('g1', 'Azul', { source: src }), game('g2', 'Kingdomino')],
    sessions: [played('s1', 'g1', {
      votes: { 'm-me': { g1: { rating: 5 }, g2: { rating: 4 } } },
    })],
  });
  round({
    games: [game('g3', 'Azul (2. Edition)', { source: src })],
    sessions: [played('s2', 'g3', { votes: { 'm-me': { g3: { rating: 5 } } } })],
  });

  const st = await accountStats(UID);
  assert.equal(st.favorite.length, 1, 'one tile, not one per round');
  assert.equal(st.favAvg, 5);
  // Two Azul ROWS, played once each, in two different rounds — one game played.
  // Kingdomino was rated but never chosen, so it was never played at all.
  assert.equal(st.gamesPlayed, 1, 'Azul played in both rounds is ONE game played');
});

test('a retired game still counts toward the numbers but is never NAMED', async () => {
  reset();
  seatUser();
  round({
    games: [game('g1', 'Altes Spiel', { retired: true, retiredAt: '2026-01-01T00:00:00.000Z' })],
    sessions: [played('s1', 'g1', { votes: { 'm-me': { g1: { rating: 5 } } } })],
  });

  const st = await accountStats(UID);
  assert.equal(st.avgGiven, 5, 'the rating counts — it measures how this account rates (#643)');
  assert.equal(st.gamesPlayed, 1, 'the night happened');
  assert.deepEqual(st.favorite, [], 'but a taste tile may not name a retired game');
  assert.deepEqual(st.bestGames, []);
});

test('a seat in a GRANTED round counts exactly like a seat in an own round', async () => {
  reset();
  seatUser();
  const shared = round({
    tenantId: 't-someone-else',
    games: [game('g1', 'Azul')],
    sessions: [played('s1', 'g1')],
  });
  store.data.roundGrants.push({
    id: 'gr1', roundId: shared.id, ownerTenantId: 't-someone-else', userId: UID, role: 'member',
  });

  const st = await accountStats(UID);
  assert.equal(st.rounds, 1);
  assert.equal(st.sessions, 1);
  assert.equal(st.wins, 1);
});

test('a grant whose round is gone is skipped without error', async () => {
  reset();
  seatUser();
  store.data.roundGrants.push({
    id: 'gr1', roundId: 'deleted-round', ownerTenantId: 't-someone-else', userId: UID, role: 'member',
  });

  const st = await accountStats(UID);
  assert.equal(st.rounds, 0);
  assert.equal(st.sessions, 0);
});

// --- the disclosure boundary ------------------------------------------------

test('the payload carries numbers and game titles only — no round, member or tenant', async () => {
  reset();
  seatUser();
  const src = { provider: 'bgg', externalId: '1' };
  round({
    games: [game('g1', 'Azul', { source: src, image: '/uploads/cover.webp' })],
    sessions: [played('s1', 'g1', { votes: { 'm-me': { g1: { rating: 5 } } } })],
  });

  const st = await accountStats(UID);
  assert.deepEqual(Object.keys(st).sort(), [
    'avgGiven', 'badges', 'bestGames', 'bestPlays', 'bestScore', 'favAvg', 'favorite',
    'gamesPlayed', 'rounds', 'sessions', 'winRate', 'wins',
  ]);
  // A game tile carries what it draws with and nothing that identifies where it
  // was played — no game id either, which would be meaningless off its round.
  assert.deepEqual(Object.keys(st.favorite[0]).sort(), ['image', 'title']);

  const json = JSON.stringify(st);
  for (const leak of ['Runde', 'Ada', 'Bo', 't-ada', 'm-me', 'g1']) {
    assert.equal(json.includes(leak), false, `payload must not carry ${leak}`);
  }
});

// --- the account-tier Abzeichen (#1387) ----------------------------------------

test('the account-tier Abzeichen read the same totals, plus the account age', async () => {
  reset();
  // A year and a day ago, so Jahre 1 is earned whatever today is.
  seatUser({ createdAt: new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString() });
  round({ games: [game('g1', 'Azul')], sessions: [played('s1', 'g1')] });
  round({ games: [game('g2', 'Azul')], sessions: [played('s2', 'g2', { winner: 'm-other' })] });

  const st = await accountStats(UID);
  const by = Object.fromEntries(st.badges.map((b) => [b.key, b]));
  assert.deepEqual(Object.keys(by), ['accountSessions', 'accountWins', 'accountRounds', 'accountYears']);
  assert.deepEqual([by.accountSessions.state, by.accountSessions.count, by.accountSessions.of], ['progress', st.sessions, 25]);
  assert.deepEqual([by.accountWins.count, by.accountWins.of], [st.wins, 10]);
  assert.deepEqual([by.accountRounds.state, by.accountRounds.tier], ['earned', 2], 'two seats is Runden 2');
  assert.deepEqual([by.accountYears.state, by.accountYears.tier], ['earned', 1]);
});

// --- empty and unknown ------------------------------------------------------

test('the play floor is applied to the MERGED total, and a thin game is unranked', async () => {
  /* „Stärkstes Spiel" is a win rate with a floor of BEST_GAME_MIN_PLAYS
     (member-stats.js), and across rounds the floor has to be applied to the SUM
     — a game played twice in each of two rounds is four plays of one game, and
     `gameKey` merged it precisely so that it would be. Applying the floor
     per seat would leave it unranked in both halves and therefore absent.

     The floor is read from the implementation rather than restated: a case
     written against "three" stops testing the boundary the day the number moves. */
  reset();
  seatUser();
  // Two different game IDS with the same TITLE — that is what gameKey merges,
  // and using one id in both rounds would not exercise the merge at all.
  const two = (prefix, gid) => [played(`${prefix}1`, gid), played(`${prefix}2`, gid)];
  round({ games: [game('g1', 'Azul')], sessions: two('a', 'g1') });
  round({ games: [game('g9', 'Azul')], sessions: two('b', 'g9') });

  const st = await accountStats(UID);
  assert.ok(BEST_GAME_MIN_PLAYS > 2 && BEST_GAME_MIN_PLAYS <= 4,
    `this case straddles the floor only while it is 3 or 4 — it is ${BEST_GAME_MIN_PLAYS}`);
  assert.deepEqual(st.bestGames.map((g) => g.title), ['Azul'],
    'two plays in each of two rounds is four plays of one game');
  assert.equal(st.bestPlays, 4, 'and the tile states the merged count');
  assert.equal(st.bestScore, 1);
});

test('a game below the merged floor is absent, not ranked at its rate', async () => {
  reset();
  seatUser();
  round({ games: [game('g1', 'Azul')], sessions: [played('s1', 'g1'), played('s2', 'g1')] });
  const st = await accountStats(UID);
  assert.deepEqual(st.bestGames, [], 'two plays is under the floor — unproven is not weak');
  assert.equal(st.bestScore, null);
});

test('an account with no seat gets a real zero record; an unknown one gets null', async () => {
  reset();
  seatUser();
  const st = await accountStats(UID);
  assert.equal(st.sessions, 0);
  assert.equal(st.rounds, 0);
  // null rather than 0: "never been in a contest" is not "never wins" (#1075).
  assert.equal(st.winRate, null);
  assert.equal(st.avgGiven, null);
  assert.equal(st.bestScore, null, '0 % is a real rate, so absence must not read as one');

  assert.equal(await accountStats('nobody-at-all'), null);
});
