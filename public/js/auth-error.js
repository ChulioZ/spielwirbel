/* Spielwirbel – auth-form error mapping (#399). Pure and dependency-free, so it
   works both as a shared-scope frontend script (browser global) and as a
   CommonJS module the test suite can require. Load order: see index.html. */

'use strict';

// The auth routes are answered by more than their own handlers: the auth rate
// limiter (429 `rate_limited`) and, in layered mode, the shared-password gate
// (401 `auth_required`) reply on the same URLs. So an unknown code must fall
// back to a GENERIC message — the old per-form defaults claimed "password too
// short" (register) or "wrong credentials" (login) for a plain 429.
const AUTH_ERROR_KEYS = {
  register: {
    invalid_email: 'auth.error.invalidEmail',
    invalid_username: 'auth.error.invalidUsername',
    invalid_password: 'auth.error.shortPassword',
    username_taken: 'auth.error.usernameTaken',
    // Well-formed and free, but refused as an impersonation risk. It needs its
    // own message: "already taken" would send the person off inventing variants
    // of a handle no variant of which will be accepted.
    username_reserved: 'auth.error.reservedUsername',
  },
  login: {
    invalid_credentials: 'auth.error.badCredentials',
    email_not_verified: 'auth.error.notVerified',
    account_disabled: 'auth.error.accountDisabled',
  },
  reset: {
    invalid_token: 'auth.reset.invalid',
    invalid_password: 'auth.error.shortPassword',
  },
  // The logged-IN password change (#482). `invalid_credentials` means the
  // CURRENT password was wrong, not the login — so it needs its own wording
  // rather than login's "Anmeldedaten oder Passwort sind falsch".
  changePassword: {
    invalid_credentials: 'konto.pw.wrongCurrent',
    invalid_password: 'auth.error.shortPassword',
  },
  // Self-service account deletion (#419). `tenant_shared` is a real refusal, not
  // a fault: the erasure would cascade a tenant a second account still lives on,
  // so it must read as an explained "not this way" rather than a generic error.
  deleteAccount: {
    invalid_credentials: 'konto.delete.wrongPassword',
    confirm_mismatch: 'konto.delete.mismatch',
    tenant_shared: 'konto.delete.tenantShared',
  },
  // Passkey login (#418). `invalid_credentials` is deliberately the SAME answer
  // for an unknown credential, a bad challenge and a refused assertion — the
  // route cannot distinguish them without telling a stranger that the
  // credential they tried is real — so it needs wording that does not blame the
  // password the user never typed.
  passkeyLogin: {
    invalid_credentials: 'auth.passkey.error.noMatch',
    account_disabled: 'auth.error.accountDisabled',
  },
  // Registering a passkey from the Konto screen (#418).
  passkey: {
    quota_passkeys: 'konto.passkey.error.quota',
    passkey_exists: 'konto.passkey.error.exists',
    passkey_taken: 'konto.passkey.error.taken',
    invalid_passkey: 'konto.passkey.error.invalid',
    invalid_challenge: 'konto.passkey.error.invalid',
    demo_forbidden: 'konto.passkey.error.demo',
  },
  // 'forgot' and 'resend' have no per-form codes: their handlers always answer
  // ok (anti-enumeration), so only the cross-cutting codes below can reach them.
};

// Map a failed auth call to the i18n key of an honest error message.
// `kind` names the form ('register' | 'login' | 'forgot' | 'reset');
// `code` is the server's `error` field (may be undefined for a non-JSON body).
function authErrorKey(kind, code) {
  if (code === 'rate_limited') return 'auth.error.rateLimited';
  if (code === 'auth_required') return 'auth.error.sessionExpired';
  return (AUTH_ERROR_KEYS[kind] || {})[code] || 'auth.error.network';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { authErrorKey, AUTH_ERROR_KEYS };
}
