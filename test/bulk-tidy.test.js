'use strict';

/*
 * public/js/bulk-tidy.js — the one question the three bulk-removal screens ask
 * before confirming: does this selection reach into any past session?
 *
 * It decides the WORDING of a destructive confirm, so both directions matter.
 * A false negative drops the "they disappear from session history" sentence off
 * a deletion that really does erase history; a false positive puts it on every
 * shelf tidy, and a warning that cries wolf is one people learn to click
 * through (the reasoning showTransferGames' own confirm split was built on).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectionTouchesHistory } = require('../public/js/bulk-tidy');

const round = (...sessions) => ({ sessions });

test('a selection naming a played game touches history', () => {
  const r = round({ gameIds: ['a', 'b'] }, { gameIds: ['c'] });
  assert.equal(selectionTouchesHistory(r, ['b']), true);
  assert.equal(selectionTouchesHistory(r, ['c']), true);
});

test('a selection of never-played games does not', () => {
  const r = round({ gameIds: ['a', 'b'] });
  assert.equal(selectionTouchesHistory(r, ['x', 'y']), false);
});

test('one played game among unplayed ones is enough', () => {
  const r = round({ gameIds: ['a'] });
  assert.equal(selectionTouchesHistory(r, ['x', 'y', 'a']), true);
});

test('it accepts a Set as well as an array — the Regal holds one', () => {
  const r = round({ gameIds: ['a'] });
  assert.equal(selectionTouchesHistory(r, new Set(['a'])), true);
  assert.equal(selectionTouchesHistory(r, new Set(['z'])), false);
});

test('an empty selection touches nothing', () => {
  assert.equal(selectionTouchesHistory(round({ gameIds: ['a'] }), []), false);
  assert.equal(selectionTouchesHistory(round({ gameIds: ['a'] }), new Set()), false);
});

/* A summary payload carries no `sessions`, and a session mid-creation can carry
   no `gameIds`. Neither may throw: this runs inside a click handler, and an
   exception there would swallow the confirm and the action with it. */
test('a round with no sessions, or a session with no gameIds, is answered not thrown', () => {
  assert.equal(selectionTouchesHistory({}, ['a']), false);
  assert.equal(selectionTouchesHistory(null, ['a']), false);
  assert.equal(selectionTouchesHistory(round({}), ['a']), false);
});
