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
const { creditedDesigners } = require('../public/js/provider-info-fields');
const { DEMO_ROUNDS } = require('../lib/demo-seed');

// The seams the browser hands in (views-shelf-profile.js `shelfProfileDeps`).
// `scoreOf` stands in for the round's shelf index (roundScoreIndex): a fixture
// game carries its shelf score as `score`, and a game without one is unscored.
const scoreOf = (game) => (Number.isFinite(game.score) ? game.score : null);
const deps = { fitsPlayerCount, creditedDesigners, scoreOf };
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

test('gaps: every seat and time band under three, the empty ones first, dimension order otherwise', () => {
  const shelf = [
    ...shelfOf(7),                                           // 2–4, 31–60, medium
    g({ minPlayers: 2, maxPlayers: 5, maxPlaytime: 25 }),     // one at five, one ≤30
  ];
  const p = shelfProfile(shelf, deps);
  assert.deepEqual(p.gaps.map((x) => `${x.dim}:${x.key}:${x.n}`), [
    'seats:6:0', 'time:to120:0', 'time:over120:0',
    'seats:5:1', 'time:upTo30:1',
  ]);
  // Weight is a taste, not a gap (#1173 review): a light family shelf has no
  // heavy game on purpose, so the bars show weight and no sentence claims it.
  assert.equal(p.weight.bands.find((b) => b.key === 'heavy').n, 0, 'the fixture really has an empty weight band');
  assert.ok(!p.gaps.some((x) => x.dim === 'weight'), 'weight never produces a gap');
  const full = shelfProfile([
    ...shelfOf(3, { minPlayers: 1, maxPlayers: 8, maxPlaytime: 20, weight: 1.2 }),
    ...shelfOf(3, { minPlayers: 1, maxPlayers: 8, maxPlaytime: 50, weight: 2.4 }),
    ...shelfOf(3, { minPlayers: 1, maxPlayers: 8, maxPlaytime: 90, weight: 3.8 }),
    ...shelfOf(3, { minPlayers: 1, maxPlayers: 8, maxPlaytime: 180, weight: 4.1 }),
  ], deps);
  assert.deepEqual(full.gaps, [], 'a shelf with three or more in every band has no gaps');
});

// A shelf of `n` scored games with no mechanics or categories, for the list
// tests to hand names to. Fresh arrays per game: the helper would share one.
const listShelf = (n = 9) => shelfOf(n, { score: 3 }).map((x) => ({ ...x, mechanics: [], categories: [] }));
const row = (it) => `${it.name}:${it.score}:${it.n}`;

test('the top names rank by their games\' mean shelf score, not by how many games carry them (#1556)', () => {
  const shelf = listShelf();
  // Common is on four mediocre games, Loved on two favourites. A count ranking
  // puts Common first; the score ranking must not.
  [0, 1, 2, 3].forEach((i) => { shelf[i].mechanics = ['Common']; shelf[i].score = 2; });
  [4, 5].forEach((i) => { shelf[i].mechanics = ['Loved']; shelf[i].score = 4.5; });
  shelf[4].score = 4;
  shelf[5].score = 5;
  const p = shelfProfile(shelf, deps);
  assert.deepEqual(p.mechanics.map(row), ['Loved:4.5:2', 'Common:2:4']);
});

test('an unscored game moves neither a name\'s value nor its count, and a name needs two SCORED games (#1556)', () => {
  const shelf = listShelf();
  // Loved: two scored games plus three unscored ones — still 4.5 over 2.
  [0, 1, 2, 3, 4].forEach((i) => { shelf[i].mechanics = ['Loved']; });
  shelf[0].score = 4;
  shelf[1].score = 5;
  [2, 3, 4].forEach((i) => { shelf[i].score = null; });
  // Solo: one scored game and two unscored — never listed, however many boxes.
  [5, 6, 7].forEach((i) => { shelf[i].categories = ['Solo']; });
  shelf[6].score = null;
  shelf[7].score = undefined;
  const p = shelfProfile(shelf, deps);
  assert.deepEqual(p.mechanics.map(row), ['Loved:4.5:2']);
  assert.deepEqual(p.categories, [], 'one scored game leads nothing; no fallback to counts');
});

test('ties: more scored games first, then by name; at most five; duplicates count once (#1556)', () => {
  const shelf = listShelf(12);
  // B and A share a mean of 3 on two games each; Wide has the same mean on
  // three. Wide wins the tie by evidence, then A before B by name.
  shelf[0].mechanics = ['B', 'B'];  // a duplicate on one game counts once
  shelf[1].mechanics = ['B'];
  shelf[2].mechanics = ['A'];
  shelf[3].mechanics = ['A'];
  [4, 5, 6].forEach((i) => { shelf[i].mechanics = ['Wide']; });
  // Three more names above them, so the cut at five is visible.
  ['Top1', 'Top2', 'Top3'].forEach((m) => { shelf[7].mechanics.push(m); shelf[8].mechanics.push(m); });
  shelf[7].score = 4;
  shelf[8].score = 4;
  const p = shelfProfile(shelf, deps);
  assert.deepEqual(p.mechanics.map(row), ['Top1:4:2', 'Top2:4:2', 'Top3:4:2', 'Wide:3:3', 'A:3:2']);
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

test('the top designers: ranked like mechanics, with BGG\'s (Uncredited) sentinel never among them (#1505)', () => {
  /* Five uncredited games score highest on this shelf, so a builder that forgot
   * the filter would lead with "(Uncredited)" — every party game reading as the
   * work of one beloved designer. */
  const shelf = shelfOf(9).map((x, i) => ({
    ...x,
    score: i < 5 ? 5 : 3,
    designers: i < 5 ? ['(Uncredited)'] : i < 8 ? ['Uwe Rosenberg'] : ['Uwe Rosenberg', 'Solo Person'],
  }));
  const p = shelfProfile(shelf, deps);
  assert.deepEqual(p.designers, [{ name: 'Uwe Rosenberg', score: 3, n: 4 }]);
  // A shelf with no designer data has an empty list, like the other two.
  assert.deepEqual(shelfProfile(shelfOf(9, { score: 3 }), deps).designers, []);
});
