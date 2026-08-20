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

test('the corpus row\'s cover reaches the card, gated by the host allowlist (#779)', async () => {
  const cover = 'https://cf.geekdo-images.com/abc__small/img/x=/fit-in/200x150/filters:strip_icc()/pic1.jpg';
  const round = await seedRound();
  await seedCorpus([
    ...ownedRows(),
    { externalId: '999', name: 'With cover', rank: 40, bayesRating: 8.4, info: info({ imageUrl: cover }) },
    { externalId: '998', name: 'No cover', rank: 41, bayesRating: 8.3, info: info({ imageUrl: null }) },
    // A host no provider vouches for. It cannot arrive from parseCorpusThing —
    // this is the shape a future parser change, or a hand-edited row, could
    // produce, and it must degrade to the placeholder rather than being
    // interpolated into background-image:url('…') on the client.
    { externalId: '997', name: 'Untrusted host', rank: 42, bayesRating: 8.2, info: info({ imageUrl: 'https://evil.example/x.jpg' }) },
    { externalId: '996', name: 'Quote injection', rank: 43, bayesRating: 8.1, info: info({ imageUrl: "https://cf.geekdo-images.com/a.jpg');background:url('x" }) },
  ]);

  const res = await request(app).get(`/api/rounds/${round.id}/recommendations`);
  assert.equal(res.status, 200);
  const by = Object.fromEntries(res.body.recommendations.map((r) => [r.externalId, r.image]));
  // Verbatim: BGG's real paths carry parens, which providerCoverUrl allows on
  // purpose (.claude/rules/provider-cover-hotlinking.md).
  assert.equal(by['999'], cover);
  assert.equal(by['998'], null);
  assert.equal(by['997'], null);
  assert.equal(by['996'], null);
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

/* ------------------------- „Nicht interessiert" (#782) ------------------------- */

const dismissed = (rid) => request(app).get(`/api/rounds/${rid}/recommendations`).then((r) => r.body.dismissed);

test('a dismissed title leaves the list for good, and the undo brings it back', async () => {
  const round = await seedRound();
  await seedCorpus([
    ...ownedRows(),
    { externalId: '999', name: 'Great Match', rank: 40, bayesRating: 8.4, info: info() },
    { externalId: '998', name: 'Second Match', rank: 41, bayesRating: 8.3, info: info() },
  ]);
  const ids = async () => (await request(app).get(`/api/rounds/${round.id}/recommendations`)).body.recommendations.map((r) => r.externalId);
  assert.deepEqual(await ids(), ['999', '998']);

  const post = await request(app)
    .post(`/api/rounds/${round.id}/recommendations/dismissed`)
    .send({ externalId: '999', title: 'Great Match' });
  assert.equal(post.status, 201);
  assert.equal(post.body.externalId, '999');

  assert.deepEqual(await ids(), ['998'], 'the dismissed title is gone from the ranking');
  assert.deepEqual((await dismissed(round.id)).map((d) => d.title), ['Great Match']);

  const del = await request(app).delete(`/api/rounds/${round.id}/recommendations/dismissed/999`);
  assert.equal(del.status, 200);
  assert.deepEqual(await ids(), ['999', '998'], 'the undo restores it into the ranking');
  assert.deepEqual(await dismissed(round.id), []);
});

test('dismissing creates NO game row — not a fifth state, not a retired game', async () => {
  const round = await seedRound();
  await seedCorpus([...ownedRows(), { externalId: '999', name: 'Great Match', rank: 40, bayesRating: 8.4, info: info() }]);
  const before = (await request(app).get(`/api/rounds/${round.id}`)).body.games;

  // Asserted, or this whole spec is vacuously green against a route that 404s:
  // nothing was added because nothing happened.
  const post = await request(app).post(`/api/rounds/${round.id}/recommendations/dismissed`).send({ externalId: '999', title: 'Great Match' });
  assert.equal(post.status, 201);

  const after = (await request(app).get(`/api/rounds/${round.id}`)).body;
  // The whole argument of the issue: a dismissal must cost no shelf row, or it
  // shows up in gameCount, the Regal's archive views, the Chronik, the public
  // stats and the per-round game quota.
  assert.equal(after.games.length, before.length);
  assert.ok(!after.games.some((g) => g.title === 'Great Match'));
  // …and it writes no Chronik entry either — nothing happened to the shelf.
  const acts = (await request(app).get(`/api/rounds/${round.id}/activities`)).body;
  assert.ok(!(acts.activities || acts).some?.((a) => /Great Match/.test(JSON.stringify(a))), 'no activity names a game that was never added');
});

test('a dismissal is refused without an externalId, and an unknown round 404s', async () => {
  const round = await seedRound();
  assert.equal((await request(app).post(`/api/rounds/${round.id}/recommendations/dismissed`).send({ title: 'No id' })).status, 400);
  assert.equal((await request(app).post('/api/rounds/nope/recommendations/dismissed').send({ externalId: '1', title: 'X' })).status, 404);
  assert.equal((await request(app).delete('/api/rounds/nope/recommendations/dismissed/1')).status, 404);
  // Restoring something that was never dismissed is a 404, not a silent ok —
  // the client would otherwise show "restored" for a no-op.
  assert.equal((await request(app).delete(`/api/rounds/${round.id}/recommendations/dismissed/never`)).status, 404);
});

test('dismissing the same title twice is idempotent, and keeps the first decision', async () => {
  const round = await seedRound();
  await seedCorpus([...ownedRows(), { externalId: '999', name: 'Great Match', rank: 40, info: info() }]);
  const first = await request(app).post(`/api/rounds/${round.id}/recommendations/dismissed`).send({ externalId: '999', title: 'Great Match' });
  const again = await request(app).post(`/api/rounds/${round.id}/recommendations/dismissed`).send({ externalId: '999', title: 'Great Match' });
  assert.equal(again.status, 201);
  assert.equal(again.body.at, first.body.at, 'a re-dismiss must not restamp the moment the round decided');
  assert.equal((await dismissed(round.id)).length, 1);
});

test('an unknown round is a 404, like every other round-scoped read', async () => {
  const res = await request(app).get('/api/rounds/nope/recommendations');
  assert.equal(res.status, 404);
});
