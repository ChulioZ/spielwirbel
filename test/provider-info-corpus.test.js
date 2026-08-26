'use strict';

/*
 * The corpus-first provider-info fill (issue #829).
 *
 * The local BGG corpus (#681) already holds every provider-info field for its
 * enriched rows, fetched under the same licence — so asking BGG about a game it
 * knows spends an upstream request on data already on disk. This is the read
 * that goes in front of the hop.
 *
 * Its own file rather than more of test/provider-info.test.js, which crossed the
 * 700-line budget with these in it and already covers four other concerns — the
 * same seam test/provider-info-shelf.test.js was split off under
 * (.claude/rules/token-friendly-source-files.md).
 *
 * These drive backfillProviderInfo against the REAL module-level repo, because
 * the corpus is global and un-scoped and is therefore not reachable through
 * req.repo at all (lib/repo/index.js); the tenant-scoped writes go to a
 * recording stub.
 */

process.env.BGG_API_TOKEN = 'test-token';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

require('./helpers');
const repo = require('../lib/repo');
const { backfillProviderInfo } = require('../lib/provider-info');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

// A repo stub that records which games were written, so a spec can assert on the
// set that got stamped rather than on the store's contents.
const recordingRepo = () => {
  const stamped = [];
  return { stamped, setGameProviderInfo: async (rid, gid) => { stamped.push(gid); } };
};

// `n` provider-linked games, none of them filled, so all are eligible.
const unfilledGames = (n, base) =>
  Array.from({ length: n }, (_, i) => ({
    id: `g${base + i}`,
    source: { provider: 'bgg', externalId: String(base + i), url: null },
  }));

// A healthy /thing answer that names no game — enough to see WHICH ids were
// asked about, which is all these specs need from the upstream half.
const stubFetch = () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return { status: 200, text: async () => '<items></items>' };
  };
  return calls;
};

// Full coverage of PROVIDER_INFO_FIELDS bar `rating`, which rides at the row's
// top level because it comes off the uploaded CSV rather than the enrichment.
const FULL_INFO = {
  weight: 3.2, minPlaytime: 60, maxPlaytime: 120, minAge: 12,
  categories: ['Economic'], mechanics: ['Trading'],
  // Corpus-only keys, which must NOT reach a game row.
  families: ['Legacy'], designers: ['Ada'], imageUrl: 'https://cf.geekdo-images.com/x.jpg',
};

const seedCorpus = async (rows) => {
  await repo.replaceCorpus(
    rows.map((r, i) => ({
      externalId: r.externalId, name: `Corpus ${i}`, year: 2020, rank: i + 1,
      rating: r.rating, bayesRating: 6.9, usersRated: 500,
    })),
    { dumpDate: 'd', uploadedAt: 'u' },
  );
  for (const r of rows) {
    if (r.info) await repo.updateCorpusEntries([{ externalId: r.externalId, enrichedAt: '2026-08-26T10:00:00.000Z', info: r.info }]);
  }
};

test('a game the corpus knows is filled with NO upstream request', async () => {
  const games = unfilledGames(3, 990000);
  await seedCorpus(games.map((g) => ({ externalId: g.source.externalId, rating: 7.4, info: FULL_INFO })));
  const repoStub = recordingRepo();
  const written = [];
  repoStub.setGameProviderInfo = async (rid, gid, patch) => { written.push(patch); repoStub.stamped.push(gid); };
  const calls = stubFetch();

  const out = await backfillProviderInfo(repoStub, 'r-corpus', games, { maxBatches: 15 });
  assert.equal(calls.length, 0, 'the corpus covered the shelf; nothing may be asked of BGG');
  assert.equal(out.fromCorpus, 3);
  assert.equal(out.batches, 0);
  assert.equal(repoStub.stamped.length, 3);
  // Both halves land, from their two different sources...
  assert.equal(written[0].weight, 3.2);
  assert.equal(written[0].rating, 7.4);
  assert.deepEqual(written[0].mechanics, ['Trading']);
  // ...and the corpus-only keys do not. A game row is not a corpus row.
  for (const k of ['families', 'designers', 'imageUrl']) {
    assert.equal(k in written[0], false, `corpus-only key \`${k}\` reached a game row`);
  }
});

test('a PARTIAL corpus row fills nothing and is not stamped', async () => {
  /* THE trap of this change. `setGameProviderInfo` always stamps
   * `providerInfoAt`, and the stamp is what suppresses the next fetch for a
   * 7-day TTL — so writing a half-known row here would hide the game from the
   * upstream hop that could have completed it, with no request ever going out
   * (.claude/rules/provider-info-triggers-and-stamping.md §2).
   *
   * Three shapes of partial, because they fail for different reasons: a row
   * nobody enriched (rating only), one missing a number, and one whose list is
   * empty — which `hasProviderField` counts as absent, not as "BGG named none". */
  const games = unfilledGames(3, 991000);
  const [a, b, c] = games.map((g) => g.source.externalId);
  await seedCorpus([
    { externalId: a, rating: 7.4 },                                          // never enriched
    { externalId: b, rating: 7.4, info: { ...FULL_INFO, minAge: null } },    // a missing number
    { externalId: c, rating: 7.4, info: { ...FULL_INFO, mechanics: [] } },   // an empty list
  ]);
  const repoStub = recordingRepo();
  const calls = stubFetch();

  const out = await backfillProviderInfo(repoStub, 'r-partial', games, { maxBatches: 15 });
  assert.equal(out.fromCorpus, 0, 'a partial row must fill nothing at all');
  assert.equal(calls.length, 1, 'all three must still reach the upstream hop');
  const asked = new URL(calls[0]).searchParams.get('id').split(',');
  assert.deepEqual(asked.sort(), [a, b, c].sort());
});

test('a MIXED shelf asks BGG only about what the corpus lacks', async () => {
  /* The realistic case, and the whole point of the change: the corpus is capped
   * at BGG_CORPUS_SIZE best-ranked games, so a group's obscure titles always
   * take the BGG path while the mainstream ones cost nothing. */
  const games = unfilledGames(30, 992000);
  await seedCorpus(games.slice(0, 25).map((g) => ({ externalId: g.source.externalId, rating: 7.4, info: FULL_INFO })));
  const repoStub = recordingRepo();
  const calls = stubFetch();

  const out = await backfillProviderInfo(repoStub, 'r-mixed', games, { maxBatches: 15 });
  assert.equal(out.fromCorpus, 25);
  assert.equal(calls.length, 1, '5 leftovers ride ONE batch, not two');
  assert.equal(new URL(calls[0]).searchParams.get('id').split(',').length, 5);
  assert.equal(out.filled, 30, 'every game filled, by one route or the other');
});

test('an unreadable corpus degrades to the upstream hop, never to a failed fill', async () => {
  const games = unfilledGames(2, 993000);
  const repoStub = recordingRepo();
  const calls = stubFetch();
  const real = repo.getCorpusEntries;
  repo.getCorpusEntries = async () => { throw new Error('corpus is down'); };
  try {
    const out = await backfillProviderInfo(repoStub, 'r-corpus-down', games);
    assert.equal(out.fromCorpus, 0);
    assert.equal(calls.length, 1, 'the upstream hop is the real path and must still run');
    assert.equal(repoStub.stamped.length, 2);
  } finally {
    repo.getCorpusEntries = real;
  }
});
