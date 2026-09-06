'use strict';

// PWA plumbing (issue #142): the web manifest, the service worker, and the
// registration script must be served as real static files (not swallowed by the
// SPA fallback), the manifest must be valid, and every asset the service worker
// precaches must actually resolve — otherwise `cache.addAll(SHELL)` rejects and
// the SW never installs. See public/manifest.webmanifest and public/sw.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { app } = require('./helpers');

test('serves the web manifest as JSON, not the HTML shell', async () => {
  const res = await request(app).get('/manifest.webmanifest');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /json/);
  assert.doesNotMatch(res.text, /id="app"/); // not the SPA shell
});

test('the manifest declares the fields browsers need to install', async () => {
  const res = await request(app).get('/manifest.webmanifest');
  const m = JSON.parse(res.text);
  assert.equal(m.start_url, '/');
  assert.equal(m.display, 'standalone');
  assert.ok(m.name, 'name is required');
  assert.ok(m.theme_color, 'theme_color is required');
  assert.ok(m.background_color, 'background_color is required');
  // At least a 192 and a 512 icon (the install-criteria sizes).
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'), 'needs a 192 icon');
  assert.ok(sizes.includes('512x512'), 'needs a 512 icon');
});

// A captured link (scope is "/", so an installed WebAPK captures every app URL,
// incl. the mailed verify/reset links) must navigate the RUNNING window. The
// default `auto` opens a second app window on Chromium, leaving the window the
// user was already looking at logged out. The exact mode is the point, not just
// the member's presence: `focus-existing` would raise the old window without
// following the link, which is a different — and for an auth link, wrong —
// behaviour. See issue #617.
test('the manifest routes captured links into the running window', async () => {
  const res = await request(app).get('/manifest.webmanifest');
  const m = JSON.parse(res.text);
  assert.equal(m.launch_handler?.client_mode, 'navigate-existing');
});

test('serves the service worker as JavaScript, not the HTML shell', async () => {
  const res = await request(app).get('/sw.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.match(res.text, /addEventListener\('fetch'/); // the real SW source
});

test('the service worker never caches live data routes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  // Guard against a regression that would cache API responses or gated covers.
  assert.match(src, /'\/api\/'/);
  assert.match(src, /'\/uploads\/'/);
});

test('serves the SW registration script', async () => {
  const res = await request(app).get('/js/pwa.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.match(res.text, /serviceWorker\.register\('\/sw\.js'\)/);
});

test('index.html wires up the manifest, theme-color, icons and registration', async () => {
  const res = await request(app).get('/');
  assert.match(res.text, /<link rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(res.text, /<meta name="theme-color"/);
  assert.match(res.text, /rel="apple-touch-icon"/);
  assert.match(res.text, /src="\/js\/pwa\.js"/);
});

test('every asset the service worker precaches is actually served', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  const block = src.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, 'could not find the SHELL precache list in sw.js');
  const shell = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(shell.length > 5, 'SHELL should list the app shell assets');
  for (const url of shell) {
    const res = await request(app).get(url);
    assert.equal(res.status, 200, `precached asset ${url} must be served (got ${res.status})`);
  }
});

/* The REVERSE direction, and the one the assertion above cannot see (#537).
 * It walks SHELL -> served, so a shell script that is loaded by index.html but
 * was never ADDED to SHELL passes it silently: nothing 404s, `cache.addAll`
 * resolves, and the service worker installs perfectly. The cost lands only on
 * an offline load, where that one script is not in the cache — for a lang table
 * that means the app comes up in English for a reader who picked another
 * language, with no error anywhere.
 *
 * Found by deleting the freshly-added '/js/lang/nl.js' SHELL line on purpose:
 * the whole PWA suite stayed green. Derived from the markup rather than listed
 * here, so a script added to index.html is covered without anyone remembering
 * this file — which is exactly the step that gets forgotten. */
test('every script index.html loads is precached by the service worker', async () => {
  const root = path.join(__dirname, '..', 'public');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const src = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const block = src.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, 'could not find the SHELL precache list in sw.js');
  const shell = new Set([...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

  const scripts = [...html.matchAll(/<script[^>]+src="(\/js\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length > 50, `expected the SPA's script tags, found ${scripts.length}`);

  const missing = scripts.filter((s) => !shell.has(s));
  assert.deepEqual(missing, [], `loaded by index.html but missing from sw.js's SHELL: ${missing.join(', ')}`);
});

test('the PWA icons are served as PNGs', async () => {
  for (const url of ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']) {
    const res = await request(app).get(url);
    assert.equal(res.status, 200, `${url} should be served`);
    assert.match(res.headers['content-type'], /image\/png/);
  }
});
