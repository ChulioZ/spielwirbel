'use strict';

/*
 * The demo resume marker's rotation rule (#502).
 *
 * This is the fragile half of browser-local resume: POST /refresh SPENDS the
 * presented refresh token, so a marker that is not rewritten on every rotation
 * goes stale after the first silent refresh — and the next resume then presents
 * a spent token, fails, and silently mints a SECOND demo, i.e. exactly the
 * slot-stranding this issue exists to stop. Nothing about that failure is
 * visible: the demo works fine, the visitor just gets a fresh empty one.
 *
 * The predicate is pure, so it lives in its own tiny file and is tested directly
 * rather than through the DOM (.claude/rules/frontend-helper-modules-and-coverage.md).
 */

const test = require('node:test');
const assert = require('node:assert');

const { SA_DEMO, demoMarkerFollowsRotation } = require('../public/js/demo-marker');

test('a live demo carries its marker through every rotation', () => {
  // Inside a running demo the marker and the stored refresh token are the same
  // string, which is what identifies the rotation as the demo's own.
  assert.equal(demoMarkerFollowsRotation('r1.abc.secret', 'r1.abc.secret'), true);
});

test('a real account\'s rotation must NOT clobber an abandoned demo\'s marker', () => {
  // The register CTA drops the demo's tokens but deliberately KEEPS the marker,
  // so the demo stays resumable. If the visitor then signs up for real, every
  // refresh of that real session would overwrite the marker with the real
  // account's token — and "Demo fortsetzen" would silently resume the real
  // account instead. This is why the rule is token identity, not "am I a demo".
  assert.equal(demoMarkerFollowsRotation('r1.demo.secret', 'r1.real.secret'), false);
});

test('the mint has no previous token to match, so it writes the marker explicitly', () => {
  // No marker yet: the very first setTokens of a demo cannot be recognised here.
  assert.equal(demoMarkerFollowsRotation(null, 'r1.abc.secret'), false);
});

test('a resume finds no stored refresh token, so it writes the marker explicitly', () => {
  // The visitor left, so SA_REFRESH was cleared while the marker survived.
  assert.equal(demoMarkerFollowsRotation('r1.demo.secret', null), false);
});

test('two absent values are not a match — `null === null` must not read as one', () => {
  // The trap the two !! guards exist for: without them a logged-out browser
  // would treat any incoming token as the demo's and mint a marker for a real
  // account's session.
  assert.equal(demoMarkerFollowsRotation(null, null), false);
  assert.equal(demoMarkerFollowsRotation('', ''), false);
  assert.equal(demoMarkerFollowsRotation(undefined, undefined), false);
});

test('the marker key is distinct from the two token keys', () => {
  // It must be a THIRD key: clearTokens() removes the other two and the marker
  // has to survive that, which is the whole mechanism.
  assert.equal(SA_DEMO, 'sa_demo');
  assert.notEqual(SA_DEMO, 'sa_access');
  assert.notEqual(SA_DEMO, 'sa_refresh');
});
