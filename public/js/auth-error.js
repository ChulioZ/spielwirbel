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
