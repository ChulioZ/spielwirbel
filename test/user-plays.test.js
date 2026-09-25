'use strict';

/*
 * An account's flat play list (issue #1147, lib/user-plays.js) — the server
 * half of „Dein Rückblick". Seeded straight into the store, like
 * test/user-stats.test.js, because every case is about WHICH sessions become
 * rows across several rounds; who may SEE the list is test/profile.test.js's.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { store } = require('./helpers');
const { accountPlays } = require('../lib/user-plays');
const { gameKey } = require('../lib/user-stats');

const UID = 'u-ada';
let n = 0;
const uid = () => `p${(n += 1)}`;

function reset() {
  store.data.rounds = [];
  store.data.users = [{ id: UID, tenantId: 't-ada', email: 'ada@example.com', username: 'ada' }];
  store.data.roundGrants = [];
}

function round({ tenantId = 't-ada', name = 'Runde', games = [], sessions = [] }) {
  const r = {
    id: uid(),
    tenantId,
    name,
    members: [
      { id: 'm-me', name: 'Ada', userId: UID },
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

const played = (id, gid, createdAt, over = {}) => ({
  id,
  finished: true,
  cancelled: false,
  memberIds: ['m-me', 'm-other'],
  winnerIds: ['m-me'],
  gameIds: [gid],
  chosenGameId: gid,
  votes: {},
  createdAt,
  finishedAt: createdAt,
  ...over,
});

test('an unknown account gets null, an account with nothing played an empty list', async () => {
  reset();
  assert.equal(await accountPlays('nobody'), null);
  round({ games: [game('g1', 'Azul')] });
  assert.deepEqual(await accountPlays(UID), []);
});

test('one row per finished session sat at, across an own AND a granted round, oldest first', async () => {
  reset();
  const src = { provider: 'bgg', externalId: '230802' };
  round({
    games: [game('g1', 'Azul', { source: src, image: '/uploads/azul.webp' })],
    sessions: [played('s1', 'g1', '2026-03-05T19:00:00.000Z', { votes: { 'm-me': { g1: { rating: 4 } } } })],
  });
  const shared = round({
    tenantId: 't-someone-else',
    // The same game on another shelf under another title: one key.
    games: [game('h1', 'Azul (Box)', { source: src })],
    sessions: [played('s2', 'h1', '2026-02-10T19:00:00.000Z')],
  });
  store.data.roundGrants.push({
    id: 'gr1', roundId: shared.id, ownerTenantId: 't-someone-else', userId: UID, role: 'member',
  });

  const plays = await accountPlays(UID);
  assert.deepEqual(plays.map((p) => p.at), ['2026-02-10T19:00:00.000Z', '2026-03-05T19:00:00.000Z']);
  assert.equal(plays[0].key, plays[1].key, 'the same provider entry is one game across rounds');
  assert.equal(plays[1].key, gameKey({ title: 'Azul', source: src }));
  assert.equal(plays[1].rating, 4, 'this account\'s own vote on the chosen game');
  assert.equal(plays[0].rating, null, 'no vote is null, never 0');
  assert.equal(plays[1].image, '/uploads/azul.webp');
});

test('only the sessions this account actually sat at, finished and with a game still there', async () => {
  reset();
  round({
    games: [game('g1', 'Azul')],
    sessions: [
      played('s1', 'g1', '2026-03-01T19:00:00.000Z', { memberIds: ['m-other'] }), // not seated
      played('s2', 'g1', '2026-03-02T19:00:00.000Z', { finished: false }), // still open
      played('s3', 'gone', '2026-03-03T19:00:00.000Z'), // the game was deleted
      played('s4', 'g1', '2026-03-04T19:00:00.000Z', { chosenGameId: null }), // nothing chosen
      played('s5', 'g1', '2026-03-05T19:00:00.000Z', { memberIds: undefined }), // legacy: everyone joined
      played('s6', 'g1', '2026-03-06T19:00:00.000Z'),
    ],
  });
  const plays = await accountPlays(UID);
  assert.deepEqual(plays.map((p) => p.at.slice(0, 10)), ['2026-03-05', '2026-03-06']);
});

test('a RETIRED game\'s play counts, its rating is withheld', async () => {
  reset();
  round({
    games: [game('g1', 'Azul', { retired: true })],
    sessions: [played('s1', 'g1', '2026-03-01T19:00:00.000Z', { votes: { 'm-me': { g1: { rating: 5 } } } })],
  });
  const [row] = await accountPlays(UID);
  assert.equal(row.title, 'Azul');
  assert.equal(row.rating, null);
});

test('a row carries play facts only — no round, member or tenant anywhere in it', async () => {
  reset();
  const r = round({
    name: 'Freitagsrunde',
    games: [game('g1', 'Azul')],
    sessions: [played('s1', 'g1', '2026-03-01T19:00:00.000Z', { votes: { 'm-me': { g1: { rating: 3 } } } })],
  });
  const plays = await accountPlays(UID);
  assert.equal(plays.length, 1);
  for (const row of plays) {
    assert.deepEqual(Object.keys(row).sort(), ['at', 'image', 'key', 'rating', 'title']);
  }
  const text = JSON.stringify(plays);
  for (const secret of [r.id, r.name, r.tenantId, 'm-me', 'm-other', 'Ada', 'Bo', 's1', 'g1"']) {
    assert.ok(!text.includes(secret), `the play list leaks ${secret}`);
  }
});
