'use strict';

/*
 * The feed's accepted event types are ONE file both repo backends require
 * (lib/feed-events.js). They used to be a `new Set([...])` literal in each,
 * with nothing asserting the two agreed (2026-09-06 code-maturity audit,
 * M-002). Same shape as test/demo.test.js's guard for the demo-tenant prefix:
 * assert the literal has not come back, rather than that two copies agree.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { FEED_EVENT_TYPES } = require('../lib/feed-events');

test('the feed event types are the two the client can phrase', () => {
  assert.deepEqual([...FEED_EVENT_TYPES].sort(), ['game_added', 'session_played']);
});

test('neither backend carries its own copy of the set', () => {
  for (const rel of ['lib/repo/json.js', 'lib/repo/postgres.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.doesNotMatch(src, /FEED_EVENT_TYPES\s*=\s*new Set/, `${rel} declares its own FEED_EVENT_TYPES`);
    assert.match(src, /require\('\.\.\/feed-events'\)/, `${rel} does not require lib/feed-events.js`);
  }
});
