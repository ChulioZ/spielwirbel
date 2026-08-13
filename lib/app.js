'use strict';

/*
 * Builds the Express app: middleware + route mounting only. No listening here,
 * so tests can require the app and drive it (e.g. via supertest) without opening
 * a port. server.js requires this and calls listen().
 */

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

const { ROOT } = require('./store');
const { requestLogger, healthz, createReadyz, errorHandler } = require('./observability');
const repo = require('./repo');
const auth = require('./auth');
const accounts = require('./accounts');
const demo = require('./demo');
const mail = require('./mail');
const legal = require('./legal');
const { createCanonicalRedirect } = require('./canonical');
const storage = require('./storage');
const { imageCspSources } = require('./providers');

const GLOBAL_WINDOW_MS = 15 * 60 * 1000; // 15 min

// The exact set of request paths that ASSET_DIR can serve, walked once per
// createApp() and used only to exempt them from the global limiter (#464) —
// never as a serving allowlist, which stays express.static's job.
//
// An EXACT set, deliberately, rather than the obvious "does the path end in
// .js/.css/.woff2". The limiter is mounted long before express.static, so it
// cannot observe whether a request resolved to a file — and an extension test
// answers a different question than the one that matters. Measured: a GET of
// `/made-up.js` matches no file, falls through to the SPA fallback and is
// answered with the full ~10.8 KB index.html at 200. Exempting by extension
// would therefore make an unlimited number of made-up asset names free, trading
// the self-lockout this fixes for an amplification vector. Membership in this
// set is the question actually worth asking, and it needs no extension list, no
// /uploads carve-out (cover keys are `<id><ext>`, so they look exactly like
// assets) and no /api carve-out — none of those paths are files we ship.
function listAssetPaths(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = base + '/' + entry.name;
    if (entry.isDirectory()) listAssetPaths(path.join(dir, entry.name), rel, out);
    else out.add(rel);
  }
  return out;
}

function assetPathSet(dir) {
  try {
    return listAssetPaths(dir, '', new Set());
  } catch {
    // Unreadable asset dir: exempt nothing. Fail closed — a limiter that counts
    // too much degrades, one that counts too little stops being a limiter.
    return new Set();
  }
}

// Which directory holds the frontend assets. In production, prefer the optional
// content-hashed build (dist/, from `npm run build` — issue #141) when it's
// there; everywhere else (dev, tests) serve the live-editable public/ tree.
// Gating on NODE_ENV=production — not mere existence — keeps `npm start` and the
// test suite deterministic (a stale local dist/ never shadows your edits) while
// letting a production host serve the minified, hashed assets. A production run
// with no dist/ built falls back to public/ rather than 404ing.
// The condition lived in lib/status.js while the operator panel reported a
// "built assets" row; that row went away with #404, so it moved back here to its
// only caller and lib/status.js no longer exports it.
function assetsBuilt() {
  return process.env.NODE_ENV === 'production'
    && fs.existsSync(path.join(ROOT, 'dist', 'index.html'));
}

function assetDir() {
  return path.join(ROOT, assetsBuilt() ? 'dist' : 'public');
}

// Cache headers for static assets. Content-hashed build outputs (name.<8-hex>.js/
// .css from scripts/build.js, served from dist/ in production) are immutable —
// their URL changes when their bytes do — so browsers may cache them for a year.
// sw.js must instead revalidate on every fetch (no-cache) or a stale service
// worker would delay shell updates. Everything else keeps Express's default
// ETag revalidation. Exported for tests.
function assetCacheHeaders(res, filePath) {
  if (/\.[0-9a-f]{8}\.(js|css)$/.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (filePath.endsWith('sw.js')) {
    res.setHeader('Cache-Control', 'no-cache');
  }
  // The link-preview card (#430) is the one asset whose whole purpose is to be
  // displayed on someone else's origin. helmet's default
  // Cross-Origin-Resource-Policy: same-origin makes a browser refuse to render
  // it there — server-side scrapers (Facebook, Telegram, Slack) fetch it
  // directly and never see the header, but any preview rendered client-side
  // (opengraph.xyz and friends) shows a broken image. Opt this ONE file out.
  // Deliberately not the whole tree: /uploads/ is auth-gated user data and the
  // PWA icons are only ever loaded by our own origin, so both keep the
  // restrictive default.
  if (filePath.endsWith('og-image.png')) {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
}

/*
 * Auth-mode gates (issue #266). Two INDEPENDENT switches — the shared-password
 * gate (lib/auth.js, AUTH_PASSWORD) and accounts mode (lib/accounts.js,
 * ACCOUNTS_ENABLED + SESSION_SECRET) — yield four modes:
 *   neither        -> open (local dev / the test suite)
 *   password only  -> today's gated single-instance production
 *   accounts only  -> the post-go-live public multi-tenant end state
 *   both = LAYERED  -> the instance stays sealed behind the shared password
 *                     while everyone inside uses REAL accounts (register/verify/
 *                     login/own tenant). Go-live (#219) then shrinks to REMOVING
 *                     AUTH_PASSWORD, after every account flow has been exercised.
 *
 * `auth.requireAuth` is itself a no-op unless AUTH_PASSWORD is set, so composing
 * it in FRONT of the account gate yields all four modes from one expression and
 * leaves the three pre-existing modes byte-for-byte unchanged — only the both-on
 * (layered) path adds a check. See .claude/rules/accounts-mode-gate.md.
 */

// /api data routes: in accounts mode a valid Bearer access token is required
// (Bearer-only, so the state-changing routes stay CSRF-immune — the cookie is
// never honored here); in LAYERED mode the shared-password session must ALSO be
// present first. Not accounts mode -> the shared-password gate alone (a no-op
// when AUTH_PASSWORD is unset), exactly as before.
function apiGate(req, res, next) {
  if (accounts.accountsEnabled()) {
    return auth.requireAuth(req, res, () => accounts.requireApiAccount(req, res, next));
  }
  return auth.requireAuth(req, res, next);
}

// /uploads (cover images): the same layering, but the account credential may ride
// the lax `sa` cookie as well as the Bearer header, since <img>/background-image
// GETs can't send a header. In layered mode the shared `sid` cookie rides along
// on the same same-site GET, so both gates are satisfied by one request.
function uploadGate(req, res, next) {
  if (accounts.accountsEnabled()) {
    return auth.requireAuth(req, res, () => accounts.requireUploadAccount(req, res, next));
  }
  return auth.requireAuth(req, res, next);
}

// The account routes (register/login/refresh/reset + invitations/friends). In
// LAYERED mode they sit behind the shared gate, so "accounts on" does not mean
// public sign-up on an instance still sealed by the shared password — without
// this, layering would defeat its own purpose. Gated on BOTH switches (not just
// requireAuth) so password-only mode keeps answering these routes' own 404
// `accounts_disabled` rather than a 401: that mode stays unchanged, and only
// layered mode requires the shared session here. /api/auth (the shared login
// itself) and the public /api/contact + legal surfaces are deliberately NOT
// fronted with this — they must stay reachable to a logged-out visitor.
function requireSharedIfLayered(req, res, next) {
  if (auth.authEnabled() && accounts.accountsEnabled()) return auth.requireAuth(req, res, next);
  return next();
}

function createApp() {
  const app = express();
  const ASSET_DIR = assetDir();

  // Rate-limit ceilings, overridable via env so a deployment can tune them and a
  // test can drive tiny limits deterministically. Read per call (not at module
  // load) so each createApp() picks up the current env. `limit` is per IP/window.
  const globalLimit = Number(process.env.RATE_LIMIT_MAX) || 1000;
  // 100, not 20 (#399): the auth limiter also fronts ordinary logged-in
  // browsing (inbox, invitations, friends), and per-IP it is shared by whole
  // NAT households — 20 was reachable by enthusiastic normal use. 100 still
  // caps online password guessing at ~9.6k/day/IP against Argon2id hashes.
  const authLimit = Number(process.env.AUTH_RATE_LIMIT_MAX) || 100;
  const contactLimit = Number(process.env.CONTACT_RATE_LIMIT_MAX) || 5;
  // Registration is the one unauthenticated endpoint that mails a stranger's
  // address on first contact (#448), so it gets a tighter cap than the shared
  // authLimit it stacks on top of. 10, not 5: a table of friends signing up
  // together shares one NAT address, and that is the app's actual use case —
  // the #399 lesson that a per-IP ceiling is really a per-household one. It is
  // not the quota defence (rotating IPs walk around it); MAIL_DAILY_MAX in
  // lib/mail.js is. This just makes a naive bulk run ~10x more expensive.
  const registerLimit = Number(process.env.REGISTER_RATE_LIMIT_MAX) || 10;
  // The guest demo (#427) is the other unauthenticated endpoint that CREATES an
  // account — and unlike registration it also writes a whole seeded round, so
  // one call is far more expensive than one signup. Tighter than register for
  // that reason. Like register, this is not the real defence against a
  // determined caller (rotating IPs walk around any per-IP cap); MAX_LIVE_DEMOS
  // in lib/demo.js bounds the resource itself, which is what actually holds.
  const demoLimit = Number(process.env.DEMO_RATE_LIMIT_MAX) || 5;
  // The public vote link (#652) is unauthenticated and its path segment is a
  // secret, so it is the app's one guessable-token surface: without a cap, an
  // unlimited stream of GET /api/vote/<guess> is free. 60, not 5 — unlike register
  // and demo this is an ORDINARY user action, and a whole table opening the same
  // link from one NAT address plus each of them submitting is easily a dozen
  // requests before anything goes wrong. It is not what makes guessing hopeless
  // (192 bits of token is); it just stops the endpoint being a cheap probe loop.
  const voteLinkLimit = Number(process.env.VOTE_LINK_RATE_LIMIT_MAX) || 60;

  // When behind a TLS-terminating reverse proxy (§4 of the roadmap: TLS lives at
  // the proxy), TRUST_PROXY tells Express to read the client IP from
  // X-Forwarded-For so rate limiting keys on the real caller. Left off by default
  // so a direct deployment can't be fooled by a spoofed header.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy)
      : trustProxy === 'true' ? true : trustProxy);
  }

  // Security headers. HSTS is set here (harmless over plain HTTP — browsers only
  // honour it over HTTPS, i.e. once TLS terminates at the proxy). The CSP keeps
  // helmet's safe defaults but: allows inline `style="…"` attributes (the views
  // build them for avatar colours, cover backgrounds, score pills) and `data:`
  // images (the background-grain SVG), and drops `upgrade-insecure-requests` so
  // the current plain-HTTP local deployment isn't forced onto HTTPS. img-src also
  // lists the cover hosts so the browser can render provider covers in the
  // add-game/link previews and lookup thumbnails — and, since #172, every SAVED
  // cover too, because provider covers are hotlinked rather than re-hosted. Drop
  // a host and those games' covers silently go blank, which is why that list is
  // NOT the live provider registry since #744: retiring a provider must not
  // revoke the render permission for covers already on people's shelves. See
  // .claude/rules/security-middleware.md and provider-cover-hotlinking.md.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', ...imageCspSources()],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'upgrade-insecure-requests': null,
      },
    },
  }));

  // Structured request logging (issue #132): one JSON line per request when it
  // finishes — method/path/status/timing/ip only, no bodies or query strings, so
  // no personal data is logged. Placed early so it also times rate-limited and
  // errored responses. Silence it with LOG_LEVEL=silent (the test suite does).
  app.use(requestLogger);

  // Canonical-host redirect (issue #230): 301 the branded non-canonical domains
  // (spielwirbel.de/.com + www) onto spielwirbel.app, so all traffic converges on
  // one origin. An allowlist — it never touches the canonical host, Railway's
  // *.up.railway.app, or the deploy health-check host, so health-checks don't
  // flap. Built here so it reads the current env; a no-op on local/test hosts.
  // See lib/canonical.js and .claude/rules/canonical-host-redirect.md.
  app.use(createCanonicalRedirect());

  // gzip responses (perf for the hosted deploy): round JSON compresses ~8-10x,
  // which directly cuts API latency and transfer. The middleware only compresses
  // compressible content-types, so image bytes from /uploads pass through
  // untouched, and responses under its 1 KB threshold are skipped.
  app.use(compression());

  // Liveness + readiness probes, before the rate limiter so uptime monitors
  // polling them frequently are never throttled, and before the auth gates so a
  // monitor needs no credential.
  //
  // Two endpoints, not one: /healthz says "the process is up" and answers 200
  // straight through a database outage — which is exactly the failure that takes
  // every data route down while the container looks healthy — so /readyz (#462)
  // touches the backend and answers 503 when it cannot. railway.json
  // health-checks /healthz and must keep doing so: a transient database blip
  // failing the DEPLOY health check would restart-loop the container.
  app.get('/healthz', healthz);
  app.get('/readyz', createReadyz(repo));

  // Global rate limit: a blunt DoS/abuse cap across the whole app, covering the
  // endpoints that actually cost something — /api, /uploads, the SPA fallback.
  //
  // Static shell assets are exempt (#464). index.html loads 35 <script src> tags
  // plus 6 <link>s, and the app ships 8 woff2 faces and its icons, so a load that
  // misses both the HTTP cache and the service worker costs ~50 requests — a hard
  // reload (Cmd+Shift+R) bypasses both. Against the 1000 ceiling that is ~20 hard
  // reloads before an IP locks itself out of the whole app for the rest of the
  // window, which is well inside what an operator does while diagnosing an
  // incident: the app degrades, they reload, and they trip their own DoS defence.
  // The store is in memory and per process (#215), so there is no way to clear
  // such a lockout except waiting it out or restarting. Counting a page load the
  // same as an API write was the asymmetry; exempting the shell fixes it and
  // leaves the ceiling meaningful for everything else. The shell holds no user
  // data (it is the code that is public on the repo anyway), so volumetric
  // protection for it leans on the platform edge.
  //
  // A page load now costs ONE request — the navigation — rather than ~50. SPA
  // deep links stay counted precisely because they are that navigation.
  const assetPaths = assetPathSet(ASSET_DIR);
  app.use(rateLimit({
    windowMs: GLOBAL_WINDOW_MS,
    limit: globalLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
    skip: (req) => (req.method === 'GET' || req.method === 'HEAD')
      && assetPaths.has(req.path),
  }));

  app.use(express.json());

  // Auth gate (issue #129). Active only when AUTH_PASSWORD is set; otherwise
  // every guard below is a no-op and the app stays open (current MVP). The login
  // endpoints mount first, ahead of the gate, so they stay reachable without a
  // session; a stricter limiter fronts them against password brute-forcing.
  const authLimiter = rateLimit({
    windowMs: GLOBAL_WINDOW_MS,
    limit: authLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
    // The boot probe GET /api/account/me carries no credential to brute-force
    // (a 200 needs a signed Bearer JWT), but every hard page load spends one
    // request on it — so behind this limiter, ordinary shared-IP browsing could
    // trip the ceiling, and a 429 there sent the client into a reload loop
    // (#399). The global limiter still covers it. Exactly /me on the account
    // router: /inbox and every credential endpoint stay limited.
    skip: (req) => req.method === 'GET' && req.baseUrl === '/api/account' && req.path === '/me',
  });
  app.use('/api/auth', authLimiter, require('./routes/auth'));

  // User accounts (issue #135): register/login/refresh/reset, token-first.
  // Mounted ahead of the shared-password gate (account auth must be reachable
  // without an instance session) behind the same strict limiter — but the whole
  // router 404s unless ACCOUNTS_ENABLED + SESSION_SECRET are set, so a
  // deployment that hasn't opted in exposes nothing new.
  // Round-sharing invitations (issue #207): send / accept / decline. Account-
  // scoped (the invitee reaches this before the /api tenant gate — they are a
  // stranger to the round's tenant until they accept), so it mounts here beside
  // the account router and 404s unless accounts are on, same as it. Mounted
  // BEFORE /api/account so the account router (a prefix match) doesn't field it.
  app.use('/api/account/invitations', authLimiter, requireSharedIfLayered, require('./routes/invitations'));

  // Friendships & the Freundeskreis feed (issue #325): send/accept/decline/unfriend
  // and the feed read. Account-scoped (a friendship shares no round data, so no
  // tenant gate), 404s unless accounts are on. Mounted BEFORE /api/account so the
  // account router's prefix match doesn't field it, same as invitations.
  app.use('/api/account/friends', authLimiter, requireSharedIfLayered, require('./routes/friends'));

  // Public account profiles (issue #558): one read, resolving a public username
  // to the thin profile the /u/:username screen renders. Account-scoped (a
  // profile crosses no tenant and discloses nothing tenant-private), 404s unless
  // accounts are on. Mounted BEFORE /api/account so the account router's prefix
  // match doesn't field it, same as invitations and friends.
  app.use('/api/account/profile', authLimiter, requireSharedIfLayered, require('./routes/profile'));

  // Passkeys (issue #418): register/list/rename/remove, plus the two
  // usernameless-login endpoints under .../passkeys/login. Account-scoped (a
  // passkey is an account credential, crossing no tenant), 404s unless accounts
  // are on. Mounted BEFORE /api/account so the account router's prefix match
  // doesn't field it, same as invitations, friends and profile.
  //
  // ONE mount for the whole feature, including the unauthenticated login pair —
  // a second router on /api/account would run authLimiter twice for every
  // account request and silently halve AUTH_RATE_LIMIT_MAX (see the header in
  // routes/passkeys.js).
  app.use('/api/account/passkeys', authLimiter, requireSharedIfLayered, require('./routes/passkeys'));

  const registerLimiter = rateLimit({
    windowMs: GLOBAL_WINDOW_MS,
    limit: registerLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  });
  // Registration's own tighter per-IP cap (#448), mounted BEFORE the account
  // router so it actually fields the request, and stacking with authLimiter
  // rather than replacing it (a signup spends one from each). Path-scoped and
  // method-agnostic on purpose: the router only answers POST, so a GET here is
  // already a 404 and counting it costs a prober rather than a user.
  app.use('/api/account/register', registerLimiter);

  const demoLimiter = rateLimit({
    windowMs: GLOBAL_WINDOW_MS,
    limit: demoLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  });
  // Same placement rule as register's: BEFORE the account router, or the
  // router's prefix match fields the request and this never runs.
  app.use('/api/account/demo', demoLimiter);

  app.use('/api/account', authLimiter, requireSharedIfLayered, require('./routes/account'));

  // Public contact form (issue #224): mounted ahead of the gate so an
  // unauthenticated visitor can reach it (the phone-free §5 DDG second channel).
  // Its own low limiter (CONTACT_RATE_LIMIT_MAX, default 5/window) blunts spam;
  // the server-side honeypot in the route rejects bots without a signal.
  const contactLimiter = rateLimit({
    windowMs: GLOBAL_WINDOW_MS,
    limit: contactLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  });
  app.use('/api/contact', contactLimiter, require('./routes/contact'));

  // Public, non-sensitive feature flags for the static frontend (#224/#134).
  // The shell is plain static files, so the client cannot see env — this is the
  // one place it may ask "which optional public surfaces are on?". `footer` is
  // deliberately all-or-nothing: the shared site footer holds the Kontakt link
  // (useless until mail can deliver) and the legal pages (404 until the
  // Impressum identity exists — lib/legal.js), and a partially populated
  // public face reads as broken. `donateUrl` (#173) is the operator's donation
  // page; null hides the support button entirely — absent config means the
  // feature does not exist, so self-hosted instances never advertise the
  // operator's page. Values are read per request like every other env ceiling
  // in this file; mounted ahead of the auth gates because the footer renders
  // on the login page too and the support button must work for a logged-out
  // visitor in accounts mode. Never put anything sensitive in this response.
  app.get('/api/config', (req, res) => {
    const donate = (process.env.DONATE_URL || '').trim();
    res.json({
      footer: mail.isConfigured() && legal.legalConfigured(),
      donateUrl: donate || null,
      // Whether the guest demo (#427) is available, so the landing page shows
      // its CTA only where POST /api/account/demo would actually answer. Its own
      // flag rather than a fold into `footer`: an instance can have its legal
      // surfaces configured and the demo off, and a CTA that 404s is worse than
      // no CTA. Boolean only — it reveals nothing beyond "this button works".
      demo: demo.demoEnabled(),
    });
  });

  // Public vote-by-link (issue #652): read one session's ballot, write one claimed
  // participant's votes. Mounted ahead of the gate for the same reason as the
  // contact form and the guest demo — its whole audience has no account. The token
  // in the path is the only credential, and the route answers a uniform 404 for
  // every unusable one, so nothing here distinguishes a wrong guess from a real
  // link whose session has closed. Its own per-IP limiter, stacking with the
  // global one. See lib/routes/vote-link.js.
  const voteLinkLimiter = rateLimit({
    windowMs: GLOBAL_WINDOW_MS,
    limit: voteLinkLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  });
  app.use('/api/vote', voteLinkLimiter, require('./routes/vote-link'));

  // Impressum + Datenschutzerklärung (issue #134): public, login-free,
  // server-rendered with the operator identity from env; 404 until configured.
  app.use(require('./routes/legal'));

  // FAQ (issue #489): public and login-free like the pages above — its whole
  // audience is people who have not signed up. Unlike them it never 404s; it is
  // server-rendered so each answer an instance cannot honestly give is simply
  // omitted rather than hidden by client-side JS a crawler never runs.
  app.use(require('./routes/faq'));

  // Operator moderation surface (issue #268): image lookup, takedown, account
  // suspension, action log. Mounted ahead of the app's gate for the same reason
  // as the routers above — the operator must reach it in either auth mode — and
  // behind the same strict limiter, since it takes a password. It carries its
  // own, separate gate (lib/admin.js / ADMIN_PASSWORD) and the whole router 404s
  // unless that is configured, so an instance that hasn't opted in exposes
  // nothing. The tenant middleware below deliberately does NOT apply: moderation
  // is cross-tenant by definition (see .claude/rules/admin-moderation-surface.md).
  app.use('/api/admin', authLimiter, require('./routes/admin'));

  // Static app shell + assets stay open (they hold no user data — just the code
  // that's public on the repo anyway); the real protection is on the data below.
  // `index: false` so `/` doesn't shortcut to index.html via static — it falls
  // through to the SPA fallback, which can serve the login page when locked.
  app.use(express.static(ASSET_DIR, { index: false, setHeaders: assetCacheHeaders }));
  // Cover images ARE user data, so gate /uploads (a session/account cookie rides
  // along on same-site <img> GETs). In accounts mode (#138) a valid account token
  // — Bearer header or the lax access cookie — is required; otherwise the shared
  // gate applies (a no-op when auth is disabled). The storage backend serves the
  // bytes — off local disk by default, streamed from object storage when S3 is
  // configured (issue #128) — behind this same gate.
  app.use('/uploads', uploadGate, storage.serve);

  // Gate every data route: /api/auth and /api/account already handled their own
  // paths above, so this protects all the resource routers that follow (401 when
  // locked out). In accounts mode (#138) a valid account Bearer token is required
  // — there is no anonymous 'default' access; in LAYERED mode (#266) the shared-
  // password session is required first; otherwise the shared-password gate applies
  // (a no-op when auth is disabled). Every path answers 401 'auth_required' so the
  // SPA's api() reacts identically. See apiGate above.
  app.use('/api', apiGate);

  // Tenancy (issue #136): resolve the caller's tenant once and hand every
  // resource router a repo scoped to it (req.repo) — the single enforcement
  // point for data isolation. Mounted after the gate so only authenticated
  // requests reach it.
  app.use('/api', require('./tenant').withTenant);

  // #207: re-scope a request to the round's OWNER tenant when the caller reaches
  // it through a grant. Mounted on the :rid path so it runs for every
  // round-detail router below (and GET/DELETE of the round itself), after the
  // tenant is set and before any handler touches req.repo. A no-op without a
  // matching grant, so owners and legacy callers are unaffected.
  app.use('/api/rounds/:rid', require('./tenant').resolveRoundGrant);

  // #137: enforce the grantee's ROLE. Mounted on the same path, immediately after
  // the resolver (which has set req.grant) and before every round router, so the
  // required role for a round-level action is decided in ONE place instead of by
  // a guard each handler has to remember. Owners and legacy callers hold no grant
  // and pass straight through. See lib/round-access.js for why an UNLISTED
  // mutating route is refused rather than allowed.
  app.use('/api/rounds/:rid', require('./round-access').requireRoundRole);

  // API routes (split by resource). In-app feedback (issue #260) used to mount
  // its own POST /api/feedback here; since #321 feedback is submitted through the
  // public contact form (lib/routes/contact.js, category 'feedback') and this route
  // is retired. The operator read side stays on /api/admin (lib/routes/admin.js).
  app.use('/api/rounds', require('./routes/rounds'));
  app.use('/api/rounds/:rid/games', require('./routes/games'));
  app.use('/api/rounds/:rid/members', require('./routes/members'));
  app.use('/api/rounds/:rid/sessions', require('./routes/sessions'));
  app.use('/api/rounds/:rid/activities', require('./routes/activities'));
  app.use('/api/rounds/:rid/background', require('./routes/background'));
  app.use('/api/rounds/:rid/tags', require('./routes/tags'));
  // Round-scoped since #294: the enabled-provider list is a property of the
  // round, so the lookup needs to know which round is asking.
  app.use('/api/rounds/:rid/lookup', require('./routes/lookup'));

  // SPA fallback: serve the app shell for frontend GET navigations (deep links,
  // reloads) that aren't an API call, an upload, or a real static file — the
  // client-side router (public/js/router.js) then renders the matching view.
  // Placed last so express.static and the /api routers take precedence; unknown
  // /api/* paths fall through to Express's default 404 rather than the shell.
  app.get(/(.*)/, (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    if (!req.accepts('html')) return next();
    // Pass the file relative to a `root`, not as an absolute path: res.sendFile
    // rejects (404s) any path segment starting with a dot, and an absolute path
    // includes the whole prefix — so running from a directory like a
    // `.claude/worktrees/…` checkout would otherwise fail. With `root`, only the
    // relative part ('index.html') is checked for dotfiles.
    const root = ASSET_DIR;
    // Gate the SPA shell (issue #129), checked FIRST so it holds in BOTH modes
    // where the shared gate is active — password-only AND layered (#266): an
    // unauthenticated visitor gets the standalone login page, never the SPA shell
    // (which bears the round-data UI). Only once the shared session exists — or the
    // gate is off — is the shell served. (Before #266 the accountsEnabled() branch
    // short-circuited to index.html even without the shared session, which is
    // exactly the hole layering closes: it let ACCOUNTS_ENABLED bypass login.html.)
    if (auth.authEnabled() && !auth.isAuthenticated(req)) {
      return res.sendFile('login.html', { root });
    }
    // Shared gate passed or absent. In accounts mode the SPA renders the auth UI
    // itself and the data routes above stay token-gated, so an unauthenticated
    // account still gets no round data; in every other mode this is just the shell.
    res.sendFile('index.html', { root });
  });

  // Central error handler (issue #132): must be last. Any unexpected throw or
  // next(err) — including async rejections, which Express 5 forwards here — is
  // logged + optionally alerted and answered with a generic 500, so stack traces
  // never leak to the client. See lib/observability.js.
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, assetCacheHeaders };
