'use strict';

// #1830 — the multi-table objective with ballot weights. Weights are integer
// percent, so every sum stays an exact integer (scoreSplit's determinism), and
// a violation stays a count of PEOPLE.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { tableFeedback, proposeTableSplits } = require('../public/js/table-split');
const { tileValue } = require('../public/js/vote-score');
const { fitsPlayerCount } = require('../public/js/draw-pool');

const votes = {
  a: { g1: { rating: 5 }, g2: { rating: 1 } },
  b: { g1: { rating: 2 }, g2: { rating: 4 } },
  c: { g1: { rating: 2 }, g2: { rating: 4 } },
};
const table = { gameId: 'g1', personIds: ['a', 'b', 'c'] };

test('tableFeedback without weights is the unweighted sum, unchanged', () => {
  const fb = tableFeedback(table, votes, tileValue);
  assert.deepEqual({ sum: fb.sum, avg: fb.avg, lowest: fb.lowest, violations: fb.violations }, {
    sum: 5, avg: 5 / 3, lowest: 2, violations: ['b', 'c'],
  });
});

test('weighted: Σ w·tileValue(r), an integer; avg over Σ w; violations stay people', () => {
  const w = new Map([['a', 150], ['b', 100], ['c', 100]]);
  const fb = tableFeedback(table, votes, tileValue, w);
  assert.equal(fb.sum, 150 * 5 + 100 * 0 + 100 * 0);
  assert.ok(Number.isInteger(fb.sum));
  assert.equal(fb.avg, 750 / 350);
  assert.deepEqual(fb.violations, ['b', 'c'], 'two unhappy people, not 2.5');
  // A seat missing from the map weighs the base 100.
  assert.equal(tableFeedback(table, votes, tileValue, new Map([['a', 150]])).sum, 750);
});

test('proposals: weights:null is byte-identical to no weights at all', () => {
  const games = [
    { id: 'g1', title: 'A', minPlayers: 2, maxPlayers: 4 },
    { id: 'g2', title: 'B', minPlayers: 2, maxPlayers: 4 },
  ];
  const parties = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, personIds: [id] }));
  const v = { ...votes, d: votes.a, e: votes.b, f: votes.c };
  const base = { parties, games, votes: v, seed: 's', tileValue, fitsPlayerCount };
  assert.equal(JSON.stringify(proposeTableSplits({ ...base, weights: null })), JSON.stringify(proposeTableSplits(base)));
  // And a weighting that matters still yields proposals with integer sums.
  const heavy = new Map([['a', 250], ['d', 250]]);
  const props = proposeTableSplits({ ...base, weights: heavy });
  assert.ok(props.length > 0);
});
