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

const { sessionChildIds, sessionOutcome, isSplitParent, sessionHasVotes } = require('../public/js/session-outcome');

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

/* Did anybody vote at all (#915).

   Not an outcome, but the same kind of derived question and the same failure
   shape: a direct-play session stores `votes: {}`, and every vote-derived piece
   of the results screen rendered its EMPTY state — 0px bars, a bare „–", a
   medal, „1 Spiel bewertet" — instead of being absent. Derived from the votes
   themselves rather than stored, so no flag can disagree with the votes the
   same screens tally. */

test('a session has votes only when somebody actually voted on something', () => {
  assert.equal(sessionHasVotes({ votes: { m1: { g1: { rating: 4 } } } }), true);
  // The zero of the scale is a vote like any other (#797) — a retirement
  // proposal is somebody having answered, so the ranking treatment belongs.
  assert.equal(sessionHasVotes({ votes: { m1: { g1: { retire: true } } } }), true);
  assert.equal(sessionHasVotes({ votes: { m1: {}, m2: { g1: { rating: 0 } } } }), true,
    'one person answering is enough, even beside somebody who did not');
});

test('every shape of "nobody voted" reads as no votes', () => {
  assert.equal(sessionHasVotes({}), false, 'the direct-play branch writes no key at all');
  assert.equal(sessionHasVotes({ votes: {} }), false, 'nor does an empty map');
  assert.equal(sessionHasVotes({ votes: { m1: {} } }), false,
    'a person entry with no game in it is somebody who was asked and never answered');
  assert.equal(sessionHasVotes({ votes: { m1: null } }), false, 'a null entry cannot throw');
  assert.equal(sessionHasVotes({ votes: 'oops' }), false, 'nor can a non-object');
  assert.equal(sessionHasVotes(null), false);
  assert.equal(sessionHasVotes(undefined), false);
});
