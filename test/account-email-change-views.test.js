'use strict';

/* The address-change UI (#1076): the Konto section and the /e landing.
 *
 * Views are RUN through the jsdom harness, not source-matched
 * (.claude/rules/testing-views-under-jsdom.md): every assertion here is about a
 * decision taken at render time — which state the section is in, whether a demo
 * sees it at all, and which endpoint the landing posts to.
 *
 * The route half is test/account-email-change.test.js; this file deliberately
 * stubs `accountApi` so it never reaches one.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, translator } = require('./support/dom');

const T = translator('de');

const ME = {
  id: 'u1', email: 'ada@example.com', username: 'ada', emailVerified: true,
  createdAt: '2026-01-01T00:00:00Z', bggUsername: null, avatar: null,
  pendingEmail: null, demo: false,
};

async function konto(t, over = {}, api) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('accountApi', api || (async () => ({ ...ME, ...over })));
  await dom.call('showAccount');
  return dom;
}

const section = (dom) => {
  const h2 = [...dom.app.querySelectorAll('.konto-section__h')]
    .find((x) => x.textContent === T('konto.email.title'));
  return h2 ? h2.nextElementSibling : null;
};

/* ------------------------------- the section ------------------------------- */

test('the section offers both fields, and the password one is a password field', async (t) => {
  const dom = await konto(t);
  const el = section(dom);
  assert.ok(el, 'the Konto screen has no address-change section');

  const next = el.querySelector('#keNew');
  const current = el.querySelector('#keCurrent');
  assert.equal(next.getAttribute('type'), 'email');
  assert.equal(next.getAttribute('autocomplete'), 'email');
  assert.equal(current.getAttribute('type'), 'password');
  assert.equal(current.getAttribute('autocomplete'), 'current-password',
    'the manager must offer the CURRENT password here, not a new one');
  // Both fields are labelled, not placeholder-only (WCAG 2.2 SC 3.3.2/4.1.2).
  for (const input of [next, current]) {
    assert.ok(el.querySelector(`label[for="${input.id}"]`), `${input.id} has no <label for>`);
  }
  assert.equal(el.querySelector('button[type=submit]').textContent, T('konto.email.submit'));
});

test('a demo account is not offered the section at all', async (t) => {
  /* Structurally unusable rather than merely refused: a demo's stored address is
     a synthetic placeholder and it holds no password identity, so the route
     answers 403 and the form could only ever fail. Same call the password form
     one section down already makes. */
  const dom = await konto(t, { demo: true });
  assert.equal(section(dom), null);
  assert.ok(!dom.app.textContent.includes(T('konto.email.title')));
});

test('a pending change shows the address, and the form becomes a resend', async (t) => {
  const dom = await konto(t, { pendingEmail: 'new@example.com' });
  const el = section(dom);
  assert.match(el.textContent, /new@example\.com/,
    'the pending address is not shown — the only way to spot a typo, since a taken address answers ok');
  assert.equal(el.querySelector('button[type=submit]').textContent, T('konto.email.resend'));
  assert.equal(el.querySelector('#keNew').value, 'new@example.com',
    'the address is not prefilled, so a resend is two fields instead of one');
  assert.ok([...el.querySelectorAll('button')].some((b) => b.textContent === T('konto.email.cancel')),
    'no way to cancel a pending change');
});

test('submitting requests the change and switches the section into the pending state', async (t) => {
  const calls = [];
  const dom = await konto(t, {}, async (method, path, body) => {
    calls.push([method, path, body]);
    if (path === '/me') return ME;
    return { ok: true, pendingEmail: 'typo@example.com' };
  });
  const el = section(dom);
  el.querySelector('#keNew').value = 'typo@example.com';
  el.querySelector('#keCurrent').value = 'correct horse battery';
  el.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));

  const sent = calls.find(([, p]) => p === '/change-email');
  assert.ok(sent, 'nothing was posted to /change-email');
  // Field by field, not deepEqual: the body is built inside the harness's `vm`
  // context, so its prototype is a different realm's and deepStrictEqual reports
  // "same structure but not reference-equal" for a body that is exactly right.
  assert.equal(sent[2].email, 'typo@example.com');
  assert.equal(sent[2].currentPassword, 'correct horse battery');
  assert.deepEqual(Object.keys(sent[2]).sort(), ['currentPassword', 'email'],
    'the request carries a field beyond the two the route reads');
  // It re-renders from the ECHOED address, so what is shown is what the server
  // stored rather than what is still sitting in the field.
  assert.match(section(dom).textContent, /typo@example\.com/);
  assert.equal(section(dom).querySelector('button[type=submit]').textContent, T('konto.email.resend'));
});

test('an empty field costs no request, and a refusal is worded per code', async (t) => {
  const calls = [];
  const dom = await konto(t, {}, async (method, path) => {
    calls.push(path);
    if (path === '/me') return ME;
    throw new Error('invalid_credentials');
  });
  const el = section(dom);
  const form = el.querySelector('form');
  const fire = () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

  fire();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(!calls.includes('/change-email'), 'an empty form cost a request and an Argon2 verify');
  assert.equal(el.querySelector('.konto-error').textContent, T('auth.error.missing'));

  el.querySelector('#keNew').value = 'new@example.com';
  el.querySelector('#keCurrent').value = 'wrong';
  fire();
  await new Promise((r) => setTimeout(r, 0));
  // `invalid_credentials` here means the CURRENT PASSWORD was wrong, not the
  // login — so it borrows change-password's wording, not login's.
  assert.equal(el.querySelector('.konto-error').textContent, T('konto.pw.wrongCurrent'));
  // …and the button is usable again, or one slip ends the interaction.
  assert.equal(el.querySelector('button[type=submit]').disabled, false);
});

test('each refusal code has its own wording — none falls through to "network"', async (t) => {
  const dom = await konto(t);
  const network = T('auth.error.network');
  for (const code of ['invalid_credentials', 'invalid_email', 'same_email', 'demo_account']) {
    const key = dom.run(`authErrorKey('changeEmail', '${code}')`);
    assert.notEqual(T(key), network, `${code} falls through to the generic network error`);
    assert.notEqual(T(key), key, `${key} is not translated`);
  }
  // Anti-vacuous: something genuinely unmapped still reaches the generic text.
  assert.equal(T(dom.run("authErrorKey('changeEmail', 'something_else')")), network);
});

/* ------------------------------- the landing ------------------------------- */

test('/e posts the token to confirm-email and titles the outcome', async (t) => {
  const posts = [];
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('authFetch', async (path, body) => { posts.push([path, body]); return { ok: true }; });
  dom.window.history.replaceState({}, '', '/e?t=e1.abc.secret');
  await dom.call('renderEmailChangeLanding');
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(posts.length, 1);
  assert.equal(posts[0][0], '/confirm-email');
  // Cross-realm again — see the note in the section test above.
  assert.equal(posts[0][1].token, 'e1.abc.secret');
  assert.equal(dom.document.querySelector('.auth__title').textContent, T('auth.emailChange.okTitle'));
  assert.equal(dom.document.querySelector('#emailChangeMsg').textContent, T('auth.emailChange.okSub'));
});

test('a refused link says to request the change again — and offers NO resend', async (t) => {
  /* `buildResend` resends a VERIFICATION by address, which is a different thing:
     this landing knows only a token, never which account or which address, so
     there is nothing it could resend. The verification landing's failure branch
     has one; this one must not. */
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('authFetch', async () => ({ ok: false }));
  dom.window.history.replaceState({}, '', '/e?t=e1.abc.bad');
  await dom.call('renderEmailChangeLanding');
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(dom.document.querySelector('.auth__title').textContent, T('auth.emailChange.failTitle'));
  assert.equal(dom.document.querySelector('#emailChangeMsg').textContent, T('auth.emailChange.failSub'));
  assert.equal(dom.document.querySelector('#resendHost'), null, 'the landing offers a resend it cannot perform');
  assert.equal(dom.document.querySelector('#toLogin').hidden, false, 'no way off the screen');
});

test('a bare /e with no token posts nothing and fails closed', async (t) => {
  const posts = [];
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('authFetch', async (p) => { posts.push(p); return { ok: true }; });
  dom.window.history.replaceState({}, '', '/e');
  await dom.call('renderEmailChangeLanding');
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(posts, [], 'a tokenless landing still called the endpoint');
  assert.equal(dom.document.querySelector('.auth__title').textContent, T('auth.emailChange.failTitle'));
});
