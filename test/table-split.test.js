'use strict';

/* The multi-table objective and the search over it (#796).

   The objective is the part with no error path: every split it produces is
   feasible, so a scoring bug is a plausible-looking arrangement that is simply
   worse than one the group could see for themselves. So each TIER is asserted in
   isolation, on a fixture built so only that tier can decide — plus the
   lexicographic property itself, that a later tier never overrules an earlier
   one.

   `scoreSplit` takes the search's internal `ctx`, so the tier cases build a
   minimal one by hand rather than going through `proposeTableSplits`. That is
   deliberate: driving the tiers through the search would mean asserting the
   scoring through the heuristic that consumes it, and a restart that happened to
   miss the better split would read as a scoring bug. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MIN_TABLE_PARTIES,
  VIOLATION_MAX,
  NEUTRAL_RATING,
  seatRating,
  tableFeedback,
  admittedTableSizes,
  fitsSomeTable,
  feasibleTableCounts,
  scoreSplit,
  compareSplits,
  proposeTableSplits,
} = require('../public/js/table-split');
const { effectiveRating } = require('../public/js/vote-scale');
const { tileValue } = require('../public/js/vote-score');
const { fitsPlayerCount } = require('../public/js/draw-pool');

// A ctx over hand-written per-(party, game) cells, matching what the search
// builds. `caps` is the largest table each game admits — tier 4's input.
function ctxOf(cells, caps) {
  const ctx = {
    cell: (pid, gid) => cells[pid][gid],
    capOf: (gid) => caps[gid],
    aggregate: (tb) => {
      let violations = 0;
      let sum = 0;
      let lowest = Infinity;
      tb.partyIds.forEach((pid) => {
        const c = ctx.cell(pid, tb.gameId);
        violations += c.violations;
        sum += c.sum;
        if (c.lowest < lowest) lowest = c.lowest;
      });
      return { violations, sum, lowest: lowest === Infinity ? NEUTRAL_RATING : lowest };
    },
  };
  return ctx;
}

const cell = (sum, lowest, violations) => ({ sum, lowest, violations });

/* ---- One vote's worth ---- */

test('an absent vote counts as the neutral midpoint, which is not a violation', () => {
  assert.equal(seatRating({}, 'p1', 'g1', effectiveRating), NEUTRAL_RATING);
  assert.ok(NEUTRAL_RATING > VIOLATION_MAX, 'the neutral value must never be a tier-1 violation');
});

test('a retirement proposal is a violation whatever rating sits beside it', () => {
  // Both stored shapes: post-#797 (retire only) and the legacy contradiction a
  // round that voted before it can still hold.
  const votes = {
    p1: { g1: { rating: null, retire: true } },
    p2: { g1: { rating: 5, retire: true } },
    p3: { g1: { rating: 5 } },
  };
  assert.equal(seatRating(votes, 'p1', 'g1', effectiveRating), 0);
  assert.equal(seatRating(votes, 'p2', 'g1', effectiveRating), 0, 'retirement wins over the rating');
  assert.equal(seatRating(votes, 'p3', 'g1', effectiveRating), 5);

  const fb = tableFeedback({ gameId: 'g1', personIds: ['p1', 'p2', 'p3'] }, votes, effectiveRating, tileValue);
  assert.deepEqual(fb.violations, ['p1', 'p2']);
  assert.equal(fb.lowest, 0);
});

test('the per-table numbers are over the SEATED only', () => {
  const votes = { a: { g: { rating: 5 } }, b: { g: { rating: 1 } }, c: { g: { rating: 1 } } };
  const fb = tableFeedback({ gameId: 'g', personIds: ['a', 'b'] }, votes, effectiveRating, tileValue);
  // Scored through the Spielwirbel-Score curve since #893, so this is 0 rather
  // than the raw mean's 3: `a`'s 5 and `b`'s „gar nicht" cancel exactly, which
  // is the same value judgement the results screen now applies. `lowest` stays
  // the RAW rating, which is why it is still 1 and not tileValue(1).
  assert.equal(fb.avg, 0);
  assert.equal(fb.lowest, 1);
  assert.deepEqual(fb.violations, ['b'], 'c never sat down, so c is not this table\'s problem');
});

/* ---- The tiers, one at a time ---- */

// Two tables, three parties each, so every candidate below has the same shape and
// only the tier under test can separate them.
const TABLES_A = [{ gameId: 'g1', partyIds: ['a', 'b', 'c'] }, { gameId: 'g2', partyIds: ['d', 'e', 'f'] }];
const TABLES_B = [{ gameId: 'g1', partyIds: ['d', 'e', 'f'] }, { gameId: 'g2', partyIds: ['a', 'b', 'c'] }];

test('tier 1: fewer people at a game they do not want to play wins', () => {
  // B seats one violation, A none. Every other tier deliberately favours B: it
  // has the HIGHER sum and the HIGHER lowest, so a non-lexicographic score would
  // pick it.
  const cells = {
    a: { g1: cell(12, 4, 0), g2: cell(3, 1, 1) },
    b: { g1: cell(12, 4, 0), g2: cell(99, 9, 0) },
    c: { g1: cell(12, 4, 0), g2: cell(99, 9, 0) },
    d: { g1: cell(12, 4, 0), g2: cell(12, 4, 0) },
    e: { g1: cell(12, 4, 0), g2: cell(12, 4, 0) },
    f: { g1: cell(12, 4, 0), g2: cell(12, 4, 0) },
  };
  const ctx = ctxOf(cells, { g1: 3, g2: 3 });
  const a = scoreSplit(TABLES_A, ctx);
  const b = scoreSplit(TABLES_B, ctx);
  assert.equal(a[0], 0);
  assert.equal(b[0], 1);
  // Read the sum through the aggregate rather than off a tuple index, so this
  // anti-vacuous check keeps saying what it means if the tuple is ever reordered.
  const sumOf = (tables) => tables.reduce((n, tb) => n + ctx.aggregate(tb).sum, 0);
  assert.ok(sumOf(TABLES_B) > sumOf(TABLES_A), 'B really does have the higher rating sum');
  assert.ok(compareSplits(a, b) < 0, 'tier 1 must outrank tiers 2 and 3');
});

test('tier 2: with violations tied, the higher rating sum wins', () => {
  // `a` is worth 15 at g2 instead of 9 — but is also the lowest rating there, so
  // tier 3 prefers the OTHER arrangement. That opposition is what makes this
  // case discriminating: it fails if the sum ever stops outranking the lowest.
  const cells = {
    a: { g1: cell(9, 3, 0), g2: cell(15, 2, 0) },
    b: { g1: cell(9, 3, 0), g2: cell(9, 3, 0) },
    c: { g1: cell(9, 3, 0), g2: cell(9, 3, 0) },
    d: { g1: cell(9, 3, 0), g2: cell(9, 3, 0) },
    e: { g1: cell(9, 3, 0), g2: cell(9, 3, 0) },
    f: { g1: cell(9, 3, 0), g2: cell(9, 3, 0) },
  };
  const ctx = ctxOf(cells, { g1: 3, g2: 3 });
  const a = scoreSplit(TABLES_A, ctx);
  const b = scoreSplit(TABLES_B, ctx);
  assert.equal(a[0], b[0], 'the violations really are tied');
  assert.ok(compareSplits(b, a) < 0, 'the higher sum wins even though it strands the lower rating');
});

test('tier 3: with violations and the sum tied, the higher LOWEST wins', () => {
  // Same totals both ways round; only how the ratings are distributed differs.
  const cells = {
    a: { g1: cell(9, 3, 0), g2: cell(9, 5, 0) },
    b: { g1: cell(9, 5, 0), g2: cell(9, 3, 0) },
    c: { g1: cell(9, 5, 0), g2: cell(9, 5, 0) },
    d: { g1: cell(9, 5, 0), g2: cell(9, 5, 0) },
    e: { g1: cell(9, 5, 0), g2: cell(9, 5, 0) },
    f: { g1: cell(9, 5, 0), g2: cell(9, 5, 0) },
  };
  const ctx = ctxOf(cells, { g1: 3, g2: 3 });
  const a = scoreSplit(TABLES_A, ctx); // a at g1 -> lowest 3
  const b = scoreSplit(TABLES_B, ctx); // a at g2 -> lowest 3 as well? no: b at g2 -> 3
  assert.equal(a[0], b[0]);
  assert.equal(a[1], b[1], 'the sums really are tied');
  // Both arrangements strand exactly one 3, so tier 3 ties too — which is the
  // control. The discriminating pair puts both 3s on one side.
  assert.equal(compareSplits(a, b), 0);

  const better = [{ gameId: 'g2', partyIds: ['a', 'c', 'd'] }, { gameId: 'g1', partyIds: ['b', 'e', 'f'] }];
  const worse = [{ gameId: 'g1', partyIds: ['a', 'c', 'd'] }, { gameId: 'g2', partyIds: ['b', 'e', 'f'] }];
  const s1 = scoreSplit(better, ctx);
  const s2 = scoreSplit(worse, ctx);
  assert.equal(s1[1], s2[1], 'still the same sum');
  assert.equal(-s1[2], 5);
  assert.equal(-s2[2], 3);
  assert.ok(compareSplits(s1, s2) < 0);
});

test('tier 4: with everything tied, the fuller tables win', () => {
  // Identical cells everywhere, so tiers 1-3 are flat by construction. g2 seats
  // up to six, so putting three parties there leaves three empty seats.
  const flat = cell(9, 3, 0);
  const cells = Object.fromEntries('abcdef'.split('').map((p) => [p, { g1: flat, g2: flat, g3: flat }]));
  const ctx = ctxOf(cells, { g1: 3, g2: 6, g3: 3 });
  const tight = [{ gameId: 'g1', partyIds: ['a', 'b', 'c'] }, { gameId: 'g3', partyIds: ['d', 'e', 'f'] }];
  const loose = [{ gameId: 'g1', partyIds: ['a', 'b', 'c'] }, { gameId: 'g2', partyIds: ['d', 'e', 'f'] }];
  assert.equal(scoreSplit(tight, ctx)[3], 0);
  assert.equal(scoreSplit(loose, ctx)[3], 3);
  assert.ok(compareSplits(scoreSplit(tight, ctx), scoreSplit(loose, ctx)) < 0);
});

test('a person who rates everything alike is correctly indifferent', () => {
  // Whatever their constant is, they contribute the same at every tier — so the
  // score cannot be moved by seating them anywhere in particular.
  const same = cell(3, 1, 1); // even a constant that is ALL violations
  const cells = Object.fromEntries('abcdef'.split('').map((p) => [p, { g1: same, g2: same }]));
  const ctx = ctxOf(cells, { g1: 3, g2: 3 });
  assert.equal(compareSplits(scoreSplit(TABLES_A, ctx), scoreSplit(TABLES_B, ctx)), 0);
});

/* ---- Which table counts are even possible ---- */

const game = (id, min, max) => ({ id, minPlayers: min, maxPlayers: max });

test('the feasible table count is derived from the headcount and the pool', () => {
  const games = [game('a', 2, 4), game('b', 2, 4), game('c', 2, 4)];
  // 9 parties, no game seating more than 4: two tables cannot hold them.
  assert.deepEqual(feasibleTableCounts(games, 9, fitsPlayerCount), [3]);
  // 6 parties: two tables of three, or nothing bigger (floor(6/3) === 2).
  assert.deepEqual(feasibleTableCounts(games, 6, fitsPlayerCount), [2]);
});

test('there is no fixed ceiling — a group big enough for a dozen tables gets one', () => {
  const games = Array.from({ length: 14 }, (_, i) => game('g' + i, 2, 5));
  const counts = feasibleTableCounts(games, 60, fitsPlayerCount);
  assert.equal(counts[0], 12, '60 parties over 5-seat games needs at least 12 tables');
  assert.equal(counts[counts.length - 1], 14, 'and at most one table per distinct game');
});

test('a pool that cannot seat the group at all yields no table count', () => {
  assert.deepEqual(feasibleTableCounts([game('a', 2, 4)], 20, fitsPlayerCount), []);
  // Two people cannot form a table of three, so nothing is feasible either.
  assert.deepEqual(feasibleTableCounts([game('a', 1, 8)], 2, fitsPlayerCount), []);
});

test('admitted sizes are a UNION, so an expansion can leave a hole', () => {
  const g = { id: 'g', minPlayers: 3, maxPlayers: 4, expansions: [{ minPlayers: 6, maxPlayers: 8 }] };
  assert.deepEqual(admittedTableSizes(g, 9, fitsPlayerCount), [3, 4, 6, 7, 8]);
});

/* ---- The relaxed pool predicate ---- */

test('fitsSomeTable admits a box that seats SOME table, not the whole party', () => {
  assert.equal(fitsPlayerCount(game('a', 2, 4), 12), false);
  assert.equal(fitsSomeTable(game('a', 2, 4), 12, fitsPlayerCount), true);
});

test('fitsSomeTable is bounded ABOVE by the group as well as below by three', () => {
  // A 2-player game admits no table of three at all.
  assert.equal(fitsSomeTable(game('duo', 2, 2), 12, fitsPlayerCount), false);
  // A 10-12 player game admits no table a group of six could form.
  assert.equal(fitsSomeTable(game('big', 10, 12), 6, fitsPlayerCount), false);
  assert.equal(fitsSomeTable(game('big', 10, 12), 12, fitsPlayerCount), true);
});

test('fitsSomeTable inherits the absent-range and expansion rules wholesale', () => {
  assert.equal(fitsSomeTable({ id: 'x' }, 12, fitsPlayerCount), true, 'no numbers means any table size');
  const withExp = { id: 'e', minPlayers: 1, maxPlayers: 2, expansions: [{ minPlayers: 5, maxPlayers: 6 }] };
  assert.equal(fitsSomeTable(withExp, 12, fitsPlayerCount), true);
  const halfDeclared = { id: 'h', minPlayers: 1, maxPlayers: 2, expansions: [{ minPlayers: 5 }] };
  assert.equal(fitsSomeTable(halfDeclared, 12, fitsPlayerCount), false, 'a lone bound states no interval');
});

/* ---- The search ---- */

const PARTIES = Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, personIds: ['p' + i] }));
const GAMES = [game('g1', 2, 4), game('g2', 3, 6), game('g3', 2, 5), game('g4', 1, 8)];
const VOTES = Object.fromEntries(
  PARTIES.map((p, i) => [p.id, Object.fromEntries(GAMES.map((g, j) => [g.id, { rating: 1 + ((i + j * 3) % 5) }]))])
);
const propose = (over = {}) =>
  proposeTableSplits({ parties: PARTIES, games: GAMES, votes: VOTES, seed: 'sess-1', effectiveRating, tileValue, fitsPlayerCount, ...over });

test('the search is seeded, so two runs produce byte-identical proposals', () => {
  assert.deepEqual(propose(), propose());
});

test('a different session id produces its own answer', () => {
  // Not a requirement of the feature — it is the anti-vacuous half of the test
  // above, which a `proposeTableSplits` that ignored the seed would also pass.
  assert.notDeepEqual(propose(), propose({ seed: 'sess-2' }));
});

test('every proposal seats every person exactly once, in range, at a distinct game', () => {
  const proposals = propose();
  assert.ok(proposals.length >= 2, 'this fixture has several feasible table counts');
  proposals.forEach((proposal) => {
    const seated = proposal.tables.flatMap((tb) => tb.personIds);
    assert.equal(seated.length, PARTIES.length);
    assert.equal(new Set(seated).size, PARTIES.length);
    assert.equal(new Set(proposal.tables.map((tb) => tb.gameId)).size, proposal.tables.length);
    proposal.tables.forEach((tb) => {
      assert.ok(tb.personIds.length >= MIN_TABLE_PARTIES);
      assert.ok(fitsPlayerCount(GAMES.find((g) => g.id === tb.gameId), tb.personIds.length));
    });
  });
});

test('the proposals are one per table count, smallest first, and none is a single table', () => {
  const sizes = propose().map((p) => p.tables.length);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b));
  assert.equal(new Set(sizes).size, sizes.length);
  assert.ok(sizes.every((n) => n >= 2));
});

test('a team is seated as ONE party, never split across two tables', () => {
  const parties = [
    { id: 't1', personIds: ['a', 'b', 'c'] },
    ...Array.from({ length: 8 }, (_, i) => ({ id: 'q' + i, personIds: ['q' + i] })),
  ];
  const votes = {};
  parties.forEach((p) => p.personIds.forEach((pid) => {
    votes[pid] = Object.fromEntries(GAMES.map((g) => [g.id, { rating: 3 }]));
  }));
  const proposals = proposeTableSplits({ parties, games: GAMES, votes, seed: 's', effectiveRating, tileValue, fitsPlayerCount });
  assert.ok(proposals.length);
  proposals.forEach((proposal) => {
    const table = proposal.tables.find((tb) => tb.personIds.includes('a'));
    assert.ok(table.personIds.includes('b') && table.personIds.includes('c'));
  });
});

test('the search avoids seating people at a game they voted 0-2 for', () => {
  // Six people who like exactly one of two games each; a split that puts either
  // half at the wrong game costs three violations, and the right one costs none.
  const parties = Array.from({ length: 6 }, (_, i) => ({ id: 'p' + i, personIds: ['p' + i] }));
  const games = [game('x', 2, 3), game('y', 2, 3)];
  const votes = {};
  parties.forEach((p, i) => {
    votes[p.id] = i < 3 ? { x: { rating: 5 }, y: { rating: 1 } } : { x: { rating: 1 }, y: { rating: 5 } };
  });
  const [proposal] = proposeTableSplits({ parties, games, votes, seed: 's', effectiveRating, tileValue, fitsPlayerCount });
  proposal.tables.forEach((tb) => {
    const fb = tableFeedback(tb, votes, effectiveRating, tileValue);
    assert.deepEqual(fb.violations, [], 'a violation-free split exists, so one must be found');
  });
});

test('too few usable games for the tables the group needs yields no proposal at all', () => {
  // 12 parties, one 4-seat game: three tables would be needed and only one box
  // exists. The builder surfaces this rather than showing an infeasible split.
  assert.deepEqual(
    proposeTableSplits({ parties: PARTIES, games: [game('only', 2, 4)], votes: VOTES, seed: 's', effectiveRating, tileValue, fitsPlayerCount }),
    []
  );
});
