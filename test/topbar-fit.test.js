'use strict';

/*
 * The top bar's fit arithmetic (#1460): how many buttons stay beside the home
 * link, the rest folding into „…". The DOM half is test/topbar-overflow.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { topbarKeep, topbarRowWidth, TOPBAR_FIT_SLACK } = require('../public/js/topbar-fit');

// Six 38px buttons, the bar's real shape at phone widths (10px gap).
const SIX = [38, 38, 38, 38, 38, 38];

test('a row is its widths plus one gap between each pair', () => {
  assert.equal(topbarRowWidth([], 10), 0);
  assert.equal(topbarRowWidth([40], 10), 40);
  assert.equal(topbarRowWidth([40, 38, 38], 10), 136);
});

test('everything stays, and no „…" is reserved, when the whole row fits', () => {
  // 40 + 6×38 + 6 gaps of 10 = 328: exactly the room.
  assert.equal(topbarKeep({ available: 328, gap: 10, fixed: [40], widths: SIX, more: 38 }), 6);
});

test('one pixel short folds the LAST candidate, and reserves room for „…"', () => {
  // 327 cannot hold all six. Five plus „…" is the same count of items, so it
  // fits only if „…" is no wider than what folded — here it is not narrower,
  // so it still fits at 328 but not at 327: the sixth AND fifth fold.
  assert.equal(topbarKeep({ available: 327, gap: 10, fixed: [40], widths: SIX, more: 38 }), 4);
  // A narrower „…" lets five stay.
  assert.equal(topbarKeep({ available: 327, gap: 10, fixed: [40], widths: SIX, more: 30 }), 5);
});

test('the sub-pixel slack keeps a bar that visibly fits from folding', () => {
  const just = 328 - TOPBAR_FIT_SLACK;
  assert.equal(topbarKeep({ available: just, gap: 10, fixed: [40], widths: SIX, more: 38 }), 6);
  assert.equal(topbarKeep({ available: just - 0.01, gap: 10, fixed: [40], widths: SIX, more: 38 }), 4);
});

test('the Programmheft phone bar at 390: the wordmark costs three buttons', () => {
  // 390 - 2×14 padding = 362; home with its wordmark on one line ≈ 162.
  // 162 + 3×38 + 38 („…") + 4 gaps = 354 ≤ 362; four would need 402.
  assert.equal(topbarKeep({ available: 362, gap: 10, fixed: [162], widths: SIX, more: 38 }), 3);
});

test('at 320 it keeps at least the highest-priority button beside „…"', () => {
  // 320 - 28 = 292: 162 + 38 + 38 + 2 gaps = 258 fits, a second button does not.
  assert.equal(topbarKeep({ available: 292, gap: 10, fixed: [162], widths: SIX, more: 38 }), 1);
});

test('when nothing fits beside „…", every candidate folds — never a negative count', () => {
  assert.equal(topbarKeep({ available: 100, gap: 10, fixed: [162], widths: SIX, more: 38 }), 0);
});

test('fixed items take their own gaps, and an empty list keeps nothing', () => {
  // home 40 + round name 60 + one gap = 110; + 38 + gap = 158.
  assert.equal(topbarKeep({ available: 158, gap: 10, fixed: [40, 60], widths: [38], more: 38 }), 1);
  assert.equal(topbarKeep({ available: 157, gap: 10, fixed: [40, 60], widths: [38], more: 38 }), 0);
  assert.equal(topbarKeep({ available: 10, gap: 10, fixed: [40], widths: [], more: 38 }), 0);
});

test('a wide candidate (the „Anmelden" text button) is measured, not assumed', () => {
  // Logged out: language, design, support, feedback, then the 96px login link
  // at the top of the priority list. All five: 30 + 96 + 4×38 + 5 gaps = 328.
  const widths = [96, 38, 38, 38, 38];
  assert.equal(topbarKeep({ available: 328, gap: 10, fixed: [30], widths, more: 38 }), 5);
  // One short: four plus „…" is the same 328, so three stay. Counting the login
  // link as 38 would have kept all five and overflowed.
  assert.equal(topbarKeep({ available: 327, gap: 10, fixed: [30], widths, more: 38 }), 3);
  assert.equal(topbarKeep({ available: 327, gap: 10, fixed: [30], widths: [38, 38, 38, 38, 38], more: 38 }), 5);
});
