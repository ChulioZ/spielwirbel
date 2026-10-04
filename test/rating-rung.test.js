'use strict';

/* `ratingRung` (#1537): the one rounding from a person's AVERAGE to the face it
   is drawn as. Every screen that shows a person's rating — the Spielepass rater
   strip, the member and profile figures, the Pokale recap, the table builder —
   reads it, so the boundaries are pinned here once rather than per surface. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RATING_MIN, RATING_MAX, ratingRung, ratingFace } = require('../public/js/rating-faces');

test('an average rounds to its nearest rung, halves upward', () => {
  assert.equal(ratingRung(3.75), 4);
  assert.equal(ratingRung(3.49), 3);
  assert.equal(ratingRung(3.5), 4);
  assert.equal(ratingRung(1.5), 2);
});

test('every whole rating is its own rung', () => {
  for (let n = RATING_MIN; n <= RATING_MAX; n++) assert.equal(ratingRung(n), n);
});

test('the rung never leaves the scale, so ratingFace always has a glyph', () => {
  assert.equal(ratingRung(0.2), RATING_MIN);
  assert.equal(ratingRung(9), RATING_MAX);
  for (const avg of [0, 0.4, 2.2, 4.9, 7]) assert.ok(ratingFace(ratingRung(avg)), `no face for ${avg}`);
});
