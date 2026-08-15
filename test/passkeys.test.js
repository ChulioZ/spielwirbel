'use strict';

/*
 * Passkey routes (issue #418): registration, management, and usernameless
 * login, over HTTP.
 *
 * The @simplewebauthn/server boundary is STUBBED — the same shape as the
 * provider specs stubbing `fetch`. There is no authenticator here, so what is
 * under test is everything around the verification: the signed challenge, the
 * options the route asks for, the credential-id dedupe, the quota, the
 * projection, the counter write-back, the anti-enumeration answers and the
 * session it mints. The verification itself is the library's own job.
 *
 * The stub reproduces ONE property of the real library — that options.challenge
 * is the base64url of the bytes handed in. test/webauthn.test.js pins that
 * against the real implementation, so this file cannot drift into a
 * self-consistent fiction.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
// A real RP ID so expectedOrigins() is deterministic and the localhost branch
// (http + port) is what the routes run under here.
process.env.WEBAUTHN_RP_ID = 'localhost';

const path = require('path');

/* --------------------------- the stubbed boundary -------------------------- */

// Installed BEFORE ./helpers, which builds the app and therefore requires
// lib/routes/passkeys.js — that file destructures the four functions at load
// time, so the cache entry has to be in place first. The exported wrappers are
// stable and delegate to `hooks`, which each test is free to reassign.
const hooks = {};
const swPath = require.resolve('@simplewebauthn/server');
require.cache[swPath] = {
  id: swPath,
  filename: swPath,
  path: path.dirname(swPath),
  loaded: true,
  children: [],
  paths: [],
  exports: {
    generateRegistrationOptions: (o) => hooks.generateRegistrationOptions(o),
    verifyRegistrationResponse: (o) => hooks.verifyRegistrationResponse(o),
    generateAuthenticationOptions: (o) => hooks.generateAuthenticationOptions(o),
    verifyAuthenticationResponse: (o) => hooks.verifyAuthenticationResponse(o),
  },
};

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const quota = require('../lib/quota');
const { outbox } = require('../lib/mail');

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

// What the route last passed INTO the library. Assertions about the ceremony's
// policy read this, never the echoed response — the response is the stub's own
// output, so asserting on it would test the stub.
let captured = {};

const FAKE_PUBLIC_KEY = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

function resetStub() {
  captured = {};
  hooks.generateRegistrationOptions = async (o) => {
    captured.registrationOptions = o;
    return {
      challenge: b64url(o.challenge),
      rp: { name: o.rpName, id: o.rpID },
      user: { id: b64url(o.userID), name: o.userName, displayName: o.userDisplayName },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: o.authenticatorSelection,
      excludeCredentials: o.excludeCredentials,
    };
  };
  hooks.verifyRegistrationResponse = async (o) => {
    captured.verifyRegistration = o;
    return {
      verified: true,
      registrationInfo: {
        credential: {
          id: (o.response && o.response.id) || 'cred-default',
          publicKey: FAKE_PUBLIC_KEY,
          counter: 0,
          transports: ['internal'],
        },
      },
    };
  };
  hooks.generateAuthenticationOptions = async (o) => {
    captured.authenticationOptions = o;
    return {
      challenge: b64url(o.challenge),
      rpId: o.rpID,
      allowCredentials: o.allowCredentials,
      userVerification: o.userVerification,
    };
  };
  hooks.verifyAuthenticationResponse = async (o) => {
    captured.verifyAuthentication = o;
    return { verified: true, authenticationInfo: { newCounter: 1, credentialID: o.response.id } };
  };
}

/* --------------------------------- fixtures -------------------------------- */

let seq = 0;

// Register -> verify -> login, returning a usable access token. Mirrors the
// helper in test/account.test.js: the verification token is read out of the
// in-memory outbox, since SMTP_PASS is unset.
async function signIn() {
  seq += 1;
  const email = `passkey${seq}@example.com`;
  const username = `passkey_user_${seq}`;
  const password = 'correct horse battery';

  await request(app).post('/api/account/register').send({ email, username, password });
  const text = outbox[outbox.length - 1].text;
  const token = text.match(/\/v\?t=([a-z0-9]+\.[0-9a-f]+\.[A-Za-z0-9_-]+)/)[1];
  await request(app).post('/api/account/verify-email').send({ token });

  const res = await request(app).post('/api/account/login').send({ login: email, password });
  return { email, username, password, uid: res.body.user.id, accessToken: res.body.accessToken };
}

const auth = (req, token) => req.set('Authorization', `Bearer ${token}`);

// Drive a whole registration ceremony and return the stored credential id.
async function addPasskey(session, credentialId, name) {
  const opts = await auth(request(app).post('/api/account/passkeys/options'), session.accessToken).send({});
  assert.equal(opts.status, 200, JSON.stringify(opts.body));
  const res = await auth(request(app).post('/api/account/passkeys'), session.accessToken)
    .send({ response: { id: credentialId }, challenge: opts.body.challenge, name });
  return { res, options: opts.body };
}

/* ------------------------------- registration ------------------------------ */

test('registration options pin residentKey and set NO authenticatorAttachment', async () => {
  resetStub();
  const session = await signIn();
  const res = await auth(request(app).post('/api/account/passkeys/options'), session.accessToken).send({});
  assert.equal(res.status, 200);

  // Asserted on what the ROUTE PASSED IN, not on the response — the response is
  // the stub echoing itself back.
  const sel = captured.registrationOptions.authenticatorSelection;
  // Without residentKey: 'required' an authenticator may create a
  // NON-discoverable credential: registration succeeds, the passkey shows up in
  // the list, and usernameless login then silently never offers it. There is no
  // error anywhere, which is why this is pinned rather than reviewed.
  assert.equal(sel.residentKey, 'required');
  assert.equal(sel.requireResidentKey, true); // the CTAP2/legacy spelling
  assert.equal(sel.userVerification, 'preferred');
  // ANY value here drops a whole device class: 'platform' excludes hardware
  // keys and the cross-device QR flow, 'cross-platform' excludes Touch ID.
  assert.equal('authenticatorAttachment' in sel, false);

  assert.equal(captured.registrationOptions.rpID, 'localhost');
  // The account id as bytes — never the e-mail, which the authenticator would
  // store and sync through the platform keychain.
  assert.equal(Buffer.from(captured.registrationOptions.userID).toString('utf8'), session.uid);
  assert.equal(res.body.challenge.split('.')[0], res.body.options.challenge);
});

test('a passkey registers, appears in the list, and never exposes its public key', async () => {
  resetStub();
  const session = await signIn();
  const { res } = await addPasskey(session, 'cred-list-1', '  MacBook  ');
  assert.equal(res.status, 201);
  assert.equal(res.body.passkeys.length, 1);

  const listed = res.body.passkeys[0];
  assert.equal(listed.credentialId, 'cred-list-1');
  assert.equal(listed.name, 'MacBook'); // trimmed
  assert.deepEqual(listed.transports, ['internal']);
  assert.equal(listed.lastUsedAt, null);
  assert.ok(listed.createdAt);
  assert.equal('publicKey' in listed, false);
  assert.equal('counter' in listed, false);
  assert.doesNotMatch(JSON.stringify(res.body), new RegExp(b64url(FAKE_PUBLIC_KEY)));

  // ...and the same through the list endpoint, which is a separate call site.
  const list = await auth(request(app).get('/api/account/passkeys'), session.accessToken);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.passkeys, res.body.passkeys);

  // The public key IS stored — the projection is what withholds it, so this
  // assertion stops the test above passing because nothing was saved.
  const stored = await repo.getUserById(session.uid);
  const identity = stored.identities.find((i) => i.type === 'passkey');
  assert.equal(identity.publicKey, b64url(FAKE_PUBLIC_KEY));
  assert.equal(identity.counter, 0);
  // The password identity survives: a passkey is ADDITIVE, and losing every
  // device must never lock anyone out.
  assert.ok(stored.identities.some((i) => i.type === 'password'));
});

test('a junk transports value is sanitized before it reaches the store', async () => {
  resetStub();
  const session = await signIn();

  // The library passes `transports` through RAW from the client's response —
  // verifyRegistrationResponse does no runtime shape check on it — so this is
  // the one client-shaped value that would otherwise reach the store unchecked
  // (S-014). Simulate a hostile client: wrong types, oversize strings, and far
  // too many entries.
  hooks.verifyRegistrationResponse = async (o) => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: (o.response && o.response.id) || 'cred-default',
        publicKey: FAKE_PUBLIC_KEY,
        counter: 0,
        transports: ['internal', 42, { evil: 'x' }, null, 'x'.repeat(500),
          ...Array.from({ length: 40 }, (_, i) => `pad-${i}`)],
      },
    },
  });
  const { res } = await addPasskey(session, 'cred-junk-transports');
  assert.equal(res.status, 201);

  const stored = (await repo.getUserById(session.uid)).identities
    .find((i) => i.type === 'passkey');
  // Strings only, each bounded, the list capped — and the honest entries kept.
  assert.ok(Array.isArray(stored.transports));
  assert.ok(stored.transports.length <= 10, `capped, got ${stored.transports.length}`);
  assert.ok(stored.transports.every((t) => typeof t === 'string' && t.length <= 32));
  assert.equal(stored.transports[0], 'internal');

  // A non-array survives as an empty list rather than round-tripping.
  hooks.verifyRegistrationResponse = async (o) => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: (o.response && o.response.id) || 'cred-default',
        publicKey: FAKE_PUBLIC_KEY, counter: 0, transports: { not: 'an array' },
      },
    },
  });
  const second = await addPasskey(session, 'cred-object-transports');
  assert.equal(second.res.status, 201);
  const other = (await repo.getUserById(session.uid)).identities
    .find((i) => i.credentialId === 'cred-object-transports');
  assert.deepEqual(other.transports, []);
});

test('the registration verify is given the signed challenge, the origin and the RP ID', async () => {
  resetStub();
  const session = await signIn();
  await addPasskey(session, 'cred-verify-1');

  assert.equal(captured.verifyRegistration.expectedChallenge,
    captured.registrationOptions.challenge && b64url(captured.registrationOptions.challenge));
  assert.deepEqual(captured.verifyRegistration.expectedOrigin, ['http://localhost:3000']);
  assert.equal(captured.verifyRegistration.expectedRPID, 'localhost');
  // Must match the 'preferred' asked for at options time. The library DEFAULTS
  // this to true, which would reject exactly the hardware keys without a PIN
  // that the 'preferred' policy exists to keep working.
  assert.equal(captured.verifyRegistration.requireUserVerification, false);
});

test('a tampered, expired or CROSS-SCOPE challenge is refused at registration', async () => {
  resetStub();
  const session = await signIn();
  const opts = await auth(request(app).post('/api/account/passkeys/options'), session.accessToken).send({});

  const post = (challenge) => auth(request(app).post('/api/account/passkeys'), session.accessToken)
    .send({ response: { id: 'cred-bad' }, challenge });

  const [c, exp, mac] = opts.body.challenge.split('.');
  assert.equal((await post(`${c}.${Number(exp) + 60000}.${mac}`)).body.error, 'invalid_challenge');
  assert.equal((await post('garbage')).body.error, 'invalid_challenge');
  assert.equal((await post(undefined)).body.error, 'invalid_challenge');

  // A LOGIN challenge presented to the registration verify. This is the reason
  // the challenge HMAC is domain-separated per scope.
  const login = await request(app).post('/api/account/passkeys/login/options').send({});
  assert.equal((await post(login.body.challenge)).body.error, 'invalid_challenge');

  // Nothing was stored by any of the above.
  const stored = await repo.getUserById(session.uid);
  assert.equal((stored.identities || []).filter((i) => i.type === 'passkey').length, 0);
});

test('a credential the library refuses is a 400 and stores nothing', async () => {
  resetStub();
  const session = await signIn();

  hooks.verifyRegistrationResponse = async () => ({ verified: false });
  let out = await addPasskey(session, 'cred-refused');
  assert.equal(out.res.status, 400);
  assert.equal(out.res.body.error, 'invalid_passkey');

  // The library THROWS on malformed input as well as returning verified:false —
  // both have to land on the same 400 rather than a 500.
  hooks.verifyRegistrationResponse = async () => { throw new Error('malformed attestation'); };
  out = await addPasskey(session, 'cred-thrown');
  assert.equal(out.res.status, 400);
  assert.equal(out.res.body.error, 'invalid_passkey');

  const stored = await repo.getUserById(session.uid);
  assert.equal((stored.identities || []).filter((i) => i.type === 'passkey').length, 0);
});

test('a credential id already registered is refused, on this account and on another', async () => {
  resetStub();
  const a = await signIn();
  const b = await signIn();
  await addPasskey(a, 'cred-shared');

  // Same account: the authenticator was asked to prevent this via
  // excludeCredentials, but that is a request, not an enforcement.
  assert.equal((await addPasskey(a, 'cred-shared')).res.body.error, 'passkey_exists');

  // Different account — the one that matters. Login resolves an ACCOUNT from a
  // credential id, so two accounts holding one id would make "which account
  // does this log in" a question about storage order.
  const res = (await addPasskey(b, 'cred-shared')).res;
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'passkey_taken');
  assert.equal((await repo.getUserByCredentialId('cred-shared')).id, a.uid);
});

test('the passkey count is capped per account', async () => {
  resetStub();
  const session = await signIn();
  const previous = process.env.MAX_PASSKEYS_PER_USER;
  process.env.MAX_PASSKEYS_PER_USER = '2';
  try {
    assert.equal(quota.passkeysPerUser(), 2);
    assert.equal((await addPasskey(session, 'cap-1')).res.status, 201);
    assert.equal((await addPasskey(session, 'cap-2')).res.status, 201);

    // Refused at the OPTIONS step, so the ceremony never starts and the user is
    // not asked for a fingerprint before being told no.
    const opts = await auth(request(app).post('/api/account/passkeys/options'), session.accessToken).send({});
    assert.equal(opts.status, 403);
    assert.equal(opts.body.error, 'quota_passkeys');
    assert.equal(opts.body.limit, 2);
  } finally {
    if (previous === undefined) delete process.env.MAX_PASSKEYS_PER_USER;
    else process.env.MAX_PASSKEYS_PER_USER = previous;
  }
});

/* --------------------------------- manage ---------------------------------- */

test('a passkey can be renamed and removed, and another account cannot touch it', async () => {
  resetStub();
  const owner = await signIn();
  const stranger = await signIn();
  await addPasskey(owner, 'cred-manage', 'Old name');

  const renamed = await auth(request(app).patch('/api/account/passkeys/cred-manage'), owner.accessToken)
    .send({ name: 'New name' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.passkeys[0].name, 'New name');

  // A 404 rather than a 403, so the route cannot double as "does this
  // credential id exist?".
  for (const method of ['patch', 'delete']) {
    const res = await auth(request(app)[method]('/api/account/passkeys/cred-manage'), stranger.accessToken).send({});
    assert.equal(res.status, 404, method);
    assert.equal(res.body.error, 'passkey_not_found');
  }
  // ...and it really is still there, so the 404s above are about ownership
  // rather than about a credential that had already gone.
  assert.equal((await repo.getUserByCredentialId('cred-manage')).id, owner.uid);

  const removed = await auth(request(app).delete('/api/account/passkeys/cred-manage'), owner.accessToken);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.passkeys, []);
  assert.equal(await repo.getUserByCredentialId('cred-manage'), null);

  // Removing the last passkey leaves the account fully usable by password.
  const relogin = await request(app).post('/api/account/login')
    .send({ login: owner.email, password: owner.password });
  assert.equal(relogin.status, 200);
});

/* ------------------------------ passkey login ------------------------------ */

test('a passkey signs in without an identifier, minting the same session a password does', async () => {
  resetStub();
  const session = await signIn();
  await addPasskey(session, 'cred-login');

  const opts = await request(app).post('/api/account/passkeys/login/options').send({});
  assert.equal(opts.status, 200);

  const res = await request(app).post('/api/account/passkeys/login')
    .send({ response: { id: 'cred-login' }, challenge: opts.body.challenge });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.user.id, session.uid);
  assert.ok(res.body.accessToken);
  assert.ok(res.body.refreshToken);
  assert.ok(res.body.expiresIn > 0);

  // The access cookie is what makes /uploads cover images render — without it
  // every cover 401s and the app looks broken after a passkey login
  // (.claude/rules/accounts-mode-gate.md).
  const cookies = res.headers['set-cookie'] || [];
  assert.ok(cookies.some((c) => c.startsWith('sa=')), 'sets the sa access cookie');

  // The minted token really works against a gated route.
  const me = await auth(request(app).get('/api/account/me'), res.body.accessToken);
  assert.equal(me.status, 200);
  assert.equal(me.body.id, session.uid);

  // …and this response carries the SAME account shape /me does (#785). The
  // client seats `accountUser` from whatever started the session, so a field
  // omitted here reads as `undefined` for the rest of it — which is how the
  // „Was ist neu" dot (#741) re-lit after every sign-in. Derived from /me rather
  // than restated, so the two lists cannot drift apart
  // (.claude/rules/shared-constants-across-the-stack.md).
  assert.deepEqual(Object.keys(res.body.user).sort(), Object.keys(me.body).sort());

  // The stored credential is what was verified against, and the counter and
  // last-used stamp are written back.
  assert.equal(Buffer.from(captured.verifyAuthentication.credential.publicKey).toString('base64url'),
    b64url(FAKE_PUBLIC_KEY));
  assert.deepEqual(captured.verifyAuthentication.expectedOrigin, ['http://localhost:3000']);
  const stored = await repo.getUserById(session.uid);
  const identity = stored.identities.find((i) => i.type === 'passkey');
  assert.equal(identity.counter, 1);
  assert.ok(identity.lastUsedAt);
});

test('the login options reveal nothing about any account, whatever is posted', async () => {
  resetStub();
  await signIn();

  const bare = await request(app).post('/api/account/passkeys/login/options').send({});
  // An identifier in the body must change absolutely nothing. This is the shape
  // an "improvement" would take — resolving the address to its credentials —
  // and it would answer "does this address have an account?" for free.
  const withEmail = await request(app).post('/api/account/passkeys/login/options')
    .send({ login: 'passkey1@example.com', email: 'passkey1@example.com' });
  const unknown = await request(app).post('/api/account/passkeys/login/options')
    .send({ login: 'nobody-at-all@example.com' });

  for (const res of [bare, withEmail, unknown]) {
    assert.equal(res.status, 200);
    // Empty = "any credential you hold for this RP", which is what makes the
    // flow usernameless — and what keeps it blind.
    assert.deepEqual(res.body.options.allowCredentials, []);
    assert.equal(res.body.options.rpId, 'localhost');
    assert.equal(res.body.options.userVerification, 'preferred');
  }
  // Identical but for the challenge, which must differ every time.
  const strip = (r) => ({ ...r.body.options, challenge: null });
  assert.deepEqual(strip(bare), strip(withEmail));
  assert.deepEqual(strip(bare), strip(unknown));
  assert.notEqual(bare.body.options.challenge, withEmail.body.options.challenge);
});

test('an unknown credential, a wrong-scope challenge and a refused assertion all answer the same 401', async () => {
  resetStub();
  const session = await signIn();
  await addPasskey(session, 'cred-401');

  const opts = await request(app).post('/api/account/passkeys/login/options').send({});
  const login = (body) => request(app).post('/api/account/passkeys/login').send(body);

  // A credential nobody has registered.
  let res = await login({ response: { id: 'cred-unknown' }, challenge: opts.body.challenge });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');

  // A REGISTRATION challenge replayed at login.
  const regOpts = await auth(request(app).post('/api/account/passkeys/options'), session.accessToken).send({});
  res = await login({ response: { id: 'cred-401' }, challenge: regOpts.body.challenge });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');

  // A genuine credential whose assertion the library refuses (a replayed
  // counter is the case this covers in production).
  hooks.verifyAuthenticationResponse = async () => { throw new Error('counter went backwards'); };
  const fresh = await request(app).post('/api/account/passkeys/login/options').send({});
  res = await login({ response: { id: 'cred-401' }, challenge: fresh.body.challenge });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');

  // No body at all.
  res = await login({});
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');
});

test('a suspended account cannot sign in with a passkey either', async () => {
  resetStub();
  const session = await signIn();
  await addPasskey(session, 'cred-disabled');
  await repo.updateUser(session.uid, { disabled: true, disabledAt: new Date().toISOString(), disabledReason: 'abuse' });

  const opts = await request(app).post('/api/account/passkeys/login/options').send({});
  const res = await request(app).post('/api/account/passkeys/login')
    .send({ response: { id: 'cred-disabled' }, challenge: opts.body.challenge });
  // Only revealed after the credential is proven, exactly like the password
  // login's own placement — so it leaks nothing to an outsider.
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'account_disabled');
});

/* --------------------------------- gating ---------------------------------- */

test('every passkey route 404s accounts_disabled when accounts are off', async () => {
  resetStub();
  const session = await signIn();
  await addPasskey(session, 'cred-gate');

  // The gate is read PER REQUEST, so flipping the env exercises the real
  // accounts-off behaviour on the app that is already built.
  process.env.ACCOUNTS_ENABLED = 'false';
  try {
    const calls = [
      auth(request(app).post('/api/account/passkeys/options'), session.accessToken).send({}),
      auth(request(app).post('/api/account/passkeys'), session.accessToken).send({}),
      auth(request(app).get('/api/account/passkeys'), session.accessToken),
      auth(request(app).patch('/api/account/passkeys/cred-gate'), session.accessToken).send({ name: 'x' }),
      auth(request(app).delete('/api/account/passkeys/cred-gate'), session.accessToken),
      request(app).post('/api/account/passkeys/login/options').send({}),
      request(app).post('/api/account/passkeys/login').send({}),
    ];
    for (const res of await Promise.all(calls)) {
      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'accounts_disabled');
    }
  } finally {
    process.env.ACCOUNTS_ENABLED = 'true';
  }
});

test('the management routes require a token; the login pair does not', async () => {
  resetStub();
  for (const res of await Promise.all([
    request(app).post('/api/account/passkeys/options').send({}),
    request(app).post('/api/account/passkeys').send({}),
    request(app).get('/api/account/passkeys'),
    request(app).patch('/api/account/passkeys/x').send({ name: 'x' }),
    request(app).delete('/api/account/passkeys/x'),
  ])) {
    assert.equal(res.status, 401);
  }
  // The login pair is unauthenticated by necessity — usernameless login has no
  // session yet.
  assert.equal((await request(app).post('/api/account/passkeys/login/options').send({})).status, 200);
});

test('a guest demo cannot register a passkey', async () => {
  resetStub();
  const previous = process.env.DEMO_ENABLED;
  process.env.DEMO_ENABLED = 'true';
  try {
    const demo = await request(app).post('/api/account/demo').send({ locale: 'de' });
    assert.equal(demo.status, 200, JSON.stringify(demo.body));
    const token = demo.body.accessToken;

    // A demo self-erases on a TTL, so a passkey registered against one would
    // point at an account that is about to vanish — and the platform keychain
    // would keep offering it forever.
    for (const res of await Promise.all([
      auth(request(app).post('/api/account/passkeys/options'), token).send({}),
      auth(request(app).post('/api/account/passkeys'), token).send({}),
    ])) {
      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'demo_forbidden');
    }
  } finally {
    if (previous === undefined) delete process.env.DEMO_ENABLED;
    else process.env.DEMO_ENABLED = previous;
  }
});
