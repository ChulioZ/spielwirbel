'use strict';

/*
 * Passkey (WebAuthn) primitives (issue #418) — the second credential type on the
 * `identities` seam lib/accounts.js documents. A passkey is an ADDITIONAL way
 * into an existing account: the password and the mailed reset link stay exactly
 * as they are, so losing every device can never lock anyone out.
 *
 * Gated on accounts.accountsEnabled() — a passkey is an account credential, so
 * it is inert wherever accounts are. Config is read per call (not at module
 * load) so tests and createApp() always see the current env, the same reason as
 * lib/accounts.js and the rate-limit ceilings.
 *
 * The verification itself (CBOR decoding, COSE public keys, attestation formats,
 * origin/RP-ID binding, signature counters) is @simplewebauthn/server's job, not
 * ours — correctness-critical crypto is exactly what CLAUDE.md says to adopt
 * rather than hand-roll. What lives here is the surrounding policy: which RP ID
 * and origin we bind to, and the stateless challenge.
 */

const crypto = require('crypto');
const accounts = require('./accounts');
const { canonicalHost } = require('./canonical');

// A challenge is single-use in practice (the ceremony completes or it doesn't)
// and short-lived; 5 minutes covers a user hunting for a hardware key without
// leaving a replay window open.
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_BYTES = 32;

// Domain separation for the challenge HMAC, the same reasoning as the admin
// token's `admin.` prefix: a REGISTRATION challenge must never be replayable
// against the AUTHENTICATION verify (that direction would let anyone who can
// start a signup finish a login), and neither may collide with an app access
// token when SESSION_SECRET signs all three.
const SCOPE_REGISTER = 'wa.reg';
const SCOPE_LOGIN = 'wa.auth';

// A stored name is a display label the user typed; bounded so it stays one
// storable, renderable token.
const PASSKEY_NAME_MAX = 60;

function webauthnEnabled() {
  return accounts.accountsEnabled();
}

// A passkey is bound to ONE RP ID for its whole life, so this value is
// effectively permanent once anyone has registered — changing it silently
// invalidates every existing passkey (the OS sheet just reports none found).
// It defaults to the canonical host (#230), which the .de/.com domains already
// 301 to, so the convergence WebAuthn requires is one the app already has.
function rpId() {
  return (process.env.WEBAUTHN_RP_ID || canonicalHost()).trim().toLowerCase();
}

function rpName() {
  return (process.env.WEBAUTHN_RP_NAME || 'Spielwirbel').trim();
}

/*
 * The origin(s) the browser may report. Distinct from the RP ID: the RP ID is a
 * bare domain, the origin is scheme + host + PORT, and a mismatch is refused by
 * the library rather than by us.
 *
 * The default derives from the RP ID because the two must agree anyway. The
 * localhost branch is not a convenience: browsers treat http://localhost as a
 * secure context (so WebAuthn works there without TLS) while every other host
 * needs https, and a dev origin carries the port. WEBAUTHN_ORIGIN overrides for
 * anything else — a staging host, or a port-bearing deployment.
 */
function expectedOrigins() {
  const explicit = String(process.env.WEBAUTHN_ORIGIN || '')
    .split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  if (explicit.length) return explicit;
  const host = rpId();
  if (host === 'localhost' || host === '127.0.0.1') {
    return [`http://${host}:${process.env.PORT || 3000}`];
  }
  return [`https://${host}`];
}

/* ------------------------------- challenges -------------------------------- */

// Raw bytes, deliberately NOT a string: @simplewebauthn treats a string
// challenge as UTF-8 text and base64url-encodes its BYTES, so passing an
// already-base64url string would make options.challenge the encoding of the
// encoding — and the value the client signs would no longer be the one we
// stored. Handing it a Uint8Array makes options.challenge exactly
// challengeToken()'s first component.
const newChallenge = () => crypto.randomBytes(CHALLENGE_BYTES);
const encodeChallenge = (bytes) => Buffer.from(bytes).toString('base64url');

function challengeMac(scope, challenge, exp) {
  return crypto.createHmac('sha256', accounts.signingSecret())
    .update(`${scope}.${challenge}.${exp}`)
    .digest('base64url');
}

/*
 * `<b64url(challenge)>.<expEpochMs>.<hmac>` — stateless on purpose. There is no
 * pending-challenge table to create, index, clean up or reason about across
 * processes: production overlaps two containers on every deploy
 * (.claude/rules/deploy-invariants-are-pinned-in-code.md), so an in-memory
 * challenge store would refuse ceremonies that started on the other container.
 *
 * base64url uses '-' and '_', never '.', so the separator is unambiguous.
 */
function signChallenge(scope, challenge, ttlMs = CHALLENGE_TTL_MS) {
  const exp = Date.now() + ttlMs;
  return `${challenge}.${exp}.${challengeMac(scope, challenge, exp)}`;
}

// Returns the challenge, or null when the token is malformed, tampered with,
// expired, or was issued for the OTHER scope. Never throws: every caller turns
// null into the same 400, so a caller cannot accidentally distinguish the cases.
function verifyChallenge(scope, token) {
  if (!accounts.signingSecret()) return null;
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [challenge, rawExp, mac] = parts;
  if (!challenge || !rawExp || !mac) return null;
  const exp = Number(rawExp);
  if (!Number.isFinite(exp)) return null;
  // Recompute over the RAW exp string, so the comparison is byte-exact rather
  // than re-serializing a parsed number. The signature is checked BEFORE the
  // expiry: a forged token must never be judged on the `exp` it supplied.
  if (!accounts.safeEqual(mac, challengeMac(scope, challenge, rawExp))) return null;
  if (Date.now() > exp) return null;
  return challenge;
}

/* -------------------------------- identities ------------------------------- */

const passkeysOf = (user) => ((user && user.identities) || []).filter((i) => i.type === 'passkey');

const findPasskey = (user, credentialId) =>
  passkeysOf(user).find((p) => p.credentialId === credentialId) || null;

/*
 * What a client may see of a passkey. The stored entry holds the credential's
 * PUBLIC KEY, which is not a secret in the cryptographic sense but is also not
 * the client's business — and, exactly like meProjection in
 * lib/me-projection.js, routing every response through one projection is what
 * stops a field added later from being exposed by accident.
 */
const publicPasskey = (p) => ({
  credentialId: p.credentialId,
  name: p.name || null,
  transports: p.transports || [],
  createdAt: p.createdAt || null,
  lastUsedAt: p.lastUsedAt || null,
});

// Trim to a storable label; an empty or absent name stays null so the client
// renders its own localized fallback rather than the server inventing German.
function cleanName(raw) {
  const name = String(raw == null ? '' : raw).trim().slice(0, PASSKEY_NAME_MAX);
  return name || null;
}

module.exports = {
  CHALLENGE_TTL_MS,
  PASSKEY_NAME_MAX,
  SCOPE_REGISTER,
  SCOPE_LOGIN,
  webauthnEnabled,
  rpId,
  rpName,
  expectedOrigins,
  newChallenge,
  encodeChallenge,
  signChallenge,
  verifyChallenge,
  passkeysOf,
  findPasskey,
  publicPasskey,
  cleanName,
};
