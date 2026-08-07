/* Spielwirbel – WebAuthn browser glue (issue #418).

   Its own small file on purpose: the conversions below are pure and want unit
   tests, and a testable helper exported from a view file drags that whole view
   into the coverage report at ~10% and fails `coverage:ci` with every test green
   (.claude/rules/frontend-helper-modules-and-coverage.md).

   Dependency-free. @simplewebauthn/browser would do this for us, but it ships
   ESM only and the frontend has no bundler — so the ~40 lines it would save are
   not worth a build step (the SERVER half does use the library, where the hard
   crypto is).

   Why the conversions exist at all: the WebAuthn DOM API speaks ArrayBuffer,
   while JSON speaks strings. The server sends and expects base64url — the
   encoding @simplewebauthn/server uses throughout — so every buffer crossing
   the wire is translated here, in one place. Part of the shared frontend
   scope; loads before core.js and uses no app helpers. */

'use strict';

// base64url -> bytes. Padding is restored first: atob rejects an unpadded
// string, and the server never sends padding.
function b64urlToBytes(value) {
  const b64 = String(value == null ? '' : value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// bytes -> base64url, unpadded. Accepts an ArrayBuffer or any TypedArray, since
// the credential hands back both shapes depending on the property.
function bytesToB64url(value) {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The server's registration options, with every base64url field turned back
// into the ArrayBuffer navigator.credentials.create() requires. Everything else
// is passed through untouched — in particular `authenticatorSelection`, which
// carries the residentKey policy the whole usernameless flow depends on, and
// which this must never rewrite.
function toCreateOptions(options) {
  const o = options || {};
  return {
    ...o,
    challenge: b64urlToBytes(o.challenge),
    user: { ...(o.user || {}), id: b64urlToBytes((o.user || {}).id) },
    excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: b64urlToBytes(c.id) })),
  };
}

// Same for the login options. `allowCredentials` is empty by design — that is
// what makes the flow usernameless — so the map is a no-op today and exists so
// a future non-empty list cannot silently arrive unconverted.
function toRequestOptions(options) {
  const o = options || {};
  return {
    ...o,
    challenge: b64urlToBytes(o.challenge),
    allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: b64urlToBytes(c.id) })),
  };
}

/* The two credential -> JSON shapes @simplewebauthn/server verifies. They are
   deliberately separate rather than one function branching on what is present:
   the two ceremonies return different `response` members, and a merged version
   would quietly send `undefined` for the missing half — which the server would
   reject as a malformed credential with nothing on screen to explain it. */

function registrationToJson(credential) {
  const r = credential.response;
  return {
    id: credential.id,
    rawId: bytesToB64url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    response: {
      clientDataJSON: bytesToB64url(r.clientDataJSON),
      attestationObject: bytesToB64url(r.attestationObject),
      // How the credential can be reached next time (internal, hybrid, usb…).
      // Stored and replayed in allowCredentials, so the OS can say "use your
      // phone" rather than offering every method.
      transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
    },
  };
}

function assertionToJson(credential) {
  const r = credential.response;
  return {
    id: credential.id,
    rawId: bytesToB64url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    response: {
      clientDataJSON: bytesToB64url(r.clientDataJSON),
      authenticatorData: bytesToB64url(r.authenticatorData),
      signature: bytesToB64url(r.signature),
      // Present only for a discoverable credential — which ours always are, but
      // it is nullable in the spec, so null must survive as null rather than
      // becoming the string "null".
      userHandle: r.userHandle ? bytesToB64url(r.userHandle) : null,
    },
  };
}

// Feature detection for the login button. A browser without
// window.PublicKeyCredential cannot run either ceremony, so the affordance is
// absent rather than present-and-broken.
function passkeysSupported() {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

// A user who dismisses the OS sheet throws NotAllowedError / AbortError. That
// is a deliberate cancel, not a failure, so callers show nothing at all rather
// than an error the user caused on purpose.
function isPasskeyCancel(err) {
  return !!err && (err.name === 'NotAllowedError' || err.name === 'AbortError');
}

async function createPasskey(options) {
  const credential = await navigator.credentials.create({ publicKey: toCreateOptions(options) });
  if (!credential) throw new Error('no_credential');
  return registrationToJson(credential);
}

async function getPasskey(options) {
  const credential = await navigator.credentials.get({ publicKey: toRequestOptions(options) });
  if (!credential) throw new Error('no_credential');
  return assertionToJson(credential);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    b64urlToBytes,
    bytesToB64url,
    toCreateOptions,
    toRequestOptions,
    registrationToJson,
    assertionToJson,
    passkeysSupported,
    isPasskeyCancel,
  };
}
