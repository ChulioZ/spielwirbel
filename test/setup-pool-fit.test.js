'use strict';

/* The setup screen's pool gives up rows until „Loswirbeln" is on screen
   (#1346, views-session.js fitSetupPool). jsdom has no layout, so each case
   hands the function the geometry a real browser measured — the numbers are
   Klassisch's at 1728×1000 before the fix: the pool at 399 with the 500px cap,
   the button ending 57px under the fold. What is pinned is the DECISION taken
   from that geometry, not the geometry itself; the real-browser measurements
   per design and viewport are in the PR. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const rect = (top, height, width = 600) => ({ top, bottom: top + height, height, width, left: 0, right: width, x: 0, y: top });

function fit(t, { pool, go, tile = 126, viewport = 1000, wide = true, tiles = true }) {
  const dom = loadApp();
  t.after(() => dom.close());
  const { document: doc, window: win } = dom;
  const form = doc.createElement('div');
  form.innerHTML = `<div id="poolGrid" style="padding-top: 4px; row-gap: 12px">${tiles ? '<span class="pool-tile"></span>' : ''}</div><button id="go"></button>`;
  doc.body.appendChild(form);
  const grid = form.querySelector('#poolGrid');
  // The pool is capped by what the inline max-height allows, so the stubbed
  // height follows it the way a real box would.
  grid.getBoundingClientRect = () => {
    const cap = parseFloat(grid.style.maxHeight);
    return rect(pool[0], Number.isFinite(cap) ? Math.min(cap, pool[1]) : pool[1]);
  };
  form.querySelector('#go').getBoundingClientRect = () => rect(go[0], go[1]);
  if (tiles) form.querySelector('.pool-tile').getBoundingClientRect = () => rect(pool[0] + 4, tile, 124);
  Object.defineProperty(doc.documentElement, 'clientHeight', { configurable: true, get: () => viewport });
  win.matchMedia = () => ({ matches: wide });
  dom.call('fitSetupPool', form);
  return grid.style.maxHeight;
}

test('the pool gives up exactly the pixels the button is short by, plus the slack', (t) => {
  // #go ends at 1057 on a 1000px viewport: 57 over, and 16 of slack.
  assert.equal(fit(t, { pool: [399, 500], go: [986, 71] }), `${500 - 57 - 16}px`);
});

test('a button already above the fold leaves the stylesheet cap alone', (t) => {
  assert.equal(fit(t, { pool: [399, 300], go: [786, 71] }), '');
});

test('the pool never drops below one row and a third of the next', (t) => {
  // 4 padding + 126 + 0.3 × (126 + 12) = 171.4 → 172, however short the window.
  assert.equal(fit(t, { pool: [399, 500], go: [986, 71], viewport: 560 }), '172px');
});

test('a pool BESIDE the button is not shrunk — it would move nothing (Ocean desktop)', (t) => {
  assert.equal(fit(t, { pool: [268, 580], go: [318, 88], viewport: 300 }), '');
});

test('below 860px nothing is fitted — the phone pool is never squeezed', (t) => {
  assert.equal(fit(t, { pool: [602, 292], go: [1170, 60], viewport: 812, wide: false }), '');
});

test('an empty pool has no row to measure and is left alone', (t) => {
  assert.equal(fit(t, { pool: [399, 40], go: [1100, 71], tiles: false }), '');
});
