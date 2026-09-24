'use strict';

/* The Regal-Steckbrief's builder (#1173, public/js/shelf-profile.js): bands,
   the containment reading of playing time, expansion-widened seat ranges, the
   gap list, and the threshold that keeps a thin shelf from getting a card. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shelfProfile, shelfHasData, SHELF_PROFILE_MIN_GAMES,
} = require('../public/js/shelf-profile');
// The REAL seat predicate, not a paraphrase — the builder is handed it in the
// browser, so the spec hands it the same function.
const { fitsPlayerCount, isActiveGame } = require('../public/js/draw-pool');
const { DEMO_ROUNDS } = require('../lib/demo-seed');

const deps = { fitsPlayerCount };
const band = (dim, key) => dim.bands.find((b) => b.key === key).n;

// A linked game: some provider data, a 2–4 range, a medium hour.
const g = (over = {}) => ({
  title: 'G', minPlayers: 2, maxPlayers: 4, minPlaytime: 30, maxPlaytime: 60, weight: 2.5,
  categories: ['Card Game'], mechanics: ['Hand Management'], ...over,
});
const shelfOf = (n, over) => Array.from({ length: n }, (_, i) => g({ title: `G${i}`, ...over }));

test('below the threshold of linked games there is no profile at all', () => {
  assert.equal(shelfProfile([], deps), null);
  assert.equal(shelfProfile(undefined, deps), null);
  assert.equal(shelfProfile(shelfOf(SHELF_PROFILE_MIN_GAMES - 1), deps), null);
  assert.ok(shelfProfile(shelfOf(SHELF_PROFILE_MIN_GAMES), deps));
});

test('a hand-typed player range is not "linked" — only provider data counts toward the threshold', () => {
  const bare = Array.from({ length: 20 }, (_, i) => ({ title: `F${i}`, minPlayers: 2, maxPlayers: 4 }));
  assert.equal(shelfHasData(bare[0]), false);
  assert.equal(shelfProfile(bare, deps), null);
  assert.equal(shelfHasData({ categories: [] }), false, 'an empty list is no data');
  assert.equal(shelfHasData({ weight: 1.5 }), true);
});

test('seat bands: a game counts in every size its range covers, and 6+ means any table of six or more', () => {
  const shelf = [
    ...shelfOf(6),                              // 2–4
    g({ minPlayers: 3, maxPlayers: 8 }),        // 3..6+
    g({ minPlayers: 7, maxPlayers: 10 }),       // only 6+ (via 7)
  ];
  const p = shelfProfile(shelf, deps);
  assert.equal(band(p.seats, '2'), 6);
  assert.equal(band(p.seats, '3'), 7);
  assert.equal(band(p.seats, '4'), 7);
  assert.equal(band(p.seats, '5'), 1);
  assert.equal(band(p.seats, '6'), 2, 'a 7–10 game seats a table of six or more even though it cannot seat six');
});

test('owned expansions widen the range by UNION, never by hull', () => {
  const shelf = [
    ...shelfOf(6),
    // A 2–4 base plus a 5–6 expansion seats five and six.
    g({ expansions: [{ title: 'Erweiterung', minPlayers: 5, maxPlayers: 6 }] }),
    // A 3–4 base plus a SOLO expansion: 1, 3 and 4 — the hull 1–4 would claim 2.
    g({ minPlayers: 3, maxPlayers: 4, expansions: [{ title: 'Solo', minPlayers: 1, maxPlayers: 1 }] }),
  ];
  const p = shelfProfile(shelf, deps);
  assert.equal(band(p.seats, '5'), 1);
  assert.equal(band(p.seats, '6'), 1);
  assert.equal(band(p.seats, '2'), 7, 'the solo expansion must not make its 3–4 game count at two');
});

test('a game with no range at all is UNKNOWN for seats, not "any table size"', () => {
  const shelf = [...shelfOf(8), g({ minPlayers: undefined, maxPlayers: undefined })];
  const p = shelfProfile(shelf, deps);
  assert.equal(p.seats.known, 8);
  assert.equal(p.seats.unknown, 1);
  assert.equal(band(p.seats, '6'), 0, 'the rangeless box would otherwise fill every band and hide the gap');
});

test('playing time bands read the game’s OWN maximum — the draw filter’s containment reading (#1025)', () => {
  const shelf = [
    ...shelfOf(4, { minPlaytime: 20, maxPlaytime: 30 }),   // ≤30
    ...shelfOf(2, { minPlaytime: 30, maxPlaytime: 60 }),   // 31–60, though it CAN run 30
    g({ minPlaytime: 60, maxPlaytime: 61 }),               // 61–120
    g({ minPlaytime: 120, maxPlaytime: 240 }),             // >120
  ];
  const p = shelfProfile(shelf, deps);
  assert.deepEqual(p.time.bands.map((b) => [b.key, b.n]),
    [['upTo30', 4], ['to60', 2], ['to120', 1], ['over120', 1]]);
});

test('weight bands: light < 2.0, medium 2.0–3.4, heavy from 3.5', () => {
  const shelf = [
    ...shelfOf(3, { weight: 1.99 }),
    ...shelfOf(3, { weight: 2 }),
    g({ weight: 3.49 }),
    g({ weight: 3.5 }),
  ];
  const p = shelfProfile(shelf, deps);
  assert.deepEqual(p.weight.bands.map((b) => [b.key, b.n]), [['light', 3], ['medium', 4], ['heavy', 1]]);
});

test('a dimension too few games carry is left out rather than drawn as a row of gaps', () => {
  // Every game is linked through categories, but only three have a weight.
  const shelf = shelfOf(9, { weight: undefined });
  shelf.slice(0, 3).forEach((x) => { x.weight = 1.5; });
  const p = shelfProfile(shelf, deps);
  assert.equal(p.weight, null);
  assert.ok(!p.gaps.some((x) => x.dim === 'weight'), 'no weight gap may be claimed from three data points');
  assert.ok(p.time, 'the other dimensions are unaffected');
});

test('gaps: every band under three, the empty ones first, dimension order otherwise', () => {
  const shelf = [
    ...shelfOf(7),                                           // 2–4, 31–60, medium
    g({ minPlayers: 2, maxPlayers: 5, maxPlaytime: 25 }),     // one at five, one ≤30
  ];
  const p = shelfProfile(shelf, deps);
  assert.deepEqual(p.gaps.map((x) => `${x.dim}:${x.key}:${x.n}`), [
    'seats:6:0', 'time:to120:0', 'time:over120:0', 'weight:light:0', 'weight:heavy:0',
    'seats:5:1', 'time:upTo30:1',
  ]);
  const full = shelfProfile([
    ...shelfOf(3, { minPlayers: 1, maxPlayers: 8, maxPlaytime: 20, weight: 1.2 }),
    ...shelfOf(3, { minPlayers: 1, maxPlayers: 8, maxPlaytime: 50, weight: 2.4 }),
    ...shelfOf(3, { minPlayers: 1, maxPlayers: 8, maxPlaytime: 90, weight: 3.8 }),
    ...shelfOf(3, { minPlayers: 1, maxPlayers: 8, maxPlaytime: 180, weight: 4.1 }),
  ], deps);
  assert.deepEqual(full.gaps, [], 'a shelf with three or more in every band has no gaps');
});

test('the top mechanics and categories: most common first, ties by name, no singletons, at most five', () => {
  // Fresh arrays per game: the fixture helper would otherwise share one.
  const shelf = shelfOf(8, { categories: [] }).map((x) => ({ ...x, mechanics: ['Dice Rolling'] }));
  shelf[0].mechanics = ['Dice Rolling', 'Worker Placement', 'Worker Placement'];  // a duplicate counts once
  shelf[1].mechanics = ['Dice Rolling', 'Worker Placement', 'Auction'];
  shelf[2].mechanics = ['Dice Rolling', 'Auction', 'Solo'];
  ['A', 'B', 'C', 'D', 'E'].forEach((m) => { shelf[3].mechanics.push(m); shelf[4].mechanics.push(m); });
  const p = shelfProfile(shelf, deps);
  assert.deepEqual(p.mechanics.map((m) => `${m.name}:${m.n}`),
    ['Dice Rolling:8', 'A:2', 'Auction:2', 'B:2', 'C:2']);
  assert.ok(!p.mechanics.some((m) => m.name === 'Solo'), 'a name held by one game leads nothing');
  assert.deepEqual(p.categories, []);
  // The singleton guard needs a list SHORTER than five to be visible at all —
  // above, Solo loses the cut to the pairs anyway (measured: green with the
  // filter deleted).
  shelf[0].categories = ['Rare'];
  shelf[1].categories = ['Common'];
  shelf[2].categories = ['Common'];
  assert.deepEqual(shelfProfile(shelf, deps).categories.map((c) => c.name), ['Common']);
});

test('the demo seed’s big round has a profile, and its two small rounds do not', () => {
  const [main, duo, group] = DEMO_ROUNDS;
  const active = (r) => r.games.filter(isActiveGame);
  const p = shelfProfile(active(main), deps);
  assert.ok(p, 'the round a demo visitor lands in must show the card');
  assert.ok(p.seats && p.time && p.weight, 'every dimension has enough data in the demo');
  assert.ok(p.gaps.length > 0, 'the demo shelf has something to say about its gaps');
  assert.equal(shelfProfile(active(duo), deps), null);
  assert.equal(shelfProfile(active(group), deps), null);
});
