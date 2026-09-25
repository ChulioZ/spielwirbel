'use strict';

/*
 * GET /api/config (issues #224/#134, donateUrl since #173): the public,
 * non-sensitive feature flags the static frontend reads to decide whether to
 * render the shared site footer and the support button. Four properties
 * matter:
 *
 *  1. `footer` is all-or-nothing — true only when mail can deliver
 *     (SMTP_HOST + SMTP_USER + SMTP_PASS + MAIL_FROM) AND the Impressum identity is set
 *     (IMPRESSUM_ADDRESS + IMPRESSUM_EMAIL, the same condition that makes the
 *     legal pages exist — lib/legal.js) — so a half-configured instance shows
 *     no public footer rather than a broken one.
 *  2. `donateUrl` is the operator's donation page (#173) — null when
 *     DONATE_URL is unset, which hides the support button entirely.
 *  3. The endpoint must stay reachable without ANY auth in both gate modes:
 *     the footer renders on the login page, before a session or token exists,
 *     and the support button must work for a logged-out visitor too.
 *  4. `expansionsPerGame` is the per-game expansion ceiling (#1143) — the one
 *     quota the UI states BEFORE the write rather than only in the 403's toast,
 *     so the expansions dialog can render „N von 40 im Regal". `null` when
 *     quotas are inert (lib/quota.js enforces only in accounts mode), because a
 *     self-hosted instance has no ceiling to count against and a number there
 *     would be a limit that does not exist.
 *
 * Env is read per request (like the rate-limit ceilings), so these tests flip
 * process.env around requests against the shared app. The deepEqual assertions
 * pin the WHOLE response shape: nothing else may creep into this public,
 * ungated response — the secret sweep at the bottom is the guard for values.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const { createApp } = require('../lib/app');
const { selectableDesignIds, FACE_DESIGN, DESIGN_REGISTRY } = require('../public/js/designs');

const MAIL_ENV = { SMTP_HOST: 'smtp.example.test', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'no-reply@example.com' };
// The guest demo (#427) is off in this file: the shared app's env has no
// DEMO_ENABLED, so every response carries `demo: false`. Spelled into each
// expectation rather than loosened to a subset match — the whole point of the
// deepEqual assertions here is that a newly added key cannot slip into this
// public, ungated response unnoticed.
// `expansionsPerGame: null` throughout: this file's shared app runs with
// accounts off, so quotas are inert (lib/quota.js `enforced()`).
// `designs`/`faceDesign` (#1184) are in every expectation below because the
// deepEqual assertions pin the WHOLE shape. Outside production the server
// reports every REGISTERED design, enabled or not, so an unfinished one can be
// opened for review — which is why `tisch` is here while it is `enabled: false`.
// The production half is its own test at the bottom.
const OFF = {
  footer: false,
  donateUrl: null,
  demo: false,
  expansionsPerGame: null,
  // Saved session filters (#1328): ALWAYS numbers, accounts on or off — that
  // cap bounds the hub's chip row, not abuse (lib/quota.js).
  savedFilters: { perRound: 6, nameMax: 40 },
  designs: selectableDesignIds({ production: false }),
  faceDesign: FACE_DESIGN,
};

test.afterEach(() => {
  for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'IMPRESSUM_ADDRESS', 'IMPRESSUM_EMAIL',
    'AUTH_PASSWORD', 'ACCOUNTS_ENABLED', 'SESSION_SECRET', 'ADMIN_PASSWORD',
    'BGG_API_TOKEN', 'DONATE_URL', 'MAX_EXPANSIONS_PER_GAME', 'NODE_ENV']) {
    delete process.env[k];
  }
});

test('everything is off when nothing is configured', async () => {
  const res = await request(app).get('/api/config');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, OFF);
});

test('mail alone does not enable the footer', async () => {
  Object.assign(process.env, MAIL_ENV);
  const res = await request(app).get('/api/config');
  assert.deepEqual(res.body, OFF);
});

test('the Impressum identity alone does not enable the footer', async () => {
  process.env.IMPRESSUM_ADDRESS = 'Musterweg 1, 12345 Musterstadt';
  process.env.IMPRESSUM_EMAIL = 'kontakt@example.test';
  const res = await request(app).get('/api/config');
  assert.deepEqual(res.body, OFF);
});

test('mail + address without the e-mail stays off (the legal pages would 404)', async () => {
  Object.assign(process.env, MAIL_ENV);
  process.env.IMPRESSUM_ADDRESS = 'Musterweg 1, 12345 Musterstadt';
  const res = await request(app).get('/api/config');
  assert.deepEqual(res.body, OFF);
});

test('a whitespace-only address does not count as set', async () => {
  Object.assign(process.env, MAIL_ENV);
  process.env.IMPRESSUM_ADDRESS = '   ';
  process.env.IMPRESSUM_EMAIL = 'kontakt@example.test';
  const res = await request(app).get('/api/config');
  assert.deepEqual(res.body, OFF);
});

test('mail + full identity enable the footer; env is read per request', async () => {
  Object.assign(process.env, MAIL_ENV);
  process.env.IMPRESSUM_ADDRESS = 'Musterweg 1, 12345 Musterstadt';
  process.env.IMPRESSUM_EMAIL = 'kontakt@example.test';
  const on = await request(app).get('/api/config');
  assert.deepEqual(on.body, { ...OFF, footer: true });
  // Same app instance, no rebuild: unsetting one input flips it back off.
  delete process.env.IMPRESSUM_ADDRESS;
  const off = await request(app).get('/api/config');
  assert.deepEqual(off.body, OFF);
});

test('DONATE_URL is echoed as donateUrl, independent of the footer (#173)', async () => {
  process.env.DONATE_URL = 'https://ko-fi.com/spielwirbel';
  const on = await request(app).get('/api/config');
  assert.deepEqual(on.body, { ...OFF, donateUrl: 'https://ko-fi.com/spielwirbel' });
  // Read per request: unsetting it hides the button again without a rebuild.
  delete process.env.DONATE_URL;
  const off = await request(app).get('/api/config');
  assert.deepEqual(off.body, OFF);
});

test('a whitespace-only DONATE_URL does not count as set', async () => {
  process.env.DONATE_URL = '   ';
  const res = await request(app).get('/api/config');
  assert.deepEqual(res.body, OFF);
});

test('reachable without a session under the shared-password gate', async () => {
  process.env.AUTH_PASSWORD = 'gate-pw';
  process.env.DONATE_URL = 'https://ko-fi.com/spielwirbel';
  const gatedApp = createApp();
  // Sanity: the data routes ARE gated on this app.
  const gated = await request(gatedApp).get('/api/rounds');
  assert.equal(gated.status, 401);
  const res = await request(gatedApp).get('/api/config');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ...OFF, donateUrl: 'https://ko-fi.com/spielwirbel' });
});

test('reachable without a token in accounts mode', async () => {
  process.env.ACCOUNTS_ENABLED = 'true';
  process.env.SESSION_SECRET = 'x'.repeat(32);
  process.env.DONATE_URL = 'https://ko-fi.com/spielwirbel';
  const accountsApp = createApp();
  const gated = await request(accountsApp).get('/api/rounds');
  assert.equal(gated.status, 401);
  const res = await request(accountsApp).get('/api/config');
  assert.equal(res.status, 200);
  // 40 rather than null here, unlike every other case in this file: accounts
  // mode is precisely where quotas are enforced (lib/quota.js).
  assert.deepEqual(res.body, { ...OFF, donateUrl: 'https://ko-fi.com/spielwirbel', expansionsPerGame: 40 });
});

/* The one quota the client is told up front (#1143). Its own test rather than
   another line in the shape pins above, because the two things that can go
   wrong here are both invisible to a deepEqual against a constant: reporting a
   ceiling on an instance that enforces none, and reporting the DEFAULT on an
   instance that tuned it. */
test('expansionsPerGame reports the live ceiling in accounts mode, and null without it', async () => {
  process.env.ACCOUNTS_ENABLED = 'true';
  process.env.SESSION_SECRET = 'x'.repeat(32);
  const accountsApp = createApp();

  const dflt = await request(accountsApp).get('/api/config');
  assert.equal(dflt.body.expansionsPerGame, 40, 'the documented default');

  // Read per request, like every other ceiling — a live re-tune needs no rebuild.
  process.env.MAX_EXPANSIONS_PER_GAME = '12';
  const tuned = await request(accountsApp).get('/api/config');
  assert.equal(tuned.body.expansionsPerGame, 12,
    'a tuned instance must not be told the default — the dialog would count against a ceiling nobody enforces');

  // Quotas are inert with accounts off (lib/quota.js `enforced()`), so there is
  // no ceiling to state. `null`, never the number: a self-hosted round may hold
  // more than 40 and the bar must not call that over a limit. `enforced()` reads
  // the env per call, so clearing the flag is enough — no rebuild, and it has to
  // be cleared explicitly because afterEach has not run yet.
  delete process.env.ACCOUNTS_ENABLED;
  const selfHosted = await request(app).get('/api/config');
  assert.equal(selfHosted.body.expansionsPerGame, null,
    'a tuned MAX_EXPANSIONS_PER_GAME must still report null where nothing enforces it');
});

// The guard that survives future edits (same idea as test/status.test.js):
// plant a recognisable value in every secret-bearing env var and assert none
// of them reaches this public, ungated response in any form. The deepEqual
// shape pins above make this nearly redundant today — this is the tripwire
// for a future field added without one.
test('no secret value ever appears in the response', async () => {
  const secrets = {
    AUTH_PASSWORD: 'SECRETVALUE-auth',
    SESSION_SECRET: 'SECRETVALUE-session',
    ADMIN_PASSWORD: 'SECRETVALUE-admin',
    SMTP_PASS: 'SECRETVALUE-smtppass',
    BGG_API_TOKEN: 'SECRETVALUE-bgg',
  };
  Object.assign(process.env, secrets);
  const res = await request(app).get('/api/config');
  const serialized = JSON.stringify(res.body);
  for (const [name, value] of Object.entries(secrets)) {
    assert.equal(serialized.includes(value), false, `${name} leaked into /api/config`);
    assert.equal(serialized.includes(value.slice(0, 8)), false, `${name} leaked a prefix`);
  }
});

/* The user-design gate (#1184). It lives in code, not in an env var, and it is
   the SERVER that applies it — so this endpoint is the whole enforcement point
   for "an unfinished design does not exist in production". Its own test rather
   than another deepEqual line, for the reason expansionsPerGame has one: what
   can go wrong is invisible to an assertion against a constant, namely
   reporting the full registry on a production instance.

   Note the assertions are derived from `enabled` rather than from a literal.
   Since the flip (#1202) every registered design is live, so the unfinished
   one is made for the test: Klassisch is switched off for its duration (never
   the face, which must stay offered), on the very module object the server
   reads — the state the next design will be in while it is built. */
test('production reports only the enabled designs; outside it, the whole registry', async (t) => {
  const klassisch = DESIGN_REGISTRY.find((d) => d.id === 'klassisch');
  if (DESIGN_REGISTRY.every((d) => d.enabled)) {
    klassisch.enabled = false;
    t.after(() => { klassisch.enabled = true; });
  }
  const enabled = DESIGN_REGISTRY.filter((d) => d.enabled).map((d) => d.id);
  const unfinished = DESIGN_REGISTRY.filter((d) => !d.enabled).map((d) => d.id);
  assert.ok(unfinished.length >= 1,
    'no unfinished design ships — the production half of this test is vacuous');

  process.env.NODE_ENV = 'production';
  const prod = await request(app).get('/api/config');
  assert.deepEqual(prod.body.designs, enabled, 'production must not advertise an unfinished design');
  for (const id of unfinished) {
    assert.equal(prod.body.designs.includes(id), false, `${id} is not enabled and must not be offered`);
  }

  delete process.env.NODE_ENV;
  const dev = await request(app).get('/api/config');
  assert.deepEqual(dev.body.designs, DESIGN_REGISTRY.map((d) => d.id),
    'outside production every registered design is selectable, so an unfinished one can be reviewed');

  // The face is a design that actually exists, in both directions — a face the
  // server does not offer would leave every logged-out surface unpainted.
  assert.ok(prod.body.designs.includes(prod.body.faceDesign), 'the face must be an enabled design in production');
});
