'use strict';

/* The session draw's pool filter (#486).

   Before this module existed the filter lived inline in lib/routes/sessions.js
   and could only be exercised through an HTTP round-trip, which is why
   .claude/rules/active-games-filter-sites.md calls the two server-side copies
   the ones that "bite silently". These are the direct unit tests: each clause of
   the predicate on its own, so a dropped clause names itself. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { drawPool, isActiveGame, shuffle } = require('../lib/draw');
const shared = require('../public/js/draw-pool');

// One game per state/shape the filter cares about. Player ranges are left off
// unless the case is about them — an absent min/max means "any table size".
const round = {
  games: [
    { id: 'plain', tagIds: [] },
    { id: 'retired', retired: true, tagIds: [] },
    { id: 'completed', completed: true, tagIds: [] },
    { id: 'tagged-ab', tagIds: ['a', 'b'] },
    { id: 'tagged-a', tagIds: ['a'] },
    { id: 'duo', tagIds: [], minPlayers: 2, maxPlayers: 2 },
    { id: 'party', tagIds: [], minPlayers: 4 },
    { id: 'solo-capped', tagIds: [], maxPlayers: 1 },
  ],
};

const ids = (games) => games.map((g) => g.id);

test('both archives are out of the pool, and only they are', () => {
  const picked = ids(drawPool(round, { playerCount: 1 }));
  assert.ok(!picked.includes('retired'), 'a retired game must not be drawable');
  assert.ok(!picked.includes('completed'), 'a completed game must not be drawable');
  assert.ok(picked.includes('plain'), 'an active game must stay drawable');
});

test('isActiveGame is false for either archive and true for a plain game', () => {
  assert.equal(isActiveGame({}), true);
  assert.equal(isActiveGame({ retired: true }), false);
  assert.equal(isActiveGame({ completed: true }), false);
  // Exclusivity is enforced in the repo, but the predicate must not depend on it.
  assert.equal(isActiveGame({ retired: true, completed: true }), false);
});

test('lib/draw re-exports the SHARED predicates rather than holding copies', () => {
  // Identity, not behaviour: an inlined second copy of either predicate passes
  // every other test in this file while being exactly the drift #634 removed.
  // lib/routes/sessions.js imports isActiveGame from here, so the re-export is
  // load-bearing and not a convenience.
  assert.equal(isActiveGame, shared.isActiveGame, 'isActiveGame must BE public/js/draw-pool.js\'s');
  assert.equal(
    drawPool({ games: [{ minPlayers: 5 }] }, { playerCount: 2 }).length,
    0,
    'the pool must apply the shared range predicate',
  );
});

test('included tags use AND semantics — a game must carry every one', () => {
  const picked = ids(drawPool(round, { tagIds: ['a', 'b'], playerCount: 1 }));
  assert.deepEqual(picked, ['tagged-ab']);
  // Carrying one of the two is not enough, and carrying none is not either.
  assert.ok(!picked.includes('tagged-a'));
  assert.ok(!picked.includes('plain'));
});

test('AND stays the default — an absent or unknown tagMode does not widen the pool (#726)', () => {
  // The mode is a lenient field, so the pool must not depend on the caller
  // spelling it: every non-'any' value is the pre-#726 behaviour.
  for (const tagMode of [undefined, null, 'all', 'ALL', 'any-ish', 42]) {
    assert.deepEqual(
      ids(drawPool(round, { tagIds: ['a', 'b'], tagMode, playerCount: 1 })),
      ['tagged-ab'],
      `tagMode ${JSON.stringify(tagMode)} must behave as 'all'`,
    );
  }
});

test("tagMode 'any' admits a game carrying at least ONE included tag (#726)", () => {
  const picked = ids(drawPool(round, { tagIds: ['a', 'b'], tagMode: 'any', playerCount: 1 }));
  // 'tagged-a' carries only one of the two — the whole point of the mode. The
  // AND result ('tagged-ab') has to stay in as well, or `some` was swapped for
  // an exclusive-or rather than widened.
  assert.deepEqual(picked, ['tagged-ab', 'tagged-a']);
  // A game carrying NEITHER is still out: 'any' widens the filter, it does not
  // remove it. Without this, `tagIds.some(...)` replaced by a bare `true` passes.
  assert.ok(!picked.includes('plain'), "'any' is still a filter");
});

test("tagMode 'any' does not weaken the exclude clause (#726)", () => {
  // Excludes reject a game carrying ANY of them in BOTH modes. The fixture puts
  // 'b' in both lists so one assertion discriminates all three ways this can go
  // wrong: correct OR admits 'tagged-ab' by 'a' and then rejects it by 'b';
  // an OR that also softens excludes keeps it; and a mode that never applied at
  // all ANDs down to 'tagged-ab' and then rejects THAT, leaving nothing.
  const picked = ids(
    drawPool(round, { tagIds: ['a', 'b'], excludeTagIds: ['b'], tagMode: 'any', playerCount: 1 }),
  );
  assert.deepEqual(picked, ['tagged-a']);
});

test('excluded tags reject a game carrying ANY of them', () => {
  // TWO excluded tags, and 'tagged-ab' carries only one of them. With a single
  // excluded tag `.some` and `.every` behave identically, so a one-tag fixture
  // stays green against the ANY->ALL break this test exists to catch
  // (.claude/rules/break-the-code-on-purpose.md — a fixture too small to fail).
  const picked = ids(drawPool(round, { excludeTagIds: ['b', 'c'], playerCount: 1 }));
  assert.ok(!picked.includes('tagged-ab'), 'carrying ONE excluded tag is enough to reject');
  assert.ok(picked.includes('tagged-a'), 'a game carrying none of them survives');
  assert.ok(picked.includes('plain'));
});

test('include and exclude combine — include first, then reject', () => {
  const picked = ids(drawPool(round, { tagIds: ['a'], excludeTagIds: ['b'], playerCount: 1 }));
  assert.deepEqual(picked, ['tagged-a'], 'tagged-ab is included by "a" and then rejected by "b"');
});

test('a game whose minimum is above the table is out', () => {
  assert.ok(!ids(drawPool(round, { playerCount: 3 })).includes('party'));
  assert.ok(ids(drawPool(round, { playerCount: 4 })).includes('party'), 'exactly the minimum fits');
});

test('a game whose maximum is below the table is out', () => {
  assert.ok(!ids(drawPool(round, { playerCount: 2 })).includes('solo-capped'));
  assert.ok(ids(drawPool(round, { playerCount: 1 })).includes('solo-capped'), 'exactly the maximum fits');
});

test('a game with no declared range fits any table', () => {
  for (const playerCount of [1, 4, 99]) {
    assert.ok(ids(drawPool(round, { playerCount })).includes('plain'), `playerCount ${playerCount}`);
  }
});

test('an exact-range game is in only at its own size', () => {
  assert.ok(!ids(drawPool(round, { playerCount: 1 })).includes('duo'));
  assert.ok(ids(drawPool(round, { playerCount: 2 })).includes('duo'));
  assert.ok(!ids(drawPool(round, { playerCount: 3 })).includes('duo'));
});

test('null tag filters mean no tag filtering at all', () => {
  const picked = ids(drawPool(round, { tagIds: null, excludeTagIds: null, playerCount: 1 }));
  assert.deepEqual(picked, ['plain', 'tagged-ab', 'tagged-a', 'solo-capped']);
});

test('a game with no tagIds key survives an exclude filter', () => {
  // `tagIds` is absent rather than [] on games added before #238.
  const legacy = { games: [{ id: 'legacy' }] };
  assert.deepEqual(ids(drawPool(legacy, { excludeTagIds: ['a'], playerCount: 2 })), ['legacy']);
  assert.deepEqual(ids(drawPool(legacy, { tagIds: ['a'], playerCount: 2 })), []);
});

test('shuffle keeps every element, and shuffles in place', () => {
  const arr = [1, 2, 3, 4, 5];
  const out = shuffle(arr);
  assert.equal(out, arr, 'returns the same array it was given');
  assert.deepEqual([...out].sort((a, b) => a - b), [1, 2, 3, 4, 5], 'no element lost or duplicated');
});

test('shuffle actually reorders over repeated runs', () => {
  // A permutation check would pass against `return arr`, so assert that some run
  // differs. 20 runs of 8 elements: a no-op shuffle fails every time, a real one
  // has a (1/8!)^20 chance of a false red.
  const source = [1, 2, 3, 4, 5, 6, 7, 8];
  const moved = Array.from({ length: 20 }, () => shuffle([...source]))
    .some((out) => out.some((v, i) => v !== source[i]));
  assert.ok(moved, 'shuffle must not return the input order every time');
});
