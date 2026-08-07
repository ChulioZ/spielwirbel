'use strict';

/*
 * lib/webauthn.js (issue #418): the stateless signed challenge, the RP
 * identity, and the passkey projection. No HTTP and no authenticator — the
 * challenge matrix is the part that is ours rather than @simplewebauthn's, and
 * every failure mode in it is silent (a bad challenge just means "no passkey
 * found" on someone's phone).
 *
 * The one test that DOES call the real library is the fidelity check at the
 * bottom. It exists because test/passkeys.test.js stubs that boundary, and a
 * stub that encodes the challenge differently from the real thing would make
 * every route test in that file self-consistent and wrong.
 */

process.env.SESSION_SECRET = 'test-session-secret';
process.env.ACCOUNTS_ENABLED = 'true';

const fs = require('fs');
const os = require('os');
const path = require('path');

// lib/webauthn -> lib/accounts -> lib/repo -> lib/store, which reads data.json
// once at require time. Point it somewhere disposable first.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'game-sessions-webauthn-'));

const { test } = require('node:test');
const assert = require('node:assert/strict');

const webauthn = require('../lib/webauthn');

const freshChallenge = () => webauthn.encodeChallenge(webauthn.newChallenge());

/* -------------------------------- challenges ------------------------------- */

test('a signed challenge round-trips within its scope', () => {
  const challenge = freshChallenge();
  const token = webauthn.signChallenge(webauthn.SCOPE_REGISTER, challenge);
  assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_REGISTER, token), challenge);
});

test('a REGISTRATION challenge is refused by the AUTHENTICATION verify, and vice versa', () => {
  // The reason the HMAC is domain-separated at all. Without the scope prefix
  // both tokens verify under either scope, so anyone able to start a signup
  // could finish a login with the challenge it handed them.
  const challenge = freshChallenge();
  const reg = webauthn.signChallenge(webauthn.SCOPE_REGISTER, challenge);
  const login = webauthn.signChallenge(webauthn.SCOPE_LOGIN, challenge);

  assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_LOGIN, reg), null);
  assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_REGISTER, login), null);
  // ...and each still works in its own scope, so the refusal above is the scope
  // check rather than a token that was simply broken.
  assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_REGISTER, reg), challenge);
  assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_LOGIN, login), challenge);
});

test('a tampered challenge, expiry or signature is refused', () => {
  const challenge = freshChallenge();
  const token = webauthn.signChallenge(webauthn.SCOPE_REGISTER, challenge);
  const [c, exp, mac] = token.split('.');

  // Swapping the challenge for another valid one keeps the shape intact and is
  // exactly what an attacker who wants their OWN challenge signed would try.
  assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_REGISTER, `${freshChallenge()}.${exp}.${mac}`), null);
  // Extending the lifetime.
  assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_REGISTER, `${c}.${Number(exp) + 60000}.${mac}`), null);
  // Forging the signature.
  assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_REGISTER, `${c}.${exp}.${'A'.repeat(mac.length)}`), null);
});

test('an expired challenge is refused even though its signature is valid', () => {
  // Signed with a negative TTL, so the token is genuinely ours and genuinely
  // stale — the case a replayed ceremony hits.
  const token = webauthn.signChallenge(webauthn.SCOPE_REGISTER, freshChallenge(), -1000);
  assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_REGISTER, token), null);
});

test('a malformed challenge token is refused rather than throwing', () => {
  for (const bad of ['', null, undefined, 'a', 'a.b', 'a.b.c.d', '..', 'a..c', '.b.c', 'a.b.']) {
    assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_REGISTER, bad), null, `refused: ${JSON.stringify(bad)}`);
  }
  // A non-numeric expiry must not become NaN and slip past the comparison.
  const challenge = freshChallenge();
  assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_REGISTER, `${challenge}.later.zzz`), null);
});

test('challenges are unique per call', () => {
  const seen = new Set(Array.from({ length: 50 }, freshChallenge));
  assert.equal(seen.size, 50);
});

test('with no SESSION_SECRET nothing verifies', () => {
  const challenge = freshChallenge();
  const token = webauthn.signChallenge(webauthn.SCOPE_REGISTER, challenge);
  const secret = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try {
    assert.equal(webauthn.verifyChallenge(webauthn.SCOPE_REGISTER, token), null);
    assert.equal(webauthn.webauthnEnabled(), false);
  } finally {
    process.env.SESSION_SECRET = secret;
  }
});

/* ------------------------------- RP identity ------------------------------- */

test('the RP ID defaults to the canonical host and is env-overridable', () => {
  assert.equal(webauthn.rpId(), 'spielwirbel.app');
  process.env.WEBAUTHN_RP_ID = 'Example.TEST';
  try {
    assert.equal(webauthn.rpId(), 'example.test'); // lower-cased and trimmed
  } finally {
    delete process.env.WEBAUTHN_RP_ID;
  }
});

test('the expected origin follows the RP ID, with http+port only for localhost', () => {
  assert.deepEqual(webauthn.expectedOrigins(), ['https://spielwirbel.app']);

  process.env.WEBAUTHN_RP_ID = 'localhost';
  process.env.PORT = '3100';
  try {
    // Browsers treat http://localhost as a secure context, so a dev box needs
    // the plain-http origin AND its port — every other host is https.
    assert.deepEqual(webauthn.expectedOrigins(), ['http://localhost:3100']);
  } finally {
    delete process.env.WEBAUTHN_RP_ID;
    delete process.env.PORT;
  }

  process.env.WEBAUTHN_ORIGIN = 'https://staging.example/, https://alt.example';
  try {
    // An explicit list wins outright, and a trailing slash is normalised away —
    // the browser never reports one, so leaving it would refuse every ceremony.
    assert.deepEqual(webauthn.expectedOrigins(), ['https://staging.example', 'https://alt.example']);
  } finally {
    delete process.env.WEBAUTHN_ORIGIN;
  }
});

/* ------------------------------- projection -------------------------------- */

test('the public projection never carries the public key or the counter', () => {
  const stored = {
    type: 'passkey',
    credentialId: 'cred-1',
    publicKey: 'c2VjcmV0LWlzaA',
    counter: 7,
    transports: ['internal', 'hybrid'],
    name: 'MacBook',
    createdAt: '2026-08-07T10:00:00.000Z',
    lastUsedAt: null,
  };
  const shown = webauthn.publicPasskey(stored);

  assert.deepEqual(Object.keys(shown).sort(),
    ['createdAt', 'credentialId', 'lastUsedAt', 'name', 'transports'].sort());
  // Asserted over the SERIALIZED form as well, so a nested or renamed carrier
  // of the same bytes is caught rather than only the exact key name.
  assert.doesNotMatch(JSON.stringify(shown), /c2VjcmV0LWlzaA/);
});

test('passkeysOf and findPasskey ignore every other identity type', () => {
  const user = {
    identities: [
      { type: 'password', hash: 'argon2' },
      { type: 'passkey', credentialId: 'a', publicKey: 'x', counter: 0 },
      { type: 'passkey', credentialId: 'b', publicKey: 'y', counter: 0 },
    ],
  };
  assert.deepEqual(webauthn.passkeysOf(user).map((p) => p.credentialId), ['a', 'b']);
  assert.equal(webauthn.findPasskey(user, 'b').publicKey, 'y');
  assert.equal(webauthn.findPasskey(user, 'nope'), null);
  // An account with no identities key at all must not throw — a legacy shape
  // (.claude/rules/defaulted-account-fields-need-a-legacy-shape-spec.md).
  assert.deepEqual(webauthn.passkeysOf({}), []);
  assert.deepEqual(webauthn.passkeysOf(null), []);
});

test('a passkey name is trimmed, capped, and blank becomes null', () => {
  assert.equal(webauthn.cleanName('  MacBook  '), 'MacBook');
  assert.equal(webauthn.cleanName(''), null);
  assert.equal(webauthn.cleanName('   '), null);
  assert.equal(webauthn.cleanName(undefined), null);
  assert.equal(webauthn.cleanName(null), null);
  assert.equal(webauthn.cleanName('x'.repeat(500)).length, webauthn.PASSKEY_NAME_MAX);
});

/* ----------------------------- stub fidelity ------------------------------- */

test('the real library encodes our challenge bytes exactly as encodeChallenge does', async () => {
  // The whole stateless-challenge design rests on options.challenge being the
  // base64url of the bytes we handed in — that string is what gets signed into
  // the token and later passed back as expectedChallenge.
  //
  // It is also the one property test/passkeys.test.js's stub has to reproduce,
  // so pinning it against the REAL library is what stops that stub drifting into
  // a self-consistent fiction.
  //
  // Note the trap this guards: @simplewebauthn treats a STRING challenge as
  // UTF-8 text and base64url-encodes its bytes. Passing an already-encoded
  // string would therefore double-encode it, and every ceremony would fail with
  // nothing to see but "no passkey found".
  const { generateRegistrationOptions } = require('@simplewebauthn/server');
  const bytes = webauthn.newChallenge();
  const options = await generateRegistrationOptions({
    rpName: 'Spielwirbel',
    rpID: 'spielwirbel.app',
    userName: 'probe',
    userID: Buffer.from('0123456789abcdef', 'utf8'),
    challenge: bytes,
  });
  assert.equal(options.challenge, webauthn.encodeChallenge(bytes));
});
