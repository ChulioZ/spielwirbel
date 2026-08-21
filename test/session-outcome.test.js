'use strict';

/* What became of a session (#796).

   The helper exists because sixteen sites branched on `session.cancelled` to mean
   "this evening did not happen at one table", and a split parent is neither
   played nor cancelled. Every one of those sites fails silently, so what is
   asserted here is the derivation itself: `split` follows from the child ids and
   from nothing else, and it outranks the two booleans that a hand-crafted or
   legacy blob could set alongside it. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sessionChildIds, sessionOutcome, isSplitParent } = require('../public/js/session-outcome');

test('the four outcomes', () => {
  assert.equal(sessionOutcome({ done: false }), 'open');
  assert.equal(sessionOutcome({ done: true, chosenGameId: 'g1' }), 'open', 'chosen is not yet played');
  assert.equal(sessionOutcome({ finished: true }), 'played');
  assert.equal(sessionOutcome({ cancelled: true }), 'cancelled');
  assert.equal(sessionOutcome({ childSessionIds: ['s1', 's2'] }), 'split');
});

test('split is derived from the child ids, never from a flag of its own', () => {
  // The whole point of the derivation: there is no third boolean that could
  // disagree with the links the same screens render.
  assert.equal(sessionOutcome({ childSessionIds: [] }), 'open', 'an empty list is not a split');
  assert.equal(sessionOutcome({ split: true }), 'open', 'an invented flag means nothing');
  assert.deepEqual(sessionChildIds({}), []);
  assert.deepEqual(sessionChildIds({ childSessionIds: 'oops' }), [], 'a non-array reads as none');
});

test('split outranks cancelled and finished', () => {
  // The routes refuse both combinations, so this can only be reached by a
  // hand-crafted blob — and a screen saying „Abgebrochen" while listing the three
  // tables it spawned is incoherent in a way that "split" never is.
  assert.equal(sessionOutcome({ cancelled: true, childSessionIds: ['s1'] }), 'split');
  assert.equal(sessionOutcome({ finished: true, childSessionIds: ['s1'] }), 'split');
});

test('a missing session reads as open rather than throwing', () => {
  assert.equal(sessionOutcome(null), 'open');
  assert.equal(sessionOutcome(undefined), 'open');
  assert.equal(isSplitParent(null), false);
  assert.equal(isSplitParent({ childSessionIds: ['s1'] }), true);
});
