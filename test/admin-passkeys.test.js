'use strict';

/*
 * The operator panel's passkey second factor (#1670), end to end over HTTP.
 *
 * NOT stubbed, unlike test/passkeys.test.js: a software authenticator
 * (test/support/soft-authenticator.js) produces real attestations and real
 * ES256 assertions, so @simplewebauthn/server's actual verification runs. That
 * is what lets this file prove the two policies the library enforces for us —
 * user verification required, a regressing signature counter refused — instead
 * of asserting what the route passed into a fake.
 *
 * SESSION_SECRET is set and ADMIN_SESSION_SECRET is not, so the admin surface
 * and the account ceremonies sign with the SAME secret: the worst case for
 * domain separation, which is exactly the case the cross-token tests need.
 */

process.env.SESSION_SECRET = 'shared-signing-secret';
process.env.ADMIN_PASSWORD = 'operator-secret-pw';
process.env.WEBAUTHN_RP_ID = 'localhost';
delete process.env.ADMIN_ENROLL_TOKEN;

const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, adminSessionCookie } = require('./helpers');
const repo = require('../lib/repo');
const admin = require('../lib/admin');
const webauthn = require('../lib/webauthn');
const adminPasskeys = require('../lib/admin-passkeys');
const { createAuthenticator } = require('./support/soft-authenticator');

const PW = 'operator-secret-pw';
const ENROLL = 'one-time-enroll-token';

const withEnroll = async (fn) => {
  process.env.ADMIN_ENROLL_TOKEN = ENROLL;
  try { return await fn(); } finally { delete process.env.ADMIN_ENROLL_TOKEN; }
};

async function enroll(auth, { uv = true, name = 'YubiKey' } = {}) {
  return withEnroll(async () => {
    const opts = await request(app).post('/api/admin/enroll/options').send({ password: PW, enrollToken: ENROLL });
    assert.equal(opts.status, 200, JSON.stringify(opts.body));
    return request(app).post('/api/admin/enroll').send({
      enrollToken: ENROLL,
      challenge: opts.body.challenge,
      response: auth.register(opts.body.options, { uv }),
      name,
    });
  });
}

const passwordStep = () => request(app).post('/api/admin/login').send({ password: PW });

async function login(auth, assertOpts) {
  const step = await passwordStep();
  assert.equal(step.status, 200, JSON.stringify(step.body));
  return request(app).post('/api/admin/login/passkey')
    .send({ step: step.body.step, response: auth.assert(step.body.options, assertOpts) });
}

/* --------------------------- before any key exists ------------------------- */

test('with no passkey enrolled and enrollment closed, the panel cannot be entered', async () => {
  const res = await passwordStep();
  // Fail closed, and indistinguishable from a wrong password.
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_password');
  assert.equal(res.headers['set-cookie'], undefined);
});

test('enrollment 404s while ADMIN_ENROLL_TOKEN is unset — for a signed-in operator too', async () => {
  for (const path of ['/api/admin/enroll/options', '/api/admin/enroll']) {
    const anon = await request(app).post(path).send({ password: PW, enrollToken: ENROLL });
    assert.equal(anon.status, 404, path);
    const signedIn = await request(app).post(path).set('Cookie', adminSessionCookie())
      .send({ password: PW, enrollToken: ENROLL });
    assert.equal(signedIn.status, 404, `${path} with an aid session`);
    assert.equal(signedIn.body.error, 'admin_enroll_disabled');
  }
});

test('with enrollment open and no key, the password step says so', async () => {
  await withEnroll(async () => {
    const res = await passwordStep();
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'no_admin_passkey');
    assert.equal(res.headers['set-cookie'], undefined);
  });
});

test('enrollment needs the password AND the token', async () => {
  await withEnroll(async () => {
    for (const body of [
      { password: PW, enrollToken: 'wrong' },
      { password: 'wrong', enrollToken: ENROLL },
      { password: PW },
      {},
    ]) {
      const res = await request(app).post('/api/admin/enroll/options').send(body);
      assert.equal(res.status, 401, JSON.stringify(body));
      assert.equal(res.body.error, 'invalid_credentials');
    }
    const ok = await request(app).post('/api/admin/enroll/options').send({ password: PW, enrollToken: ENROLL });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.options.authenticatorSelection.userVerification, 'required');

    // The final step re-checks the token, so a challenge alone cannot finish it.
    const auth = createAuthenticator();
    const res = await request(app).post('/api/admin/enroll')
      .send({ enrollToken: 'wrong', challenge: ok.body.challenge, response: auth.register(ok.body.options) });
    assert.equal(res.status, 401);
  });
  assert.deepEqual(await repo.listAdminPasskeys(), []);
});

test('a registration without user verification is refused', async () => {
  const res = await enroll(createAuthenticator(), { uv: false });
  assert.equal(res.status, 400);
  assert.deepEqual(await repo.listAdminPasskeys(), []);
});

/* ------------------------------- with a key -------------------------------- */

const key = createAuthenticator();

test('a passkey enrolls, and the panel never sees its public key', async () => {
  const res = await enroll(key);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.passkey.credentialId, key.id);
  assert.equal(res.body.passkey.name, 'YubiKey');
  assert.equal('publicKey' in res.body.passkey, false);

  const stored = await repo.listAdminPasskeys();
  assert.equal(stored.length, 1);
  assert.equal(typeof stored[0].publicKey, 'string');

  // excludeCredentials only ASKS the authenticator not to re-register; the
  // store's dedupe is what enforces it.
  const again = await enroll(key);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'passkey_exists');
  assert.equal((await repo.listAdminPasskeys()).length, 1);
});

test('the correct password ALONE does not mint a session', async () => {
  const res = await passwordStep();
  assert.equal(res.status, 200);
  assert.equal(res.headers['set-cookie'], undefined, 'no aid cookie after the password step');
  assert.equal(res.body.options.userVerification, 'required');
  assert.deepEqual(res.body.options.allowCredentials.map((c) => c.id), [key.id]);

  // The step token is not a session, under the session's own cookie name.
  const me = await request(app).get('/api/admin/me').set('Cookie', [`aid=${res.body.step}`]);
  assert.equal(me.status, 401);
});

test('a wrong password is refused before any passkey step', async () => {
  const res = await request(app).post('/api/admin/login').send({ password: 'wrong' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_password');
  assert.equal(res.body.step, undefined);
});

test('password + a verified passkey mints the session and advances the counter', async () => {
  const res = await login(key);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const cookie = res.headers['set-cookie'][0];
  assert.match(cookie, /^aid=a2\./);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);

  const me = await request(app).get('/api/admin/me').set('Cookie', res.headers['set-cookie']);
  assert.equal(me.status, 200);

  const [stored] = await repo.listAdminPasskeys();
  assert.equal(stored.counter, key.counter);
  assert.ok(stored.lastUsedAt);
});

test('an assertion whose counter did not advance is refused', async () => {
  const before = (await repo.listAdminPasskeys())[0].counter;
  assert.ok(before > 0, 'the library only checks a counter above 0');
  const res = await login(key, { counter: before });
  assert.equal(res.status, 401);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('an assertion without user verification is refused', async () => {
  const res = await login(key, { uv: false });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_passkey');
});

test('an unknown credential is refused', async () => {
  const res = await login(createAuthenticator());
  assert.equal(res.status, 401);
});

test('the passkey step needs a valid password-step token', async (t) => {
  const step = await passwordStep();
  const assertion = key.assert(step.body.options);
  const send = (s) => request(app).post('/api/admin/login/passkey').send({ step: s, response: assertion });

  const challenge = step.body.options.challenge;
  const secret = admin.signingSecret();
  const cases = {
    missing: undefined,
    tampered: step.body.step.slice(0, -2) + (step.body.step.endsWith('AA') ? 'BB' : 'AA'),
    expired: webauthn.signChallengeWith(secret, adminPasskeys.SCOPE_LOGIN, challenge, -1000),
    // Same challenge, same secret, every OTHER scope a token in this app is signed under.
    'an admin enrollment challenge': adminPasskeys.signEnrollChallenge(challenge),
    'an account login challenge': webauthn.signChallenge(webauthn.SCOPE_LOGIN, challenge),
    'an account registration challenge': webauthn.signChallenge(webauthn.SCOPE_REGISTER, challenge),
    'an aid session token': admin.mintToken(secret),
  };
  for (const [name, token] of Object.entries(cases)) {
    await t.test(name, async () => {
      const res = await send(token);
      assert.equal(res.status, 401);
      assert.equal(res.headers['set-cookie'], undefined);
    });
  }
  // Anti-vacuous: the same assertion with the genuine token succeeds, so every
  // refusal above is about the token and not about the assertion.
  assert.equal((await send(step.body.step)).status, 200);
});

test('no admin token verifies as another kind, in either direction', () => {
  const challenge = webauthn.encodeChallenge(webauthn.newChallenge());
  const step = adminPasskeys.signLoginStep(challenge);
  const enrollChallenge = adminPasskeys.signEnrollChallenge(challenge);
  const aid = admin.mintToken(admin.signingSecret());

  assert.equal(admin.verifyToken(step, admin.signingSecret()), false, 'step token as aid');
  assert.equal(admin.verifyToken(enrollChallenge, admin.signingSecret()), false, 'enroll challenge as aid');
  assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_LOGIN, step), null, 'step token as account login challenge');
  assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_REGISTER, enrollChallenge), null, 'enroll as account registration');
  assert.equal(adminPasskeys.verifyLoginStep(aid), null, 'aid as step token');
  assert.equal(adminPasskeys.verifyLoginStep(enrollChallenge), null, 'enroll challenge as step token');
  assert.equal(adminPasskeys.verifyEnrollChallenge(step), null, 'step token as enroll challenge');
  // Anti-vacuous: each verifies as itself.
  assert.equal(adminPasskeys.verifyLoginStep(step), challenge);
  assert.equal(adminPasskeys.verifyEnrollChallenge(enrollChallenge), challenge);
  assert.equal(admin.verifyToken(aid, admin.signingSecret()), true);
});

test('a session cookie minted under the password-only login (a1) is rejected', async () => {
  const secret = admin.signingSecret();
  const payload = `a1.${Date.now() + 60 * 60 * 1000}`;
  const sig = crypto.createHmac('sha256', secret).update(`admin.${payload}`).digest('base64url');
  const res = await request(app).get('/api/admin/me').set('Cookie', [`aid=${payload}.${sig}`]);
  assert.equal(res.status, 401);
  // Anti-vacuous: the same construction under the current version is accepted.
  const current = `a2.${Date.now() + 60 * 60 * 1000}`;
  const ok = crypto.createHmac('sha256', secret).update(`admin.${current}`).digest('base64url');
  assert.equal((await request(app).get('/api/admin/me').set('Cookie', [`aid=${current}.${ok}`])).status, 200);
});

test('the admin factor works without SESSION_SECRET (the panel is not an account feature)', async () => {
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try {
    const res = await login(key);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  } finally {
    process.env.SESSION_SECRET = saved;
  }
});

/* ------------------------------- management -------------------------------- */

test('the panel lists the keys and refuses to remove the last one', async () => {
  const cookie = adminSessionCookie();
  const unauth = await request(app).get('/api/admin/passkeys');
  assert.equal(unauth.status, 401);

  const list = await request(app).get('/api/admin/passkeys').set('Cookie', cookie);
  assert.equal(list.status, 200);
  assert.equal(list.body.passkeys.length, 1);
  assert.equal(list.body.enrollOpen, false);
  assert.equal('publicKey' in list.body.passkeys[0], false);

  const last = await request(app).delete(`/api/admin/passkeys/${key.id}`).set('Cookie', cookie);
  assert.equal(last.status, 409);
  assert.equal(last.body.error, 'last_admin_passkey');

  const missing = await request(app).delete('/api/admin/passkeys/nope').set('Cookie', cookie);
  assert.equal(missing.status, 404);

  const second = createAuthenticator();
  assert.equal((await enroll(second, { name: 'Phone' })).status, 201);
  await withEnroll(async () => {
    const open = await request(app).get('/api/admin/passkeys').set('Cookie', cookie);
    assert.equal(open.body.enrollOpen, true);
  });

  const removed = await request(app).delete(`/api/admin/passkeys/${key.id}`).set('Cookie', cookie);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.passkeys.map((p) => p.name), ['Phone']);

  // The removed key no longer logs in; the remaining one does.
  assert.equal((await login(key)).status, 401);
  assert.equal((await login(second)).status, 200);
});

test('ADMIN_PASSWORD unset: every login and enrollment route 404s', async () => {
  const saved = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  try {
    await withEnroll(async () => {
      for (const path of ['/api/admin/login', '/api/admin/login/passkey', '/api/admin/enroll/options', '/api/admin/enroll']) {
        const res = await request(app).post(path).send({ password: PW, enrollToken: ENROLL });
        assert.equal(res.status, 404, path);
      }
    });
  } finally {
    process.env.ADMIN_PASSWORD = saved;
  }
});
