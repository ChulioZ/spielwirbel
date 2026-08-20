'use strict';

/* The retirement proposal IS the zero of the voting scale (#797).

   These pin the three legacy vote shapes the app has on disk, because that is
   where the whole feature lives: storage was not migrated, so every historical
   row still spells "I want this gone" as a `retire` flag next to whatever
   rating it happened to carry, and `effectiveRating` is the single place that
   turns those back into a number. Get the precedence wrong and nothing errors —
   averages just silently move on rounds nobody is looking at. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RATING_MIN, RATING_MAX, wantsRetire, effectiveRating } = require('../public/js/vote-scale');

test('the scale runs 0 to 5', () => {
  assert.equal(RATING_MIN, 0);
  assert.equal(RATING_MAX, 5);
});

test('a plain rating is worth itself', () => {
  for (let n = 1; n <= RATING_MAX; n++) {
    assert.equal(effectiveRating({ rating: n, retire: false }), n);
  }
});

test('a retire-only vote is worth 0, not nothing', () => {
  // Pre-#797 this shape was skipped by every `typeof v.rating === 'number'`
  // read, so a game half the group wanted gone kept the average of the half
  // that rated it.
  assert.equal(effectiveRating({ rating: null, retire: true }), 0);
});

test('retirement wins over a rating in legacy data', () => {
  // The contradiction the new card cannot express and old data can.
  assert.equal(effectiveRating({ rating: 4, retire: true }), 0);
  assert.equal(effectiveRating({ rating: 1, retire: true }), 0);
});

test('a vote with neither counts as nothing', () => {
  assert.equal(effectiveRating({ rating: null, retire: false }), null);
  assert.equal(effectiveRating({}), null);
  assert.equal(effectiveRating(null), null);
  assert.equal(effectiveRating(undefined), null);
});

test('a non-numeric rating counts as nothing', () => {
  for (const rating of ['4', {}, [], true, NaN, Infinity]) {
    assert.equal(effectiveRating({ rating, retire: false }), null,
      `a rating of ${String(rating)} should not reach an average`);
  }
});

test('only an exact `true` is a retirement proposal', () => {
  // A guest column stores `{ rating }` with no flag at all, and the truthiness
  // of a stray value must not promote it to a vote against the game.
  for (const retire of [undefined, false, null, 0, '', 'true', 1]) {
    assert.equal(wantsRetire({ rating: 3, retire }), retire === true,
      `retire: ${JSON.stringify(retire)} was read wrongly`);
  }
  assert.equal(wantsRetire(null), false);
});
