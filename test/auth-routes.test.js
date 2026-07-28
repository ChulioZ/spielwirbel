'use strict';

// The routed auth screens (issue #501). The routing itself is client-side and
// lives in public/js/router.js — resolveRoute is not exported and giving it a
// module.exports guard would drag router.js into the coverage report at a low
// percentage (.claude/rules/frontend-helper-modules-and-coverage.md), so the
// automatable half is the SERVING half, asserted over HTTP.
//
// That half is worth pinning for one specific reason: `/login` now has to be
// answered by the SPA shell, while `public/login.html` — the legacy
// shared-password page, and the document that was Google's result for this app
// until #510 — sits one dot away from it. express.static is configured without
// its `extensions` option (lib/app.js), which is the only thing keeping the two
// apart. Adding `extensions: ['html']` there, or dropping a `register.html` into
// public/, would shadow these routes and the SPA would never see them.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('./helpers');

const AUTH_PATHS = ['/login', '/register', '/forgot-password'];

test('the auth routes are served the SPA shell, not a static page (#501)', async () => {
  // Compared against `GET /` rather than sniffed for a marker: one document
  // serves every route (.claude/rules/link-preview-card.md §3), so "the same
  // bytes as the front door" is exactly the claim, and it cannot pass against a
  // different HTML page that happens to contain whichever marker was chosen.
  const root = await request(app).get('/');
  assert.equal(root.status, 200);
  assert.match(root.text, /<main id="app"/, 'the front door still serves the shell');

  for (const path of AUTH_PATHS) {
    const res = await request(app).get(path);
    assert.equal(res.status, 200, `${path} is served`);
    assert.match(res.headers['content-type'], /text\/html/, `${path} is HTML`);
    assert.equal(res.text, root.text,
      `${path} must serve the same shell as / — the client router renders the screen`);
  }
});

test('/login is not shadowed by the legacy login.html (#501)', async () => {
  // The assertion above would pass vacuously if the two documents were alike, so
  // pin that they are not: login.html carries the noindex #510 added to shed its
  // search-result entry, and the shell must never answer with it — that would
  // put the retired shared-password screen back on a public URL, and a noindexed
  // one at that, on the path the register/login links now point at.
  const legacy = await request(app).get('/login.html');
  assert.equal(legacy.status, 200, 'login.html is still served for shared-password instances');
  assert.match(legacy.text, /<meta name="robots" content="noindex/,
    'login.html still carries its noindex — otherwise this test proves nothing');

  const routed = await request(app).get('/login');
  assert.doesNotMatch(routed.text, /<meta name="robots" content="noindex/,
    '/login served the legacy login.html instead of the app shell');
});
