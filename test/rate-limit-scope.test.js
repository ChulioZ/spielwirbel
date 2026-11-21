'use strict';

/*
 * What the rate limiters count (#1836).
 *
 * The strict AUTH_RATE_LIMIT_MAX budget exists to slow down guessing a
 * credential or a secret token. It used to sit on whole routers (/api/admin,
 * /api/account and its five sub-routers), so ordinary signed-in work spent it:
 * an operator confirming 100 games' scoring locked themselves out of their own
 * panel. It now rides the individual credential routes (`credentialLimit`,
 * lib/route-limits.js), and the general RATE_LIMIT_MAX backstop counts a
 * signed-in caller per VERIFIED account rather than per IP.
 *
 * Every spec builds a throwaway app with tiny ceilings, so each gets its own
 * in-memory limiter stores (.claude/rules/security-middleware.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { adminSessionCookie } = require('./helpers');
const { createApp } = require('../lib/app');
const accounts = require('../lib/accounts');

const ENV_KEYS = ['RATE_LIMIT_MAX', 'AUTH_RATE_LIMIT_MAX', 'IMAGE_UPLOAD_RATE_LIMIT_MAX',
  'ACCOUNTS_ENABLED', 'SESSION_SECRET', 'ADMIN_PASSWORD', 'TRUST_PROXY'];

// Build an app under `env`, restoring every touched variable afterwards.
async function withApp(env, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  Object.assign(process.env, {
    RATE_LIMIT_MAX: '1000000',
    AUTH_RATE_LIMIT_MAX: '1000000',
    IMAGE_UPLOAD_RATE_LIMIT_MAX: '1000000',
    ACCOUNTS_ENABLED: 'true',
    SESSION_SECRET: 'rate-limit-scope-secret',
    ADMIN_PASSWORD: 'rate-limit-scope-admin',
  }, env);
  try {
    return await fn(createApp());
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

const send = (app, method, path) => request(app)[method.toLowerCase()](path).send({});

// The credential and secret-token surface: each must still spend the strict
// budget. With a ceiling of ONE, the first request must get through and the
// second be refused — which also proves a single request spends exactly one
// unit, since a limiter run twice per request refuses the very first one.
const STRICT = [
  ['POST', '/api/auth/login'],
  ['POST', '/api/account/login'],
  ['POST', '/api/account/refresh'],
  ['POST', '/api/account/forgot-password'],
  ['POST', '/api/account/reset-password'],
  ['POST', '/api/account/resend-verification'],
  ['GET', '/api/account/verify-email'],
  ['POST', '/api/account/verify-email'],
  ['POST', '/api/account/confirm-email'],
  ['POST', '/api/account/change-password'],
  ['POST', '/api/account/change-email'],
  ['DELETE', '/api/account'],
  ['POST', '/api/account/register'],
  ['POST', '/api/account/demo'],
  ['POST', '/api/account/passkeys/login/options'],
  ['POST', '/api/account/passkeys/login'],
  ['POST', '/api/account/join/preview'],
  ['POST', '/api/account/join'],
  ['POST', '/api/admin/login'],
  ['POST', '/api/admin/login/passkey'],
  ['POST', '/api/admin/enroll/options'],
  ['POST', '/api/admin/enroll'],
];

for (const [method, path] of STRICT) {
  test(`${method} ${path} is limited by AUTH_RATE_LIMIT_MAX, one unit per attempt`, async () => {
    await withApp({ AUTH_RATE_LIMIT_MAX: '1' }, async (app) => {
      const first = await send(app, method, path);
      assert.notEqual(first.status, 429, 'the first attempt must not be refused');
      const second = await send(app, method, path);
      assert.equal(second.status, 429);
      assert.deepEqual(second.body, { error: 'rate_limited' });
    });
  });
}

// Express routing is case-insensitive and ignores a trailing slash, so a
// spelling variant reaches the same handler — and must reach the same budget.
test('a case or trailing-slash variant of a credential path shares its budget', async () => {
  await withApp({ AUTH_RATE_LIMIT_MAX: '1' }, async (app) => {
    assert.notEqual((await send(app, 'POST', '/api/account/login')).status, 429);
    assert.equal((await send(app, 'POST', '/API/Account/Login/')).status, 429);
  });
});

// Signed-in work that presents no credential: none of it may spend the strict
// budget any more.
test('authenticated account routes no longer spend the strict budget', async () => {
  await withApp({ AUTH_RATE_LIMIT_MAX: '1' }, async (app) => {
    const token = accounts.mintAccessToken('scope-user-1');
    const routes = [
      ['GET', '/api/account/me'],
      ['PATCH', '/api/account/me'],
      ['GET', '/api/account/inbox'],
      ['POST', '/api/account/news-seen'],
      ['GET', '/api/account/friends'],
      ['GET', '/api/account/friends/feed'],
      ['GET', '/api/account/profile/someone'],
      ['POST', '/api/account/invitations/x/decline'],
      ['GET', '/api/account/passkeys'],
      ['POST', '/api/account/logout'],
    ];
    for (const [method, path] of routes) {
      for (let i = 0; i < 3; i++) {
        const res = await request(app)[method.toLowerCase()](path)
          .set('Authorization', `Bearer ${token}`).send({});
        assert.notEqual(res.status, 429, `${method} ${path} (request ${i + 1}) spent the strict budget`);
      }
    }
  });
});

test('an operator can work well past AUTH_RATE_LIMIT_MAX in the panel', async () => {
  await withApp({ AUTH_RATE_LIMIT_MAX: '2' }, async (app) => {
    const cookie = await adminSessionCookie();
    for (let i = 0; i < 10; i++) {
      const res = await request(app).get('/api/admin/me').set('Cookie', cookie);
      assert.equal(res.status, 200, `panel request ${i + 1}`);
    }
    // … while the password step stays capped from the same address.
    for (let i = 0; i < 2; i++) {
      assert.equal((await request(app).post('/api/admin/login').send({ password: 'nope' })).status, 401);
    }
    assert.equal((await request(app).post('/api/admin/login').send({ password: 'nope' })).status, 429);
  });
});

/* ---------------------- the general limiter's key ---------------------- */

const meWith = (app, token, ip) => {
  const req = request(app).get('/api/account/me');
  if (token) req.set('Authorization', `Bearer ${token}`);
  if (ip) req.set('X-Forwarded-For', ip);
  return req;
};

test('two accounts behind one IP each get the full RATE_LIMIT_MAX', async () => {
  await withApp({ RATE_LIMIT_MAX: '3' }, async (app) => {
    const a = accounts.mintAccessToken('scope-a');
    const b = accounts.mintAccessToken('scope-b');
    for (let i = 0; i < 3; i++) assert.notEqual((await meWith(app, a)).status, 429);
    assert.equal((await meWith(app, a)).status, 429, 'account A is over its own budget');
    for (let i = 0; i < 3; i++) {
      assert.notEqual((await meWith(app, b)).status, 429, `account B request ${i + 1} shared A's bucket`);
    }
  });
});

test('one account across two IPs shares one bucket', async () => {
  await withApp({ RATE_LIMIT_MAX: '3', TRUST_PROXY: '1' }, async (app) => {
    const a = accounts.mintAccessToken('scope-roaming');
    assert.notEqual((await meWith(app, a, '203.0.113.1')).status, 429);
    assert.notEqual((await meWith(app, a, '203.0.113.1')).status, 429);
    assert.notEqual((await meWith(app, a, '198.51.100.7')).status, 429);
    assert.equal((await meWith(app, a, '198.51.100.7')).status, 429);
  });
});

test('the access cookie keys the account too (cover images send no header)', async () => {
  await withApp({ RATE_LIMIT_MAX: '2' }, async (app) => {
    const a = accounts.mintAccessToken('scope-cookie');
    const viaCookie = () => request(app).get('/api/account/me').set('Cookie', `${accounts.ACCESS_COOKIE}=${a}`);
    assert.notEqual((await viaCookie()).status, 429);
    assert.notEqual((await meWith(app, a)).status, 429);
    assert.equal((await viaCookie()).status, 429, 'cookie and header must land in one bucket');
    // The IP itself was never charged.
    assert.notEqual((await meWith(app, null)).status, 429);
  });
});

test('a forged, expired or foreign-signed token is counted by IP, not by token', async () => {
  await withApp({ RATE_LIMIT_MAX: '4' }, async (app) => {
    const jwt = require('jsonwebtoken');
    const bogus = [
      'not-a-jwt-at-all',
      accounts.mintAccessToken('scope-expired', -60 * 1000),
      jwt.sign({ sub: 'scope-forged', exp: Math.floor(Date.now() / 1000) + 600 }, 'another-secret'),
      jwt.sign({ sub: 'scope-none' }, null, { algorithm: 'none' }),
    ];
    for (const token of bogus) assert.notEqual((await meWith(app, token)).status, 429);
    // Each was a different "key" if the token decided it; by IP they are one.
    assert.equal((await meWith(app, 'yet-another-garbage-token')).status, 429);
  });
});

test('anonymous requests are still counted per IP', async () => {
  await withApp({ RATE_LIMIT_MAX: '2', TRUST_PROXY: '1' }, async (app) => {
    assert.notEqual((await meWith(app, null, '203.0.113.9')).status, 429);
    assert.notEqual((await meWith(app, null, '203.0.113.9')).status, 429);
    assert.equal((await meWith(app, null, '203.0.113.9')).status, 429);
    assert.notEqual((await meWith(app, null, '198.51.100.9')).status, 429, 'another IP has its own bucket');
  });
});

/* ------------------- the endpoint audit's one new cap ------------------- */

// Cover and session-photo uploads DECODE caller-supplied bytes — the avatar
// limiter's argument (#841) — so they get their own per-account ceiling. Only a
// multipart body counts: a JSON edit of a game decodes nothing.
test('image uploads have their own cap; a JSON game edit does not spend it', async () => {
  await withApp({ IMAGE_UPLOAD_RATE_LIMIT_MAX: '1', ACCOUNTS_ENABLED: '' }, async (app) => {
    const round = (await request(app).post('/api/rounds').send({ name: 'Upload cap', members: ['A'] })).body;
    const game = (await request(app).post(`/api/rounds/${round.id}/games`).send({ title: 'Box', minPlayers: 1, maxPlayers: 4 })).body;
    const gamePath = `/api/rounds/${round.id}/games/${game.id}`;

    for (let i = 0; i < 3; i++) {
      const res = await request(app).patch(gamePath).send({ title: `Box ${i}` });
      assert.equal(res.status, 200, `JSON edit ${i + 1}`);
    }
    const png = Buffer.from('not really a png');
    const first = await request(app).patch(gamePath).attach('image', png, 'a.png');
    assert.notEqual(first.status, 429);
    const second = await request(app).patch(gamePath).attach('image', png, 'b.png');
    assert.equal(second.status, 429);
    assert.deepEqual(second.body, { error: 'rate_limited' });
  });
});

// The limiter instances live on app.locals because the routers are singletons.
// A route that cannot find its limiter must FAIL, never wave the request
// through — an unlimited credential endpoint is the silent direction.
test('a credential route whose limiter is missing fails closed', async () => {
  await withApp({}, async (app) => {
    delete app.locals.routeLimiters;
    const res = await send(app, 'POST', '/api/account/login');
    assert.equal(res.status, 500);
  });
});
