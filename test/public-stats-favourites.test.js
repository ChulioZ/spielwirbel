'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

const publicStats = require('../lib/public-stats');
const bgg = require('../lib/providers/bgg');
const repo = require('../lib/repo');

/*
 * The three favourite cards on Discover (#1557): the designer, category and
 * mechanic whose games score highest on average, instance-wide.
 *
 * Its own spec rather than more cases in test/public-stats.test.js, which is a
 * catalogue of podium cases already past its budget; this one shares only the
 * stub-the-provider and delete-after-each shape, for the reason given there (a
 * favourite is a maximum over one shared store, so a previous case's games
 * would keep competing).
 */
const realDetail = bgg.detail;

const ENV = [
  'PUBLIC_STATS_MIN_RATINGS', 'PUBLIC_STATS_MIN_RATING_TENANTS', 'PUBLIC_STATS_RESOLVE_MAX',
  'PUBLIC_STATS_MIN_NAME_GAMES', 'PUBLIC_STATS_MIN_NAME_TENANTS',
];

const seeded = [];
afterEach(async () => {
  bgg.detail = realDetail;
  for (const name of ENV) delete process.env[name];
  publicStats.resetForTests();
  await repo.replaceCorpus([], {});
  while (seeded.length) await request(app).delete(`/api/rounds/${seeded.pop()}`);
});

// Admit every rated game, and let one fixture round stand for the spread: the
// test store has a single tenant, so the tenant floor is pinned on rankNames.
function openFloors() {
  process.env.PUBLIC_STATS_MIN_RATINGS = '1';
  process.env.PUBLIC_STATS_MIN_RATING_TENANTS = '1';
  process.env.PUBLIC_STATS_MIN_NAME_TENANTS = '1';
}

// The provider answers with a title and the links `links[id]` names; nothing
// here is what a user typed.
function stubProvider(links = {}) {
  bgg.detail = async (externalId) => ({
    provider: 'bgg', externalId, title: `Provider-Titel ${externalId}`, imageUrl: null,
    url: `https://boardgamegeek.com/boardgame/${externalId}`,
    designers: [], categories: [], mechanics: [],
    ...(links[externalId] || {}),
  });
}

/*
 * One round, one session holding every game, each rated once by the first
 * member. `typed` is sent as the user's own title AND as user-supplied link
 * fields, so the sweep can prove neither reaches the payload.
 */
async function seedRated(games, typed = 'GETIPPT') {
  const round = await createRound(request, { name: 'Lieblingsrunde', members: ['Ann', 'Bo'] });
  seeded.push(round.id);
  const made = [];
  for (const g of games) {
    made.push((await request(app).post(`/api/rounds/${round.id}/games`).send({
      title: `${typed} ${g.id}`, minPlayers: '1', maxPlayers: '4',
      sourceProvider: 'bgg', sourceExternalId: g.id,
      designers: [`${typed} Designer`], categories: [`${typed} Kategorie`], mechanics: [`${typed} Mechanik`],
    })).body);
  }
  const fresh = (await request(app).get(`/api/rounds/${round.id}`)).body;
  const { session } = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({
    gameIds: made.map((g) => g.id), memberIds: fresh.members.map((m) => m.id),
  })).body;
  const votes = { [fresh.members[0].id]: {} };
  made.forEach((g, i) => { votes[fresh.members[0].id][g.id] = { rating: games[i].rating }; });
  const res = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/results`).send({ votes });
  assert.equal(res.status, 200, `fixture step failed: ${JSON.stringify(res.body)}`);
}

/* ------------------------------- rankNames --------------------------------- */

const floors = { minGames: 1, minTenants: 1 };

test('rankNames ranks on the mean score, not on how many games carry a name', () => {
  const ranked = publicStats.rankNames([
    { score: 2, tenants: 1, values: ['Many'] },
    { score: 2, tenants: 1, values: ['Many'] },
    { score: 2, tenants: 1, values: ['Many'] },
    { score: 4.5, tenants: 1, values: ['Few', 'Many'] },
  ], floors);
  assert.deepEqual(ranked.map((n) => n.name), ['Few', 'Many']);
  assert.equal(ranked[1].games, 4);
  assert.equal(ranked[1].mean, 2.625);
});

test('rankNames ties to more games, then to the name', () => {
  const ranked = publicStats.rankNames([
    { score: 4, tenants: 1, values: ['Zed', 'Bea', 'Ada'] },
    { score: 4, tenants: 1, values: ['Zed'] },
  ], floors);
  assert.deepEqual(ranked.map((n) => n.name), ['Zed', 'Ada', 'Bea']);
});

test('rankNames applies both floors, and counts a name twice on one game once', () => {
  const games = [
    { score: 5, tenants: 1, values: ['Solo', 'Solo'] },
    { score: 3, tenants: 2, values: ['Spread'] },
    { score: 3, tenants: 1, values: ['Spread'] },
  ];
  assert.deepEqual(publicStats.rankNames(games, { minGames: 2, minTenants: 1 }).map((n) => n.name), ['Spread'],
    'Solo has ONE game, however often BGG lists it');
  assert.deepEqual(publicStats.rankNames(games, { minGames: 1, minTenants: 2 }).map((n) => n.name), ['Spread'],
    'the spread is the largest of its games’ spreads');
  assert.deepEqual(publicStats.rankNames(games, { minGames: 3, minTenants: 1 }), []);
});

/* ------------------------------ the payload -------------------------------- */

test('the favourites rank by score, need three games by default, and carry no typed byte', async () => {
  openFloors();
  stubProvider({
    m1: { designers: ['Many Designer'], categories: ['Party'], mechanics: ['Dice'] },
    m2: { designers: ['Many Designer'], categories: ['Party'], mechanics: ['Dice'] },
    m3: { designers: ['Many Designer'], categories: ['Party'], mechanics: ['Dice'] },
    m4: { designers: ['Many Designer'], categories: ['Party'], mechanics: ['Dice'] },
    f1: { designers: ['Few Designer'], categories: ['Strategy'], mechanics: ['Worker Placement'] },
    f2: { designers: ['Few Designer'], categories: ['Strategy'], mechanics: ['Worker Placement'] },
    f3: { designers: ['Few Designer'], categories: ['Strategy'], mechanics: ['Worker Placement'] },
    // Rated highest of all, but the only game its names have: below the floor.
    t1: { designers: ['Thin Designer'], categories: ['Thin'], mechanics: ['Thin'] },
  });
  await seedRated([
    ...['m1', 'm2', 'm3', 'm4'].map((id) => ({ id, rating: 2 })),
    ...['f1', 'f2', 'f3'].map((id) => ({ id, rating: 4 })),
    { id: 't1', rating: 5 },
  ]);

  const built = await publicStats.rebuild();
  assert.ok(built.names, 'the favourites block is present');
  assert.equal(built.names.favDesigner[0].name, 'Few Designer');
  assert.equal(built.names.favCategory[0].name, 'Strategy');
  assert.equal(built.names.favMechanic[0].name, 'Worker Placement');
  assert.equal(built.names.favDesigner[0].games, 3);
  assert.equal(typeof built.names.favDesigner[0].score, 'number');
  assert.equal(built.names.favDesigner[0].score, Math.round(built.names.favDesigner[0].score * 10) / 10,
    'rounded to one decimal, like bestRated');
  assert.ok(!JSON.stringify(built).includes('GETIPPT'), 'no user-typed title or link field reaches the payload');

  const res = await request(app).get('/api/stats/public');
  assert.deepEqual(res.body.names, built.names, 'the route serves the cached favourites');
});

test('each favourite is absent until a name clears its floor, and 0 is honoured', async () => {
  openFloors();
  stubProvider({ a: { designers: ['Ann Designer'] }, b: { designers: ['Bo Designer'] } });
  await seedRated([{ id: 'a', rating: 5 }, { id: 'b', rating: 3 }]);

  const quiet = await publicStats.rebuild();
  assert.equal(quiet.names, undefined, 'two games per name is under the default three');

  process.env.PUBLIC_STATS_MIN_NAME_GAMES = '0';
  publicStats.resetForTests();
  const open = await publicStats.rebuild();
  assert.equal(open.names.favDesigner[0].name, 'Ann Designer');
  assert.equal(open.names.favCategory, undefined, 'no game carries a category, so no card');
});

test('BGG’s (Uncredited) sentinel never wins the designer card', async () => {
  openFloors();
  process.env.PUBLIC_STATS_MIN_NAME_GAMES = '1';
  stubProvider({
    u: { designers: ['(Uncredited)'] },
    c: { designers: ['Credited Designer'] },
  });
  await seedRated([{ id: 'u', rating: 5 }, { id: 'c', rating: 2 }]);

  const built = await publicStats.rebuild();
  assert.equal(built.names.favDesigner[0].name, 'Credited Designer');
});

test('a game below the „Bestbewertet“ evidence floor moves no average', async () => {
  openFloors();
  process.env.PUBLIC_STATS_MIN_NAME_GAMES = '1';
  stubProvider({ hi: { designers: ['Hi Designer'] }, lo: { designers: ['Lo Designer'] } });
  await seedRated([{ id: 'hi', rating: 5 }, { id: 'lo', rating: 3 }]);
  // One rating each: with the evidence floor at 2, neither game is admitted.
  process.env.PUBLIC_STATS_MIN_RATINGS = '2';

  const built = await publicStats.rebuild();
  assert.equal(built.names, undefined);
});

test('the BGG corpus answers without a provider hop, and an outage leaves the cards absent', async () => {
  openFloors();
  process.env.PUBLIC_STATS_MIN_NAME_GAMES = '1';
  // A provider that answers nothing (no token, or a bad day upstream).
  let calls = 0;
  bgg.detail = async () => { calls += 1; return { title: null }; };
  await seedRated([{ id: '901', rating: 5 }, { id: '902', rating: 2 }]);

  const dark = await publicStats.rebuild();
  assert.equal(dark.names, undefined, 'nothing to name, and no throw');
  assert.ok(calls > 0);

  await repo.replaceCorpus([
    { externalId: '901', name: 'x', rank: 1 },
    { externalId: '902', name: 'y', rank: 2 },
  ], {});
  await repo.updateCorpusEntries([
    { externalId: '901', enrichedAt: '2026-10-01T00:00:00.000Z', info: { designers: ['Corpus Designer'], categories: ['Abstract'], mechanics: ['Tile Placement'] } },
    { externalId: '902', enrichedAt: '2026-10-01T00:00:00.000Z', info: { designers: ['Other Designer'], categories: [], mechanics: [] } },
  ]);
  // Spend the whole budget on the podiums, so any name now came from the corpus.
  process.env.PUBLIC_STATS_RESOLVE_MAX = '0';
  const built = await publicStats.rebuild();
  assert.equal(built.names.favDesigner[0].name, 'Corpus Designer');
  assert.equal(built.names.favCategory[0].name, 'Abstract');
});
