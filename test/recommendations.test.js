'use strict';

/* GET /api/rounds/:rid/recommendations (#682) — the route around the scoring.
 * The ranking itself is covered term by term in test/recommend.test.js; what is
 * asserted here is the wiring: the round is read whole (the ratings and party
 * sizes are half the profile), the corpus comes from the process cache, and
 * every honest empty state answers 200 rather than an error. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, createRound } = require('./helpers');
const repo = require('../lib/repo');
const corpusCache = require('../lib/corpus-cache');
const { MIN_PROFILE_GAMES } = require('../lib/recommend');

const info = (over = {}) => ({
  weight: 3,
  minPlayers: 2,
  maxPlayers: 4,
  minPlaytime: 45,
  maxPlaytime: 60,
  minAge: 12,
  categories: ['Economic'],
  mechanics: ['Worker Placement'],
  families: [],
  designers: [],
  implementations: [],
  bestWith: [2],
  recommendedWith: [2, 3],
  ...over,
});

// Seed the global corpus and drop the process snapshot — the route reads through
// lib/corpus-cache.js, which only invalidates on writes made through
// lib/corpus.js, and these go straight to the repo.
async function seedCorpus(rows) {
  await repo.replaceCorpus(
    rows.map((r, i) => ({
      externalId: r.externalId,
      name: r.name,
      year: 2015,
      rank: r.rank ?? i + 1,
      rating: 7.6,
      bayesRating: r.bayesRating ?? 7,
      usersRated: 4000,
    })),
    { dumpDate: '2026-08-01', uploadedAt: '2026-08-14T00:00:00.000Z' },
  );
  await repo.updateCorpusEntries(
    rows.filter((r) => r.info).map((r) => ({ externalId: r.externalId, enrichedAt: '2026-08-14T01:00:00.000Z', info: r.info })),
  );
  corpusCache.invalidate();
}

// A round whose shelf clears the profile floor, every game linked to BGG.
async function seedRound(over = {}) {
  const round = await createRound(request, { name: 'Rec round', members: ['Alice', 'Bob'], ...over });
  for (let i = 1; i <= MIN_PROFILE_GAMES; i += 1) {
    await request(app)
      .post(`/api/rounds/${round.id}/games`)
      .field('title', `Owned ${i}`)
      .field('minPlayers', '2')
      .field('maxPlayers', '4')
      .field('sourceProvider', 'bgg')
      .field('sourceExternalId', `o${i}`);
  }
  return round;
}

const ownedRows = () => {
  const rows = [];
  for (let i = 1; i <= MIN_PROFILE_GAMES; i += 1) rows.push({ externalId: `o${i}`, name: `Owned ${i}`, info: info() });
  return rows;
};

test('a round with a profile gets ranked recommendations, each with a reason and a BGG link', async () => {
  const round = await seedRound();
  await seedCorpus([
    ...ownedRows(),
    { externalId: '999', name: 'Great Match', rank: 40, bayesRating: 8.4, info: info() },
    { externalId: '998', name: 'Poor Match', rank: 41, bayesRating: 5.6, info: info({ weight: 4.9, maxPlaytime: 400 }) },
  ]);

  const res = await request(app).get(`/api/rounds/${round.id}/recommendations`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.recommendations.map((r) => r.externalId), ['999', '998']);

  const [top] = res.body.recommendations;
  assert.equal(top.title, 'Great Match');
  assert.equal(top.url, 'https://boardgamegeek.com/boardgame/999');
  assert.ok(top.reasons.length > 0, 'a ranked list with no reasons is indistinguishable from a guess');
  assert.ok(top.score > res.body.recommendations[1].score);
  assert.equal(res.body.profileGames, MIN_PROFILE_GAMES);
  assert.equal(res.body.minProfileGames, MIN_PROFILE_GAMES);
});

test('a game already on the shelf is never recommended back', async () => {
  const round = await seedRound();
  await seedCorpus([...ownedRows(), { externalId: '999', name: 'Great Match', rank: 40, bayesRating: 8.4, info: info() }]);
  const res = await request(app).get(`/api/rounds/${round.id}/recommendations`);
  const ids = res.body.recommendations.map((r) => r.externalId);
  assert.deepEqual(ids, ['999']);
  assert.ok(!ids.some((id) => id.startsWith('o')));
});

test('a thin shelf answers 200 with the counts that explain the empty list', async () => {
  const round = await createRound(request, { name: 'Fresh round' });
  await seedCorpus([...ownedRows(), { externalId: '999', name: 'Great Match', info: info() }]);
  const res = await request(app).get(`/api/rounds/${round.id}/recommendations`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.recommendations, []);
  assert.equal(res.body.profileGames, 0);
  assert.equal(res.body.linkedGames, 0);
  // The corpus count is what lets the screen tell "your shelf is too thin" from
  // "this instance has no corpus" — two empty states with opposite advice.
  assert.ok(res.body.corpusRows > 0);
});

test('an EMPTY corpus is an empty list, not an error — an instance may have none', async () => {
  const round = await seedRound();
  await seedCorpus([]);
  const res = await request(app).get(`/api/rounds/${round.id}/recommendations`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.recommendations, []);
  assert.equal(res.body.corpusRows, 0);
  assert.equal(res.body.linkedGames, MIN_PROFILE_GAMES, 'the shelf is fine, the corpus is not');
  assert.equal(res.body.profileGames, 0);
});

test('the round\'s own ratings shape the ranking', async () => {
  const round = await seedRound();
  // Two candidates identical but for their mechanic; the group has rated the
  // owned game carrying one of them at the top of the scale and the other at the
  // bottom, so only the sessions can tell them apart.
  const rows = ownedRows();
  rows[0].info = info({ mechanics: ['Loved Mechanic'] });
  rows[1].info = info({ mechanics: ['Hated Mechanic'] });
  await seedCorpus([
    ...rows,
    // 902 holds the BETTER rank, which is the tie-break. So if the votes never
    // land — a mis-shaped session fixture, a rating the profile ignores — the two
    // score identically and 902 comes FIRST, and this spec fails instead of
    // passing on the ordering it was going to assert anyway.
    { externalId: '901', name: 'Like the loved one', rank: 51, info: info({ mechanics: ['Loved Mechanic'] }) },
    { externalId: '902', name: 'Like the hated one', rank: 50, info: info({ mechanics: ['Hated Mechanic'] }) },
  ]);

  const full = (await request(app).get(`/api/rounds/${round.id}`)).body;
  const [loved, hated] = full.games;
  // A DRAWN session over the whole shelf, not a direct pick: a direct-pick
  // session is born `done`, and a vote written to a closed session is refused —
  // so the ratings would never exist and this spec would assert nothing.
  const start = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: MIN_PROFILE_GAMES, memberIds: full.members.map((m) => m.id) });
  const session = start.body.session || start.body;
  assert.ok(session && session.id, `the fixture session was not created: ${JSON.stringify(start.body)}`);
  const voted = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${full.members[0].id}`)
    .send({ votes: { [loved.id]: { rating: 5 }, [hated.id]: { rating: 1 } } });
  assert.equal(voted.status, 200);
  // Close it before reading the votes back: an OPEN session ships `votes: {}` to
  // every client by design (.claude/rules/per-device-session-voting.md §1), so
  // the read below would say nothing about what was stored.
  assert.equal((await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({})).status, 200);
  // The vote's own 200 is not evidence either: a vote for a game the session does
  // not hold is dropped by the route's sanitizer, which also answers 200. Read
  // the ratings back, or this spec asserts an ordering that nothing produced.
  const stored = (await request(app).get(`/api/rounds/${round.id}`)).body.sessions.find((s) => s.id === session.id);
  assert.equal(stored.votes[full.members[0].id][loved.id].rating, 5);
  assert.equal(stored.votes[full.members[0].id][hated.id].rating, 1);

  const res = await request(app).get(`/api/rounds/${round.id}/recommendations`);
  const ids = res.body.recommendations.map((r) => r.externalId);
  assert.ok(ids.indexOf('901') < ids.indexOf('902'), `expected the loved mechanic first, got ${ids}`);
});

test('an unknown round is a 404, like every other round-scoped read', async () => {
  const res = await request(app).get('/api/rounds/nope/recommendations');
  assert.equal(res.status, 404);
});
