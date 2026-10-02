'use strict';

/* reflowAt (#1496): the frame's cells move between the phone order and the
 * desktop columns at a breakpoint. What matters is that the arrangement is
 * applied at once, follows a crossing, falls back to the phone order without
 * matchMedia, and that a hub which has left the document stops listening —
 * otherwise every re-render of the Start tab would leave one behind.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { reflowAt, hubReflows } = require('../public/js/hub-reflow');

function fakeMedia(matches) {
  const listeners = new Set();
  const mq = {
    matches,
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
  };
  global.window = { matchMedia: () => mq };
  return { mq, listeners, cross: (m) => [...listeners].forEach((fn) => fn({ matches: m })) };
}

test('without matchMedia the narrow (phone) arrangement stands and nothing listens', () => {
  global.window = {};
  hubReflows.length = 0;
  const seen = [];
  reflowAt('(min-width: 1280px)', { isConnected: true }, (wide) => seen.push(wide));
  assert.deepEqual(seen, [false]);
  assert.equal(hubReflows.length, 0);
});

test('the arrangement is applied at once and again on every crossing', () => {
  hubReflows.length = 0;
  const media = fakeMedia(true);
  const seen = [];
  reflowAt('(min-width: 1280px)', { isConnected: true }, (wide) => seen.push(wide));
  assert.deepEqual(seen, [true], 'not applied when registered');
  media.cross(false);
  media.cross(true);
  assert.deepEqual(seen, [true, false, true]);
});

test('a hub that left the document is dropped when the next one registers', () => {
  hubReflows.length = 0;
  const media = fakeMedia(false);
  const old = { isConnected: true };
  reflowAt('(min-width: 1280px)', old, () => {});
  assert.equal(media.listeners.size, 1);
  old.isConnected = false;                      // the Start tab re-rendered
  const fresh = { isConnected: true };
  reflowAt('(min-width: 1280px)', fresh, () => {});
  assert.equal(media.listeners.size, 1, 'the detached hub kept its listener');
  assert.deepEqual(hubReflows.map((r) => r.root), [fresh]);
});
