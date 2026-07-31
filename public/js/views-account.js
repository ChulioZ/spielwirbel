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
  setDocTitle(t('konto.title'));
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
  // A guest demo (#427) has no e-mail — the stored address is a synthetic,
  // unroutable placeholder that exists only to keep the uniqueness constraint
  // satisfiable. Showing it would invite "why do I have an address I never
  // gave?", so the honest answer is a dash.
  facts.appendChild(renderKontoFact(t('auth.email'), me.demo ? '—' : me.email));
  facts.appendChild(renderKontoFact(t('auth.username'), me.username || '—'));
  app.appendChild(facts);

  app.appendChild(h(`<h2 class="konto-section__h">${esc(t('konto.bgg.title'))}</h2>`));
  app.appendChild(buildBggForm(me.bggUsername));

  // The password form is STRUCTURALLY unusable for a demo account: it holds no
  // password identity, so change-password answers `invalid_credentials` whatever
  // is typed — i.e. "your current password is wrong" about a password that never
  // existed. Offering a form that cannot succeed is worse than offering none, so
  // a demo gets the explanation instead.
  if (me.demo) {
    app.appendChild(h(`<h2 class="konto-section__h">${esc(t('konto.demo.title'))}</h2>`));
    app.appendChild(h(`<p class="muted">${esc(t('konto.demo.note'))}</p>`));
    return;
  }

  app.appendChild(h(`<h2 class="konto-section__h">${esc(t('konto.pw.title'))}</h2>`));
  app.appendChild(buildPasswordForm());

  // Last, and visually separated: the one irreversible thing on this screen
  // (#419). A demo returned above — its erasure is „Demo beenden“ in the account
  // menu, and it holds no password to re-authenticate with anyway.
  app.appendChild(h(`<h2 class="konto-section__h konto-section__h--danger">${esc(t('konto.delete.title'))}</h2>`));
  app.appendChild(buildDeleteSection(me));
}

// The entry point to deletion. Deliberately a button that opens a confirmation
// rather than a form that deletes: the counts it shows are fetched at that
// moment, so what the user confirms is what is actually there.
function buildDeleteSection(me) {
  const wrap = h(`<div class="konto-danger">
      <p class="muted">${esc(t('konto.delete.intro'))}</p>
      <button class="btn btn--danger" type="button">${esc(t('konto.delete.cta'))}</button>
    </div>`);
  wrap.querySelector('button').addEventListener('click', () => openDeleteSheet(me));
  return wrap;
}

// The confirmation sheet. Through openSheet so it inherits the focus trap (#145)
// and Back-dismissal (#333) rather than hand-rolling either.
async function openDeleteSheet(me) {
  let counts;
  try {
    counts = await accountApi('GET', '/deletion-preview');
  } catch (ex) {
    if (ex.message !== 'auth') toast(t('auth.error.network'));
    return;
  }

  const row = (label, value) => `<div class="konto-fact">
      <span class="konto-fact__label">${esc(label)}</span>
      <span class="konto-fact__value">${esc(String(value))}</span>
    </div>`;

  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(t('konto.delete.sheetTitle'))}">
        <div class="sheet__head">
          <h2>${esc(t('konto.delete.sheetTitle'))}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <p>${esc(t('konto.delete.lead'))}</p>
        <div class="konto-facts">
          ${row(t('konto.delete.rounds'), counts.rounds)}
          ${row(t('konto.delete.games'), counts.games)}
          ${row(t('konto.delete.sessions'), counts.sessions)}
          ${row(t('konto.delete.images'), counts.images)}
        </div>
        ${counts.sharedWith
    // A consequence to a THIRD party, so it is stated rather than left to be
    // discovered by the people who lose access.
    ? `<p class="konto-danger__third">${esc(tn(counts.sharedWith, 'konto.delete.sharedOne', 'konto.delete.shared'))}</p>`
    : ''}
        <div class="field">
          <label for="kdUser">${esc(t('konto.delete.confirmLabel', { username: me.username || '' }))}</label>
          <input id="kdUser" class="input" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="field">
          <label for="kdPw">${esc(t('konto.delete.password'))}</label>
          <input id="kdPw" class="input" type="password" autocomplete="current-password" />
        </div>
        <p class="konto-error" hidden></p>
        <div class="toolbar sheet__actions">
          <button id="kdGo" class="btn btn--danger btn--lg" type="button"><i class="ti ti-trash" aria-hidden="true"></i> ${esc(t('konto.delete.submit'))}</button>
        </div>
      </div>
    </div>`);

  const sheet = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  sheet.querySelector('.sheet__close').addEventListener('click', () => closeSheet());

  const user = sheet.querySelector('#kdUser');
  const pw = sheet.querySelector('#kdPw');
  const err = sheet.querySelector('.konto-error');
  const go = sheet.querySelector('#kdGo');

  go.addEventListener('click', async () => {
    err.hidden = true;
    // Client-side first, so an obvious slip costs no request — and no Argon2
    // verify on the server.
    if (!user.value.trim() || !pw.value) return setKontoError(err, t('auth.error.missing'));
    go.disabled = true;
    try {
      await accountApi('DELETE', '', { password: pw.value, confirmUsername: user.value.trim() });
      // The account is gone, so nothing cached about it may survive — least of
      // all the round data in localStorage, which belongs to a tenant that no
      // longer exists.
      clearTokens();
      invalidateRoundCache();
      accountUser = null;
      setupAccountUi();
      // Pass the navigation to closeSheet rather than calling it on the next
      // line: history.back() is async, so the two would race and leave the URL
      // and the DOM disagreeing (.claude/rules/sheet-history-back-dismissal.md).
      closeSheet(() => {
        showLanding();
        toast(t('konto.delete.done'));
      });
      return;
    } catch (ex) {
      if (ex.message !== 'auth') setKontoError(err, t(authErrorKey('deleteAccount', ex.message)));
    }
    go.disabled = false;
  });

  // Focus AFTER openSheet — trapFocus captures document.activeElement as its
  // restore target, so focusing first would "restore" focus into the sheet.
  user.focus();
}

// The linked BoardGameGeek handle (#481) — the one settable identity field, and
// the only place to remove it. Editable here unlike e-mail and username above,
// because it names an account on someone else's service: nothing in this app
// addresses it, so changing it costs nothing and needs no verification.
function buildBggForm(current) {
  const form = h(`<form class="konto-pw">
      <div class="field">
        <label for="kBgg">${esc(t('konto.bgg.label'))}</label>
        <input id="kBgg" class="input" autocomplete="off" spellcheck="false" value="${esc(current || '')}" />
        <p class="field__hint muted">${esc(t('konto.bgg.hint'))}</p>
      </div>
      <p class="konto-error" hidden></p>
      <button class="btn btn--primary" type="submit">${esc(t('konto.bgg.submit'))}</button>
    </form>`);

  const input = form.querySelector('#kBgg');
  const err = form.querySelector('.konto-error');
  const submit = form.querySelector('button[type=submit]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    try {
      // A blank field clears the link — the server reads '' as null, so this is
      // also how someone unlinks without a separate destructive-looking button.
      const data = await accountApi('PATCH', '/me', { bggUsername: input.value.trim() });
      input.value = data.bggUsername || '';
      toast(data.bggUsername ? t('konto.bgg.done') : t('konto.bgg.cleared'));
    } catch (ex) {
      if (ex.message !== 'auth') {
        setKontoError(err, ex.message === 'invalid_bgg_username'
          ? t('bggImport.toast.badHandle')
          : t('auth.error.network'));
      }
    }
    submit.disabled = false;
  });

  return form;
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
