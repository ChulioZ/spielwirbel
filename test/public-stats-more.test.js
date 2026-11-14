'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

const publicStats = require('../lib/public-stats');
const { pastWinners, historyCutoff } = require('../lib/public-stats-more');
const { periodKeysOf, periodBoundaries } = require('../lib/calendar-periods');
const bgg = require('../lib/providers/bgg');
const repo = require('../lib/repo');

/*
 * Discover's longer lists (#1732): the top ten places behind six cards and
 * every past week's and month's most played game, served by their own route.
 * The pure bucketing is tested first, without a store; the rebuild cases share
 * test/public-stats-lists.test.js's stub-the-provider and delete-after-each
 * shape for the same reason (a list is a maximum over one shared store).
 */

/* ------------------------------ period keys ------------------------------- */

test('periodKeysOf names an instant\'s Berlin week by its Monday and its month', () => {
  // Sunday 23:30 Berlin (summer time) is still the week that began Monday the 10th.
  assert.deepEqual(periodKeysOf('2026-08-16T21:30:00.000Z'), { week: '2026-08-10', month: '2026-08' });
  // Monday 00:30 Berlin is the next week, although it is still Sunday in UTC.
  assert.deepEqual(periodKeysOf('2026-08-16T22:30:00.000Z'), { week: '2026-08-17', month: '2026-08' });
  // Across the October switch: Sunday the 25th is a 25-hour day in Berlin.
  assert.deepEqual(periodKeysOf('2026-10-25T22:59:00.000Z'), { week: '2026-10-19', month: '2026-10' });
  assert.deepEqual(periodKeysOf('2026-10-25T23:01:00.000Z'), { week: '2026-10-26', month: '2026-10' });
  // A week can straddle two months; the month is the play's own.
  assert.deepEqual(periodKeysOf('2026-09-01T08:00:00.000Z'), { week: '2026-08-31', month: '2026-09' });
  assert.equal(periodKeysOf('not a date'), null);
});

test('the history cutoff is the later of the two running periods\' starts', () => {
  // Thursday 2026-08-13: the week began on the 10th, the month on the 1st.
  const b = periodBoundaries('2026-08-13T12:00:00.000Z');
  assert.equal(historyCutoff(b), b.week);
  // Tuesday 2026-09-01: the month began today, the week on Monday the 31st.
  const c = periodBoundaries('2026-09-01T12:00:00.000Z');
  assert.equal(historyCutoff(c), c.month);
});

/* ------------------------------ past winners ------------------------------ */

const NOW = '2026-08-13T12:00:00.000Z'; // Thursday, mid-week, mid-month
const OPEN = { week: { plays: 1, tenants: 1 }, month: { plays: 1, tenants: 1 } };
const play = (externalId, playedAt, tenant = 't1') => ({ provider: 'bgg', externalId, tenant, playedAt });
const keys = (list) => list.map((p) => [p.period, p.games.map((g) => g.externalId)]);

test('each completed period names its most played game, newest first; the running one is the card', () => {
  const plays = [
    play('a', '2026-07-28T10:00:00.000Z'), play('a', '2026-07-29T10:00:00.000Z'), play('b', '2026-07-30T10:00:00.000Z'),
    play('b', '2026-08-04T10:00:00.000Z'),
    // This week — the live card, never a past winner.
    play('c', '2026-08-12T10:00:00.000Z'),
  ];
  const out = pastWinners(plays, NOW, OPEN);
  assert.deepEqual(keys(out.week), [['2026-08-03', ['b']], ['2026-07-27', ['a']]]);
  // August is still running, so only July is a past month.
  assert.deepEqual(keys(out.month), [['2026-07', ['a']]]);
});

test('a past period is judged against the card\'s own floors, and one nobody cleared is omitted', () => {
  const plays = [
    // Week of 27 Jul: three plays of `a`, but from one group only.
    play('a', '2026-07-28T10:00:00.000Z'), play('a', '2026-07-29T10:00:00.000Z'), play('a', '2026-07-30T10:00:00.000Z'),
    // Week of 3 Aug: two plays of `b` from two groups.
    play('b', '2026-08-04T10:00:00.000Z', 't1'), play('b', '2026-08-05T10:00:00.000Z', 't2'),
  ];
  const floors = { week: { plays: 2, tenants: 2 }, month: { plays: 1, tenants: 1 } };
  const out = pastWinners(plays, NOW, floors);
  assert.deepEqual(keys(out.week), [['2026-08-03', ['b']]], 'one group alone never makes a winner');
});

test('a tie for first lists every tied game, the one that got there first leading', () => {
  /* Named so the provider-key fallback sorts them the OTHER way round: `z-early`
     reached two plays first and must lead `a-late`, which the key alone would
     put first (.claude/rules/tiebreak-fixtures-must-sort-against-the-fallback.md). */
  const plays = [
    play('z-early', '2026-08-03T10:00:00.000Z'), play('z-early', '2026-08-04T10:00:00.000Z'),
    play('a-late', '2026-08-05T10:00:00.000Z'), play('a-late', '2026-08-06T10:00:00.000Z'),
    play('m-third', '2026-08-04T12:00:00.000Z'),
  ];
  const out = pastWinners(plays, NOW, OPEN);
  assert.deepEqual(keys(out.week), [['2026-08-03', ['z-early', 'a-late']]]);
});

/* ------------------------------ the rebuild ------------------------------- */

const realDetail = bgg.detail;
const realHistory = repo.publicPlayHistory;
const ENV = ['PUBLIC_STATS_MIN_SHELVES', 'PUBLIC_STATS_MIN_OWNER_TENANTS', 'PUBLIC_STATS_RESOLVE_MAX',
  'PUBLIC_STATS_MIN_PLAYS_WEEK', 'PUBLIC_STATS_MIN_PLAY_TENANTS_WEEK', 'PUBLIC_STATS_ENABLED'];
const seeded = [];
afterEach(async () => {
  bgg.detail = realDetail;
  repo.publicPlayHistory = realHistory;
  for (const name of ENV) delete process.env[name];
  publicStats.resetForTests();
  while (seeded.length) await request(app).delete(`/api/rounds/${seeded.pop()}`);
});

function stubProvider() {
  bgg.detail = async (externalId) => ({
    provider: 'bgg', externalId, title: `Provider-Titel ${externalId}`, imageUrl: null,
    url: `https://boardgamegeek.com/boardgame/${externalId}`, designers: [], categories: [], mechanics: [],
  });
}

async function seedShelves(shelves) {
  const most = Math.max(...Object.values(shelves));
  for (let i = 0; i < most; i++) {
    const round = await createRound(request, { name: `Regal ${i}`, members: ['Ann'] });
    seeded.push(round.id);
    for (const [id, n] of Object.entries(shelves)) {
      if (i >= n) continue;
      const res = await request(app).post(`/api/rounds/${round.id}/games`).send({
        title: `GETIPPT ${id}`, minPlayers: '1', maxPlayers: '4', sourceProvider: 'bgg', sourceExternalId: id,
      });
      assert.equal(res.status, 201);
    }
  }
}

const ids = (list) => list.map((e) => e.url.split('/').pop());

test('the top ten continues the card\'s ranking, and is published only when it holds more', async () => {
  process.env.PUBLIC_STATS_MIN_SHELVES = '1';
  process.env.PUBLIC_STATS_MIN_OWNER_TENANTS = '1';
  stubProvider();
  // Twelve games on 12, 11 … 1 shelves: the card holds three, the list ten.
  const shelves = Object.fromEntries([...Array(12)].map((_, i) => [`g${String(i).padStart(2, '0')}`, 12 - i]));
  await seedShelves(shelves);

  const built = await publicStats.rebuild();
  assert.deepEqual(ids(built.games.mostOwned), ['g00', 'g01', 'g02']);
  const res = await request(app).get('/api/stats/public/more');
  assert.equal(res.status, 200);
  const long = res.body.games.mostOwned;
  assert.equal(long.length, 10, 'ten places, never padded past them');
  assert.deepEqual(ids(long).slice(0, 3), ids(built.games.mostOwned), 'its first places ARE the card');
  assert.deepEqual(long.map((e) => e.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(!JSON.stringify(res.body).includes('GETIPPT'), 'no typed title reaches the longer lists either');
  // The landing payload did not grow with it.
  assert.equal((await request(app).get('/api/stats/public')).body.games.mostOwned.length, 3);
});

test('a card with nothing beyond its own places gets no longer list', async () => {
  process.env.PUBLIC_STATS_MIN_SHELVES = '1';
  process.env.PUBLIC_STATS_MIN_OWNER_TENANTS = '1';
  stubProvider();
  await seedShelves({ only1: 2, only2: 1 });
  await publicStats.rebuild();
  const res = await request(app).get('/api/stats/public/more');
  assert.equal(res.body.games.mostOwned, undefined);
});

test('past winners are named by the provider and carry no count', async () => {
  stubProvider();
  repo.publicPlayHistory = async () => [
    play('w1', '2026-08-04T10:00:00.000Z'), play('w1', '2026-08-05T10:00:00.000Z', 't2'),
    play('w1', '2026-08-06T10:00:00.000Z', 't3'),
  ];
  process.env.PUBLIC_STATS_MIN_PLAYS_WEEK = '3';
  process.env.PUBLIC_STATS_MIN_PLAY_TENANTS_WEEK = '3';
  await publicStats.rebuild(NOW);
  const res = await request(app).get('/api/stats/public/more');
  assert.deepEqual(res.body.pastWinners.week, [{
    period: '2026-08-03',
    games: [{ title: 'Provider-Titel w1', image: null, url: 'https://boardgamegeek.com/boardgame/w1' }],
  }]);
  // Raising the floor live removes the winner on the next rebuild: no snapshot.
  process.env.PUBLIC_STATS_MIN_PLAYS_WEEK = '4';
  await publicStats.rebuild(NOW);
  assert.equal((await request(app).get('/api/stats/public/more')).body.pastWinners.week, undefined);
});

test('the longer lists are spent LAST: a budget the cards use up publishes none of them', async () => {
  process.env.PUBLIC_STATS_MIN_SHELVES = '1';
  process.env.PUBLIC_STATS_MIN_OWNER_TENANTS = '1';
  process.env.PUBLIC_STATS_RESOLVE_MAX = '3';
  stubProvider();
  await seedShelves({ b1: 6, b2: 5, b3: 4, b4: 3, b5: 2 });
  const built = await publicStats.rebuild();
  assert.deepEqual(ids(built.games.mostOwned), ['b1', 'b2', 'b3'], 'the card gets the whole budget');
  assert.equal((await request(app).get('/api/stats/public/more')).body.games.mostOwned, undefined);
});

test('the route 404s while the feature is off', async () => {
  process.env.PUBLIC_STATS_ENABLED = 'false';
  await publicStats.rebuild();
  assert.equal((await request(app).get('/api/stats/public/more')).status, 404);
});
