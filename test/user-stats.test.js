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
const { accountStats, gameKey } = require('../lib/user-stats');

const UID = 'u-ada';

// --- fixtures ---------------------------------------------------------------

let n = 0;
const uid = () => `x${(n += 1)}`;

function seatUser({ id = UID, tenantId = 't-ada' } = {}) {
  store.data.users = store.data.users || [];
  store.data.users.push({ id, tenantId, email: `${id}@example.com`, username: id });
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
    'avgGiven', 'bestGames', 'bestScore', 'favAvg', 'favorite',
    'gamesPlayed', 'rounds', 'sessions', 'winRate', 'winScore', 'wins',
  ]);
  // A game tile carries what it draws with and nothing that identifies where it
  // was played — no game id either, which would be meaningless off its round.
  assert.deepEqual(Object.keys(st.favorite[0]).sort(), ['image', 'title']);

  const json = JSON.stringify(st);
  for (const leak of ['Runde', 'Ada', 'Bo', 't-ada', 'm-me', 'g1']) {
    assert.equal(json.includes(leak), false, `payload must not carry ${leak}`);
  }
});

// --- empty and unknown ------------------------------------------------------

test('an account with no seat gets a real zero record; an unknown one gets null', async () => {
  reset();
  seatUser();
  const st = await accountStats(UID);
  assert.equal(st.sessions, 0);
  assert.equal(st.rounds, 0);
  // null rather than 0: "never been in a contest" is not "never wins" (#1075).
  assert.equal(st.winRate, null);
  assert.equal(st.avgGiven, null);
  assert.equal(st.bestScore, null, '0 is a real Siegwertung, so absence must not read as one');

  assert.equal(await accountStats('nobody-at-all'), null);
});
