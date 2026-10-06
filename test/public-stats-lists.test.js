'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

const publicStats = require('../lib/public-stats');
const bgg = require('../lib/providers/bgg');
const repo = require('../lib/repo');

/*
 * Discover's ranked lists (#1424): every card carries up to three entries, not
 * one winner. Its own spec, like test/public-stats-favourites.test.js, because
 * test/public-stats.test.js is a catalogue already past its budget; it shares
 * that file's stub-the-provider and delete-after-each shape for the same reason
 * (a list is a maximum over one shared store, so a previous case's games keep
 * competing).
 *
 * The shelf card carries every list case: owning a game is one POST, so a case
 * can lay out an exact ranking (3 shelves, 2, 1 …) without playing sessions.
 */
const realDetail = bgg.detail;

const ENV = [
  'PUBLIC_STATS_MIN_SHELVES', 'PUBLIC_STATS_MIN_OWNER_TENANTS', 'PUBLIC_STATS_RESOLVE_MAX',
  'PUBLIC_STATS_MIN_RATINGS', 'PUBLIC_STATS_MIN_RATING_TENANTS',
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

// Every hop is counted, so a case can tell a memo hit from an upstream call.
let hops = 0;
function stubProvider(links = {}) {
  hops = 0;
  bgg.detail = async (externalId) => {
    hops += 1;
    return {
      provider: 'bgg', externalId, title: `Provider-Titel ${externalId}`, imageUrl: null,
      url: `https://boardgamegeek.com/boardgame/${externalId}`,
      designers: [], categories: [], mechanics: [],
      ...(links[externalId] || {}),
    };
  };
}

// `shelves` maps an externalId to how many rounds own it. The typed title is
// distinctive so the sweep can look for it in the serialized payload.
async function seedShelves(shelves) {
  const most = Math.max(...Object.values(shelves));
  for (let i = 0; i < most; i++) {
    const round = await createRound(request, { name: `Regal ${i}`, members: ['Ann'] });
    seeded.push(round.id);
    for (const [id, n] of Object.entries(shelves)) {
      if (i >= n) continue;
      const res = await request(app).post(`/api/rounds/${round.id}/games`).send({
        title: `GETIPPT ${id}`, minPlayers: '1', maxPlayers: '4',
        sourceProvider: 'bgg', sourceExternalId: id,
      });
      assert.equal(res.status, 201, `fixture step failed: ${JSON.stringify(res.body)}`);
    }
  }
}

function openShelfFloors() {
  process.env.PUBLIC_STATS_MIN_SHELVES = '1';
  process.env.PUBLIC_STATS_MIN_OWNER_TENANTS = '1';
}

const ids = (list) => list.map((e) => e.url.split('/').pop());

test('a card is a RANKED array of up to three entries, each shaped like the old winner', async () => {
  openShelfFloors();
  stubProvider();
  await seedShelves({ a: 4, b: 3, c: 2, d: 1 });

  const built = await publicStats.rebuild();
  const list = built.games.mostOwned;
  assert.ok(Array.isArray(list), 'the card is an array');
  assert.deepEqual(ids(list), ['a', 'b', 'c'], 'ranked by the metric, cut at three');
  assert.deepEqual(list.map((e) => e.shelves), [4, 3, 2]);
  assert.equal(list[1].title, 'Provider-Titel b');
  assert.ok(!JSON.stringify(built).includes('GETIPPT'), 'no typed title in ANY list entry');

  const res = await request(app).get('/api/stats/public');
  assert.deepEqual(res.body.games.mostOwned, list, 'the route serves the list');
});

test('an entry below the floor never pads a list — fewer than three is fine', async () => {
  openShelfFloors();
  process.env.PUBLIC_STATS_MIN_SHELVES = '3';
  stubProvider();
  await seedShelves({ a: 4, b: 3, c: 2, d: 1 });

  const built = await publicStats.rebuild();
  assert.deepEqual(ids(built.games.mostOwned), ['a', 'b']);
});

test('an unresolvable entry is skipped and the next one takes its place', async () => {
  openShelfFloors();
  stubProvider({ b: { title: null } });
  await seedShelves({ a: 4, b: 3, c: 2, d: 1 });

  const built = await publicStats.rebuild();
  assert.deepEqual(ids(built.games.mostOwned), ['a', 'c', 'd']);
});

test('a run that exhausts the budget publishes a SHORTER list, and the memo finishes it', async () => {
  openShelfFloors();
  process.env.PUBLIC_STATS_RESOLVE_MAX = '2';
  stubProvider();
  await seedShelves({ a: 4, b: 3, c: 2 });

  const first = await publicStats.rebuild();
  assert.deepEqual(ids(first.games.mostOwned), ['a', 'b'], 'two hops, two entries — not none');
  assert.equal(hops, 2);

  const second = await publicStats.rebuild();
  assert.deepEqual(ids(second.games.mostOwned), ['a', 'b', 'c'], 'the memo costs nothing, so the third fits');
  assert.equal(hops, 3, 'only the missing entry was asked for');
});

test('the favourite cards are ranked lists of names too', async () => {
  process.env.PUBLIC_STATS_MIN_RATINGS = '1';
  process.env.PUBLIC_STATS_MIN_RATING_TENANTS = '1';
  process.env.PUBLIC_STATS_MIN_NAME_TENANTS = '1';
  process.env.PUBLIC_STATS_MIN_NAME_GAMES = '1';
  stubProvider({
    g5: { designers: ['Top Designer'] },
    g4: { designers: ['Mid Designer'] },
    g3: { designers: ['Low Designer'] },
    g2: { designers: ['Last Designer'] },
  });
  const round = await createRound(request, { name: 'Namensrunde', members: ['Ann'] });
  seeded.push(round.id);
  const made = [];
  for (const id of ['g5', 'g4', 'g3', 'g2']) {
    made.push((await request(app).post(`/api/rounds/${round.id}/games`).send({
      title: `GETIPPT ${id}`, minPlayers: '1', maxPlayers: '4', sourceProvider: 'bgg', sourceExternalId: id,
    })).body);
  }
  const fresh = (await request(app).get(`/api/rounds/${round.id}`)).body;
  const { session } = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({
    gameIds: made.map((g) => g.id), memberIds: fresh.members.map((m) => m.id),
  })).body;
  const votes = { [fresh.members[0].id]: {} };
  made.forEach((g, i) => { votes[fresh.members[0].id][g.id] = { rating: 5 - i }; });
  const res = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/results`).send({ votes });
  assert.equal(res.status, 200);

  const built = await publicStats.rebuild();
  const list = built.names.favDesigner;
  assert.ok(Array.isArray(list));
  assert.deepEqual(list.map((n) => n.name), ['Top Designer', 'Mid Designer', 'Low Designer']);
  assert.ok(list[0].score > list[1].score && list[1].score > list[2].score);
  assert.deepEqual(list.map((n) => n.games), [1, 1, 1]);
});
