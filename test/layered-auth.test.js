'use strict';

/*
 * Layered auth mode (issue #266): AUTH_PASSWORD (the shared-password gate, #129)
 * AND accounts (#135/#138) configured at the SAME time, so the instance stays
 * sealed behind the shared password while everyone inside uses real accounts.
 * Go-live (#219) then shrinks to REMOVING AUTH_PASSWORD.
 *
 * The three PRE-EXISTING modes must be byte-for-byte unchanged — this file pins
 * the two most fragile of those (password-only's /api/account still 404s, not
 * 401; accounts-only still serves the SPA to a logged-out visitor) alongside the
 * new layered path, building a fresh createApp() per env combination like
 * test/auth.test.js and test/security.test.js do. Requiring ./helpers sets
 * DATA_DIR, raises the limiter ceilings, and silences the request logger; the
 * middleware reads the auth env per request, so each app sees the env its test set.
 * No network: BREVO_API_KEY stays unset, so mail lands in the in-memory outbox.
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

require('./helpers'); // side effects: DATA_DIR + store, raised limiters, silent logger
const { createApp } = require('../lib/app');
const { outbox } = require('../lib/mail');

const PASSWORD = 'correct horse battery';

function buildApp(env) {
  Object.assign(process.env, env);
  return createApp();
}

afterEach(() => {
  delete process.env.AUTH_PASSWORD;
  delete process.env.ACCOUNTS_ENABLED;
  delete process.env.SESSION_SECRET;
});

test('LAYERED mode: the shared gate fronts everything, then real accounts work inside it', async () => {
  const app = buildApp({ AUTH_PASSWORD: 'family', ACCOUNTS_ENABLED: 'true', SESSION_SECRET: 'layered-secret' });

  // 1. An unauthenticated visitor gets the standalone login page, never the SPA
  //    shell — the hole layering closes (before #266, ACCOUNTS_ENABLED served the
  //    shell to everyone, bypassing login.html).
  const locked = await request(app).get('/round/x').set('Accept', 'text/html');
  assert.equal(locked.status, 200);
  assert.match(locked.text, /id="loginForm"/);
  assert.doesNotMatch(locked.text, /id="app"/);

  // 2. /api is 401 without the shared session.
  const apiAnon = await request(app).get('/api/rounds');
  assert.equal(apiAnon.status, 401);
  assert.deepEqual(apiAnon.body, { error: 'auth_required' });

  // 3. The account routes are unreachable without the shared session — a 401, NOT
  //    the 404 accounts_disabled you'd get with accounts off, and NOT open sign-up.
  //    Without this, "accounts on" would mean public registration on a sealed box.
  const regAnon = await request(app).post('/api/account/register')
    .send({ email: 'stranger@example.com', username: 'stranger', password: PASSWORD });
  assert.equal(regAnon.status, 401);
  assert.equal(regAnon.body.error, 'auth_required');

  // 4. Pass the shared password -> get the sid session cookie (a browser would).
  const agent = request.agent(app);
  const shared = await agent.post('/api/auth/login').send({ password: 'family' });
  assert.equal(shared.status, 200);

  // 5. With the shared session, the SPA shell is served...
  const shell = await agent.get('/round/x').set('Accept', 'text/html');
  assert.match(shell.text, /id="app"/);
  // ...and /api/account/me answers 401 (accounts on, not logged in) so the SPA
  //    renders the account login UI — NOT 404 (which the SPA reads as accounts off).
  const me = await agent.get('/api/account/me');
  assert.equal(me.status, 401);

  // 6. Register -> verify -> login a real account, all behind the shared gate.
  const reg = await agent.post('/api/account/register')
    .send({ email: 'owner@example.com', username: 'owner', password: PASSWORD });
  assert.equal(reg.status, 200);
  const mailText = outbox[outbox.length - 1].text;
  const m = mailText.match(/\/verify-email\?uid=([0-9a-f]+)&token=([A-Za-z0-9_-]+)/);
  assert.ok(m, 'the verify-email mail links to the in-app landing');
  await agent.post('/api/account/verify-email').send({ uid: m[1], token: m[2] });
  const login = await agent.post('/api/account/login').send({ email: 'owner@example.com', password: PASSWORD });
  assert.equal(login.status, 200);
  const token = login.body.accessToken;

  // 7. /api needs BOTH credentials. The Bearer token alone (no shared cookie) is
  //    401; the shared cookie alone (agent carries sid + the sa access cookie, but
  //    sends no Bearer — and /api ignores the cookie) is 401; both together pass.
  const bearerOnly = await request(app).get('/api/rounds').set('Authorization', `Bearer ${token}`);
  assert.equal(bearerOnly.status, 401);
  const sharedOnly = await agent.get('/api/rounds');
  assert.equal(sharedOnly.status, 401);
  const both = await agent.get('/api/rounds').set('Authorization', `Bearer ${token}`);
  assert.equal(both.status, 200);
  assert.deepEqual(both.body, []);

  // 8. /uploads needs the shared session AND an account credential — but there the
  //    credential MAY ride the lax sa cookie (an <img> GET can't send a header).
  //    The agent has sid + sa, so a missing file 404s (gate passed); a bare request
  //    (no shared session) 401s.
  const upViaCookie = await agent.get('/uploads/none.png');
  assert.equal(upViaCookie.status, 404);
  const upNoShared = await request(app).get('/uploads/none.png');
  assert.equal(upNoShared.status, 401);
});

test('PASSWORD-ONLY mode is unchanged: /api/account still 404s (accounts off), not 401', async () => {
  const app = buildApp({ AUTH_PASSWORD: 'family' }); // accounts off
  // The account router is NOT fronted by the shared gate when accounts are off, so
  // it keeps answering its own 404 accounts_disabled — layering must not turn this
  // into a 401, which would change today's production behaviour.
  const reg = await request(app).post('/api/account/register')
    .send({ email: 'p@example.com', username: 'ponly', password: PASSWORD });
  assert.equal(reg.status, 404);
  assert.equal(reg.body.error, 'accounts_disabled');
  // An unauthenticated visitor still gets login.html, and /api is the shared 401.
  const locked = await request(app).get('/x').set('Accept', 'text/html');
  assert.match(locked.text, /id="loginForm"/);
  const api = await request(app).get('/api/rounds');
  assert.equal(api.status, 401);
});

test('ACCOUNTS-ONLY mode is unchanged: no shared gate, account routes open, SPA always served', async () => {
  const app = buildApp({ ACCOUNTS_ENABLED: 'true', SESSION_SECRET: 'accounts-secret' }); // no AUTH_PASSWORD
  // The account router is reachable without any shared session (there is none).
  const reg = await request(app).post('/api/account/register')
    .send({ email: 'a-only@example.com', username: 'aonly', password: PASSWORD });
  assert.equal(reg.status, 200);
  // The SPA shell is served to a logged-out visitor (the client renders the auth
  // UI) — never the standalone shared-password login page.
  const shell = await request(app).get('/round/x').set('Accept', 'text/html');
  assert.match(shell.text, /id="app"/);
  assert.doesNotMatch(shell.text, /id="loginForm"/);
  // /api needs a Bearer token only — no shared session exists to require.
  const anon = await request(app).get('/api/rounds');
  assert.equal(anon.status, 401);
  assert.equal(anon.body.error, 'auth_required');
});

test('OPEN mode is unchanged: neither gate configured -> the app is fully open', async () => {
  const app = buildApp({}); // neither AUTH_PASSWORD nor accounts
  const api = await request(app).get('/api/rounds');
  assert.equal(api.status, 200);
  const shell = await request(app).get('/').set('Accept', 'text/html');
  assert.match(shell.text, /id="app"/);
  assert.doesNotMatch(shell.text, /id="loginForm"/);
});
