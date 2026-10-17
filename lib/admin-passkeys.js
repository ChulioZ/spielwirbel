'use strict';

/*
 * The operator panel's passkey second factor (#1670).
 *
 * The panel's powers are all cross-tenant, and until this change one secret
 * (ADMIN_PASSWORD) stood between the public internet and them. Now the password
 * is step one of two: it buys a short-lived PASSWORD-STEP TOKEN, and only a
 * passkey assertion verified against an enrolled admin credential mints the
 * `aid` session (lib/admin.js).
 *
 * The password-step token IS the signed authentication challenge. Binding the
 * two means the challenge an attacker would need to sign can only be obtained
 * by passing the password first, and there is one token to reason about rather
 * than a password token plus a separate challenge token that must be checked to
 * belong together.
 *
 * Domain separation, the property every token in this app is built around:
 *  - its own SCOPES (`wa.admin.auth` / `wa.admin.reg`), never the account
 *    ceremonies' `wa.auth` / `wa.reg` — an account login or registration
 *    challenge must not verify here, nor the other way round;
 *  - signed with admin.signingSecret(), not accounts.signingSecret(): the admin
 *    surface works in every mode, so it cannot depend on SESSION_SECRET;
 *  - a 3-part `<challenge>.<exp>.<mac>` token whose mac covers the scope, so it
 *    can never verify as an `aid` token (`a2.<exp>.<mac>` over `admin.a2.<exp>`)
 *    and an `aid` never verifies as it. test/admin-passkeys.test.js crosses
 *    every pair.
 *
 * Gated on admin.adminEnabled() ONLY — not webauthn.webauthnEnabled(), which is
 * the accounts switch: the operator is not an account and the panel exists in
 * every mode. The RP ID and origins are the account passkeys' own (#418): the
 * same frozen canonical host.
 *
 * The credentials are a GLOBAL, non-tenant store (repo.listAdminPasskeys & co.),
 * absent from TENANT_METHODS like every other admin method.
 */

const webauthn = require('./webauthn');
const admin = require('./admin');

const SCOPE_LOGIN = 'wa.admin.auth';
const SCOPE_ENROLL = 'wa.admin.reg';

const sign = (scope, challenge) => webauthn.signChallengeWith(admin.signingSecret(), scope, challenge);
const verify = (scope, token) => webauthn.verifyChallengeWith(admin.signingSecret(), scope, token);

// The library hands `transports` through raw from the client; bound it to what
// it claims to be, exactly as lib/routes/passkeys.js does for account keys.
const sanitizeTransports = (raw) => (Array.isArray(raw)
  ? raw.filter((t) => typeof t === 'string' && t.length <= 32).slice(0, 10)
  : []);

// What the panel may see of an admin credential — never the public key.
const publicAdminPasskey = (p) => ({
  credentialId: p.credentialId,
  name: p.name || null,
  createdAt: p.createdAt || null,
  lastUsedAt: p.lastUsedAt || null,
});

// The record a verified registration stores. Every key present (null when
// unset) for absent-key parity between the two backends.
function storedFromRegistration(cred, name) {
  return {
    credentialId: cred.id,
    publicKey: Buffer.from(cred.publicKey).toString('base64url'),
    counter: cred.counter || 0,
    transports: sanitizeTransports(cred.transports),
    name: webauthn.cleanName(name),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
}

module.exports = {
  SCOPE_LOGIN,
  SCOPE_ENROLL,
  signLoginStep: (challenge) => sign(SCOPE_LOGIN, challenge),
  verifyLoginStep: (token) => verify(SCOPE_LOGIN, token),
  signEnrollChallenge: (challenge) => sign(SCOPE_ENROLL, challenge),
  verifyEnrollChallenge: (token) => verify(SCOPE_ENROLL, token),
  publicAdminPasskey,
  storedFromRegistration,
};
