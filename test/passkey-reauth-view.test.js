'use strict';

/* The Konto screen's passkey enrolment asks for the current password (#1741).
 *
 * Run through the jsdom harness (.claude/rules/testing-views-under-jsdom.md):
 * the assertions are about what the view SENDS — the route half, which refuses a
 * missing or wrong password on both calls, is test/passkeys.test.js. Here
 * `accountApi` and the platform ceremony are stubbed.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, translator, flush } = require('./support/dom');

const T = translator('de');

const ME = {
  id: 'u1', email: 'ada@example.com', username: 'ada', emailVerified: true,
  createdAt: '2026-01-01T00:00:00Z', bggUsername: null, avatar: null,
  pendingEmail: null, demo: false,
};

// A REAL timer: the sheet closes through history.back(), and jsdom's popstate
// is out of setImmediate's reach (.claude/rules/jsdom-popstate-needs-a-real-timer.md).
const settle = async (dom) => {
  for (let i = 0; i < 6; i++) await new Promise((r) => dom.window.setTimeout(r, 0));
};

async function konto(t, onPost) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // Phone width: the prompt is a sheet (jsdom has no matchMedia of its own).
  dom.run('window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });');
  const calls = [];
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('passkeysSupported', () => true);
  dom.set('createPasskey', async () => ({ id: 'cred-new', type: 'public-key' }));
  dom.set('accountApi', async (method, path, body) => {
    calls.push({ method, path, body: body ? { ...body } : body });
    if (method === 'GET' && path === '/passkeys') return { passkeys: [] };
    if (method === 'POST' && path.startsWith('/passkeys')) return onPost(path, body);
    return { ...ME };
  });
  await dom.call('showAccount');
  await flush();
  return { dom, calls };
}

const addButton = (dom) => dom.app.querySelector('.konto-passkeys__add');
const dialogInput = (dom) => dom.document.querySelector('#kpkCurrent');
const posts = (calls) => calls.filter((c) => c.method === 'POST');

test('adding a passkey opens a password prompt first and sends nothing yet', async (t) => {
  const { dom, calls } = await konto(t, () => assert.fail('no request before the password'));
  addButton(dom).click();
  await flush();

  const input = dialogInput(dom);
  assert.ok(input, 'no password prompt opened');
  assert.equal(input.getAttribute('type'), 'password');
  assert.equal(input.getAttribute('autocomplete'), 'current-password');
  assert.ok(dom.document.querySelector('label[for="kpkCurrent"]'), 'the field has no <label for>');
  assert.equal(dom.document.activeElement, input, 'focus did not move into the prompt');
  assert.equal(posts(calls).length, 0);

  // An empty submit is caught client-side: no request, a visible error.
  input.closest('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();
  assert.equal(posts(calls).length, 0);
  assert.equal(input.closest('form').querySelector('.konto-error').textContent, T('auth.error.missing'));
  await settle(dom);
});

test('the password rides on BOTH calls, and a success closes the prompt and lists the passkey', async (t) => {
  const { dom, calls } = await konto(t, (path) => (path === '/passkeys/options'
    ? { options: { challenge: 'c' }, challenge: 'c.1.m' }
    : { passkeys: [{ credentialId: 'cred-new', name: null, createdAt: '2026-10-28T00:00:00Z', lastUsedAt: null }] }));
  addButton(dom).click();
  await flush();
  dialogInput(dom).value = 'correct horse battery';
  dialogInput(dom).closest('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();
  await flush();

  const [options, verify] = posts(calls);
  assert.equal(options.path, '/passkeys/options');
  assert.equal(options.body.currentPassword, 'correct horse battery');
  assert.equal(verify.path, '/passkeys');
  assert.equal(verify.body.currentPassword, 'correct horse battery',
    'the verify is checked server-side too — without the password it 401s');
  assert.equal(verify.body.challenge, 'c.1.m');

  await settle(dom);
  assert.equal(dialogInput(dom), null, 'the prompt is still open after a successful enrolment');
  assert.equal(dom.app.querySelectorAll('.konto-passkeys .konto-passkey__name').length, 1);
});

test('a wrong password is reported INSIDE the prompt, which stays open', async (t) => {
  const { dom, calls } = await konto(t, () => { throw new Error('invalid_credentials'); });
  addButton(dom).click();
  await flush();
  dialogInput(dom).value = 'wrong';
  const form = dialogInput(dom).closest('form');
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();
  await flush();

  assert.equal(posts(calls).length, 1, 'the ceremony went on after a refused password');
  assert.ok(dialogInput(dom), 'the prompt closed on a wrong password');
  assert.equal(form.querySelector('.konto-error').textContent, T('konto.pw.wrongCurrent'));
  assert.equal(form.querySelector('button[type=submit]').disabled, false, 'the submit stays disabled — no retry');
  await settle(dom);
});
