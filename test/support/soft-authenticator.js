'use strict';

/*
 * A software WebAuthn authenticator for route specs (#1670): a real P-256 key,
 * a real attestation object ('none' format) and a real ES256 assertion, so the
 * route under test runs @simplewebauthn/server's actual verification instead
 * of a stub. That is what lets a spec prove a policy the library enforces —
 * user verification required, a regressing signature counter refused — rather
 * than asserting what the route passed into a fake.
 *
 * Only what the 'none' attestation path needs; no extensions, no attestation
 * certificates.
 */

const crypto = require('node:crypto');
const { isoCBOR } = require('@simplewebauthn/server/helpers');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest();
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

function createAuthenticator({ rpId = 'localhost', origin = 'http://localhost:3000' } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = crypto.randomBytes(16);
  const id = b64url(credentialId);
  let counter = 0;

  const flags = (uv) => FLAG_UP | (uv ? FLAG_UV : 0);
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({
    type, challenge, origin, crossOrigin: false,
  }));

  // What navigator.credentials.create() would hand back, as JSON.
  function register(options, { uv = true } = {}) {
    const cose = isoCBOR.encode(new Map([
      [1, 2], [3, -7], [-1, 1],
      [-2, Buffer.from(jwk.x, 'base64url')],
      [-3, Buffer.from(jwk.y, 'base64url')],
    ]));
    const idLen = Buffer.alloc(2); idLen.writeUInt16BE(credentialId.length);
    const authData = Buffer.concat([
      sha256(rpId), Buffer.from([flags(uv) | FLAG_AT]), u32(counter),
      Buffer.alloc(16), idLen, credentialId, Buffer.from(cose),
    ]);
    const attestationObject = isoCBOR.encode(new Map([
      ['fmt', 'none'], ['attStmt', new Map()], ['authData', authData],
    ]));
    return {
      id, rawId: id, type: 'public-key', clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientData('webauthn.create', options.challenge)),
        attestationObject: b64url(attestationObject),
        transports: ['usb'],
      },
    };
  }

  // What navigator.credentials.get() would hand back. `counter` overrides the
  // authenticator's own (to replay an old value); otherwise it advances.
  function assert(options, { uv = true, counter: forced } = {}) {
    if (forced === undefined) counter += 1;
    const authData = Buffer.concat([
      sha256(rpId), Buffer.from([flags(uv)]), u32(forced === undefined ? counter : forced),
    ]);
    const cdj = clientData('webauthn.get', options.challenge);
    const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(cdj)]), privateKey);
    return {
      id, rawId: id, type: 'public-key', clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(cdj),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: null,
      },
    };
  }

  return { id, register, assert, get counter() { return counter; } };
}

module.exports = { createAuthenticator };
