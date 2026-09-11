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

/* ---------------------------- Owners (#971) -------------------------------- */

// A round where the games live in several cupboards. `ownerIds` names members of
// THIS round; an absent key means nobody has recorded who owns the box, which
// must stay drawable at every table (the same absent-value rule
// `fitsOwnRange` applies to a missing player range).
const owned = {
  games: [
    { id: 'nobodys', tagIds: [] },
    { id: 'annas', tagIds: [], ownerIds: ['anna'] },
    { id: 'bens', tagIds: [], ownerIds: ['ben'] },
    { id: 'shared', tagIds: [], ownerIds: ['anna', 'ben'] },
    { id: 'emptied', tagIds: [], ownerIds: [] },
  ],
};

test('a game whose every owner is away is out of the pool (#971)', () => {
  const picked = ids(drawPool(owned, { playerCount: 2, memberIds: ['anna'] }));
  assert.ok(picked.includes('annas'), "the owner is at the table, so her game is in");
  assert.ok(!picked.includes('bens'), "Ben is not at the table, so his game is out");
  assert.ok(picked.includes('shared'), 'one owner present is enough');
});

test('a game with no recorded owner is always drawable (#971)', () => {
  const picked = ids(drawPool(owned, { playerCount: 2, memberIds: ['anna'] }));
  assert.ok(picked.includes('nobodys'), 'an absent ownerIds key must never filter');
  assert.ok(picked.includes('emptied'), 'an EMPTY ownerIds list means the same as absent');
});

// The clause has to be inert for every caller that predates it, or a draw from an
// older client would silently lose the whole shelf.
test('an absent memberIds leaves the pool untouched (#971)', () => {
  assert.deepEqual(ids(drawPool(owned, { playerCount: 2 })).sort(),
    ['annas', 'bens', 'emptied', 'nobodys', 'shared']);
});

test('ownedByParty is the SHARED predicate, not a server copy (#971)', () => {
  assert.equal(typeof shared.ownedByParty, 'function');
  assert.equal(shared.ownedByParty({ ownerIds: ['anna'] }, ['ben']), false);
  assert.equal(shared.ownedByParty({ ownerIds: ['anna'] }, ['ben', 'anna']), true);
  assert.equal(shared.ownedByParty({}, []), true, 'ownerless is drawable at an empty table too');
});

test('the owner clause applies in multi-table mode too (#971)', () => {
  const big = { games: [{ id: 'bens', tagIds: [], ownerIds: ['ben'], minPlayers: 3, maxPlayers: 8 }] };
  assert.deepEqual(ids(drawPool(big, { playerCount: 6, multiTable: true, memberIds: ['anna'] })), []);
  assert.deepEqual(ids(drawPool(big, { playerCount: 6, multiTable: true, memberIds: ['ben'] })), ['bens']);
});

/* ------------------ Present without your shelf (#1002) --------------------- */

test('shelfParty subtracts the people who came without their games (#1002)', () => {
  assert.deepEqual(shared.shelfParty(['anna', 'ben'], ['anna']), ['ben']);
  assert.deepEqual(shared.shelfParty(['anna', 'ben'], []), ['anna', 'ben']);
  assert.deepEqual(shared.shelfParty(['anna', 'ben'], ['clara']), ['anna', 'ben'],
    'an id that is not a seat subtracts nothing');
  assert.deepEqual(shared.shelfParty(['anna', 'ben'], ['anna', 'ben']), [],
    'everyone away is a real answer: no box in the cupboard is here');
});

// Both arguments reach it straight off a request body or a live Set, so neither
// may be assumed to be an array. A throw here would 500 a draw.
test('shelfParty survives a non-array on either side (#1002)', () => {
  assert.deepEqual(shared.shelfParty(undefined, ['anna']), []);
  assert.deepEqual(shared.shelfParty(['anna'], undefined), ['anna']);
  assert.deepEqual(shared.shelfParty(null, null), []);
});

// The clause is what the whole feature rides on, and it is the one place it
// could have failed SILENTLY: `drawPool` gates the owner filter on `!memberIds`,
// and an empty array is truthy, so an all-away party must still filter rather
// than reading as "this caller predates ownership" and passing everything.
test('an empty shelf party still applies the owner clause (#1002)', () => {
  assert.deepEqual(ids(drawPool(owned, { playerCount: 2, memberIds: [] })).sort(),
    ['emptied', 'nobodys'], 'only the games nobody is recorded as owning');
});

test('a game co-owned by somebody who DID bring theirs survives the subtraction (#1002)', () => {
  const party = shared.shelfParty(['anna', 'ben'], ['anna']);
  const picked = ids(drawPool(owned, { playerCount: 2, memberIds: party }));
  assert.ok(picked.includes('shared'), 'Ben is here with his copy, so the box is in the room');
  assert.ok(!picked.includes('annas'), 'her own shelf is not');
  assert.ok(picked.includes('bens'));
});
