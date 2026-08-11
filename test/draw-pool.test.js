'use strict';

/* The shared draw-pool predicates (#634) and — the point of the whole exercise —
   that the session-setup screen's live preview really applies them.

   `test/draw.test.js` covers the server's side of this. What it cannot see is the
   failure #634 exists to prevent: the preview promising a pool the draw would not
   produce. That is invisible to every server-side test by construction, which is
   why the parity check at the bottom renders the real view and compares its tiles
   against `drawPool()` over the same round.

   Only the ACTIVE and RANGE clauses are shared, so only those are asserted as
   parity. The tag filter is deliberately still expressed twice — the server takes
   resolved include/exclude id lists, the client a tri-state chip map — and
   `test/draw.test.js` owns that half. */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  isActiveGame,
  fitsPlayerCount,
  requiredExpansions,
  fitsMetadataFilters,
  metadataFilterOptions,
  hasMetadataFilterOptions,
  normalizeMetadataFilters,
  countMetadataFilters,
} = require('../public/js/draw-pool');
const { drawPool } = require('../lib/draw');
const { loadApp } = require('./support/dom');

// The canonical "nothing is filtered" shape, minted the way the app mints it.
const NO_FILTERS = normalizeMetadataFilters(null, {});
// Everything on offer, for the normalizer cases that are about the VALUE rather
// than about a shelf that cannot offer it.
const ALL_OPTIONS = {
  playtime: true,
  weight: true,
  age: true,
  categories: ['Economic', 'Party Game'],
  mechanics: ['Deck Building', 'Dice Rolling'],
};

test('isActiveGame is false for either archive and true for a plain game', () => {
  assert.equal(isActiveGame({}), true);
  assert.equal(isActiveGame({ retired: true }), false);
  assert.equal(isActiveGame({ completed: true }), false);
  // Exclusivity is enforced in the repo, but the predicate must not depend on it.
  assert.equal(isActiveGame({ retired: true, completed: true }), false);
});

test('fitsPlayerCount admits exactly the declared range, bounds included', () => {
  const duo = { minPlayers: 2, maxPlayers: 2 };
  assert.equal(fitsPlayerCount(duo, 1), false);
  assert.equal(fitsPlayerCount(duo, 2), true, 'both bounds are inclusive');
  assert.equal(fitsPlayerCount(duo, 3), false);
});

test('an absent bound means "any table size" — not zero and not infinity', () => {
  // The typeof guards are what make this true; defaulting a missing min to 0
  // would read the same here but not for a game with no range at all, below.
  assert.equal(fitsPlayerCount({ minPlayers: 4 }, 99), true, 'no maximum');
  assert.equal(fitsPlayerCount({ maxPlayers: 4 }, 1), true, 'no minimum');
  for (const n of [1, 4, 99]) {
    assert.equal(fitsPlayerCount({}, n), true, `a game with no range fits ${n}`);
  }
});

/* ---- owned expansions widen the range (#653) --------------------------------
   The union of the base box and every owned expansion, never their hull. The
   two traps are asserted directly below because both produce a plausible pool
   rather than an error — see .claude/rules/expansions-widen-by-union.md. */

test('an owned expansion makes its game drawable at the counts it admits', () => {
  const catan = {
    minPlayers: 3,
    maxPlayers: 4,
    expansions: [{ title: '5–6 Spieler', minPlayers: 5, maxPlayers: 6 }],
  };
  assert.equal(fitsPlayerCount(catan, 4), true, 'the base box still fits');
  assert.equal(fitsPlayerCount(catan, 5), true, 'the expansion admits five');
  assert.equal(fitsPlayerCount(catan, 6), true);
  assert.equal(fitsPlayerCount(catan, 7), false, 'nothing owned admits seven');
  assert.equal(fitsPlayerCount(catan, 2), false, 'and the base minimum still binds');
});

test('the widening is a UNION, not a hull — a solo expansion does not admit two', () => {
  // The case that separates the two implementations: hulling 3–4 with 1–1 gives
  // 1–4, which admits a table of 2 that no box in the cupboard supports.
  const game = {
    minPlayers: 3,
    maxPlayers: 4,
    expansions: [{ title: 'Solo', minPlayers: 1, maxPlayers: 1 }],
  };
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => fitsPlayerCount(game, n)),
    [true, false, true, true, false]
  );
});

test('an absent range means the OPPOSITE thing on an expansion', () => {
  // On the base game it means "any table size" (asserted above). On an
  // expansion it must widen nothing, or one expansion BGG has no numbers for
  // makes its game drawable at every count.
  const vague = { minPlayers: 3, maxPlayers: 4, expansions: [{ title: 'Unbekannt' }] };
  assert.equal(fitsPlayerCount(vague, 6), false, 'no numbers, no widening');
  assert.equal(fitsPlayerCount(vague, 1), false);
  assert.equal(fitsPlayerCount(vague, 3), true, 'the base box is untouched');

  // A HALF-declared range is the same case: it widens only over a range it
  // states in full, so a stray bound can never open one end to infinity.
  const halfMax = { minPlayers: 3, maxPlayers: 4, expansions: [{ maxPlayers: 6 }] };
  assert.equal(fitsPlayerCount(halfMax, 6), false, 'a bare maximum states no minimum');
  assert.equal(fitsPlayerCount(halfMax, 1), false, 'and must not open the bottom end');
  const halfMin = { minPlayers: 3, maxPlayers: 4, expansions: [{ minPlayers: 5 }] };
  assert.equal(fitsPlayerCount(halfMin, 5), false, 'a bare minimum states no maximum');
  assert.equal(fitsPlayerCount(halfMin, 99), false);
});

test('a base game with no range keeps fitting everything, expansions or not', () => {
  const g = { expansions: [{ title: 'Solo', minPlayers: 1, maxPlayers: 1 }] };
  for (const n of [1, 4, 99]) assert.equal(fitsPlayerCount(g, n), true);
});

test('requiredExpansions names only what the BASE box cannot seat', () => {
  const game = {
    minPlayers: 3,
    maxPlayers: 4,
    expansions: [
      { id: 'e1', title: '5–6 Spieler', minPlayers: 5, maxPlayers: 6 },
      { id: 'e2', title: 'Seefahrer', minPlayers: 3, maxPlayers: 6 },
      { id: 'e3', title: 'Ohne Angabe' },
    ],
  };
  assert.deepEqual(requiredExpansions(game, 4), [], 'the base box fits — nothing is required');
  assert.deepEqual(
    requiredExpansions(game, 5).map((e) => e.id),
    ['e1', 'e2'],
    'both owned expansions that admit five are named'
  );
  assert.deepEqual(requiredExpansions(game, 9), [], 'a count nothing admits names nothing');
  assert.deepEqual(requiredExpansions({ minPlayers: 3, maxPlayers: 4 }, 5), []);
});

/* ---- the metadata filters (#725) ------------------------------------------- */

test('an ABSENT field on the game passes every metadata filter', () => {
  // The rule the whole feature hangs on: a game BGG has no metadata for must
  // stay drawable, or the first touch of any filter silently hides every
  // storefront game, every hand-typed one, and an entire shelf on an instance
  // with no BGG token. Asserted field by field rather than on one bare {} —
  // a single guard written the wrong way round would still pass that.
  const filters = {
    maxPlaytime: 30, weightMin: 2, weightMax: 3, youngestAge: 8,
    categories: ['Economic'], mechanics: ['Dice Rolling'],
  };
  assert.equal(fitsMetadataFilters({}, filters), true, 'a game with no metadata at all');
  assert.equal(fitsMetadataFilters({ minPlaytime: 20 }, filters), true, 'only playtime known');
  assert.equal(fitsMetadataFilters({ weight: 2.5 }, filters), true, 'only weight known');
  assert.equal(fitsMetadataFilters({ minAge: 8 }, filters), true, 'only age known');
  assert.equal(fitsMetadataFilters({ categories: [] }, filters), true, 'an empty list is absent');
  assert.equal(fitsMetadataFilters({ mechanics: [] }, filters), true, 'an empty list is absent');
});

test('an empty filter set admits everything, including a fully described game', () => {
  const game = {
    minPlaytime: 240, maxPlaytime: 600, weight: 4.7, minAge: 14,
    categories: ['Economic'], mechanics: ['Deck Building'],
  };
  assert.equal(fitsMetadataFilters(game, NO_FILTERS), true);
  assert.equal(fitsMetadataFilters(game, {}), true);
  assert.equal(fitsMetadataFilters(game, undefined), true);
});

test('the playtime budget tests the LOWER bound, not an average or the maximum', () => {
  // Toriki's real 20–600 spread is the case that decides this: filtering on the
  // maximum (or on a synthesised mean of 310) would drop it from every realistic
  // evening, though it genuinely plays in twenty minutes.
  const wide = { minPlaytime: 20, maxPlaytime: 600 };
  assert.equal(fitsMetadataFilters(wide, { maxPlaytime: 30 }), true);
  assert.equal(fitsMetadataFilters({ minPlaytime: 45 }, { maxPlaytime: 30 }), false);
  assert.equal(fitsMetadataFilters({ minPlaytime: 30 }, { maxPlaytime: 30 }), true, 'inclusive');
});

test('the complexity bounds are inclusive and each acts on its own', () => {
  assert.equal(fitsMetadataFilters({ weight: 2 }, { weightMin: 2 }), true);
  assert.equal(fitsMetadataFilters({ weight: 1.9 }, { weightMin: 2 }), false);
  assert.equal(fitsMetadataFilters({ weight: 3 }, { weightMax: 3 }), true);
  assert.equal(fitsMetadataFilters({ weight: 3.1 }, { weightMax: 3 }), false);
  assert.equal(fitsMetadataFilters({ weight: 2.5 }, { weightMin: 2, weightMax: 3 }), true);
});

test('"the youngest at the table is N" admits a game whose own minimum is at most N', () => {
  assert.equal(fitsMetadataFilters({ minAge: 8 }, { youngestAge: 8 }), true, 'inclusive');
  assert.equal(fitsMetadataFilters({ minAge: 6 }, { youngestAge: 8 }), true);
  assert.equal(fitsMetadataFilters({ minAge: 12 }, { youngestAge: 8 }), false);
});

test('categories and mechanics are OR within a list and AND between them', () => {
  const game = { categories: ['Economic', 'Negotiation'], mechanics: ['Trading'] };
  // OR within: one match out of two picks is enough. AND-ing these would collapse
  // the pool to near-zero, since a game carries 3–8 of BGG's ~84 categories.
  assert.equal(fitsMetadataFilters(game, { categories: ['Economic', 'Party Game'] }), true);
  assert.equal(fitsMetadataFilters(game, { categories: ['Party Game'] }), false);
  // AND between: the mechanic clause must also hold.
  assert.equal(
    fitsMetadataFilters(game, { categories: ['Economic'], mechanics: ['Trading'] }), true);
  assert.equal(
    fitsMetadataFilters(game, { categories: ['Economic'], mechanics: ['Deck Building'] }), false,
    'a matching category cannot carry a failing mechanic');
});

test('metadataFilterOptions offers only what the SHELF carries, deduped and sorted', () => {
  const games = [
    { minPlaytime: 30, categories: ['Party Game', 'Economic'] },
    { minAge: 10, categories: ['Economic'], mechanics: ['Dice Rolling'] },
    { title: 'no metadata at all' },
  ];
  const o = metadataFilterOptions(games);
  assert.equal(o.playtime, true);
  assert.equal(o.age, true);
  assert.equal(o.weight, false, 'no game carries a weight, so complexity is not offered');
  assert.deepEqual(o.categories, ['Economic', 'Party Game'], 'BGG\'s ~84 are not on offer');
  assert.deepEqual(o.mechanics, ['Dice Rolling']);
});

test('a shelf carrying no metadata at all offers nothing — the disclosure is absent', () => {
  const bare = metadataFilterOptions([{ title: 'Azul' }, { title: 'Uno' }]);
  assert.equal(hasMetadataFilterOptions(bare), false);
  assert.equal(hasMetadataFilterOptions(metadataFilterOptions([])), false);
  // …and any one field is enough to bring it back, or the "hide it entirely"
  // branch would be reachable on a shelf that has something to offer.
  assert.equal(hasMetadataFilterOptions(metadataFilterOptions([{ minAge: 8 }])), true);
  assert.equal(
    hasMetadataFilterOptions(metadataFilterOptions([{ mechanics: ['Trading'] }])), true);
});

test('normalizeMetadataFilters drops a value this shelf can no longer offer', () => {
  // The vanished referent: a category whose last game was archived, and a
  // numeric filter on a field nothing on the shelf carries. Left in place, each
  // would count toward the badge over a control the disclosure never renders.
  const out = normalizeMetadataFilters(
    { maxPlaytime: 60, weightMin: 2, youngestAge: 10, categories: ['Economic', 'Gone'], mechanics: ['Trading'] },
    { playtime: true, weight: false, age: false, categories: ['Economic'], mechanics: [] }
  );
  assert.deepEqual(out, {
    maxPlaytime: 60,
    weightMin: null,
    weightMax: null,
    youngestAge: null,
    categories: ['Economic'],
    mechanics: [],
  });
});

test('normalizeMetadataFilters accepts only the ladder steps the UI offers', () => {
  // Membership, not a range — so a hand-crafted 37-minute budget or a 2.5
  // complexity bound collapses to "unfiltered" instead of 400ing, and the client
  // cannot offer a step the server would reject.
  const out = normalizeMetadataFilters(
    { maxPlaytime: 37, weightMin: 2.5, weightMax: 9, youngestAge: 7 }, ALL_OPTIONS);
  assert.deepEqual(out, { ...NO_FILTERS });
  const good = normalizeMetadataFilters(
    { maxPlaytime: 90, weightMin: 2, weightMax: 4, youngestAge: 12 }, ALL_OPTIONS);
  assert.deepEqual(good, { ...NO_FILTERS, maxPlaytime: 90, weightMin: 2, weightMax: 4, youngestAge: 12 });
});

test('normalizeMetadataFilters survives junk of every shape', () => {
  for (const junk of [null, undefined, 'nope', 42, [], { categories: 'Economic' }, { categories: [7, null] }]) {
    assert.deepEqual(normalizeMetadataFilters(junk, ALL_OPTIONS), NO_FILTERS,
      `junk input ${JSON.stringify(junk)} must normalize to the empty filter set`);
  }
});

test('an inverted complexity range is SWAPPED, not left to empty the pool', () => {
  // Unreachable through the UI (each select carries the other along), so this is
  // about a hand-crafted body. Swapping here, in the shared function, is what
  // keeps the preview and the draw from disagreeing about what it means.
  const out = normalizeMetadataFilters({ weightMin: 4, weightMax: 2 }, ALL_OPTIONS);
  assert.equal(out.weightMin, 2);
  assert.equal(out.weightMax, 4);
});

test('countMetadataFilters counts CONTROLS — the complexity range is one', () => {
  assert.equal(countMetadataFilters(NO_FILTERS), 0);
  assert.equal(countMetadataFilters({ ...NO_FILTERS, weightMin: 2 }), 1);
  assert.equal(countMetadataFilters({ ...NO_FILTERS, weightMin: 2, weightMax: 4 }), 1,
    'two bounds are one visible row, so a badge of 2 could not be reconciled');
  assert.equal(countMetadataFilters({
    maxPlaytime: 60, weightMin: 2, weightMax: 4, youngestAge: 10,
    categories: ['Economic'], mechanics: ['Trading'],
  }), 5, 'all five controls');
  assert.equal(countMetadataFilters({ ...NO_FILTERS, categories: [] }), 0, 'an empty list filters nothing');
});

test('drawPool applies the metadata filters, and is untouched without them', () => {
  const shelf = {
    games: [
      { id: 'a', title: 'Kurz', minPlaytime: 20 },
      { id: 'b', title: 'Lang', minPlaytime: 120 },
      { id: 'c', title: 'Unbekannt' },
    ],
  };
  const titles = (metadata) => drawPool(shelf, { metadata, playerCount: 3 }).map((g) => g.title).sort();
  // The regression guard: no filter set must produce exactly the pre-#725 pool.
  assert.deepEqual(titles(undefined), ['Kurz', 'Lang', 'Unbekannt']);
  assert.deepEqual(titles(NO_FILTERS), ['Kurz', 'Lang', 'Unbekannt']);
  assert.deepEqual(titles({ ...NO_FILTERS, maxPlaytime: 30 }), ['Kurz', 'Unbekannt']);
});

/* ---- the cross-boundary parity check ---------------------------------------
   Four members join by default and there are no guests or teams, so the view's
   party count is round.members.length — the same number handed to drawPool here.

   The fixture discriminates in BOTH directions as that count changes: at four
   players 'Catan' is in and 'Duo' is out, at two it is the other way round. A
   preview that had drifted to a wrong bound, a wrong comparison or a missing
   archive clause changes one of those four answers. */

const round = {
  id: 'r1',
  name: 'Freitagsrunde',
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
    { id: 'm3', name: 'Cleo' },
    { id: 'm4', name: 'Dana' },
  ],
  games: [
    { id: 'g1', title: 'Azul' },
    { id: 'g2', title: 'Uno', retired: true },
    { id: 'g3', title: 'Risiko', completed: true },
    { id: 'g4', title: 'Duo', minPlayers: 2, maxPlayers: 2 },
    { id: 'g5', title: 'Catan', minPlayers: 3, maxPlayers: 4 },
  ],
};

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
// The screen renders the per-device-voting row only in accounts mode, and it is
// not what this spec is about.
dom.set('isLoggedIn', () => false);

// The titles the preview panel is offering right now.
const previewed = () =>
  [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort();

// What the server would actually draw from, for the same table size.
const drawable = (playerCount) =>
  drawPool(round, { playerCount }).map((g) => g.title).sort();

test('the setup preview offers exactly what the draw would pick from', async () => {
  await dom.call('showStartSession', round);

  assert.deepEqual(previewed(), drawable(4));
  // Anti-vacuous: an empty preview would satisfy a comparison against an empty
  // pool, and both archives must be doing work in that equality.
  assert.deepEqual(previewed(), ['Azul', 'Catan']);
});

test('… and still does after the table size changes', async () => {
  await dom.call('showStartSession', round);

  // Two seats out -> a two-person table. Clicking a seat re-runs updateHint().
  const seats = [...dom.app.querySelectorAll('.nr-seat')];
  assert.equal(seats.length, 4, 'fixture sanity: one seat per member');
  seats[0].click();
  seats[1].click();

  assert.deepEqual(previewed(), drawable(2));
  // The set must have moved in both directions, or this asserts nothing that the
  // four-player case did not already cover.
  assert.deepEqual(previewed(), ['Azul', 'Duo']);
});
