/* Spielwirbel – account/onboarding (issue #138): the in-app "way in" for the
   token-first account backend (issue #135). Renders the auth screens (login,
   register, e-mail-verification landing, forgot/reset password), stores the
   access/refresh tokens, and boots the app in one of two modes:

   - Accounts mode (server has ACCOUNTS_ENABLED + SESSION_SECRET): the /api data
     routes require a valid account token, so the SPA shows the auth UI until the
     user logs in, then attaches the Bearer token to every request (via core.js
     api()) and refreshes it silently when it expires.
   - Legacy mode (accounts off — today's production, shared-password gate): every
     helper here is inert. probeMe() gets a 404, accountsMode stays false, and
     bootApp() just routes into the app exactly as before.

   Part of the frontend; all files share one global script scope. Loads right
   after core.js (uses h/esc/app/toast/openPopover) and before main.js (which
   calls bootApp last). See index.html for the load order. */

'use strict';

let accountsMode = false; // set by initAccounts(): true once the server confirms accounts are on
let accountUser = null; // { id, email, ... } when logged in; shown in the account menu

// Tokens live in localStorage so a reload stays logged in. Wrapped in try/catch
// because localStorage throws in some privacy modes — we degrade to "not logged
// in" rather than crashing the boot.
const SA_ACCESS = 'sa_access';
const SA_REFRESH = 'sa_refresh';
const saStore = () => { try { return window.localStorage; } catch { return null; } };
function getAccessToken() { try { const s = saStore(); return s ? s.getItem(SA_ACCESS) : null; } catch { return null; } }
function getRefreshToken() { try { const s = saStore(); return s ? s.getItem(SA_REFRESH) : null; } catch { return null; } }
function setTokens(access, refresh) {
  const s = saStore();
  if (!s) return;
  try { if (access) s.setItem(SA_ACCESS, access); if (refresh) s.setItem(SA_REFRESH, refresh); } catch {}
}
function clearTokens() {
  const s = saStore();
  if (!s) return;
  try { s.removeItem(SA_ACCESS); s.removeItem(SA_REFRESH); } catch {}
}

// Read by core.js api() and by the view code: which mode, and are we logged in.
function accountsActive() { return accountsMode; }
function isLoggedIn() { return accountsMode && !!getAccessToken(); }
// Who am I (#421) — accessors rather than views reaching into `accountUser`,
// which is a module-scoped `let` and may be null between boot and probeMe().
function currentUserId() { return (accountUser && accountUser.id) || null; }
function currentUsername() { return (accountUser && accountUser.username) || ''; }
// Guest demo mode (#427). Read from /me, so it survives a reload rather than
// living only in the POST /demo response — the banner has to come back when the
// visitor refreshes or follows a deep link inside their demo.
function isDemoAccount() { return !!(accountUser && accountUser.demo); }

// Auth endpoints are called with a plain fetch (not api()): they carry no Bearer
// token, and a 401 here means "bad credentials", not "session expired" — so they
// must NOT trigger the refresh-or-bounce logic api() adds.
async function authFetch(path, body) {
  const res = await fetch('/api/account' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data: data || {} };
}

// GET /me is the boot probe. 404 = accounts disabled (legacy mode); 401 = accounts
// on but not logged in; 200 = logged in (body is the user).
async function probeMe() {
  const token = getAccessToken();
  try {
    const r = await fetch('/api/account/me', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data: data || {} };
  } catch { return { status: 0, data: {} }; }
}

// Exchange the refresh token for a fresh pair (rotating). Returns whether it
// worked; on failure the (now useless) tokens are cleared. Called by core.js
// api() on a 401 before retrying the original request.
async function refreshAccessToken() {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    const { ok, data } = await authFetch('/refresh', { refreshToken: refresh });
    if (ok && data.accessToken) { setTokens(data.accessToken, data.refreshToken); return true; }
  } catch {}
  clearTokens();
  return false;
}

// The session is unrecoverably gone (refresh failed): drop tokens and show login.
// Called by core.js api() when a 401 survives a refresh attempt.
function onSessionLost() {
  clearTokens();
  invalidateRoundCache(); // no cached round data may survive the identity loss
  accountUser = null;
  setupAccountUi();
  showLogin();
}

// 401 codes a HANDLER produced rather than the token guard (#482). Every other
// 401 — including one whose body we cannot read — still means the session is
// over, so forgetting to list a new one degrades to the old behaviour instead of
// leaving a dead session live.
const HANDLER_401 = ['invalid_credentials']; // change-password: wrong current password

// Authenticated JSON request to an account-scoped data route (/api/account/*
// behind requireUser — e.g. the inbox #207, friend requests #325). Attaches the
// access token and, on a 401 from the token guard, refreshes once and retries
// before giving up to the login screen. Deliberately separate from core.js
// api(): those requireUser routes answer 'invalid_token', which api() does NOT
// auto-refresh (it only refreshes the data gate's 'auth_required'). Returns
// parsed JSON (null on 204); throws on any non-2xx so callers can degrade
// gracefully.
async function accountApi(method, path, body, _retried) {
  const token = getAccessToken();
  const opts = { method, headers: {} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api/account' + path, opts);
  if (!res.ok) {
    // Surface the server's error code (like core.js api()) so callers can map it
    // to a specific message — e.g. the invitation accept's 'seat_unavailable'.
    let code = 'request_failed';
    try { code = (await res.json()).error || code; } catch {}
    // A 401 the handler decided is an ordinary refusal, not a dead session:
    // treating change-password's wrong-current-password as one would log the
    // user out over a typo.
    if (res.status === 401 && !HANDLER_401.includes(code)) {
      if (!_retried && (await refreshAccessToken())) return accountApi(method, path, body, true);
      onSessionLost();
      throw new Error('auth');
    }
    throw new Error(code);
  }
  return res.status === 204 ? null : res.json();
}

async function logout() {
  try { await authFetch('/logout', { refreshToken: getRefreshToken() }); } catch {}
  clearTokens();
  invalidateRoundCache(); // the next login may be a different account/tenant
  accountUser = null;
  setupAccountUi();
  showLogin();
}

/* --------------------------------- boot ----------------------------------- */

// '/v' and '/r' are the short links the account mails carry (#434); the long
// '/verify-email' and '/reset-password' forms are the pre-#434 shape. Since #451
// the server no longer resolves those links (their records have long expired),
// but the paths are kept so a bookmarked or copy-pasted old URL still renders the
// "link expired" screen with its resend recovery instead of a blank page.
const isAuthPath = (p) => p === '/v' || p === '/r'
  || p === '/verify-email' || p === '/reset-password';

// The one-time token from either link shape: '?t=' carries the combined
// "<version>.<uid>.<secret>" token, the legacy pair a separate uid. The uid is
// still sent for a legacy URL and still accepted by the API — it is simply
// ignored now (#451), so such a link resolves to nothing and the landing shows
// the expired-link recovery.
function linkToken() {
  const params = new URLSearchParams(location.search);
  const combined = params.get('t');
  return combined ? { token: combined } : { uid: params.get('uid'), token: params.get('token') };
}

// Resolve the mode + login state, then decide the first screen. Called last from
// main.js so i18n/core/views are all loaded.
async function bootApp() {
  if ((await initAccounts()) === 'rate_limited') return showRateLimited();
  const path = location.pathname;
  if (path === '/v' || path === '/verify-email') return renderVerifyLanding();
  if (path === '/r' || path === '/reset-password') return renderResetLanding();
  // The /demo deep link (#427), so a launch post can point straight into a
  // running demo. Handled here rather than in resolveRoute because it is not a
  // view: it performs a side effect and then routes to Home. Someone who is
  // already logged in falls through and simply lands in their own app — starting
  // a demo over a real session would log them out of it.
  if (path === '/demo' && accountsActive() && !isLoggedIn()) return startDemo();
  if (accountsActive() && !isLoggedIn()) {
    // A cold visitor on "/" gets the marketing landing (issue #322); a deep link
    // (a shared /round/… URL &c.) already has context and wants in fast, so it
    // goes straight to login and continues to the deep link after (enterApp).
    return path === '/' ? showLanding() : showLogin();
  }
  authScreen(false);
  setupAccountUi();
  routeTo(path);
}

async function initAccounts() {
  let res = await probeMe();
  if (res.status === 429) {
    // A rate-limited probe says NOTHING about the auth mode, so it must not
    // fall into the legacy branch below: against an accounts-mode server the
    // "legacy" client's first data fetch 401s, legacy api() answers that with a
    // location.assign reload, and the reload re-runs this probe against the
    // still-tripped limiter — an infinite reload loop (#399). One short retry,
    // then a visible retry screen instead of a guessed mode.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    res = await probeMe();
    if (res.status === 429) return 'rate_limited';
  }
  // Only a definitive answer from the (pre-gate) account router flips on accounts
  // mode: 200 = logged in, 401 = accounts on but not logged in. A 404 means
  // accounts are disabled, and anything else (a boot-time network hiccup) is
  // treated the same — legacy mode — so a transient error never strands a
  // shared-password instance on the login screen.
  if (res.status === 200) { accountsMode = true; accountUser = res.data; return; }
  if (res.status !== 401) { accountsMode = false; return; }
  accountsMode = true;
  if (getRefreshToken() && (await refreshAccessToken())) {
    const again = await probeMe(); // a stale access token: refreshed, probe again
    if (again.status === 200) { accountUser = again.data; return; }
  }
  clearTokens();
  accountUser = null;
}

// Enter the app after a successful login: leave the auth UI, reveal the account
// menu, and route to the deep link the user arrived on (or Home if that was an
// auth landing).
function enterApp() {
  authScreen(false);
  setupAccountUi();
  const path = location.pathname;
  routeTo(isAuthPath(path) ? '/' : path);
}

/* ------------------------------- auth screens ------------------------------ */

// Toggle the whole-screen auth layout: hides the top-bar home link and context
// label (the language picker stays) so a logged-out visitor sees only the auth
// card.
function authScreen(on) { document.body.classList.toggle('auth-screen', !!on); }

// Shared scaffold for an auth screen: clears the view, sets the auth layout, and
// appends the built card. `build(card)` wires the specific form. `render` is the
// function itself so a language switch re-renders it (via currentView).
function openAuth(render, innerHtml, build) {
  currentView = render;
  authScreen(true);
  setContext('');
  applyBackground(null);
  app.innerHTML = '';
  const wrap = h(`<div class="auth">${innerHtml}</div>`);
  app.appendChild(wrap);
  build(wrap.querySelector('.auth__card'));
}

const authError = (card) => card.querySelector('.auth__error');
function setError(card, msg) {
  const el = authError(card);
  el.textContent = msg;
  el.hidden = false;
}

function showLogin() {
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
      <p class="auth__error" hidden></p>
      <button class="btn btn--primary btn--block" type="submit">${esc(t('auth.login.submit'))}</button>
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
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      authError(card).hidden = true;
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
  });
}

function showRegister() {
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
               maxlength="30" spellcheck="false" autocapitalize="none" />
        <div class="field__hint muted">${esc(t('auth.register.userHint'))}</div>
      </div>
      <div class="field">
        <label for="regPw">${esc(t('auth.password'))}</label>
        <input id="regPw" class="input" type="password" autocomplete="new-password" />
        <div class="field__hint muted">${esc(t('auth.register.pwHint'))}</div>
      </div>
      <p class="auth__error" hidden></p>
      <button class="btn btn--primary btn--block" type="submit">${esc(t('auth.register.submit'))}</button>
      <p class="auth__terms muted">${esc(t('auth.register.termsPre'))}
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
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      authError(card).hidden = true;
      const username = user.value.trim();
      if (!email.value.trim() || !username) return setError(card, t('auth.error.missing'));
      // Mirrors usernameSchema in routes/account.js — the server is still the
      // authority; this only saves a round trip on an obviously bad handle.
      if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) return setError(card, t('auth.error.invalidUsername'));
      if (pw.value.length < 8) return setError(card, t('auth.error.shortPassword'));
      submit.disabled = true;
      try {
        const { ok, data } = await authFetch('/register', { email: email.value.trim(), username, password: pw.value });
        // Register answers ok even for an existing e-mail (anti-enumeration) — a
        // 400/409 only comes back for a malformed field or a taken username,
        // which IS reported openly (a public handle; see routes/account.js) —
        // plus the cross-cutting 429/401 refusals authErrorKey maps (#399).
        // The address is handed on so the done screen can offer a resend (#435)
        // without asking for it again.
        if (ok) return showAuthDone('auth.register.doneTitle', 'auth.register.doneSub', email.value.trim());
        setError(card, t(authErrorKey('register', data.error)));
      } catch { setError(card, t('auth.error.network')); }
      submit.disabled = false;
    });
    email.focus();
  });
}

function showForgot() {
  openAuth(showForgot, `<form class="auth__card" autocomplete="on">
      <div class="auth__logo"><i class="ti ti-lock-question" aria-hidden="true"></i></div>
      <h1 class="auth__title">${esc(t('auth.forgot.title'))}</h1>
      <p class="auth__sub muted">${esc(t('auth.forgot.sub'))}</p>
      <div class="field">
        <label for="fpEmail">${esc(t('auth.email'))}</label>
        <input id="fpEmail" class="input" type="email" autocomplete="username" inputmode="email" />
      </div>
      <p class="auth__error" hidden></p>
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
      authError(card).hidden = true;
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
  });
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
      <p class="auth__error" hidden></p>
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
      authError(card).hidden = true;
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

/* --------------------------------- guest demo ------------------------------- */

// Start a guest demo (#427): mint a throwaway seeded account and drop the
// visitor straight into it. Wired to the landing CTA and to the /demo deep link
// so a launch post can link people directly into a running demo.
//
// `busy` is the button the click came from (if any) — disabled for the duration,
// because seeding a whole round is not instantaneous and a second click would
// mint a second demo tenant and abandon the first.
async function startDemo(busy) {
  // `disabled` is the whole busy state — .btn:disabled already dims it, and
  // seeding a round takes a moment, so a second click would mint a second demo
  // tenant and abandon the first.
  if (busy) busy.disabled = true;
  // A failure has to leave the visitor looking at SOMETHING. When the click came
  // from the landing page (`busy` is its button) that page is already rendered
  // and a toast is enough — but the /demo deep link reaches here with nothing
  // drawn at all, because bootApp() returned before choosing a screen. Without
  // this, a 503 at the ceiling turns a shared launch link into a blank page.
  const fail = (key) => {
    if (busy) busy.disabled = false;
    else { history.replaceState({}, '', '/'); showLanding(); }
    toast(t(key));
  };

  let res;
  try {
    res = await authFetch('/demo', { locale: getLocale() });
  } catch {
    return fail('demo.start.failed');
  }
  const { ok, data } = res;
  if (!ok || !data || !data.accessToken) {
    // The capacity refusal is its own message: "try again shortly" is true and
    // actionable, while the generic failure text would read as the app being
    // broken at exactly the moment we are asking someone to judge it.
    const code = (data && data.error) || '';
    if (code === 'demo_unavailable') return fail('demo.start.busy');
    if (code === 'demo_disabled') return fail('demo.start.disabled');
    return fail('demo.start.failed');
  }
  setTokens(data.accessToken, data.refreshToken);
  accountUser = data.user || null;
  // Land on Home rather than on whatever path the visitor arrived at: /demo is
  // not a view, and enterApp() would otherwise try to route to it.
  history.replaceState({}, '', '/');
  authScreen(false);
  setupAccountUi();
  routeTo('/');
}

// The persistent "this is a demo" marker. Deliberately NOT a toast(): a toast is
// the confirmation/error channel and disappears, while this has to keep being
// true for as long as the demo lasts — the visitor must never be surprised that
// their round was deleted.
//
// The element lives permanently in index.html and is toggled with the `hidden`
// attribute. That attribute only hides via the UA stylesheet, so styles.css
// carries an explicit `.demo-banner[hidden] { display: none }` — without it the
// component's own `display` wins and the banner shows for everyone
// (.claude/rules/hidden-attribute-vs-display-rule.md).
function setupDemoBanner() {
  const bar = document.getElementById('demoBanner');
  if (!bar) return;
  const on = accountsActive() && isLoggedIn() && isDemoAccount();
  bar.hidden = !on;
  document.body.classList.toggle('has-demo-banner', on);
  if (!on) return;
  const text = document.getElementById('demoBannerText');
  const cta = document.getElementById('demoBannerCta');
  if (text) text.textContent = t('demo.banner.text');
  if (cta) {
    cta.textContent = t('demo.banner.cta');
    // Registering from inside a demo starts a FRESH account — nothing carries
    // over (#427 rules that out: it would need the cross-tenant re-tenanting
    // write path removed in #405). So drop the demo's tokens first, or the new
    // visitor to the register screen is still holding a logged-in session.
    cta.onclick = () => {
      clearTokens();
      accountUser = null;
      setupDemoBanner();
      setupAccountUi();
      showRegister();
    };
  }
}

/* ----------------------------- top-bar account ----------------------------- */

// Reveal (accounts mode + logged in) or hide the top-bar account button, and wire
// its menu (e-mail + logout). Called on boot, login, and logout.
function setupAccountUi() {
  // Tracks exactly the same login transitions as the account button (boot,
  // login, logout, session-lost), which is why it hangs off this function
  // rather than being called from each of those sites separately.
  setupDemoBanner();
  const btn = document.getElementById('accountBtn');
  if (!btn) return;
  const loggedIn = accountsActive() && isLoggedIn();
  btn.hidden = !loggedIn;
  if (!loggedIn) return;
  btn.onclick = () => openPopover(btn, (el, close) => {
    const username = (accountUser && accountUser.username) || '';
    el.appendChild(h(`<div class="popover__head">${
      username ? `<strong>${esc(username)}</strong>` : ''
    }${esc((accountUser && accountUser.email) || '')}</div>`));
    // Freundeskreis (#325): the entry point to the dedicated friends view.
    const friends = h(`<button class="popover__opt"><i class="ti ti-users" aria-hidden="true"></i> ${esc(t('friends.menu'))}</button>`);
    friends.addEventListener('click', () => { close(); showFriends(); });
    el.appendChild(friends);
    // Konto (#482): account settings — password change today, passkeys (#418)
    // and account deletion (#419) later.
    const konto = h(`<button class="popover__opt"><i class="ti ti-user" aria-hidden="true"></i> ${esc(t('konto.menu'))}</button>`);
    konto.addEventListener('click', () => { close(); showAccount(); });
    el.appendChild(konto);
    const out = h(`<button class="popover__opt"><i class="ti ti-logout" aria-hidden="true"></i> ${esc(t('auth.logout'))}</button>`);
    out.addEventListener('click', () => { close(); logout(); });
    el.appendChild(out);
  });
  setupInboxUi();
}

// The inbox button (issue #207): visible only when logged in, opens the inbox
// view, and shows an unread dot. Called from setupAccountUi so it tracks the same
// login transitions (boot, login, logout, session-lost).
function setupInboxUi() {
  const btn = document.getElementById('inboxBtn');
  if (!btn) return;
  const loggedIn = accountsActive() && isLoggedIn();
  btn.hidden = !loggedIn;
  if (!loggedIn) { setInboxDot(false); return; }
  btn.onclick = () => showInbox();
  refreshInboxBadge();
}

// Toggle the unread dot on the inbox button.
function setInboxDot(on) {
  const dot = document.getElementById('inboxDot');
  if (dot) dot.hidden = !on;
}

// Light the unread dot if any inbox item is unread. Best-effort: a failure just
// leaves the dot as-is (accountApi bounces a dead session to login). Reused by
// showInbox() after it marks/dismisses an item.
async function refreshInboxBadge() {
  if (!(accountsActive() && isLoggedIn())) return;
  try {
    const { items } = await accountApi('GET', '/inbox');
    setInboxDot(items.some((i) => !i.read));
  } catch {}
}
