'use strict';

/*
 * Security hardening (issue #130): helmet security headers + rate limiting.
 *
 * Requiring ./helpers sets DATA_DIR and builds the shared `app` (with the
 * limiters raised out of reach) — good for asserting headers. For the 429
 * behaviour we build fresh apps with tiny env limits, so each gets its own
 * in-memory limiter store and the assertions are deterministic.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('./helpers');
const { createApp } = require('../lib/app');
const { imageCspSources } = require('../lib/providers');

test('helmet sets security headers on every response', async () => {
  const res = await request(app).get('/');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.headers['x-frame-options'], 'X-Frame-Options is set');
  assert.ok(res.headers['strict-transport-security'], 'HSTS is set');
  const csp = res.headers['content-security-policy'];
  assert.ok(csp, 'Content-Security-Policy is set');
  assert.match(csp, /script-src 'self'/);
  // Inline style attributes and data: images must stay allowed (the views need
  // them), and the local plain-HTTP deployment must not be force-upgraded.
  assert.match(csp, /style-src [^;]*'unsafe-inline'/);
  assert.match(csp, /img-src [^;]*data:/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  // Provider cover hosts are render-allowed on img-src, mirroring the host
  // allowlist (isAllowedImageUrl) so provider covers show in the add-game/link
  // previews and lookup thumbnails (#179) — and, since #172, so that SAVED
  // covers render at all, since they are hotlinked rather than re-hosted.
  const imgSrc = csp.match(/img-src ([^;]*)/)[1];
  const sources = imageCspSources();
  assert.ok(sources.length > 0, 'there are provider image hosts to allow');
  for (const src of sources) assert.ok(imgSrc.includes(src), `img-src lists ${src}`);
});

// Structural truth-pin for the footer's "no tracking, no ads, no third-party
// scripts" trust claim (#323): scripts, fonts and network connections must all
// be same-origin only. If someone adds a third-party <script>, web font or
// beacon host to the CSP, this fails — so the public claim can't silently drift
// out of true (see .claude/rules/keep-legal-docs-current.md).
test('script-src, font-src and connect-src are self-only (backs the footer trust claim)', async () => {
  const csp = (await request(app).get('/')).headers['content-security-policy'];
  for (const directive of ['script-src', 'font-src', 'connect-src']) {
    const value = csp.match(new RegExp(`${directive} ([^;]*)`))[1].trim();
    assert.equal(value, "'self'", `${directive} must be exactly 'self', got: ${value}`);
  }
});

test('the global rate limit returns 429 once the ceiling is exceeded', async () => {
  process.env.RATE_LIMIT_MAX = '3';
  const limited = createApp();
  for (let i = 0; i < 3; i++) {
    const ok = await request(limited).get('/api/rounds');
    assert.equal(ok.status, 200);
  }
  const blocked = await request(limited).get('/api/rounds');
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.body, { error: 'rate_limited' });
});

// #464: the shell's ~50 requests per cold load must not share the API's budget.
// The strong form of the assertion is that an asset storm well past the ceiling
// leaves the API budget *completely untouched* — a `skip` that merely raised the
// cost of an asset would still pass a "did the asset 200" check.
test('static shell assets are exempt from the global limiter (#464)', async () => {
  const saved = process.env.RATE_LIMIT_MAX;
  process.env.RATE_LIMIT_MAX = '3';
  try {
    const limited = createApp();
    // Well past the ceiling, across the extensions a real page load pulls.
    for (const asset of ['/js/core.js', '/styles.css', '/sw.js', '/manifest.webmanifest']) {
      for (let i = 0; i < 5; i++) {
        const res = await request(limited).get(asset);
        assert.equal(res.status, 200, `${asset} stayed served (request ${i + 1})`);
      }
    }
    // …and the API still has its full ceiling, i.e. the storm cost nothing.
    for (let i = 0; i < 3; i++) {
      assert.equal((await request(limited).get('/api/rounds')).status, 200);
    }
    const blocked = await request(limited).get('/api/rounds');
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, { error: 'rate_limited' });
  } finally {
    if (saved === undefined) delete process.env.RATE_LIMIT_MAX; else process.env.RATE_LIMIT_MAX = saved;
  }
});

// What the exemption must NOT cover. All three look asset-ish from the outside,
// and an extension-based skip would wrongly exempt every one of them.
test('the asset exemption does not cover /uploads, navigations or made-up asset names (#464)', async () => {
  const saved = process.env.RATE_LIMIT_MAX;
  process.env.RATE_LIMIT_MAX = '2';
  try {
    // /uploads: auth-gated user cover bytes streamed from object storage. Keys
    // are `<id><ext>`, so these are indistinguishable from assets by extension.
    const uploads = createApp();
    for (let i = 0; i < 2; i++) {
      assert.equal((await request(uploads).get('/uploads/nope.png')).status, 404);
    }
    assert.equal((await request(uploads).get('/uploads/nope.png')).status, 429);

    // A deep link is answered by the SPA fallback — one request per page load,
    // and the thing actually worth capping.
    const nav = createApp();
    for (let i = 0; i < 2; i++) {
      assert.equal((await request(nav).get('/round/abc/regal')).status, 200);
    }
    assert.equal((await request(nav).get('/round/abc/regal')).status, 429);

    // A path that merely LOOKS like an asset matches no file and falls through
    // to the fallback, which answers it with the whole ~10 KB shell at 200. If
    // the skip were extension-based, an unlimited number of made-up names would
    // be free — swapping this issue's self-lockout for an amplification vector.
    const madeUp = createApp();
    for (let i = 0; i < 2; i++) {
      const res = await request(madeUp).get(`/made-up-${i}.js`);
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /text\/html/);
    }
    assert.equal((await request(madeUp).get('/made-up-2.js')).status, 429);
  } finally {
    if (saved === undefined) delete process.env.RATE_LIMIT_MAX; else process.env.RATE_LIMIT_MAX = saved;
  }
});

// #399: the credential-free boot probe GET /api/account/me must not sit behind
// the auth brute-force limiter — every hard page load spends one request on it,
// so shared-IP browsing could trip the ceiling, and a 429 there sent the client
// into a reload loop. Exactly /me is exempt: the credential endpoints and
// /inbox (a GET on the same router) stay limited, and the global limiter still
// covers /me itself.
test('the auth limiter skips GET /api/account/me but still guards the rest', async () => {
  const saved = {};
  for (const k of ['RATE_LIMIT_MAX', 'AUTH_RATE_LIMIT_MAX', 'ACCOUNTS_ENABLED', 'SESSION_SECRET']) {
    saved[k] = process.env[k];
  }
  process.env.RATE_LIMIT_MAX = '1000000';
  process.env.AUTH_RATE_LIMIT_MAX = '2';
  process.env.ACCOUNTS_ENABLED = 'true';
  process.env.SESSION_SECRET = 'security-test-secret';
  try {
    const limited = createApp();
    // Exhaust the tiny auth ceiling with credential requests.
    for (let i = 0; i < 2; i++) {
      const res = await request(limited)
        .post('/api/account/login').send({ email: 'a@b.c', password: 'wrong-password' });
      assert.equal(res.status, 401);
    }
    const blockedLogin = await request(limited)
      .post('/api/account/login').send({ email: 'a@b.c', password: 'wrong-password' });
    assert.equal(blockedLogin.status, 429);
    assert.deepEqual(blockedLogin.body, { error: 'rate_limited' });
    // A GET on the same router that is NOT the boot probe is still limited …
    const blockedInbox = await request(limited).get('/api/account/inbox');
    assert.equal(blockedInbox.status, 429);
    // … but the boot probe answers normally (401: accounts on, no token).
    const me = await request(limited).get('/api/account/me');
    assert.equal(me.status, 401);
    assert.deepEqual(me.body, { error: 'invalid_token' });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

// #448: registration mails a verification link to any address a caller names,
// and re-registering the same address sends nothing — so a per-account cooldown
// (the #435/#447 defence) has nothing to throttle against here. This tighter
// per-IP cap is the first of the two bounds; the second is MAIL_DAILY_MAX in
// lib/mail.js, which protects the mailbox quota an IP-rotating attacker can
// still reach.
test('registration has its own tighter per-IP cap on top of the auth limiter (#448)', async () => {
  const saved = {};
  for (const k of ['RATE_LIMIT_MAX', 'AUTH_RATE_LIMIT_MAX', 'REGISTER_RATE_LIMIT_MAX',
    'ACCOUNTS_ENABLED', 'SESSION_SECRET']) saved[k] = process.env[k];
  process.env.RATE_LIMIT_MAX = '1000000';
  // Deliberately far above the register cap, so a 429 below can only come from
  // the new limiter — otherwise this passes even if it was never mounted.
  process.env.AUTH_RATE_LIMIT_MAX = '1000000';
  process.env.REGISTER_RATE_LIMIT_MAX = '2';
  process.env.ACCOUNTS_ENABLED = 'true';
  process.env.SESSION_SECRET = 'security-test-secret';
  try {
    const limited = createApp();
    const post = (n) => request(limited).post('/api/account/register')
      .send({ email: `reg${n}@example.com`, username: `reg_user_${n}`, password: 'correct horse battery' });

    assert.equal((await post(1)).status, 200);
    assert.equal((await post(2)).status, 200);
    const blocked = await post(3);
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, { error: 'rate_limited' });

    // Scoped to /register: the rest of the account surface is untouched by it
    // (login still answers on its own, much higher, auth ceiling).
    const login = await request(limited).post('/api/account/login')
      .send({ email: 'reg1@example.com', password: 'wrong-password' });
    assert.equal(login.status, 401);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
