'use strict';

/*
 * public/js/passkey.js (issue #418) — the base64url ⇄ ArrayBuffer conversions
 * every WebAuthn credential crossing the wire goes through.
 *
 * These are the least interesting and most dangerous lines in the feature: a
 * wrong conversion produces a well-formed request that the server rejects as an
 * invalid signature, and the only symptom anywhere is an OS sheet that seems to
 * have worked followed by "that didn't work". So they are pinned here rather
 * than left to a browser pass.
 *
 * Required into Node, which is exactly why the file is its own small module —
 * requiring a view file instead would drag it into the coverage report at ~10%
 * and fail coverage:ci with every test green
 * (.claude/rules/frontend-helper-modules-and-coverage.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  b64urlToBytes,
  bytesToB64url,
  toCreateOptions,
  toRequestOptions,
  registrationToJson,
  assertionToJson,
  passkeysSupported,
  isPasskeyCancel,
} = require('../public/js/passkey');

const bytes = (...v) => new Uint8Array(v);

test('base64url round-trips, unpadded, with the URL-safe alphabet', () => {
  // 0xFB 0xFF encodes to "+/" in standard base64 and "-_" in base64url — the
  // one input that actually distinguishes the two alphabets. Getting this wrong
  // is invisible until a challenge happens to contain those bytes.
  assert.equal(bytesToB64url(bytes(0xfb, 0xff)), '-_8');
  assert.deepEqual(Array.from(b64urlToBytes('-_8')), [0xfb, 0xff]);

  // Every padding case: 1, 2 and 0 bytes short of a 3-byte group.
  for (const input of [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4], []]) {
    const encoded = bytesToB64url(bytes(...input));
    assert.doesNotMatch(encoded, /=/, 'never padded');
    assert.deepEqual(Array.from(b64urlToBytes(encoded)), input);
  }

  // The server sends unpadded; atob REJECTS an unpadded string, so the decoder
  // restores the padding first. This is the assertion that would catch that
  // being dropped.
  assert.deepEqual(Array.from(b64urlToBytes('AQ')), [1]);
  assert.deepEqual(Array.from(b64urlToBytes('AQI')), [1, 2]);
});

test('bytesToB64url accepts an ArrayBuffer as well as a TypedArray', () => {
  // The credential hands back both shapes depending on the property, so a
  // decoder that only handled one would fail on half the fields.
  const view = bytes(1, 2, 3, 4);
  assert.equal(bytesToB64url(view.buffer), bytesToB64url(view));
});

test('a full-byte-range payload survives the round trip', () => {
  const all = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) all[i] = i;
  assert.deepEqual(Array.from(b64urlToBytes(bytesToB64url(all))), Array.from(all));
});

test('toCreateOptions converts every buffer field and passes the policy through', () => {
  const options = toCreateOptions({
    challenge: 'AQID',
    rp: { id: 'spielwirbel.app', name: 'Spielwirbel' },
    user: { id: 'BAUG', name: 'ada', displayName: 'ada' },
    excludeCredentials: [{ id: 'BwgJ', transports: ['internal'] }],
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
  });

  assert.ok(options.challenge instanceof Uint8Array);
  assert.deepEqual(Array.from(options.challenge), [1, 2, 3]);
  assert.deepEqual(Array.from(options.user.id), [4, 5, 6]);
  assert.deepEqual(Array.from(options.excludeCredentials[0].id), [7, 8, 9]);
  assert.deepEqual(options.excludeCredentials[0].transports, ['internal']);

  // The residentKey policy is what makes usernameless login possible at all —
  // this conversion must pass it through untouched rather than rebuilding the
  // object and silently dropping it.
  assert.deepEqual(options.authenticatorSelection,
    { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' });
  assert.deepEqual(options.rp, { id: 'spielwirbel.app', name: 'Spielwirbel' });
});

test('toRequestOptions converts the challenge and tolerates an empty allowCredentials', () => {
  // Empty is the normal case — it is what makes the login usernameless — so the
  // map must not choke on it, and must still be there for a future non-empty
  // list rather than leaving those ids unconverted.
  const empty = toRequestOptions({ challenge: 'AQID', allowCredentials: [], rpId: 'localhost' });
  assert.deepEqual(Array.from(empty.challenge), [1, 2, 3]);
  assert.deepEqual(empty.allowCredentials, []);
  assert.equal(empty.rpId, 'localhost');

  const missing = toRequestOptions({ challenge: 'AQID' });
  assert.deepEqual(missing.allowCredentials, []);

  const filled = toRequestOptions({ challenge: 'AQID', allowCredentials: [{ id: 'BAUG' }] });
  assert.deepEqual(Array.from(filled.allowCredentials[0].id), [4, 5, 6]);
});

/* The two credential -> JSON shapes. Faked with the exact member set the DOM
   gives us, so a renamed or dropped field fails here rather than as an
   unexplained rejection at the server. */

const fakeCredential = (response, over = {}) => ({
  id: 'cred-abc',
  rawId: bytes(1, 2, 3).buffer,
  type: 'public-key',
  getClientExtensionResults: () => ({ credProps: { rk: true } }),
  response,
  ...over,
});

test('registrationToJson carries the attestation and the transports', () => {
  const json = registrationToJson(fakeCredential({
    clientDataJSON: bytes(10, 11),
    attestationObject: bytes(20, 21),
    getTransports: () => ['internal', 'hybrid'],
  }, { authenticatorAttachment: 'platform' }));

  assert.equal(json.id, 'cred-abc');
  assert.equal(json.rawId, bytesToB64url(bytes(1, 2, 3)));
  assert.equal(json.type, 'public-key');
  assert.deepEqual(json.clientExtensionResults, { credProps: { rk: true } });
  assert.equal(json.authenticatorAttachment, 'platform');
  assert.equal(json.response.clientDataJSON, bytesToB64url(bytes(10, 11)));
  assert.equal(json.response.attestationObject, bytesToB64url(bytes(20, 21)));
  assert.deepEqual(json.response.transports, ['internal', 'hybrid']);
  // Never the authentication members — a merged converter would send undefined
  // for these and the server would reject the credential as malformed.
  assert.equal('signature' in json.response, false);
});

test('registrationToJson survives an authenticator with no getTransports', () => {
  // Older authenticators omit it entirely; calling it unguarded would throw
  // inside the success path of a ceremony the user just completed.
  const json = registrationToJson(fakeCredential({
    clientDataJSON: bytes(1), attestationObject: bytes(2),
  }));
  assert.deepEqual(json.response.transports, []);
});

test('assertionToJson carries the signature, and a null userHandle stays null', () => {
  const json = assertionToJson(fakeCredential({
    clientDataJSON: bytes(10),
    authenticatorData: bytes(20),
    signature: bytes(30),
    userHandle: bytes(40),
  }));
  assert.equal(json.response.authenticatorData, bytesToB64url(bytes(20)));
  assert.equal(json.response.signature, bytesToB64url(bytes(30)));
  assert.equal(json.response.userHandle, bytesToB64url(bytes(40)));
  assert.equal('attestationObject' in json.response, false);

  // userHandle is nullable in the spec. It must stay null rather than becoming
  // the STRING "null", which is what a bare bytesToB64url(null) would produce
  // and which the server would then try to decode as a real handle.
  const anonymous = assertionToJson(fakeCredential({
    clientDataJSON: bytes(10), authenticatorData: bytes(20), signature: bytes(30), userHandle: null,
  }));
  assert.equal(anonymous.response.userHandle, null);
});

test('a dismissed OS sheet reads as a cancel, and a real failure does not', () => {
  // Dismissing the sheet is a deliberate choice, so the UI shows nothing at
  // all. Treating a genuine failure as a cancel would be the worse mistake —
  // it would swallow the error and leave the button looking inert.
  assert.equal(isPasskeyCancel({ name: 'NotAllowedError' }), true);
  assert.equal(isPasskeyCancel({ name: 'AbortError' }), true);
  assert.equal(isPasskeyCancel({ name: 'SecurityError' }), false);
  assert.equal(isPasskeyCancel(new Error('network')), false);
  assert.equal(isPasskeyCancel(null), false);
  assert.equal(isPasskeyCancel(undefined), false);
});

test('feature detection is false where there is no WebAuthn at all', () => {
  // Node has no window, which is the same answer an ancient browser gives — and
  // the gate that keeps the login button off a device that cannot use it.
  assert.equal(passkeysSupported(), false);
});
