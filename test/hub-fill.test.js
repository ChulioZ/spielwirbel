'use strict';

/* The fill region's fitting rule (#1683, public/js/hub-fill.js): show the
   whole items that fit inside the region, hide the rest. Pure over rects, so
   the region and its items are stubs reporting the boxes a browser would — jsdom
   has no layout to measure, and a real one is what the browser check is for. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { fitHubFill, HUB_FILL_SLACK } = require('../public/js/hub-fill');

// A stub element with a fixed box. `hidden` starts as whatever the caller says,
// so a spec can prove fitHubFill resets it rather than inheriting it.
const box = (top, height, { hidden = true, width = 100 } = {}) => ({
  hidden,
  getBoundingClientRect: () => ({ top, bottom: top + height, left: 0, right: width, height, width }),
});
const region = (top, height, items, width = 100) => ({
  children: items,
  getBoundingClientRect: () => ({ top, bottom: top + height, left: 0, right: width, height, width }),
});

test('the items that fit whole are shown, the first one past the bottom edge and every later one hidden', () => {
  const items = [box(0, 40), box(40, 40), box(80, 40), box(120, 40)];
  assert.equal(fitHubFill(region(0, 100, items)), 2);
  assert.deepEqual(items.map((i) => i.hidden), [false, false, true, true]);
});

test('once one item overflows, a later one that would fit is still hidden — the visible set is a prefix', () => {
  // A wrapping cover strip can put a short item back inside the box after a tall
  // one stuck out; showing it would leave a hole in the order.
  const items = [box(0, 40), box(40, 80), box(40, 20)];
  assert.equal(fitHubFill(region(0, 100, items)), 1);
  assert.deepEqual(items.map((i) => i.hidden), [false, true, true]);
});

test('an item that was hidden last time is re-measured, so a taller region shows more', () => {
  const items = [box(0, 40), box(40, 40), box(80, 40)];
  fitHubFill(region(0, 50, items));
  assert.deepEqual(items.map((i) => i.hidden), [false, true, true]);
  fitHubFill(region(0, 130, items));
  assert.deepEqual(items.map((i) => i.hidden), [false, false, false]);
});

test('a region with no height hides everything — the column-flow designs, where the CSS keeps it off', () => {
  const items = [box(0, 0, { hidden: false }), box(0, 0, { hidden: false })];
  assert.equal(fitHubFill(region(0, 0, items)), 0);
  assert.deepEqual(items.map((i) => i.hidden), [true, true]);
});

test('sub-pixel rounding at the bottom edge is not a cut-through item', () => {
  const items = [box(0, 50 + HUB_FILL_SLACK)];
  assert.equal(fitHubFill(region(0, 50, items)), 1);
  const over = [box(0, 50 + HUB_FILL_SLACK + 0.1)];
  assert.equal(fitHubFill(region(0, 50, over)), 0);
});

test('only the bottom edge decides: a row bleeding to the card edge sideways still counts as fitting', () => {
  // .hub-row carries a negative inline margin to reach the card's edge.
  const items = [{ hidden: true, getBoundingClientRect: () => ({ top: 0, bottom: 30, left: -16, right: 116, height: 30, width: 132 }) }];
  assert.equal(fitHubFill(region(0, 50, items)), 1);
});
