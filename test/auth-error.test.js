'use strict';

/*
 * The auth-form error mapping (#399). The bug it pins down: the auth routes are
 * also answered by the rate limiter (429 `rate_limited`) and, in layered mode,
 * the shared-password gate (401 `auth_required`) — and the old per-form
 * fallbacks rendered those as "password too short" (register) or "wrong
 * credentials" (login). Unknown codes must fall back to the generic message.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { authErrorKey, AUTH_ERROR_KEYS } = require('../public/js/auth-error');

// Same tiny vm sandbox as test/i18n-parity.test.js: the lang files are plain
// browser scripts registering into a global I18N.
function loadLocale(name) {
  const file = path.join(__dirname, '..', 'public', 'js', 'lang', `${name}.js`);
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.I18N[name];
}

test('rate_limited and auth_required outrank every per-form mapping', () => {
  for (const kind of ['register', 'login', 'forgot', 'reset']) {
    assert.equal(authErrorKey(kind, 'rate_limited'), 'auth.error.rateLimited');
    assert.equal(authErrorKey(kind, 'auth_required'), 'auth.error.sessionExpired');
  }
});

test('per-form codes map to their specific messages', () => {
  assert.equal(authErrorKey('register', 'invalid_email'), 'auth.error.invalidEmail');
  assert.equal(authErrorKey('register', 'invalid_username'), 'auth.error.invalidUsername');
  assert.equal(authErrorKey('register', 'invalid_password'), 'auth.error.shortPassword');
  assert.equal(authErrorKey('register', 'username_taken'), 'auth.error.usernameTaken');
  assert.equal(authErrorKey('login', 'invalid_credentials'), 'auth.error.badCredentials');
  assert.equal(authErrorKey('login', 'email_not_verified'), 'auth.error.notVerified');
  assert.equal(authErrorKey('login', 'account_disabled'), 'auth.error.accountDisabled');
  assert.equal(authErrorKey('reset', 'invalid_token'), 'auth.reset.invalid');
  assert.equal(authErrorKey('reset', 'invalid_password'), 'auth.error.shortPassword');
});

test('an unknown code falls back to the generic message, never a field claim', () => {
  assert.equal(authErrorKey('register', undefined), 'auth.error.network');
  assert.equal(authErrorKey('register', 'some_future_code'), 'auth.error.network');
  assert.equal(authErrorKey('login', undefined), 'auth.error.network');
  assert.equal(authErrorKey('forgot', 'accounts_disabled'), 'auth.error.network');
  assert.equal(authErrorKey('no-such-form', 'invalid_password'), 'auth.error.network');
});

test('every key the mapping can return exists in both language files', () => {
  const en = loadLocale('en');
  const de = loadLocale('de');
  const keys = new Set(['auth.error.rateLimited', 'auth.error.sessionExpired', 'auth.error.network']);
  for (const table of Object.values(AUTH_ERROR_KEYS)) {
    for (const key of Object.values(table)) keys.add(key);
  }
  for (const key of keys) {
    assert.ok(en[key], `en.js is missing ${key}`);
    assert.ok(de[key], `de.js is missing ${key}`);
  }
});
