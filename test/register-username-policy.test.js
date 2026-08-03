'use strict';

/* The register form's own copy of the username policy, driven in jsdom.
 *
 * The server is the authority (test/account.test.js pins it), so what is worth
 * asserting here is only what the server cannot: that the form applies the SAME
 * shape and reserved-list rules WITHOUT a round trip, and says which of the three
 * username refusals it was. A guard that quietly fell through would still be
 * caught by the route — with a message the client maps correctly — so nothing
 * else in the suite would go red while the person typing waited on a needless
 * request.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { USERNAME_MAX } = require('../public/js/username-policy');

// Render the register screen with the account layer stubbed to "accounts on,
// logged out" — the state `authScreensAvailable()` demands, and the only reason
// showRegister() would otherwise bail to the home view.
function registerForm(locale) {
  const ui = loadApp({ locale });
  const sent = [];
  ui.set('accountsActive', () => true);
  ui.set('isLoggedIn', () => false);
  // Memoized /api/config, read to reveal the legal line (#520). Left unfetched.
  ui.set('withAppConfig', (cb) => cb({ footer: false }));
  // Never resolves: the submit path is exercised only up to the call itself, so
  // no spec here has to stub the success screen that would follow.
  ui.set('authFetch', (path, body) => { sent.push({ path, body }); return new Promise(() => {}); });
  ui.call('showRegister');

  const card = ui.app.querySelector('.auth__card');
  assert.ok(card, 'the register card did not render');
  const submit = (username) => {
    card.querySelector('#regEmail').value = 'someone@example.com';
    card.querySelector('#regUser').value = username;
    card.querySelector('#regPw').value = 'correct horse battery';
    card.closest('.auth').querySelector('form')
      .dispatchEvent(new ui.window.Event('submit', { bubbles: true, cancelable: true }));
  };
  const error = () => card.querySelector('.auth__error');
  return { ui, sent, submit, error, close: () => ui.close() };
}

test('a reserved handle is refused on the form, before any request goes out', () => {
  const form = registerForm('de');
  try {
    form.submit('Spielwirbel-Team');
    assert.deepEqual(form.sent, [], 'the form must not ask the server about a handle it already knows is refused');
    assert.equal(form.error().hidden, false);
    assert.equal(form.error().textContent, form.ui.run("t('auth.error.reservedUsername')"));
    // Not the message for the OTHER two username refusals: "already taken" would
    // send the person off inventing variants, all of which are refused too.
    assert.notEqual(form.error().textContent, form.ui.run("t('auth.error.usernameTaken')"));
    assert.notEqual(form.error().textContent, form.ui.run("t('auth.error.invalidUsername')"));
  } finally { form.close(); }
});

test('the field is capped, and a malformed handle is refused, from the shared policy', () => {
  const form = registerForm('de');
  try {
    // The `maxlength` used to be a hand-written "30" beside a hand-copied regex
    // beside two hint strings saying "3–30". All four read the constant now.
    assert.equal(form.ui.app.querySelector('#regUser').getAttribute('maxlength'), String(USERNAME_MAX));
    // The hint below the field is the other call site that has to pass the params.
    // Nothing else can see it: t() returns the raw '{min}–{max}' when a caller
    // forgets, which renders as a plausible-looking string.
    const hint = form.ui.app.querySelector('#regUser').parentElement.querySelector('.field__hint');
    assert.ok(!hint.textContent.includes('{'), `the hint has an unfilled placeholder: ${hint.textContent}`);
    assert.ok(hint.textContent.includes(String(USERNAME_MAX)), 'the hint lost the bound');
    form.submit('has space');
    assert.deepEqual(form.sent, []);
    assert.equal(form.error().textContent, form.ui.run("t('auth.error.invalidUsername', { min: USERNAME_MIN, max: USERNAME_MAX })"));
    assert.ok(form.error().textContent.includes(String(USERNAME_MAX)), 'the bound is missing from the message');
  } finally { form.close(); }
});

test('an ordinary handle still reaches the server', () => {
  // The anti-vacuous half: a form that submitted nothing at all — a broken
  // listener, a guard that rejected everything — would satisfy the spec above.
  const form = registerForm('de');
  try {
    form.submit('badminton');
    assert.equal(form.sent.length, 1);
    assert.equal(form.sent[0].path, '/register');
    assert.equal(form.sent[0].body.username, 'badminton');
    assert.equal(form.error().hidden, true);
  } finally { form.close(); }
});

test('the refusal is localized, not an English string in a German form', () => {
  for (const locale of ['de', 'en']) {
    const form = registerForm(locale);
    try {
      form.submit('admin');
      assert.equal(form.error().textContent, form.ui.run("t('auth.error.reservedUsername')"));
      assert.ok(form.error().textContent.length > 10, `no message rendered in ${locale}`);
    } finally { form.close(); }
  }
});
