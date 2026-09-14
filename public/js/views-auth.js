/* Spielwirbel – the AUTH SCREENS (#138/#501), split out of account.js by #969:
   login, register, forgot-password, the two e-mail landings (verify and reset),
   the rate-limited state, and the passkey login wiring (#418).

   The largest of the five concerns that file held, and the one with nothing else
   depending on it: everything here renders, and every piece of state it reads
   comes from auth-tokens.js.

   `openAuth` is the one shared shape — it owns the whole-screen layout toggle,
   the document title and the URL sync, so a new screen cannot forget one of the
   three.

   Part of the frontend; all files share one global script scope. Loads after
   account.js. See index.html for the load order. */

'use strict';

/* ------------------------------- auth screens ------------------------------ */

// Toggle the whole-screen auth layout: hides the top-bar home link and context
// label (the language picker stays) so a logged-out visitor sees only the auth
// card.
function authScreen(on) {
  document.body.classList.toggle('auth-screen', !!on);
  // „Anmelden" in the bar belongs to exactly two screens (#1090) — the logged-out
  // landing and a logged-out /entdecken — and both turn it back on right after
  // calling this. Hiding it on EVERY call, in both directions, is what makes that
  // safe: the login and register screens come through here too, so without the
  // `false` branch the landing's link would follow a visitor onto the very form
  // it opened, and without the `true` branch it would survive into the app.
  showLoginLink(false);
}

// Title an auth screen from its own `<h1 class="auth__title">` (#522). `root` is
// anything containing it — openAuth passes the wrapper it built, a screen
// re-titling itself passes its card.
function setAuthDocTitle(root) {
  const heading = root.querySelector('.auth__title');
  setDocTitle(heading && heading.textContent);
}

// Shared scaffold for an auth screen: clears the view, sets the auth layout, and
// appends the built card. `build(card)` wires the specific form. `render` is the
// function itself so a language switch re-renders it (via currentView).
//
// `path` is the screen's own URL when it has one (#501). Only the three
// entry screens pass it; the terminal ones — showAuthDone, showRateLimited and
// the two mail landings — deliberately stay URL-less, because each holds
// one-shot state (a submitted address, a link token) that a cold load cannot
// rebuild, the same reasoning that keeps the session-flow paths unresolvable.
function openAuth(render, innerHtml, build, path) {
  currentView = render;
  if (path) syncUrl(path);
  authScreen(true);
  setContext('');
  applyBackground(null);
  app.innerHTML = '';
  const wrap = h(`<div class="auth">${innerHtml}</div>`);
  app.appendChild(wrap);
  // Every one of the seven auth screens gets its title read back off the card it
  // just rendered (#522), rather than passing a key in per screen: the heading is
  // already there, always translated, and cannot drift from what is on screen,
  // because it *is* what is on screen. The next auth screen added here inherits a
  // correct title with nothing to remember.
  //
  // A screen that REPLACES its heading later must re-apply it — renderVerifyLanding
  // swaps "Verifying…" for the outcome after an await, and does so.
  setAuthDocTitle(wrap);
  build(wrap.querySelector('.auth__card'));
}

const authError = (card) => card.querySelector('.auth__error');
// The error line is a permanent `role="alert"` region: it is always in the
// tree and its EMPTY state is its hidden state (`.auth__error:empty` costs no
// space). Toggling `hidden` on it would take it out of the accessibility tree,
// and un-hiding it with the text already in place is exactly the shape that
// never gets announced (.claude/rules/accessibility-contrast-and-modals.md §4,
// 2026-09-06 audit A-016).
function setError(card, msg) {
  authError(card).textContent = msg;
}

// The three routable auth screens (#501). Each guards itself rather than
// relying on its route, so every call site is covered: a visitor who is already
// logged in has no business on them (a stale /login bookmark, or the "back to
// login" button on a mail landing they opened while signed in), and a legacy
// accounts-off instance has no auth screens at all. Safe everywhere it already
// gets called — onSessionLost() and the demo banner's register CTA both
// clearTokens() first, so isLoggedIn() is already false by then.
const authScreensAvailable = () => accountsActive() && !isLoggedIn();

function showLogin() {
  if (!authScreensAvailable()) return showHome();
  openAuth(showLogin, `<form class="auth__card" autocomplete="on">
      <div class="auth__logo"><i class="ti ti-tornado" aria-hidden="true"></i></div>
      <h1 class="auth__title">${esc(t('auth.login.title'))}</h1>
      <p class="auth__sub muted">${esc(t('auth.login.sub'))}</p>
      <div class="field">
        <label for="authEmail">${esc(t('auth.emailOrUsername'))}</label>
        <!-- Not type="email"/inputmode="email" since #431: either identifier is
             accepted, so browser validation must not reject a handle and the
             phone keyboard must not lead with '@'. autocomplete="username" is
             finally literally accurate. -->
        <input id="authEmail" class="input" type="text" autocomplete="username"
               spellcheck="false" autocapitalize="none" />
      </div>
      <div class="field">
        <label for="authPassword">${esc(t('auth.password'))}</label>
        <input id="authPassword" class="input" type="password" autocomplete="current-password" />
      </div>
      <p class="auth__error" role="alert"></p>
      <button class="btn btn--primary btn--block" type="submit">${esc(t('auth.login.submit'))}</button>
      <!-- The passkey path (#418). Ships hidden and is revealed only where
           window.PublicKeyCredential exists, so a browser that cannot run the
           ceremony is offered no control rather than a broken one. .auth__alt
           carries its own display, so the paired [hidden] rule in styles.css is
           what makes the attribute bite
           (.claude/rules/hidden-attribute-vs-display-rule.md).
           NB: no backticks in this comment — it sits inside a template
           literal, and one would terminate the string. -->
      <div class="auth__alt" id="passkeyAlt" hidden>
        <p class="auth__or"><span>${esc(t('auth.passkey.or'))}</span></p>
        <button class="btn btn--block" type="button" id="passkeyLogin">${iconText('ti-fingerprint', t('auth.passkey.login'))}</button>
      </div>
      <div class="auth__links">
        <button class="link-btn" type="button" id="toForgot">${esc(t('auth.login.forgot'))}</button>
        <button class="link-btn" type="button" id="toRegister">${esc(t('auth.login.toRegister'))}</button>
      </div>
    </form>`, (card) => {
    const form = card.closest('.auth').querySelector('form');
    const ident = card.querySelector('#authEmail');
    const pw = card.querySelector('#authPassword');
    const submit = card.querySelector('button[type=submit]');
    card.querySelector('#toForgot').addEventListener('click', showForgot);
    card.querySelector('#toRegister').addEventListener('click', showRegister);
    wirePasskeyLogin(card);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      authError(card).textContent = '';
      if (!ident.value.trim() || !pw.value) return setError(card, t('auth.error.missing'));
      submit.disabled = true;
      try {
        const { ok, data } = await authFetch('/login', { login: ident.value.trim(), password: pw.value });
        if (ok) {
          setTokens(data.accessToken, data.refreshToken);
          // A different account than the cache's owner may be logging in on
          // this browser — its persisted round data must not leak across.
          invalidateRoundCache();
          accountUser = data.user || null;
          enterApp();
          return;
        }
        setError(card, t(authErrorKey('login', data.error)));
      } catch { setError(card, t('auth.error.network')); }
      submit.disabled = false;
    });
    ident.focus();
  }, '/login');
}

/* The usernameless passkey login (#418).

   No e-mail is typed and none is sent: the server answers the same options to
   everyone, and the authenticator decides which credential it holds for this
   site. That is the whole reason the flow is built this way — an e-mail-first
   passkey login would have to answer "does this address have credentials?",
   which is exactly the question register and forgot-password are carefully
   built never to answer (.claude/rules/user-accounts.md). */
function wirePasskeyLogin(card) {
  const alt = card.querySelector('#passkeyAlt');
  const btn = card.querySelector('#passkeyLogin');
  if (!alt || !btn || !passkeysSupported()) return;
  alt.hidden = false;

  btn.addEventListener('click', async () => {
    authError(card).textContent = '';
    btn.disabled = true;
    try {
      const start = await authFetch('/passkeys/login/options', {});
      if (!start.ok) throw new Error(start.data.error || 'network');

      // Opens the platform's own sheet; resolves once the user has approved.
      const credential = await getPasskey(start.data.options);

      const done = await authFetch('/passkeys/login', {
        response: credential,
        challenge: start.data.challenge,
      });
      if (!done.ok) throw new Error(done.data.error || 'network');

      setTokens(done.data.accessToken, done.data.refreshToken);
      // A different account than the cache's owner may be signing in on this
      // browser — its persisted round data must not leak across.
      invalidateRoundCache();
      accountUser = done.data.user || null;
      enterApp();
      return;
    } catch (ex) {
      // Dismissing the OS sheet is a deliberate cancel, not a failure — showing
      // an error for it would blame the user for changing their mind.
      if (!isPasskeyCancel(ex)) setError(card, t(authErrorKey('passkeyLogin', ex.message)));
    }
    btn.disabled = false;
  });
}

function showRegister() {
  if (!authScreensAvailable()) return showHome();
  openAuth(showRegister, `<form class="auth__card" autocomplete="on">
      <div class="auth__logo"><i class="ti ti-tornado" aria-hidden="true"></i></div>
      <h1 class="auth__title">${esc(t('auth.register.title'))}</h1>
      <p class="auth__sub muted">${esc(t('auth.register.sub'))}</p>
      <div class="field">
        <label for="regEmail">${esc(t('auth.email'))}</label>
        <input id="regEmail" class="input" type="email" autocomplete="username" inputmode="email" />
      </div>
      <div class="field">
        <label for="regUser">${esc(t('auth.username'))}</label>
        <!-- 'nickname', NOT 'username': the login form's identifier field owns
             autocomplete="username". Claiming that token here too would make a
             password manager store the handle as the credential's username and
             then autofill it into the login box on the next visit, over
             whichever identifier the user actually logs in with. (Login accepts
             the handle as well since #431 — but only one field can own the
             token, and it is the one on the login form.) -->
        <input id="regUser" class="input" type="text" autocomplete="nickname"
               maxlength="${USERNAME_MAX}" spellcheck="false" autocapitalize="none" />
        <div class="field__hint muted">${esc(t('auth.register.userHint', { min: USERNAME_MIN, max: USERNAME_MAX }))}</div>
      </div>
      <div class="field">
        <label for="regPw">${esc(t('auth.password'))}</label>
        <input id="regPw" class="input" type="password" autocomplete="new-password" />
        <div class="field__hint muted">${esc(t('auth.register.pwHint'))}</div>
      </div>
      <p class="auth__error" role="alert"></p>
      <button class="btn btn--primary btn--block" type="submit">${esc(t('auth.register.submit'))}</button>
      <!-- Both links here point at pages that hard-404 until the operator
           identity is configured (lib/routes/legal.js), so the whole line ships
           hidden and is revealed below only when /api/config reports footer:true
           — the same gate the site footer's legal links use. Pre-#520 this
           paragraph was unconditional, so a self-hosted instance without
           IMPRESSUM_ADDRESS/IMPRESSUM_EMAIL pointed its register form at two
           404s. NB: no backticks in here — this sits inside a template literal,
           so one would terminate the string mid-comment. -->
      <p class="auth__terms muted" hidden>${esc(t('auth.register.termsPre'))}
        <a href="/nutzungsbedingungen" target="_blank" rel="noopener">${esc(t('auth.register.termsLinkLabel'))}</a>.
        ${esc(t('auth.register.privacyPre'))}
        <a href="/datenschutz" target="_blank" rel="noopener">${esc(t('auth.register.privacyLinkLabel'))}</a>.</p>
      <div class="auth__links">
        <button class="link-btn" type="button" id="toLogin">${esc(t('auth.register.toLogin'))}</button>
      </div>
    </form>`, (card) => {
    const form = card.closest('.auth').querySelector('form');
    const email = card.querySelector('#regEmail');
    const user = card.querySelector('#regUser');
    const pw = card.querySelector('#regPw');
    const submit = card.querySelector('button[type=submit]');
    card.querySelector('#toLogin').addEventListener('click', showLogin);
    // Reveal the legal line only where those pages resolve (see the markup above).
    const termsLine = card.querySelector('.auth__terms');
    if (termsLine) withAppConfig((cfg) => { termsLine.hidden = !(cfg && cfg.footer); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      authError(card).textContent = '';
      const username = user.value.trim();
      if (!email.value.trim() || !username) return setError(card, t('auth.error.missing'));
      // Both checks share their definition with the route that enforces them
      // (username-policy.js), so this can only ever be early — never stricter or
      // laxer than the server, which stays the authority.
      if (!isValidUsername(username)) {
        return setError(card, t('auth.error.invalidUsername', { min: USERNAME_MIN, max: USERNAME_MAX }));
      }
      if (isReservedUsername(username)) return setError(card, t('auth.error.reservedUsername'));
      if (pw.value.length < 8) return setError(card, t('auth.error.shortPassword'));
      submit.disabled = true;
      try {
        const { ok, data } = await authFetch('/register', { email: email.value.trim(), username, password: pw.value });
        // Register answers ok even for an existing e-mail (anti-enumeration) — a
        // 400/409 only comes back for a malformed field or a taken username,
        // which IS reported openly (a public handle; see lib/routes/account.js) —
        // plus the cross-cutting 429/401 refusals authErrorKey maps (#399).
        // The address is handed on so the done screen can offer a resend (#435)
        // without asking for it again.
        if (ok) return showAuthDone('auth.register.doneTitle', 'auth.register.doneSub', email.value.trim());
        setError(card, t(authErrorKey('register', data.error)));
      } catch { setError(card, t('auth.error.network')); }
      submit.disabled = false;
    });
    email.focus();
  }, '/register');
}

function showForgot() {
  if (!authScreensAvailable()) return showHome();
  openAuth(showForgot, `<form class="auth__card" autocomplete="on">
      <div class="auth__logo"><i class="ti ti-lock-question" aria-hidden="true"></i></div>
      <h1 class="auth__title">${esc(t('auth.forgot.title'))}</h1>
      <p class="auth__sub muted">${esc(t('auth.forgot.sub'))}</p>
      <div class="field">
        <label for="fpEmail">${esc(t('auth.email'))}</label>
        <input id="fpEmail" class="input" type="email" autocomplete="username" inputmode="email" />
      </div>
      <p class="auth__error" role="alert"></p>
      <button class="btn btn--primary btn--block" type="submit">${esc(t('auth.forgot.submit'))}</button>
      <div class="auth__links">
        <button class="link-btn" type="button" id="toLogin">${esc(t('auth.backToLogin'))}</button>
      </div>
    </form>`, (card) => {
    const form = card.closest('.auth').querySelector('form');
    const email = card.querySelector('#fpEmail');
    const submit = card.querySelector('button[type=submit]');
    card.querySelector('#toLogin').addEventListener('click', showLogin);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      authError(card).textContent = '';
      if (!email.value.trim()) return setError(card, t('auth.error.missing'));
      submit.disabled = true;
      // The handler itself always answers ok (anti-enumeration), so a !ok can
      // only be a cross-cutting refusal (rate limiter, layered shared gate) —
      // reporting it honestly reveals nothing about any account (#399).
      try {
        const { ok, data } = await authFetch('/forgot-password', { email: email.value.trim() });
        if (!ok) {
          setError(card, t(authErrorKey('forgot', data.error)));
          submit.disabled = false;
          return;
        }
      } catch {
        setError(card, t('auth.error.network'));
        submit.disabled = false;
        return;
      }
      showAuthDone('auth.forgot.doneTitle', 'auth.forgot.doneSub');
    });
    email.focus();
  }, '/forgot-password');
}

// Fill `host` with the "send me another verification mail" affordance (#435) and
// wire it. Two shapes, because only one of the two callers knows the address:
// the post-register screen passes it (so: a button), the expired-link landing
// does not (so: a field plus a button).
function buildResend(host, presetEmail) {
  const known = typeof presetEmail === 'string' && presetEmail !== '';
  host.innerHTML = `${known ? '' : `<div class="field">
        <label for="resendEmail">${esc(t('auth.email'))}</label>
        <input id="resendEmail" class="input" type="email" autocomplete="username" inputmode="email" />
      </div>`}
      <button class="btn btn--block" type="button" id="resendBtn">${esc(t('auth.resend.action'))}</button>
      <p class="auth__sub muted" id="resendMsg" hidden></p>`;
  const btn = host.querySelector('#resendBtn');
  const input = host.querySelector('#resendEmail');
  const msg = host.querySelector('#resendMsg');
  btn.addEventListener('click', async () => {
    const email = known ? presetEmail : input.value.trim();
    if (!email) return input.focus(); // the empty field is its own prompt
    btn.disabled = true;
    msg.hidden = true;
    try {
      const { ok, data } = await authFetch('/resend-verification', { email });
      // The handler always answers ok for ANY address (anti-enumeration), so a
      // !ok can only be a cross-cutting refusal — the rate limiter or, in
      // layered mode, the shared gate (#399). Reporting it reveals nothing.
      if (ok) {
        // Terminal on success: the next step is in their inbox, not here. Said
        // conditionally ("falls ein Konto existiert") because we are not told
        // whether anything was actually sent.
        btn.remove();
        if (input) input.closest('.field').remove();
        msg.textContent = t('auth.resend.done');
      } else {
        msg.textContent = t(authErrorKey('resend', data.error));
        btn.disabled = false;
      }
    } catch {
      msg.textContent = t('auth.error.network');
      btn.disabled = false;
    }
    msg.hidden = false;
  });
}

// A terminal "check your e-mail" style panel (after register / forgot-password),
// with a single way back to login. `resendEmail` is registration-only: passing it
// adds the resend affordance (#435). Forgot-password must NOT grow one — a reset
// link is not a verification link, and the screen is shared.
function showAuthDone(titleKey, subKey, resendEmail) {
  openAuth(() => showAuthDone(titleKey, subKey, resendEmail), `<div class="auth__card">
      <div class="auth__logo"><i class="ti ti-mail-check" aria-hidden="true"></i></div>
      <h1 class="auth__title">${esc(t(titleKey))}</h1>
      <p class="auth__sub muted">${esc(t(subKey))}</p>
      <div id="resendHost"></div>
      <button class="btn btn--primary btn--block" type="button" id="toLogin">${esc(t('auth.backToLogin'))}</button>
    </div>`, (card) => {
    const host = card.querySelector('#resendHost');
    if (resendEmail) buildResend(host, resendEmail); else host.remove();
    card.querySelector('#toLogin').addEventListener('click', showLogin);
  });
}

// Boot found the auth rate limiter tripped (#399): the mode is unknowable, so
// show a plain retry screen instead of guessing one. Reload re-runs the probe.
function showRateLimited() {
  openAuth(showRateLimited, `<div class="auth__card">
      <div class="auth__logo"><i class="ti ti-hourglass" aria-hidden="true"></i></div>
      <h1 class="auth__title">${esc(t('auth.limited.title'))}</h1>
      <p class="auth__sub muted">${esc(t('auth.limited.sub'))}</p>
      <button class="btn btn--primary btn--block" type="button" id="limitedRetry">${esc(t('auth.limited.retry'))}</button>
    </div>`, (card) => {
    card.querySelector('#limitedRetry').addEventListener('click', () => window.location.reload());
  });
}

// Landing for the e-mail-verification link (/v?t=…): POST the token, then show
// success/failure with a button to login.
function renderVerifyLanding() {
  const cred = linkToken();
  openAuth(renderVerifyLanding, `<div class="auth__card">
      <div class="auth__logo"><i class="ti ti-mail-check" aria-hidden="true"></i></div>
      <h1 class="auth__title">${esc(t('auth.verify.working'))}</h1>
      <p class="auth__sub muted" id="verifyMsg">…</p>
      <div id="resendHost"></div>
      <button class="btn btn--primary btn--block" type="button" id="toLogin" hidden></button>
    </div>`, (card) => {
    const toLogin = card.querySelector('#toLogin');
    toLogin.addEventListener('click', showLogin);
    (async () => {
      const { ok } = cred.token ? await authFetch('/verify-email', cred) : { ok: false };
      card.querySelector('.auth__title').textContent = t(ok ? 'auth.verify.okTitle' : 'auth.verify.failTitle');
      // The heading openAuth titled the tab from is gone now — re-read it, or the
      // tab keeps saying "Verifying…" on a screen that has finished either way.
      setAuthDocTitle(card);
      card.querySelector('#verifyMsg').textContent = t(ok ? 'auth.verify.okSub' : 'auth.verify.failSub');
      // An expired or already-used link is the OTHER stuck-signup dead end (#435)
      // — logging in with an unverified account is refused and offers nothing —
      // so the failure branch carries the recovery. The landing knows only
      // the token, never the address, hence the field variant.
      if (ok) card.querySelector('#resendHost').remove();
      else buildResend(card.querySelector('#resendHost'), null);
      toLogin.textContent = t('auth.backToLogin');
      toLogin.hidden = false;
    })();
  });
}

/* Landing for the address-change link (/e?t=…, #1076): POST the token, then show
   the outcome.

   Unlike the verification landing it carries NO resend control. `buildResend`
   resends a VERIFICATION by address, which is a different thing entirely — and
   this landing knows only a token, never which account or which address, so
   there is nothing it could resend. The recovery is to request the change again
   from the account screen, which is what the failure text says. */
function renderEmailChangeLanding() {
  const cred = linkToken();
  openAuth(renderEmailChangeLanding, `<div class="auth__card">
      <div class="auth__logo"><i class="ti ti-mail-check" aria-hidden="true"></i></div>
      <h1 class="auth__title">${esc(t('auth.emailChange.working'))}</h1>
      <p class="auth__sub muted" id="emailChangeMsg">…</p>
      <button class="btn btn--primary btn--block" type="button" id="toLogin" hidden></button>
    </div>`, (card) => {
    const toLogin = card.querySelector('#toLogin');
    toLogin.addEventListener('click', showLogin);
    (async () => {
      const { ok } = cred.token ? await authFetch('/confirm-email', cred) : { ok: false };
      card.querySelector('.auth__title').textContent = t(ok ? 'auth.emailChange.okTitle' : 'auth.emailChange.failTitle');
      // The heading openAuth titled the tab from is gone now — re-read it, or the
      // tab keeps saying "Confirming…" on a screen that has finished either way.
      setAuthDocTitle(card);
      card.querySelector('#emailChangeMsg').textContent = t(ok ? 'auth.emailChange.okSub' : 'auth.emailChange.failSub');
      toLogin.textContent = t('auth.backToLogin');
      toLogin.hidden = false;
    })();
  });
}

// Landing for the password-reset link (/r?t=…): a new-password form that posts
// the token.
function renderResetLanding() {
  const cred = linkToken();
  openAuth(renderResetLanding, `<form class="auth__card" autocomplete="on">
      <div class="auth__logo"><i class="ti ti-lock" aria-hidden="true"></i></div>
      <h1 class="auth__title">${esc(t('auth.reset.title'))}</h1>
      <p class="auth__sub muted">${esc(t('auth.reset.sub'))}</p>
      <div class="field">
        <label for="resetPw">${esc(t('auth.reset.newPassword'))}</label>
        <input id="resetPw" class="input" type="password" autocomplete="new-password" />
      </div>
      <p class="auth__error" role="alert"></p>
      <button class="btn btn--primary btn--block" type="submit">${esc(t('auth.reset.submit'))}</button>
      <div class="auth__links">
        <button class="link-btn" type="button" id="toLogin">${esc(t('auth.backToLogin'))}</button>
      </div>
    </form>`, (card) => {
    const form = card.closest('.auth').querySelector('form');
    const pw = card.querySelector('#resetPw');
    const submit = card.querySelector('button[type=submit]');
    card.querySelector('#toLogin').addEventListener('click', showLogin);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      authError(card).textContent = '';
      if (pw.value.length < 8) return setError(card, t('auth.error.shortPassword'));
      submit.disabled = true;
      const { ok, data } = cred.token
        ? await authFetch('/reset-password', { ...cred, password: pw.value })
        : { ok: false, data: { error: 'invalid_token' } };
      if (ok) { toast(t('auth.reset.done')); return showLogin(); }
      setError(card, t(authErrorKey('reset', data.error)));
      submit.disabled = false;
    });
    pw.focus();
  });
}

