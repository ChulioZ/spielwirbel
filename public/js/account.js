/* Spielwirbel – account BOOT and the route gate (issue #138): the in-app "way
   in" for the token-first account backend (#135).

   What is left here after #969's split is the decision of what a visitor sees
   first — whether this path is one of the auth screens' own URLs, a vote link, a
   public-stats page or a deep link to remember — and `enterApp`. The pieces it
   drives live in four siblings:

     auth-tokens.js     the token store, `accountApi`, the silent refresh
     views-auth.js      login / register / forgot / the two landings
     demo-account.js    the guest demo lifecycle (#427)
     account-chrome.js  the top-bar menu, the banners and the two dots

   Two modes, unchanged:

   - Accounts mode (server has ACCOUNTS_ENABLED + SESSION_SECRET): the /api data
     routes require a valid account token, so the SPA shows the auth UI until the
     user logs in, then attaches the Bearer token to every request (via core.js
     api()) and refreshes it silently when it expires.
   - Legacy mode (accounts off — the shared-password gate): every helper is
     inert. probeMe() gets a 404, accountsMode stays false, and bootApp() just
     routes into the app exactly as before.

   Part of the frontend; all files share one global script scope. Loads after
   auth-tokens.js and before main.js (which calls bootApp last). See index.html
   for the load order. */

'use strict';

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
  /* The account's design (#1186), the moment the account state is known and
     before the first view renders. main.js has already painted synchronously —
     the face, or the device key on an accounts-off instance — so this is the
     only point at which a logged-in account's own choice can take effect
     without the first screen flashing something else.

     Every early return below (the mail landings, the login bounce, the landing
     page) is a LOGGED-OUT surface, which wears the face by definition, so this
     one call covers them all by running first. */
  applyAccountDesign();
  const path = location.pathname;
  // '/v' and '/r' are the short links the account mails carry (#434); the long
  // '/verify-email' and '/reset-password' forms are the pre-#434 shape. Since
  // #451 the server no longer resolves those links (their records have long
  // expired), but the paths are kept so a bookmarked or copy-pasted old URL still
  // renders the "link expired" screen with its resend recovery, not a blank page.
  if (path === '/v' || path === '/verify-email') return renderVerifyLanding();
  if (path === '/r' || path === '/reset-password') return renderResetLanding();
  // '/e' only — no long-form alias. The two above carry one because their long
  // paths were the shape before #434 and old mails are still out there; this
  // link has never had another form (#1076).
  if (path === '/e') return renderEmailChangeLanding();
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
  /* The chooser (#1186), for the COLD LOAD of an already-signed-in account —
     enterApp covers the other entry, a fresh login. Both are needed and neither
     covers the other: this path never calls enterApp, and a login never comes
     through here. Last, so the sheet opens over a rendered screen rather than
     over the „…" placeholder. A logged-out visitor and an accounts-off instance
     have no `accountUser`, so the call is a no-op for them — correct, since
     there is nothing to store the answer on. */
  maybeShowDesignChooser(accountUser);
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
  // The account that just signed in may wear a different design than the face
  // the login screen was on (#1186). bootApp's call ran before there was a
  // session, so this is the second of the two points where the answer changes.
  applyAccountDesign();
  // ...and if they have never been asked, ask once. After the design is
  // applied, so the sheet opens ON the design it is offering to change.
  maybeShowDesignChooser(accountUser);
  const next = pendingPath || '/';
  pendingPath = null;
  routeTo(next);
}

