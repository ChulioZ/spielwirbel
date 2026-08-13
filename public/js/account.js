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
// The demo resume marker (#502) — see public/js/demo-marker.js. Survives
// clearTokens() on purpose: leaving a demo without ending it keeps it alive on
// the server, so the browser has to remember which demo is its own.
function getDemoToken() { try { const s = saStore(); return s ? s.getItem(SA_DEMO) : null; } catch { return null; } }
function setDemoToken(token) { try { const s = saStore(); if (s && token) s.setItem(SA_DEMO, token); } catch {} }
function clearDemoToken() { try { const s = saStore(); if (s) s.removeItem(SA_DEMO); } catch {} }
function setTokens(access, refresh) {
  const s = saStore();
  if (!s) return;
  // Read BEFORE the write below: once SA_REFRESH holds the new token the
  // comparison can no longer tell whose rotation this was.
  const follows = refresh && demoMarkerFollowsRotation(getDemoToken(), getRefreshToken());
  try { if (access) s.setItem(SA_ACCESS, access); if (refresh) s.setItem(SA_REFRESH, refresh); } catch {}
  if (follows) setDemoToken(refresh);
}
function clearTokens() {
  const s = saStore();
  if (!s) return;
  try { s.removeItem(SA_ACCESS); s.removeItem(SA_REFRESH); } catch {}
}

// Memoized GET /api/config, used to gate the two links to /nutzungsbedingungen
// this file renders (#520): the register form's terms line and the demo banner's
// terms reference. Both point at a page that answers a hard 404 until the
// operator identity is configured (lib/routes/legal.js), so on a self-hosted
// instance without IMPRESSUM_ADDRESS/IMPRESSUM_EMAIL an ungated link is a
// promise of a document that does not exist. Same `footer` flag and same
// degradation as initFooter() (core.js) and the landing's operator claims: a
// plain fetch, never api() — the endpoint is public and a failure must not
// bounce to login — and on any error the links simply stay hidden.
//
// Callers pass a callback rather than awaiting, because both consumers render
// synchronously and reveal their link when the answer arrives.
let accountCfg = null;
function withAppConfig(cb) {
  if (accountCfg) { cb(accountCfg); return; }
  fetch('/api/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => { if (cfg) accountCfg = cfg; cb(cfg); })
    .catch(() => {});
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
// The BG Stats push opt-in (#485). Off for a logged-out visitor and in the
// accounts-off self-hosted modes, where `accountUser` is null and there is no
// account to hold the preference — the results screen then simply offers no
// push, which is the same answer as an account that never enabled it.
function bgStatsEnabled() { return !!(accountUser && accountUser.bgStats); }
// Keep the cached record in step with a preference the Konto screen just saved.
// showResults reads `bgStatsEnabled()` on every render, so without this the
// button would not appear (or disappear) until the next reload — the Konto
// screen fetches its own fresh /me and would otherwise be the only thing that
// knows.
function setCachedPref(field, value) { if (accountUser) accountUser[field] = value; }

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
  // The landing page, not the login card (#501). A deliberate logout is a
  // departure, and showLanding() owns '/', so the address bar stops naming the
  // round that was just left behind. An EXPIRED session still goes to
  // showLogin() (onSessionLost): that user was working and wants back in, so
  // marketing copy they have already read would be a detour.
  showLanding();
}

/* --------------------------------- boot ----------------------------------- */

// Is this path one of the three auth screens' own URLs (#501)? Used by bootApp
// to tell a visitor who cold-loaded onto /register (render it) from one who
// cold-loaded a deep link (remember it, then show login). Trailing slashes are
// stripped the way resolveRoute strips them, so /login/ is /login.
const isAuthRoute = (p) => ['/login', '/register', '/forgot-password'].includes(p.replace(/\/+$/, ''));

// A public vote link (#652): `/vote/<token>` with a non-empty token. Matched on
// the path shape rather than by trying to resolve the token — the client cannot
// know whether a token is real, and it does not need to: the screen itself asks
// the server and shows the dead-link state when the answer is no.
const isVoteLinkRoute = (p) => /^\/vote\/[^/]+\/*$/.test(p);

// The public statistics screen (#564). Like a vote link, it is a URL a
// logged-out visitor is MEANT to land on — it publishes nothing tenant-private
// and its whole point is being shareable to someone who has never seen the app.
const isPublicStatsRoute = (p) => p.replace(/\/+$/, '') === '/entdecken';

// Where to continue after a successful login: the deep link a logged-out visitor
// arrived on, captured by bootApp() before it hands them to /login and consumed
// by enterApp(). It lives in memory rather than in the URL because the auth
// screens now own their URLs, so the address bar has nowhere left to park it —
// which means a reload of /login forgets it and login lands Home. That is the
// accepted trade: a `?next=` parameter would be an open-redirect surface bolted
// onto a one-screen convenience.
let pendingPath = null;

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
  // '/v' and '/r' are the short links the account mails carry (#434); the long
  // '/verify-email' and '/reset-password' forms are the pre-#434 shape. Since
  // #451 the server no longer resolves those links (their records have long
  // expired), but the paths are kept so a bookmarked or copy-pasted old URL still
  // renders the "link expired" screen with its resend recovery, not a blank page.
  if (path === '/v' || path === '/verify-email') return renderVerifyLanding();
  if (path === '/r' || path === '/reset-password') return renderResetLanding();
  // The /demo deep link (#427), so a launch post can point straight into a
  // running demo. Handled here rather than in resolveRoute because it is not a
  // view: it performs a side effect and then routes to Home. Someone who is
  // already logged in falls through and simply lands in their own app — starting
  // a demo over a real session would log them out of it.
  if (path === '/demo' && accountsActive() && !isLoggedIn()) return startDemo();
  if (accountsActive() && !isLoggedIn()) {
    // A cold visitor on "/" gets the marketing landing (issue #322), and one who
    // cold-loaded an auth screen's own URL gets that screen (#501). Any other
    // deep link (a shared /round/… URL &c.) already has context and wants in
    // fast, so it is remembered and the visitor is sent to login, continuing
    // there after (enterApp).
    if (path === '/') return showLanding();
    if (isAuthRoute(path)) return routeTo(path);
    // A shared vote link (#652) is the one deep link a logged-out visitor is
    // MEANT to land on, so it must not be parked in pendingPath and swapped for
    // the login screen — its whole point is that the holder has no account, and
    // being asked to register is exactly the wall this feature removes. Routed
    // rather than called directly so the cold-loaded entry is replaced, not
    // pushed (same reasoning as the auth screens above).
    if (isVoteLinkRoute(path)) return routeTo(path);
    // /entdecken, for the same reason: parking it in pendingPath would answer a
    // shared "look what this instance is playing" link with a login wall, which
    // is exactly the audience the screen is published for.
    if (isPublicStatsRoute(path)) return routeTo(path);
    pendingPath = path;
    // routeTo() rather than showLogin() directly: it sets `routing`, which makes
    // the login screen's syncUrl REPLACE the deep link's history entry instead
    // of pushing on top of it. That URL was never a rendered view, so a pushed
    // entry would leave Back pointing at a path that renders nothing.
    return routeTo('/login');
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
// menu, and continue to the deep link the visitor arrived on — or Home when
// there was none, which now covers the mail landings and a reloaded /login alike
// (#501). Reading location.pathname here would send them back to /login.
function enterApp() {
  authScreen(false);
  setupAccountUi();
  const next = pendingPath || '/';
  pendingPath = null;
  routeTo(next);
}

/* ------------------------------- auth screens ------------------------------ */

// Toggle the whole-screen auth layout: hides the top-bar home link and context
// label (the language picker stays) so a logged-out visitor sees only the auth
// card.
function authScreen(on) { document.body.classList.toggle('auth-screen', !!on); }

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
function setError(card, msg) {
  const el = authError(card);
  el.textContent = msg;
  el.hidden = false;
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
      <p class="auth__error" hidden></p>
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
    authError(card).hidden = true;
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
      <p class="auth__error" hidden></p>
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
      authError(card).hidden = true;
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

  // Prefer the demo this browser already holds (#502). Without this, a visitor
  // who left without ending it strands that demo's slot for the rest of its TTL
  // and takes a second one — repeatable, so one visitor can drain the pool.
  //
  // resumeDemo() clears the marker on a definitive refusal, so falling through
  // to a fresh mint here IS the fail-forward path: a purged, expired or spent
  // marker never leaves the visitor at a dead end.
  if (getDemoToken()) {
    const resumed = await resumeDemo();
    if (resumed) {
      accountUser = resumed;
      return enterDemo();
    }
  }
  // A failure has to leave the visitor looking at SOMETHING. When the click came
  // from the landing page (`busy` is its button) that page is already rendered
  // and a toast is enough — but the /demo deep link reaches here with nothing
  // drawn at all, because bootApp() returned before choosing a screen. Without
  // this, a 503 at the ceiling turns a shared launch link into a blank page.
  const fail = (key) => {
    if (busy) busy.disabled = false;
    // routeTo('/') rather than showLanding(): both land on the landing page for
    // a logged-out visitor (views-home.js), but routeTo REPLACES the /demo entry
    // instead of pushing '/' on top of it — /demo is a side effect, never a view
    // Back should return to. Since #501 that also supersedes the manual
    // history.replaceState this used to do before showLanding().
    else routeTo('/');
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
  // The mint is one of the two places the marker is written EXPLICITLY: there is
  // no previous refresh token to match against, so setTokens' rotation rule
  // cannot recognise this as a demo (see public/js/demo-marker.js).
  setDemoToken(data.refreshToken);
  accountUser = data.user || null;
  return enterDemo();
}

// Land in the demo. Home rather than whatever path the visitor arrived at:
// /demo is not a view, and enterApp() would otherwise try to route to it.
function enterDemo() {
  history.replaceState({}, '', '/');
  authScreen(false);
  setupAccountUi();
  routeTo('/');
}

// Re-enter the demo this browser already holds (#502) by exchanging the stashed
// refresh token for a fresh pair. Returns the demo's user object, or null when
// the marker no longer resolves — the caller then mints a fresh demo.
async function resumeDemo() {
  const token = getDemoToken();
  if (!token) return null;
  let res;
  try {
    res = await authFetch('/refresh', { refreshToken: token });
  } catch {
    // A network error is NOT proof the demo is gone, so the marker survives it.
    return null;
  }
  if (!res.ok || !res.data.accessToken) {
    // Purged, expired, or already spent: a definitive refusal, so drop the
    // marker and let the caller mint a fresh demo in the same click.
    clearDemoToken();
    return null;
  }
  setTokens(res.data.accessToken, res.data.refreshToken);
  // The second explicit write: the refresh above SPENT the stashed token, and
  // setTokens could not match it because SA_REFRESH was cleared when the visitor
  // left. From here on the two are equal and rotations carry the marker along.
  setDemoToken(res.data.refreshToken);

  const me = await probeMe();
  // The marker must only ever resume a DEMO. Anything else (a purge landing
  // mid-flight, a marker that somehow points at a real account) is treated as no
  // marker at all rather than logging the visitor into it.
  if (me.status !== 200 || me.data.demo !== true) {
    clearTokens();
    clearDemoToken();
    return null;
  }
  return me.data;
}

// End a demo deliberately (#502): erase it server-side so its slot is freed
// immediately, then leave to the landing page. This is the one exit the server
// can recognise — every other one keeps the demo alive for the resume above.
async function endDemo() {
  // Best-effort: the visitor is leaving either way, and the TTL purge is the
  // backstop if the call never lands.
  try { await accountApi('DELETE', '/demo'); } catch {}
  clearTokens();
  clearDemoToken(); // nothing left to resume — the CTA must offer a fresh demo
  invalidateRoundCache();
  accountUser = null;
  setupAccountUi();
  showLanding();
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
  // The express reference to the terms (#520). A demo account is created without
  // registration, so its user never sees the register form's terms line — and
  // this banner is the only surface BOTH demo entry points share (the landing
  // CTA and the /demo deep link, which bootApp() handles as a side effect
  // without rendering the landing page at all). Revealed only on an instance
  // whose legal pages actually resolve. Re-localized here with the text and CTA
  // — which is why applyStaticTexts() (core.js) now calls this function on a
  // language switch; before #520 none of the three followed the picker.
  const terms = document.getElementById('demoBannerTerms');
  if (terms) {
    terms.textContent = t('demo.banner.terms');
    withAppConfig((cfg) => { terms.hidden = !(cfg && cfg.footer); });
  }
  if (cta) {
    cta.textContent = t('demo.banner.cta');
    // Registering from inside a demo starts a FRESH account — nothing carries
    // over (#427 rules that out: it would need the cross-tenant re-tenanting
    // write path removed in #405). So drop the demo's tokens first, or the new
    // visitor to the register screen is still holding a logged-in session.
    //
    // The resume MARKER deliberately survives (#502): this exit abandons the
    // demo without ending it, so it stays alive server-side and the landing CTA
    // must offer to re-enter it rather than minting a second one.
    cta.onclick = () => {
      clearTokens();
      accountUser = null;
      setupDemoBanner();
      setupAccountUi();
      showRegister();
    };
  }
}

// The terms-change notice (#521): Nutzungsbedingungen §11 promises we inform
// users of material changes "im Dienst oder per E-Mail", and until now nothing
// did — a published promise the implementation could not keep.
//
// The decision is a comparison of two fields the server sends TOGETHER on /me
// (see meProjection): the account's resolved accepted revision and the current
// one. Both come from one response, so this can never read a stale pair, and the
// LEGACY_TERMS_REVISION fallback for accounts predating #521 is applied
// server-side — the client deliberately knows nothing about it.
//
// Like the demo banner, the element lives permanently in index.html and is
// toggled with the `hidden` attribute, which is why styles.css carries an
// explicit `.terms-banner[hidden] { display: none }`
// (.claude/rules/hidden-attribute-vs-display-rule.md).
function setupTermsBanner() {
  const bar = document.getElementById('termsBanner');
  if (!bar) return;
  const on = accountsActive() && isLoggedIn() && !!accountUser
    && !!accountUser.termsRevision
    && accountUser.acceptedTermsRevision !== accountUser.termsRevision;
  bar.hidden = !on;
  if (!on) return;

  const text = document.getElementById('termsBannerText');
  if (text) text.textContent = t('terms.updated.text');
  // Gated on cfg.footer like the rest of the legal surface: lib/routes/legal.js
  // hard-404s until the operator identity is configured, so on such an instance
  // the notice states the change without offering a link that would break.
  const link = document.getElementById('termsBannerLink');
  if (link) {
    link.textContent = t('terms.updated.link');
    // Land the reader on the change summary in THEIR language. The document
    // carries a German section (authoritative, id="aenderungen") followed by an
    // English one (id="changes-en"); without this an English reader would be
    // dropped onto the German summary with the English one far below. Re-applied
    // on every call, so it follows the language picker like the label above.
    link.href = `/nutzungsbedingungen#${getLocale() === 'en' ? 'changes-en' : 'aenderungen'}`;
    withAppConfig((cfg) => { link.hidden = !(cfg && cfg.footer); });
  }
  const dismiss = document.getElementById('termsBannerDismiss');
  if (dismiss) {
    dismiss.textContent = t('terms.updated.dismiss');
    dismiss.onclick = async () => {
      // Hide immediately: the click is the acknowledgement, and leaving the
      // strip up until a round trip lands reads as the button being broken.
      bar.hidden = true;
      try {
        // accountApi resolves to the PARSED BODY (it throws on a non-2xx), so
        // this is the fresh meProjection — not a { status, data } envelope.
        // Re-seating it is load-bearing rather than tidy: setupTermsBanner runs
        // again on every language switch, and against a stale `accountUser` it
        // would re-show the notice the user just dismissed.
        const me = await accountApi('POST', '/accept-terms');
        if (me && me.termsRevision) accountUser = me;
      } catch {
        // A failed write just means the notice returns on the next load, which
        // is the right failure direction for something that must be seen.
      }
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
  setupTermsBanner(); // #521, same transitions
  // #207, same transitions — and it belongs UP HERE with the other two rather
  // than at the foot of this function, where it used to sit. Everything below
  // returns early for a logged-out user, so the inbox button was never hidden on
  // the way out: logging out left it on the landing page as a dead control
  // (clicking it lands in showInbox, which guards itself and bounces Home).
  // A cold boot never showed it — bootApp() returns before calling this for a
  // logged-out visitor, so the button keeps index.html's `hidden` — which is why
  // only the logout and session-lost transitions ever exposed it.
  // setupInboxUi() handles the logged-out case itself and self-guards on a
  // missing element, so it is safe ahead of both returns below.
  setupInboxUi();
  const btn = document.getElementById('accountBtn');
  if (!btn) return;
  const loggedIn = accountsActive() && isLoggedIn();
  btn.hidden = !loggedIn;
  // The „Was ist neu" dot (#741). It lives INSIDE the button above, so hiding
  // that button takes the dot with it — this call is what keeps the two honest
  // across the same login transitions the rest of this function tracks (boot,
  // login, logout, session-lost).
  setNewsDot(loggedIn && hasUnseenNews());
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
    // Entdecken (#564): the instance-wide statistics. Listed unconditionally
    // rather than gated on /api/stats/public answering — the menu is built
    // synchronously on every open, and a network round-trip per open to decide
    // whether to show one row would either stall the popover or make it jump.
    // The screen itself renders an honest empty state when the feature is off.
    const entdecken = h(`<button class="popover__opt"><i class="ti ti-world-search" aria-hidden="true"></i> ${esc(t('stats.menu'))}</button>`);
    entdecken.addEventListener('click', () => { close(); showEntdecken(); });
    el.appendChild(entdecken);
    // „Was ist neu" (#741). The only entry point to /neu, which is what makes
    // this a PULLED surface — the dot on the button above merely says there is
    // something here, and costs nothing when there is not.
    const newsOpt = h(`<button class="popover__opt"><i class="ti ti-sparkles" aria-hidden="true"></i> ${esc(t('news.menu'))}</button>`);
    newsOpt.addEventListener('click', () => { close(); showNews(); });
    el.appendChild(newsOpt);
    // A demo has nothing to log back INTO — it holds no password identity, so
    // "Abmelden" would strand the account alive and unreachable, holding a
    // capacity slot for the rest of its TTL (#502). Ending it erases it instead.
    if (isDemoAccount()) {
      const end = h(`<button class="popover__opt"><i class="ti ti-trash" aria-hidden="true"></i> ${esc(t('demo.end.menu'))}</button>`);
      end.addEventListener('click', () => { close(); endDemo(); });
      el.appendChild(end);
    } else {
      const out = h(`<button class="popover__opt"><i class="ti ti-logout" aria-hidden="true"></i> ${esc(t('auth.logout'))}</button>`);
      out.addEventListener('click', () => { close(); logout(); });
      el.appendChild(out);
    }
  });
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

/* ------------------------- „Was ist neu" (issue #741) ----------------------- */

// Is there a news entry this account has not seen? Needs NO network call — the
// entry list ships in this very bundle (public/js/news.js) and the account's own
// stamp already rode in on /me. That is the whole reason the dot costs nothing
// when there is nothing to say.
//
// A null revision (the empty list) answers false, so no dot can ever appear
// before the first entry exists. `accountUser` is deliberately required: with no
// account there is no seen-state, and dotting everyone would be worse than not
// dotting at all.
function hasUnseenNews() {
  const rev = newsRevision();
  return !!rev && !!accountUser && accountUser.lastSeenNewsRevision !== rev;
}

// Toggle the unseen dot on the account button.
function setNewsDot(on) {
  const dot = document.getElementById('newsDot');
  if (dot) dot.hidden = !on;
}

// Record that the current entries have been seen — called by showNews(), because
// OPENING the screen is the acknowledgement (the same shape as the terms
// banner's dismiss button, and the reason there is no separate "mark read"
// control). Lives here rather than in views-news.js so the `accountUser`
// re-seating below stays in the file that owns that variable.
async function markNewsSeen() {
  if (!hasUnseenNews()) return; // nothing to record, including the empty-list case
  setNewsDot(false); // optimistic: the click is the acknowledgement, a round trip is not
  try {
    // accountApi resolves to the PARSED BODY, i.e. a fresh meProjection.
    // Re-seating it is load-bearing rather than tidy: setupAccountUi() runs again
    // on the next login transition, and against a stale `accountUser` it would
    // re-light the dot the user just cleared.
    const me = await accountApi('POST', '/news-seen');
    if (me && me.id) accountUser = me;
  } catch {
    // A failed write just means the dot returns on the next load — the right
    // failure direction for a nudge nobody is blocked on.
  }
}
