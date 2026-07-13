'use strict';

/*
 * Authentication gate (issue #129). Requiring ./helpers sets DATA_DIR and builds
 * the shared `openApp` with auth OFF (no AUTH_PASSWORD) — that covers the
 * unconfigured "app stays open" path. For the locked path we set AUTH_PASSWORD
 * and build fresh apps: createApp() and the auth middleware read the env per call
 * (like the rate limiters), so each app picks up the current config and its own
 * limiter store. Cleaned up in afterEach so tests don't leak env into each other.
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app: openApp } = require('./helpers');
const { createApp } = require('../lib/app');
const auth = require('../lib/auth');

// Keep the login brute-force limiter out of the way except in the test that
// drives it with a tiny ceiling.
process.env.AUTH_RATE_LIMIT_MAX = '1000000';

afterEach(() => {
  delete process.env.AUTH_PASSWORD;
  delete process.env.SESSION_SECRET;
  delete process.env.TRUST_PROXY;
  process.env.AUTH_RATE_LIMIT_MAX = '1000000';
});

test('unconfigured: the app stays fully open', async () => {
  delete process.env.AUTH_PASSWORD;
  const api = await request(openApp).get('/api/rounds');
  assert.equal(api.status, 200);

  const shell = await request(openApp).get('/');
  assert.equal(shell.status, 200);
  assert.match(shell.text, /id="app"/); // the real SPA shell, not the login page

  const status = await request(openApp).get('/api/auth/status');
  assert.deepEqual(status.body, { authRequired: false, authenticated: false });
});

test('configured: the API is 401 and the shell shows the login page when unauthenticated', async () => {
  process.env.AUTH_PASSWORD = 'letmein';
  const app = createApp();

  const api = await request(app).get('/api/rounds');
  assert.equal(api.status, 401);
  assert.deepEqual(api.body, { error: 'auth_required' });

  const shell = await request(app).get('/round/anything');
  assert.equal(shell.status, 200);
  assert.match(shell.text, /id="loginForm"/); // the login page, not the SPA

  const status = await request(app).get('/api/auth/status');
  assert.deepEqual(status.body, { authRequired: true, authenticated: false });
});

test('configured: wrong password is rejected, right password unlocks the API, logout re-locks it', async () => {
  process.env.AUTH_PASSWORD = 'letmein';
  const app = createApp();

  const wrong = await request(app).post('/api/auth/login').send({ password: 'nope' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, { error: 'invalid_credentials' });

  // request.agent persists the session cookie across calls, like a browser.
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ password: 'letmein' });
  assert.equal(login.status, 200);
  assert.deepEqual(login.body, { ok: true });

  // The cookie is httpOnly + SameSite=Lax, and NOT Secure over plain HTTP (so
  // it survives local dev; Secure is added only behind a TLS proxy, see below).
  const cookie = login.headers['set-cookie'][0];
  assert.match(cookie, /^sid=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.doesNotMatch(cookie, /Secure/i);

  const authed = await agent.get('/api/rounds');
  assert.equal(authed.status, 200);

  const status = await agent.get('/api/auth/status');
  assert.deepEqual(status.body, { authRequired: true, authenticated: true });

  await agent.post('/api/auth/logout');
  const relocked = await agent.get('/api/rounds');
  assert.equal(relocked.status, 401);
});

test('configured: a garbage or tampered cookie does not authenticate', async () => {
  process.env.AUTH_PASSWORD = 'letmein';
  const app = createApp();

  const garbage = await request(app).get('/api/rounds').set('Cookie', 'sid=not-a-real-token');
  assert.equal(garbage.status, 401);

  // A validly-shaped token signed with the wrong secret must fail too.
  const forged = auth.mintToken('some-other-secret');
  const tampered = await request(app).get('/api/rounds').set('Cookie', `sid=${forged}`);
  assert.equal(tampered.status, 401);
});

test('token helpers: valid tokens verify; wrong-secret, tampered, and expired ones do not', () => {
  const secret = 'top-secret';
  const good = auth.mintToken(secret);
  assert.equal(auth.verifyToken(good, secret), true);
  assert.equal(auth.verifyToken(good, 'different-secret'), false);
  assert.equal(auth.verifyToken(`${good}x`, secret), false);
  assert.equal(auth.verifyToken(auth.mintToken(secret, -1000), secret), false); // already expired
  assert.equal(auth.verifyToken('', secret), false);
});

test('configured: the login endpoint is brute-force rate-limited', async () => {
  process.env.AUTH_PASSWORD = 'letmein';
  process.env.AUTH_RATE_LIMIT_MAX = '3';
  const app = createApp();

  for (let i = 0; i < 3; i++) {
    const res = await request(app).post('/api/auth/login').send({ password: 'nope' });
    assert.equal(res.status, 401);
  }
  const blocked = await request(app).post('/api/auth/login').send({ password: 'nope' });
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.body, { error: 'rate_limited' });
});

test('behind a TLS proxy the session cookie is marked Secure', async () => {
  process.env.AUTH_PASSWORD = 'letmein';
  process.env.TRUST_PROXY = '1';
  const app = createApp();

  const login = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-Proto', 'https')
    .send({ password: 'letmein' });
  assert.equal(login.status, 200);
  assert.match(login.headers['set-cookie'][0], /Secure/i);
});
