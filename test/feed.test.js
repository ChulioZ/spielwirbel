'use strict';

/*
 * The Freundeskreis feed's read-side duplicate collapse (issue #856).
 *
 * Both emit sites (POST …/sessions/:sid/finish and POST …/games/:gid/wish) are
 * re-POSTed by the UI as an idempotent save, so before #856 one played evening
 * could store three identical `session_played` rows. The routes now emit on the
 * TRANSITION only — but rows already written in production cannot be un-written,
 * so both feed read sites also collapse a run on the way out.
 *
 * The discriminating fixture is the third case below: a run INTERRUPTED by another
 * event must survive, or the helper is a global de-dupe rather than a collapse —
 * and a naive fixture (one run, nothing else) cannot tell those apart.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { collapseFeedEvents, DUP_WINDOW_MS } = require('../lib/feed');

// Newest-first, like listFeedEvents returns. `min` is minutes before the base.
const BASE = Date.parse('2026-08-30T20:00:00.000Z');
const ev = (min, over = {}) => ({
  uid: 'u1', type: 'session_played', title: 'Catan',
  at: new Date(BASE - min * 60000).toISOString(), ...over,
});
const titles = (list) => list.map((e) => e.title);

// The gaps below (7 h, 8 h) are written as literals on purpose — deriving them
// from DUP_WINDOW_MS would make every one of these specs pass for any window.
// This is the one assertion that pins the value they are chosen against.
test('the window is one game evening', () => {
  assert.equal(DUP_WINDOW_MS, 6 * 60 * 60 * 1000);
});

test('collapses an adjacent run, keeping the newest timestamp', () => {
  const out = collapseFeedEvents([ev(0), ev(1), ev(2)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].at, ev(0).at, 'the surviving entry is the newest of the run');
});

test('an interrupted run is NOT collapsed — adjacency, not global de-dupe', () => {
  const out = collapseFeedEvents([ev(0), ev(1, { title: 'Azul' }), ev(2)]);
  assert.deepEqual(titles(out), ['Catan', 'Azul', 'Catan']);
});

test('two plays outside the window stay two entries', () => {
  // 7 h apart — past the 6 h window, so a genuine second evening survives.
  const out = collapseFeedEvents([ev(0), ev(7 * 60)]);
  assert.equal(out.length, 2);
});

test('the window is measured against the KEPT event, not its neighbour', () => {
  // Four events one hour apart: chaining pairwise would collapse all four
  // (each gap is 1 h), which would swallow a play 3 h older than the survivor
  // once the run got long enough. Bounded against the kept one, it still does
  // here (3 h < 6 h) — the 8-hour tail is the one that must survive.
  const out = collapseFeedEvents([ev(0), ev(60), ev(120), ev(180), ev(8 * 60)]);
  assert.equal(out.length, 2);
  assert.equal(out[0].at, ev(0).at);
  assert.equal(out[1].at, ev(8 * 60).at);
});

test('a different uid, type or title is never collapsed', () => {
  assert.equal(collapseFeedEvents([ev(0), ev(1, { uid: 'u2' })]).length, 2);
  assert.equal(collapseFeedEvents([ev(0), ev(1, { type: 'game_added' })]).length, 2);
  assert.equal(collapseFeedEvents([ev(0), ev(1, { title: 'Azul' })]).length, 2);
});

test('an unparseable timestamp keeps both entries rather than losing one', () => {
  const out = collapseFeedEvents([ev(0, { at: 'not-a-date' }), ev(1)]);
  assert.equal(out.length, 2, 'bad data must never silently drop an event');
});

test('empty and absent input are handled', () => {
  assert.deepEqual(collapseFeedEvents([]), []);
  assert.deepEqual(collapseFeedEvents(undefined), []);
});
