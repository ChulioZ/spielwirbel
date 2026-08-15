'use strict';

/*
 * Passkey (WebAuthn) endpoints (issue #418), mounted under /api/account/passkeys
 * in createApp() — ahead of the shared-password gate like the rest of
 * /api/account, inside the AUTH_RATE_LIMIT_MAX limiter, and behind
 * requireSharedIfLayered (.claude/rules/accounts-mode-gate.md). Every handler
 * 404s `accounts_disabled` unless accounts are on, so a password-only instance
 * is behaviourally unchanged.
 *
 * Crypto primitives and challenge signing live in lib/webauthn.js; the
 * attestation/assertion verification itself is @simplewebauthn/server's.
 *
 * The two /login endpoints are UNAUTHENTICATED by necessity — usernameless
 * login has no session yet. They are also deliberately blind: neither reveals
 * whether any account, address or credential exists, because an e-mail-first
 * passkey flow would have to answer "does this address have credentials?" and
 * regress the anti-enumeration invariants register and forgot-password are
 * built around (.claude/rules/user-accounts.md).
 *
 * Route shape note: the issue sketched the login pair at
 * /api/account/passkey-login. They live under /api/account/passkeys/login
 * instead, so the whole feature is ONE mount. Mounting a second router on
 * /api/account would run authLimiter twice for every account request (each
 * mount invokes it), silently halving AUTH_RATE_LIMIT_MAX for login, register
 * and refresh — a real regression to buy a nicer URL on a private API.
 */

const express = require('express');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const repo = require('../repo');
const accounts = require('../accounts');
const webauthn = require('../webauthn');
const quota = require('../quota');
const demo = require('../demo');
// What a client may see about an account — the same projection GET /me answers.
// The client seats `accountUser` straight from the login response, so anything
// missing here is `undefined` for the whole session: that is why the terms-change
// notice (#521) had to be added by hand, and why the response now carries the
// full projection instead of a fourth remembered field (#785).
const { meProjection } = require('../me-projection');
const { logger } = require('../observability');

const router = express.Router({ mergeParams: true });

const iso = (ms) => new Date(ms).toISOString();

// The whole feature is env-gated, exactly like the account router: a 404 keeps
// the surface invisible on a deployment that has not opted in.
router.use((req, res, next) => {
  if (!webauthn.webauthnEnabled()) return res.status(404).json({ error: 'accounts_disabled' });
  next();
});

// Load the caller's account. A signature-valid token can outlive the row it
// names (erasure, #273/#419), so every handler re-reads rather than trusting
// req.userId — .claude/rules/erased-account-token-fallback.md.
async function loadUser(req, res) {
  const user = await repo.getUserById(req.userId);
  if (!user) {
    res.status(401).json({ error: 'invalid_token' });
    return null;
  }
  return user;
}

const listOf = (user) => webauthn.passkeysOf(user).map(webauthn.publicPasskey);

// The one client-shaped value that reaches the store: the library passes
// `transports` through RAW from the client's response with no runtime shape
// check (verifyRegistrationResponse just forwards response.response.transports).
// Everything else stored below comes from the library's PARSED attestation, so
// this is where S-014's "hostile input must not reach the store unchecked"
// applies. Sanitize to what it claims to be — a short list of short transport
// names ('internal', 'hybrid', 'usb', …) — rather than allowlisting the names
// themselves, which the spec extends over time.
const sanitizeTransports = (raw) => (Array.isArray(raw)
  ? raw.filter((t) => typeof t === 'string' && t.length <= 32).slice(0, 10)
  : []);

// updateUser replaces whole top-level keys, so `identities` is always written
// COMPLETE — never appended to (.claude/rules/user-accounts.md).
const writeIdentities = (user, identities) => repo.updateUser(user.id, { identities });

/* ------------------------------ registration ------------------------------- */

router.post('/options', accounts.requireUser, demo.refuseDemoAccount, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;

  const existing = webauthn.passkeysOf(user);
  // Checked here as well as on the verify below, so the ceremony is refused
  // before the OS prompts for a fingerprint rather than after.
  if (quota.enforced() && existing.length >= quota.passkeysPerUser()) {
    return res.status(403).json({ error: 'quota_passkeys', limit: quota.passkeysPerUser() });
  }

  const options = await generateRegistrationOptions({
    rpName: webauthn.rpName(),
    rpID: webauthn.rpId(),
    // What the authenticator shows in its own credential list. The username is
    // the public handle; the e-mail is the fallback for the (impossible today)
    // account without one.
    userName: user.username || user.email,
    userDisplayName: user.username || '',
    // The account id, as bytes. Never the e-mail: this value is stored by the
    // authenticator and synced through the platform's keychain.
    userID: Buffer.from(user.id, 'utf8'),
    challenge: webauthn.newChallenge(),
    attestationType: 'none',
    // So an authenticator that already holds a passkey for this account says so
    // instead of silently minting a duplicate.
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      transports: p.transports || [],
    })),
    authenticatorSelection: {
      // LOAD-BEARING. Usernameless login sends allowCredentials: [], so the
      // authenticator must be able to answer "which credentials do you hold for
      // this RP?" on its own — which only a DISCOVERABLE (resident) credential
      // can. Without this an authenticator may legitimately create a
      // non-discoverable one: registration succeeds, the passkey appears in the
      // list, and "Mit Passkey anmelden" then never offers it. There is no error
      // to see — the OS sheet simply reports no matching passkey.
      residentKey: 'required',
      requireResidentKey: true, // the CTAP2/legacy spelling; set both
      // 'preferred', not 'required': 'required' refuses a hardware key with no
      // PIN configured, while Touch ID / Windows Hello / mobile biometrics
      // satisfy UV anyway. So this is what keeps hardware keys usable without
      // weakening the common path.
      userVerification: 'preferred',
      // NO authenticatorAttachment, deliberately. 'platform' would exclude
      // hardware keys and the cross-device QR flow; 'cross-platform' would
      // exclude Touch ID itself. Any value here drops a whole device class.
    },
  });

  // The challenge rides back to the client as a signed token rather than into a
  // server-side pending table — see lib/webauthn.js for why it is stateless.
  res.json({
    options,
    challenge: webauthn.signChallenge(webauthn.SCOPE_REGISTER, options.challenge),
  });
});

router.post('/', accounts.requireUser, demo.refuseDemoAccount, async (req, res) => {
  const { response, challenge, name } = req.body || {};
  const expected = webauthn.verifyChallenge(webauthn.SCOPE_REGISTER, challenge);
  // One code for tampered, expired and WRONG-SCOPE (an authentication challenge
  // replayed here). The client cannot act differently on any of them, and a
  // distinct code would confirm which half of a forgery was right.
  if (!expected) return res.status(400).json({ error: 'invalid_challenge' });

  const user = await loadUser(req, res);
  if (!user) return;

  const existing = webauthn.passkeysOf(user);
  if (quota.enforced() && existing.length >= quota.passkeysPerUser()) {
    return res.status(403).json({ error: 'quota_passkeys', limit: quota.passkeysPerUser() });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: expected,
      expectedOrigin: webauthn.expectedOrigins(),
      expectedRPID: webauthn.rpId(),
      // Must match the 'preferred' asked for above. The library DEFAULTS this to
      // true, which would reject exactly the hardware keys the policy above went
      // out of its way to keep working.
      requireUserVerification: false,
    });
  } catch (e) {
    // A malformed or unverifiable response is a 400, not a 500 — the library
    // throws on bad input as well as on a failed check.
    logger.warn({ event: 'passkey_register_rejected', message: e.message });
    return res.status(400).json({ error: 'invalid_passkey' });
  }
  if (!verification.verified) return res.status(400).json({ error: 'invalid_passkey' });

  const cred = verification.registrationInfo.credential;
  // A credential id is globally unique, and login resolves an ACCOUNT from it —
  // so the same id must never sit on two accounts, or which one it logs in
  // becomes storage order. `excludeCredentials` above asks the authenticator to
  // prevent this; this is the check that actually enforces it.
  const claimed = await repo.getUserByCredentialId(cred.id);
  if (claimed) {
    return res.status(409).json({ error: claimed.id === user.id ? 'passkey_exists' : 'passkey_taken' });
  }

  const identities = [...(user.identities || []), {
    type: 'passkey',
    credentialId: cred.id,
    // base64url strings: the library hands back a Uint8Array, and jsonb has no
    // binary type. Every key present (null when unset) for absent-key parity
    // between the two backends (.claude/rules/postgres-backend.md).
    publicKey: Buffer.from(cred.publicKey).toString('base64url'),
    counter: cred.counter || 0,
    transports: sanitizeTransports(cred.transports),
    name: webauthn.cleanName(name),
    createdAt: iso(Date.now()),
    lastUsedAt: null,
  }];
  await writeIdentities(user, identities);

  res.status(201).json({ passkeys: listOf({ identities }) });
});

/* --------------------------------- manage ---------------------------------- */

router.get('/', accounts.requireUser, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  res.json({ passkeys: listOf(user) });
});

router.patch('/:cid', accounts.requireUser, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  // 404 rather than 403 for a credential belonging to someone else: this route
  // must not double as "does this credential id exist?".
  if (!webauthn.findPasskey(user, req.params.cid)) {
    return res.status(404).json({ error: 'passkey_not_found' });
  }
  const name = webauthn.cleanName((req.body || {}).name);
  const identities = (user.identities || []).map((i) =>
    (i.type === 'passkey' && i.credentialId === req.params.cid ? { ...i, name } : i));
  await writeIdentities(user, identities);
  res.json({ passkeys: listOf({ identities }) });
});

router.delete('/:cid', accounts.requireUser, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (!webauthn.findPasskey(user, req.params.cid)) {
    return res.status(404).json({ error: 'passkey_not_found' });
  }
  // Removing the LAST passkey is fine and leaves the account fully usable: the
  // password and the mailed reset link are untouched by this whole feature.
  const identities = (user.identities || [])
    .filter((i) => !(i.type === 'passkey' && i.credentialId === req.params.cid));
  await writeIdentities(user, identities);
  res.json({ passkeys: listOf({ identities }) });
});

/* ------------------------------ passkey login ------------------------------ */

/*
 * Discoverable-credential login. No user is identified and nothing is revealed:
 * the response is byte-identical for every caller, because it depends on
 * nothing but the RP ID and a fresh random challenge. Do NOT add an
 * `allowCredentials` derived from a submitted address — that is the shape this
 * endpoint exists to avoid.
 */
router.post('/login/options', async (req, res) => {
  const options = await generateAuthenticationOptions({
    rpID: webauthn.rpId(),
    // Empty = "any credential you hold for this RP", which is what makes the
    // flow usernameless. It only works because registration pinned
    // residentKey: 'required' above.
    allowCredentials: [],
    userVerification: 'preferred',
    challenge: webauthn.newChallenge(),
  });
  res.json({
    options,
    challenge: webauthn.signChallenge(webauthn.SCOPE_LOGIN, options.challenge),
  });
});

router.post('/login', async (req, res) => {
  const { response, challenge } = req.body || {};
  const expected = webauthn.verifyChallenge(webauthn.SCOPE_LOGIN, challenge);
  // Same generic answer as a wrong password, for the same reason — and note a
  // REGISTRATION challenge presented here fails this check, so the two
  // ceremonies cannot be crossed.
  if (!expected) return res.status(401).json({ error: 'invalid_credentials' });

  const credentialId = String((response || {}).id || '');
  const user = credentialId ? await repo.getUserByCredentialId(credentialId) : null;
  const passkey = user && webauthn.findPasskey(user, credentialId);
  if (!passkey) return res.status(401).json({ error: 'invalid_credentials' });

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: expected,
      expectedOrigin: webauthn.expectedOrigins(),
      expectedRPID: webauthn.rpId(),
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, 'base64url'),
        // The stored counter is what makes a replayed assertion detectable: the
        // library refuses one whose counter has not advanced, but ONLY when the
        // stored value is > 0. Many platform authenticators always report 0 and
        // are exempt by design, not by oversight.
        counter: passkey.counter || 0,
        transports: passkey.transports || [],
      },
      requireUserVerification: false,
    });
  } catch (e) {
    logger.warn({ event: 'passkey_login_rejected', message: e.message });
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (!verification.verified) return res.status(401).json({ error: 'invalid_credentials' });

  // Only revealed once the credential has been proven, so it leaks nothing to
  // an outsider — the same placement as the password login's two checks.
  if (user.disabled) return res.status(403).json({ error: 'account_disabled' });

  // Persist the advanced counter and the last-used stamp. Written as a complete
  // identities array, like every other write here.
  const identities = (user.identities || []).map((i) =>
    (i.type === 'passkey' && i.credentialId === credentialId
      ? { ...i, counter: verification.authenticationInfo.newCounter, lastUsedAt: iso(Date.now()) }
      : i));
  await writeIdentities(user, identities);

  // Exactly what POST /login answers, through the same session-issuing code —
  // including the access cookie, without which /uploads cover images 401 and
  // every cover renders blank (.claude/rules/accounts-mode-gate.md).
  const tokens = await accounts.issueSession({ ...user, identities });
  accounts.setAccessCookie(res, req, tokens.accessToken);
  // The full /me projection, exactly as POST /login answers it — the client
  // seats `accountUser` from whichever endpoint started the session, so a field
  // omitted here is `undefined` for the rest of it (#785).
  res.json({ ok: true, ...tokens, user: meProjection({ ...user, identities }) });
});

module.exports = router;
