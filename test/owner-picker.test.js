'use strict';

/* The two PURE halves of the owner picker (#971) — what the picker starts out
 * selecting, and how a game's owners are named.
 *
 * The chip renderer in the same module is DOM code and is exercised through the
 * jsdom harness instead (test/game-owners-views.test.js), so it shows up
 * uncovered here; requiring this file costs ~0.1 points of the global figure,
 * measured, which is well clear of the 90% floor
 * (.claude/rules/frontend-helper-modules-and-coverage.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ownerPresetFor, ownerNames } = require('../public/js/owner-picker');

const ANNA = { id: 'm1', name: 'Anna', userId: 'u-anna' };
const BEN = { id: 'm2', name: 'Ben' };
const round = (members) => ({ members });

test('with no stored preset the picker starts on the caller\'s own seat', () => {
  assert.deepEqual(ownerPresetFor(round([ANNA, BEN]), 'u-anna'), ['m1']);
});

test('a stored preset wins over the own seat, and an EMPTY one is honoured', () => {
  const withPreset = round([{ ...ANNA, ownerPreset: ['m2'] }, BEN]);
  assert.deepEqual(ownerPresetFor(withPreset, 'u-anna'), ['m2']);

  // The whole reason the guard is `Array.isArray` and not truthiness: "I took
  // myself off the list" has to survive to the next add.
  const emptied = round([{ ...ANNA, ownerPreset: [] }, BEN]);
  assert.deepEqual(ownerPresetFor(emptied, 'u-anna'), []);
});

test('a preset naming a seat that is gone does not resurrect it', () => {
  const stale = round([{ ...ANNA, ownerPreset: ['m1', 'ghost'] }]);
  assert.deepEqual(ownerPresetFor(stale, 'u-anna'), ['m1']);
});

test('a caller with no seat gets no preselection at all', () => {
  assert.deepEqual(ownerPresetFor(round([ANNA, BEN]), 'u-stranger'), [],
    'a grantee has no seat, so there is nobody to guess at');
  assert.deepEqual(ownerPresetFor(round([ANNA, BEN]), null), [], 'accounts off');
  assert.deepEqual(ownerPresetFor(undefined, 'u-anna'), [], 'no round is not a crash');
});

// Named in the ROUND's member order, so two screens can never list one game's
// owners differently.
test('ownerNames follows member order and drops an id nobody holds', () => {
  assert.deepEqual(ownerNames(round([ANNA, BEN]), ['m2', 'm1']), ['Anna', 'Ben']);
  assert.deepEqual(ownerNames(round([ANNA, BEN]), ['m2', 'ghost']), ['Ben']);
  assert.deepEqual(ownerNames(round([ANNA]), undefined), []);
  assert.deepEqual(ownerNames(null, ['m1']), []);
});
