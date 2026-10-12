'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const publicStats = require('../lib/public-stats');
const bgg = require('../lib/providers/bgg');
const repo = require('../lib/repo');
const { scoreTally, shelfScore, SCORE_MIN } = require('../public/js/vote-score');

/*
 * Ties on Discover (#1648): equal displayed values share a place (1, 1, 3), the
 * order inside a tie is deterministic, and every entry tied with the last place
 * is published — up to STATS_LIST_MAX.
 *
 * THE AGGREGATE IS STUBBED, not seeded. Every case here is about the ORDER of
 * rows the repo hands over, and a seeded store returns them in whatever order
 * its own walk produces — which is exactly the dependence under test. Feeding
 * rows directly is what lets a case shuffle them. That the two backends compute
 * the stubbed fields (`lastAt` above all) identically is the repo contract's
 * job (test/support/repo-contract.js), not this file's.
 */
const realDetail = bgg.detail;
const realAggregates = repo.publicGameAggregates;

const ENV = [
  'PUBLIC_STATS_MIN_SHELVES', 'PUBLIC_STATS_MIN_OWNER_TENANTS',
  'PUBLIC_STATS_MIN_RATINGS', 'PUBLIC_STATS_MIN_RATING_TENANTS',
  'PUBLIC_STATS_MIN_NAME_GAMES', 'PUBLIC_STATS_MIN_NAME_TENANTS',
  ...['WEEK', 'MONTH', 'YEAR', 'ALL'].flatMap((w) => [
    `PUBLIC_STATS_MIN_PLAYS_${w}`, `PUBLIC_STATS_MIN_PLAY_TENANTS_${w}`,
  ]),
];

afterEach(() => {
  bgg.detail = realDetail;
  repo.publicGameAggregates = realAggregates;
  for (const name of ENV) delete process.env[name];
  publicStats.resetForTests();
});

function openFloors() {
  for (const name of ENV) process.env[name] = '1';
}

// `links` adds BGG links per id; an id in `unnamed` resolves to nothing.
function stubProvider({ links = {}, unnamed = [] } = {}) {
  bgg.detail = async (externalId) => (unnamed.includes(externalId) ? null : {
    provider: 'bgg', externalId, title: `Titel ${externalId}`, imageUrl: null,
    url: `https://boardgamegeek.com/boardgame/${externalId}`,
    designers: [], categories: [], mechanics: [],
    ...(links[externalId] || {}),
  });
}

const window = (count = 0, lastAt = null) => ({ count, tenants: count ? 2 : 0, lastAt });

// One aggregate row, shaped like both backends' `publicGameAggregates`.
function row(externalId, { shelves = 0, owners = 0, week, all, tiles, lift = 0 } = {}) {
  const t = tiles || [0, 0, 0, 0, 0, 0];
  const count = t.reduce((a, b) => a + b, 0);
  return {
    provider: 'bgg', externalId, shelves, owners,
    plays: {
      week: week || window(), month: window(), year: window(), all: all || week || window(),
      lift: { count: lift, tenants: lift ? 2 : 0 },
    },
    ratings: { tiles: t, count, tenants: count ? 2 : 0 },
  };
}

function serve(rows) {
  repo.publicGameAggregates = async () => rows;
}

const NOW = '2026-10-14T12:00:00.000Z';
const build = async (rows) => { serve(rows); return publicStats.rebuild(NOW); };
const places = (list) => list.map((e) => [e.url.split('/').pop(), e.rank]);

// A deterministic shuffle — reversed, then the halves swapped — so a case
// asserting order-independence does not depend on Math.random.
const shuffle = (rows) => {
  const r = rows.slice().reverse();
  const mid = Math.floor(r.length / 2);
  return [...r.slice(mid), ...r.slice(0, mid)];
};

/* ------------------------------- the place --------------------------------- */

test('nextPlace numbers by competition ranking and stops past the last place', () => {
  const run = (values) => {
    const placed = [];
    for (const shown of values) {
      const rank = publicStats.nextPlace(placed, shown);
      if (rank === null) break;
      placed.push({ shown, rank });
    }
    return placed.map((p) => p.rank);
  };
  assert.deepEqual(run([9, 9, 7, 6]), [1, 1, 3], 'a shared first place pushes the next value to 3');
  assert.deepEqual(run([9, 8, 8, 8, 1]), [1, 2, 2, 2], 'a tie on 2 is all published; the 5th value is place 5');
  assert.deepEqual(run([9, 8, 7, 7, 7, 7, 7]), [1, 2, 3, 3, 3], 'a tie on the LAST place is capped at STATS_LIST_MAX');
  assert.deepEqual(run([5, 4, 3, 2]), [1, 2, 3], 'without ties nothing changes: three places');
  assert.equal(publicStats.STATS_LIST_MAX, 5);
});

test('equal shelf counts share a place, and the next count skips it (1, 1, 3)', async () => {
  openFloors();
  stubProvider();
  const payload = await build([
    row('c', { shelves: 3, owners: 3 }),
    row('a', { shelves: 5, owners: 2 }),
    row('b', { shelves: 5, owners: 4 }),
    row('d', { shelves: 2, owners: 2 }),
  ]);
  assert.deepEqual(places(payload.games.mostOwned), [['b', 1], ['a', 1], ['c', 3]],
    'b leads its tie on more ACCOUNTS; d would be place 4 and is not published');
});

test('everything tied with the last place is published, capped at five, cut by the tiebreak', async () => {
  openFloors();
  stubProvider();
  const rows = [
    row('top', { shelves: 9, owners: 1 }),
    row('two', { shelves: 8, owners: 1 }),
    // Five tied on place 3: owners order them, and the fewest-owners one is cut.
    // Each tied entry's key sorts AGAINST its owner count, so a lost tiebreak
    // cannot be rescued by the key and still read as a pass.
    row('t1', { shelves: 7, owners: 1 }),
    row('t2', { shelves: 7, owners: 2 }),
    row('t4', { shelves: 7, owners: 4 }),
    row('t3', { shelves: 7, owners: 3 }),
  ];
  const payload = await build(rows);
  assert.deepEqual(places(payload.games.mostOwned),
    [['top', 1], ['two', 2], ['t4', 3], ['t3', 3], ['t2', 3]]);

  // Equal owners too: the provider key decides, never the order of the rows.
  const flat = [row('z', { shelves: 4, owners: 2 }), row('x', { shelves: 4, owners: 2 }), row('y', { shelves: 4, owners: 2 })];
  publicStats.resetForTests();
  assert.deepEqual(places((await build(flat)).games.mostOwned), [['x', 1], ['y', 1], ['z', 1]]);
});

test('a skipped, unresolvable candidate leaves no gap in the places', async () => {
  openFloors();
  stubProvider({ unnamed: ['b'] });
  const payload = await build([
    row('a', { shelves: 5, owners: 2 }),
    row('b', { shelves: 4, owners: 2 }),
    row('c', { shelves: 3, owners: 2 }),
    row('d', { shelves: 2, owners: 2 }),
  ]);
  assert.deepEqual(places(payload.games.mostOwned), [['a', 1], ['c', 2], ['d', 3]],
    'c takes place 2, not 3 — and d fills the list the skipped game left short');
});

/* ------------------------- the order inside a tie --------------------------- */

test('a play-card tie goes to the game whose latest counted play came first', async () => {
  openFloors();
  stubProvider();
  const payload = await build([
    // Named so the provider key sorts the OTHER way round.
    row('a-late', { week: window(4, '2026-10-13T19:00:00.000Z') }),
    row('b-early', { week: window(4, '2026-10-12T19:00:00.000Z') }),
    row('most', { week: window(6, '2026-10-14T09:00:00.000Z') }),
    row('less', { week: window(2, '2026-10-12T08:00:00.000Z') }),
  ]);
  assert.deepEqual(places(payload.games.playedWeek), [['most', 1], ['b-early', 2], ['a-late', 2]],
    'early reached four plays first; the card shows both at place 2, and „less" would be 4');
  assert.deepEqual(places(payload.games.playedAll), [['most', 1], ['b-early', 2], ['a-late', 2]],
    'the all-time card orders its tie the same way, on its own window');
});

test('„Bestbewertet" ties on the score it SHOWS, and orders the tie by the raw score', async () => {
  openFloors();
  stubProvider();
  const sc = (tiles) => { const t = scoreTally(tiles); return shelfScore(t.score, t.count, 0); };
  const shown = (tiles) => Math.round(Math.max(SCORE_MIN, sc(tiles)) * 10) / 10;
  const hi = [0, 0, 0, 0, 0, 5];
  const lo = [0, 0, 0, 0, 1, 5];
  const third = [0, 0, 0, 0, 5, 0];
  // The precondition that makes this discriminating: one displayed number, two raw ones.
  assert.equal(shown(hi), shown(lo));
  assert.ok(sc(hi) > sc(lo), 'hi really is the higher raw score');
  assert.ok(shown(third) < shown(lo));

  // Named so the provider key sorts the OTHER way round.
  const payload = await build([row('a-lo', { tiles: lo }), row('third', { tiles: third }), row('b-hi', { tiles: hi })]);
  assert.deepEqual(places(payload.games.bestRated), [['b-hi', 1], ['a-lo', 1], ['third', 3]]);
  assert.equal(payload.games.bestRated[0].score, payload.games.bestRated[1].score);
});

test('two scores clamped to the display floor tie; an exact raw tie goes to more evidence', async () => {
  openFloors();
  stubProvider();
  // Both far below SCORE_MIN and different raw — the card shows the floor twice.
  const payload = await build([row('bad', { tiles: [0, 9, 0, 0, 0, 0] }), row('worse', { tiles: [0, 20, 0, 0, 0, 0] })]);
  assert.deepEqual(places(payload.games.bestRated), [['bad', 1], ['worse', 1]]);
  assert.equal(payload.games.bestRated[1].score, SCORE_MIN);

  // A neutral verdict scores exactly the prior however much evidence stands
  // behind it, so the raw scores tie too and the evidence decides.
  assert.equal(shelfScore(scoreTally([0, 0, 0, 2, 0, 0]).score, 2, 0), shelfScore(scoreTally([0, 0, 0, 6, 0, 0]).score, 6, 0));
  const order = publicStats.orderFor('bestRated', [
    row('a-thin', { tiles: [0, 0, 0, 2, 0, 0] }), row('b-deep', { tiles: [0, 0, 0, 6, 0, 0] }),
  ]).map((r) => r.externalId);
  assert.deepEqual(order, ['b-deep', 'a-thin']);
});

test('the same rows in any order publish the identical payload', async () => {
  openFloors();
  stubProvider();
  const rows = [
    row('a', { shelves: 3, owners: 2, week: window(2, '2026-10-12T10:00:00.000Z'), tiles: [0, 0, 0, 1, 1, 0] }),
    row('b', { shelves: 3, owners: 2, week: window(2, '2026-10-12T10:00:00.000Z'), tiles: [0, 0, 0, 1, 1, 0] }),
    row('c', { shelves: 3, owners: 2, week: window(2, '2026-10-12T10:00:00.000Z'), tiles: [0, 0, 0, 1, 1, 0] }),
    row('d', { shelves: 2, owners: 2, week: window(1, '2026-10-12T10:00:00.000Z'), tiles: [0, 0, 1, 0, 0, 0] }),
  ];
  const first = await build(rows);
  publicStats.resetForTests();
  const second = await build(shuffle(rows));
  assert.deepEqual(second.games, first.games);
  // Not vacuous: every card here is one fully tied group.
  assert.deepEqual(places(first.games.mostOwned), [['a', 1], ['b', 1], ['c', 1]]);
});

/* ------------------------------ the favourites ------------------------------ */

test('favourite names tie on the mean they SHOW', async () => {
  openFloors();
  // One game per designer. Bo's and Ada's games SHOW the same score (4,1) from
  // different raw ones, so a tie on the raw mean would number them 1 and 2.
  stubProvider({ links: { g1: { designers: ['Ada'] }, g2: { designers: ['Bo'] }, g3: { designers: ['Cy'] } } });
  const payload = await build([
    row('g2', { tiles: [0, 0, 0, 0, 0, 5] }),
    row('g3', { tiles: [0, 0, 0, 0, 5, 0] }),
    row('g1', { tiles: [0, 0, 0, 0, 1, 5] }),
  ]);
  const fav = payload.names.favDesigner.map((e) => [e.name, e.rank]);
  assert.deepEqual(fav, [['Bo', 1], ['Ada', 1], ['Cy', 3]], 'the raw mean still orders inside the tie');
});
