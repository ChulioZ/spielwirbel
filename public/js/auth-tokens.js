/* Spielwirbel – the account TOKEN LAYER (#135), split out of account.js by #969.

   This is the app's most widely shared code and it lived below 460 lines of
   login markup: `accountsActive` has ten callers outside this file, `isLoggedIn`
   seven, `accountApi` five, and `.claude/rules/accounts-mode-gate.md` calls
   core.js's `api()` "the token chokepoint" — everything that chokepoint depends
   on is here.

   What it owns: the three localStorage keys (access, refresh and the guest-demo
   marker, #427), the cached `/me` projection, `authFetch`'s silent-refresh
   retry, and `onSessionLost`. Nothing here renders anything.

   In LEGACY mode (accounts off) every helper is inert: `probeMe()` gets a 404,
   `accountsMode` stays false, and the app routes exactly as before.

   Part of the frontend; all files share one global script scope. Loads before
   account.js, which boots on top of it. See index.html for the load order. */

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
  resetAvatarCache();     // nor the profile pictures resolved under it (#841)
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
  // FormData rides as-is and MUST NOT get an explicit Content-Type: the browser
  // has to set it itself so the multipart boundary is included. Mirrors core.js
  // api(); added for the profile-picture upload (#841), which is the only
  // multipart request on the account surface.
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
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

// End this session server-side and forget it locally, without choosing a next
// screen. Split out of logout() (#1269) for the empty lobby's demo link, which
// signs out and then enters a demo — minting one over a live session would
// strand the account's refresh token instead of revoking it.
async function signOut() {
  try { await authFetch('/logout', { refreshToken: getRefreshToken() }); } catch {}
  clearTokens();
  invalidateRoundCache(); // the next login may be a different account/tenant
  resetAvatarCache();     // ...and so must the faces resolved for it (#841)
  accountUser = null;
}

async function logout() {
  await signOut();
  setupAccountUi();
  // The landing page, not the login card (#501). A deliberate logout is a
  // departure, and showLanding() owns '/', so the address bar stops naming the
  // round that was just left behind. An EXPIRED session still goes to
  // showLogin() (onSessionLost): that user was working and wants back in, so
  // marketing copy they have already read would be a detour.
  showLanding();
}

