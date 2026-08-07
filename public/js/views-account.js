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

  // Next to the BGG handle, its natural neighbour — and ABOVE the demo return
  // below, unlike the mail and password sections. Those sit below it because a
  // demo account has no routable address and no password identity; this one
  // needs neither. It is a link the browser follows, so it works for a demo
  // exactly as it does for a real account.
  app.appendChild(h(`<h2 class="konto-section__h">${esc(t('konto.bgstats.title'))}</h2>`));
  app.appendChild(buildBgStatsForm(me));

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

  // Below the demo return on purpose (#616), for a reason of its own: a guest
  // demo self-erases on a TTL (#427/#502), so putting its icon on someone's home
  // screen points at an account that will be gone. Placed first among the
  // below-the-return sections so it still reads as following the BGG block, the
  // order the issue asked for.
  const installSection = buildInstallSection();
  if (installSection) app.appendChild(installSection);

  // Below the demo return on purpose (#618): a guest demo's stored address is a
  // synthetic `…@demo.invalid` placeholder, so lib/notify.js never mails one —
  // offering it a switch over mail that cannot be sent would be a lie.
  app.appendChild(h(`<h2 class="konto-section__h">${esc(t('konto.notify.title'))}</h2>`));
  app.appendChild(buildNotifyForm(me));

  app.appendChild(h(`<h2 class="konto-section__h">${esc(t('konto.pw.title'))}</h2>`));
  app.appendChild(buildPasswordForm());

  // Below the password form on purpose: a passkey is an ADDITIONAL credential,
  // so it reads as an addition to the account's sign-in rather than as a
  // replacement for the thing above it. Also below the demo return, for the
  // same reason the password form is — a demo holds no password identity and
  // self-erases on a TTL, so a passkey registered against one would point at an
  // account that is about to vanish while the platform keychain keeps offering
  // it forever. (The demo branch above has already returned by here.)
  app.appendChild(h(`<h2 class="konto-section__h">${esc(t('konto.passkey.title'))}</h2>`));
  app.appendChild(buildPasskeySection());

  // Last, and visually separated: the one irreversible thing on this screen
  // (#419). A demo returned above — its erasure is „Demo beenden“ in the account
  // menu, and it holds no password to re-authenticate with anyway.
  app.appendChild(h(`<h2 class="konto-section__h konto-section__h--danger">${esc(t('konto.delete.title'))}</h2>`));
  app.appendChild(buildDeleteSection(me));
}

/* „App installieren" (#616), or nothing at all.

   Returns null in the two states with nothing to say — already installed, and a
   browser that can neither prompt nor be instructed — rather than an empty
   heading over a blank panel. The two live states are genuinely different
   controls, not one control with a fallback label: where the browser handed us
   a `beforeinstallprompt` we can open the real dialog, and on iOS no such call
   exists, so a button there would be a control that cannot work. */
function buildInstallSection() {
  const state = installState();
  if (state !== 'prompt' && state !== 'ios') return null;

  const wrap = h(`<div class="install-section">
      <h2 class="konto-section__h">${esc(t('install.title'))}</h2>
      <p class="muted">${esc(t('install.intro'))}</p>
    </div>`);
  if (state === 'ios') {
    wrap.appendChild(h(`<p class="muted">${esc(t('install.ios.steps'))}</p>`));
  } else {
    const btn = h(`<button class="btn install-cta" type="button">${iconText('ti-download', t('install.cta'))}</button>`);
    btn.addEventListener('click', async () => {
      if (await runInstallPrompt() === 'accepted') toast(t('install.done'));
    });
    wrap.appendChild(btn);
  }
  // Installing while this screen is open must not leave a live install offer on
  // it; the section is the whole panel, so one removal covers the heading too.
  hideOnInstalled(wrap);
  return wrap;
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

/* One boolean on the account, as a row that saves on change. Shared by the two
   inbox-mail opt-outs (#618) and the BG Stats opt-in (#485) — the same control,
   the same failure handling, three different fields.

   The row is a <label> so the whole row toggles its checkbox, and its group gets
   its OWN wrapper rather than a `.field` — `.field label` is (0,1,1) and would
   beat `.ds-row` (0,1,0), flattening every row
   (.claude/rules/label-rows-lose-to-field-label.md). */
function buildPrefToggle(field, label, checked, onToast) {
  const row = h(`<label class="ds-row konto-notify__row">
      <div class="ds-row__main"><span>${esc(label)}</span></div>
      <div class="ds-row__meta">
        <input type="checkbox" class="provider-row__box"${checked ? ' checked' : ''} />
      </div>
    </label>`);
  const box = row.querySelector('input');
  // Saves on change rather than behind a submit button — there is nothing to
  // review, and a toggle that needs confirming reads as not having worked.
  box.addEventListener('change', async () => {
    const want = box.checked;
    box.disabled = true;
    try {
      const data = await accountApi('PATCH', '/me', { [field]: want });
      // Follow the SERVER's answer, not the click: if it refused or coerced,
      // the checkbox must show what is actually stored.
      box.checked = data[field];
      // The cached /me is what the rest of the app reads this preference from,
      // and it was fetched before this screen opened.
      setCachedPref(field, data[field]);
      toast(t(onToast(want)));
    } catch (ex) {
      box.checked = !want; // put it back — nothing was saved
      if (ex.message !== 'auth') toast(t('auth.error.network'));
    }
    box.disabled = false;
  });
  return row;
}

// The two inbox-mail opt-outs (#618): e-mail me when a round invitation or a
// friend request arrives. Both default ON server-side, and /me always answers a
// real boolean, so this never has to re-implement the absent-key default.
function buildNotifyForm(me) {
  const wrap = h(`<div class="konto-notify">
      <p class="muted konto-notify__intro">${esc(t('konto.notify.intro'))}</p>
    </div>`);
  const mailToast = (want) => (want ? 'konto.notify.on' : 'konto.notify.off');
  wrap.appendChild(buildPrefToggle(
    'notifyRoundInvitations', t('konto.notify.invitations'), me.notifyRoundInvitations, mailToast));
  wrap.appendChild(buildPrefToggle(
    'notifyFriendRequests', t('konto.notify.friends'), me.notifyFriendRequests, mailToast));
  return wrap;
}

/* The BG Stats push opt-in (#485).

   OFF by default, unlike the two above: BG Stats' own integration guidance is to
   let the user enable the button rather than render a link that dead-ends for
   everyone who does not use the app — a website cannot detect whether it is
   installed. It is a per-ACCOUNT preference rather than a per-round one because
   the push happens on the tapping person's own device; enabling it for a whole
   round would put the link in front of everyone the round is shared with,
   including people who have never heard of BG Stats.

   The Android note is not padding: the link only opens the app once „Unterstützte
   Links öffnen" is on in its „Standardmäßig öffnen" settings, and without that
   hint the button lands in a browser and reads as broken. */
function buildBgStatsForm(me) {
  const wrap = h(`<div class="konto-notify">
      <p class="muted konto-notify__intro">${esc(t('konto.bgstats.intro'))}</p>
    </div>`);
  wrap.appendChild(buildPrefToggle(
    'bgStats', t('konto.bgstats.label'), me.bgStats,
    (want) => (want ? 'konto.bgstats.on' : 'konto.bgstats.off')));
  wrap.appendChild(h(`<p class="field__hint muted">${esc(t('konto.bgstats.hint'))}</p>`));
  return wrap;
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

/* The passkey list plus its "add" button (#418).

   The list is fetched here rather than ridden along on /me: it is the only
   screen that shows it, and keeping it off the projection every request reads
   means an account's credential list is not carried through the whole app. */
function buildPasskeySection() {
  const wrap = h(`<div class="konto-notify">
      <p class="muted konto-notify__intro">${esc(t('konto.passkey.intro'))}</p>
      <p class="field__hint muted">${esc(t('konto.passkey.privacy'))}</p>
      <div class="ds-list konto-passkeys"></div>
      <p class="konto-error" hidden></p>
      <button class="btn btn--primary konto-passkeys__add" type="button">${iconText('ti-fingerprint', t('konto.passkey.add'))}</button>
    </div>`);

  const list = wrap.querySelector('.konto-passkeys');
  const err = wrap.querySelector('.konto-error');
  const add = wrap.querySelector('.konto-passkeys__add');

  // A browser that cannot run the ceremony gets an explanation instead of a
  // button that will always fail. The LIST still renders — passkeys added on a
  // phone must remain manageable from a desktop that has no authenticator.
  if (!passkeysSupported()) {
    add.remove();
    wrap.insertBefore(h(`<p class="muted">${esc(t('konto.passkey.unsupported'))}</p>`), list);
  }

  const render = (passkeys) => {
    list.innerHTML = '';
    if (!passkeys.length) {
      list.appendChild(h(`<p class="muted">${esc(t('konto.passkey.empty'))}</p>`));
      return;
    }
    passkeys.forEach((p) => list.appendChild(renderPasskeyRow(p, render, err)));
  };

  accountApi('GET', '/passkeys')
    .then((data) => render(data.passkeys || []))
    .catch((ex) => { if (ex.message !== 'auth') setKontoError(err, t('auth.error.network')); });

  if (add) {
    add.addEventListener('click', async () => {
      err.hidden = true;
      add.disabled = true;
      try {
        const start = await accountApi('POST', '/passkeys/options', {});
        // Opens the platform's own sheet (Touch ID, Windows Hello, a hardware
        // key, or the QR flow to another device).
        const credential = await createPasskey(start.options);
        const done = await accountApi('POST', '/passkeys', {
          response: credential,
          challenge: start.challenge,
        });
        render(done.passkeys || []);
        toast(t('konto.passkey.done'));
      } catch (ex) {
        // Dismissing the sheet is a deliberate cancel, not an error.
        if (!isPasskeyCancel(ex) && ex.message !== 'auth') {
          setKontoError(err, t(authErrorKey('passkey', ex.message)));
        }
      }
      add.disabled = false;
    });
  }

  return wrap;
}

/* One passkey. The row is an inert div, so it takes `ds-row--static`: it does
   nothing itself and `.ds-row` otherwise promises a click target it does not
   have (.claude/rules/ds-row-is-a-click-target.md). The two buttons at its
   right edge carry the whole affordance, which is also why the row can never
   become an anchor — a <button> inside an <a> is invalid HTML.

   NB: don't spell the opening tag literally in this comment — the scan in
   test/ds-row-affordance.test.js reads the file as text and would match it,
   failing on a row that does not exist. */
function renderPasskeyRow(passkey, render, err) {
  const used = passkey.lastUsedAt
    ? t('konto.passkey.lastUsed', { date: fmtDate(passkey.lastUsedAt) })
    : t('konto.passkey.neverUsed');
  const row = h(`<div class="ds-row ds-row--static">
      <div class="ds-row__main">
        <span class="konto-passkey__name">${esc(passkey.name || t('konto.passkey.unnamed'))}</span>
        <span class="konto-passkey__meta muted">${esc(t('konto.passkey.added', { date: fmtDate(passkey.createdAt) }))} · ${esc(used)}</span>
      </div>
      <div class="ds-row__meta">
        <button class="link-btn" type="button" data-act="rename">${esc(t('konto.passkey.rename'))}</button>
        <button class="link-btn konto-passkey__del" type="button" data-act="remove">${esc(t('konto.passkey.remove'))}</button>
      </div>
    </div>`);

  /* `body` must be left UNDEFINED for a request that sends none. accountApi
     serializes anything that is not `undefined`, so passing null would send the
     literal `null` — and express.json() runs in strict mode, which accepts only
     an object or an array at the top level, so the DELETE would 400
     `entity.parse.failed` and the passkey would never be removed. */
  const call = async (method, body, toastKey) => {
    err.hidden = true;
    try {
      const data = await accountApi(method, `/passkeys/${encodeURIComponent(passkey.credentialId)}`, body);
      render(data.passkeys || []);
      toast(t(toastKey));
    } catch (ex) {
      if (ex.message !== 'auth') setKontoError(err, t(authErrorKey('passkey', ex.message)));
    }
  };

  // Click "Umbenennen" → inline input; Enter/blur saves, Escape cancels. The
  // same shape the game-title, member-name and round-name editors use — native
  // prompt() lives only in the operator panel, which is deliberately outside
  // this design system.
  const nameEl = row.querySelector('.konto-passkey__name');
  row.querySelector('[data-act=rename]').addEventListener('click', () => {
    if (!nameEl.isConnected) return; // an editor is already open on this row
    const input = h(`<input class="input konto-passkey__input" aria-label="${esc(t('konto.passkey.renamePrompt'))}" />`);
    input.value = passkey.name || '';
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let handled = false;
    const commit = () => {
      if (handled) return;
      handled = true;
      const val = input.value.trim();
      // An empty field is a deliberate clear, not a refusal: the server stores
      // null and the row falls back to the unnamed label. Unlike a member name,
      // a passkey has a sensible nameless state.
      if (val === (passkey.name || '')) {
        input.replaceWith(nameEl); // nothing changed
        return;
      }
      call('PATCH', { name: val }, 'konto.passkey.renamed');
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { handled = true; input.replaceWith(nameEl); }
    });
  });

  row.querySelector('[data-act=remove]').addEventListener('click', () => {
    // The confirm says the account stays usable — removing the last passkey is
    // safe here precisely because the password was never replaced.
    if (!confirm(t('konto.passkey.removeConfirm'))) return;
    call('DELETE', undefined, 'konto.passkey.removed');
  });

  return row;
}

function setKontoError(el, message) {
  el.textContent = message;
  el.hidden = false;
}
