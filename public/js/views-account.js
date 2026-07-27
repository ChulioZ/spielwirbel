/* Spielwirbel – Konto settings view (issue #482). The app's first account
   settings screen: the identity it holds (e-mail + username, both read-only)
   and a change-password form.

   Why it exists: until #482 a logged-in user could not change their password at
   all — the only handlers were the logged-OUT recovery pair (forgot/reset), so
   wanting a new password meant logging out, claiming to have forgotten it, and
   waiting for mail. The screen is also where #418 (passkeys) and #419 (account
   deletion) will hang their sections.

   The username is deliberately not editable (#320: it is a public handle other
   accounts address invitations and friend requests to), and neither is the
   e-mail — changing it needs a re-verification flow that is out of scope here.

   Account-mode only: a logged-out visitor (or legacy mode) is sent home rather
   than shown an empty shell. Part of the shared frontend scope — loads after
   account.js/core.js and uses their helpers (accountApi/isLoggedIn/
   accountsActive/setTokens, h/esc/app/t/toast, syncUrl/setContext/
   applyBackground, authErrorKey). */

'use strict';

async function showAccount() {
  // A per-account surface; without an account there is nothing to show.
  if (!(accountsActive() && isLoggedIn())) return showHome();
  currentView = () => showAccount();
  syncUrl('/konto');
  setContext(t('konto.title'));
  applyBackground(null);
  app.innerHTML = '<p class="muted">…</p>';

  // /me rather than the cached `accountUser`: it is the authoritative record and
  // the read also proves the session before a password form is offered.
  let me;
  try {
    me = await accountApi('GET', '/me');
  } catch { return; } // accountApi already handled a dead session (→ login)

  app.innerHTML = '';
  app.appendChild(h(`<div class="lobby-head"><h1>${esc(t('konto.title'))}</h1></div>`));

  app.appendChild(h(`<h2 class="konto-section__h">${esc(t('konto.identity'))}</h2>`));
  const facts = h('<div class="konto-facts"></div>');
  facts.appendChild(renderKontoFact(t('auth.email'), me.email));
  facts.appendChild(renderKontoFact(t('auth.username'), me.username || '—'));
  app.appendChild(facts);

  app.appendChild(h(`<h2 class="konto-section__h">${esc(t('konto.pw.title'))}</h2>`));
  app.appendChild(buildPasswordForm());
}

// One read-only label/value pair. Not a .ds-row: that component is a click
// target (cursor: pointer) and these rows do nothing.
function renderKontoFact(label, value) {
  return h(`<div class="konto-fact">
      <span class="konto-fact__label">${esc(label)}</span>
      <span class="konto-fact__value">${esc(value)}</span>
    </div>`);
}

// The change-password form. Current password + new password, matching the route:
// a valid access token alone must not be enough to replace the credential.
function buildPasswordForm() {
  const form = h(`<form class="konto-pw">
      <div class="field">
        <label for="kpCurrent">${esc(t('konto.pw.current'))}</label>
        <input id="kpCurrent" class="input" type="password" autocomplete="current-password" />
      </div>
      <div class="field">
        <label for="kpNew">${esc(t('konto.pw.new'))}</label>
        <input id="kpNew" class="input" type="password" autocomplete="new-password" />
        <p class="field__hint muted">${esc(t('auth.register.pwHint'))}</p>
      </div>
      <p class="konto-error" hidden></p>
      <button class="btn btn--primary" type="submit">${esc(t('konto.pw.submit'))}</button>
    </form>`);

  const current = form.querySelector('#kpCurrent');
  const next = form.querySelector('#kpNew');
  const err = form.querySelector('.konto-error');
  const submit = form.querySelector('button[type=submit]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    // Client-side checks first so an obvious slip costs no request (and no
    // Argon2 verify on the server).
    if (!current.value || !next.value) return setKontoError(err, t('auth.error.missing'));
    if (next.value.length < 8) return setKontoError(err, t('auth.error.shortPassword'));
    submit.disabled = true;
    try {
      const data = await accountApi('POST', '/change-password', {
        currentPassword: current.value,
        newPassword: next.value,
      });
      // The change revoked every other session; the route hands the caller a
      // fresh pair so the person who just changed it stays signed in here.
      setTokens(data.accessToken, data.refreshToken);
      current.value = '';
      next.value = '';
      toast(t('konto.pw.done'));
    } catch (ex) {
      // 'auth' means accountApi already bounced a dead session to login.
      if (ex.message !== 'auth') setKontoError(err, t(authErrorKey('changePassword', ex.message)));
    }
    submit.disabled = false;
  });

  return form;
}

function setKontoError(el, message) {
  el.textContent = message;
  el.hidden = false;
}
