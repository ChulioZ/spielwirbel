/* Spielwirbel – browser-side fault reporting (issue #1149).

   Nothing that went wrong in a visitor's browser used to reach the operator.
   The worked example is the WebKit canvas-taint bug
   (.claude/rules/webkit-taints-a-canvas-on-an-svg-pattern.md): „Teilen" on a
   Rückblick threw for EVERY round on a world design, on Safari and every iOS
   browser — roughly half the app's traffic — and the only trace anywhere was
   one localized toast on the user's own screen.

   The blind spot is specifically a catch with NO SERVER INVOLVEMENT. A catch
   around an api() call is fine, because the server logs its own side; a catch
   around canvas.toBlob(), navigator.clipboard.read() or a service-worker
   registration is invisible by construction.

   Its own small file for the coverage gate
   (.claude/rules/frontend-helper-modules-and-coverage.md) and because it must
   load FIRST — before locales.js, so a throw while the rest of the shell is
   still loading is caught too. Dependency-free for the same reason: at load
   time nothing else exists yet. getLocale() is read at CALL time only, which is
   the deferred-reference shape .claude/rules/frontend-script-load-order.md
   prescribes, and it is still guarded — a fault early enough to report may be
   the very fault that stopped i18n.js from defining it.

   THE REPORTER MUST NEVER MAKE THINGS WORSE. It is fire-and-forget, swallows
   its own failures, cannot report itself (so no loop), and self-throttles by
   count and by de-duplication so a throw inside a render loop cannot hammer the
   endpoint. */

'use strict';

// The fault kinds, as a fixed enum. The client OFFERS this set and
// lib/routes/client-error.js VALIDATES against it, so it lives in ONE file
// (.claude/rules/shared-constants-across-the-stack.md) — a hand-copied server
// list is the member-colour palette bug waiting to happen.
//
// A kind names the SITE, which is why an explicit report needs no source: the
// two browser-supplied kinds carry a filename and line, and the rest are
// identified by being reported at all.
const CLIENT_ERROR_KINDS = [
  'uncaught',
  'unhandled_rejection',
  'recap_export',
  'clipboard_read',
  'sw_register',
  'storage_unavailable',
];

// Truncation is applied on BOTH sides: here so the request stays small, and at
// the route so the buffer's bound holds whatever a client sends.
const CLIENT_ERROR_MESSAGE_MAX = 200;

// Reports per page load. Small on purpose: the interesting fault is the first
// one, and everything after it is usually the same fault again.
const CLIENT_ERROR_MAX_PER_LOAD = 5;

/* ------------------------------- the path shape --------------------------- */

// Every client path carries identifiers, and one carries a live CREDENTIAL: the
// shared vote link's token is the whole credential for its two public routes
// (#652) and rides in the path, which is exactly why lib/observability.js
// reqPath() redacts the server-side spelling.
//
// So the report sends the ROUTE SHAPE, never the pathname. That is stronger
// than redacting a known-bad list: an id cannot survive at all, so a segment
// nobody thought of cannot leak, and a new route added to router.js without a
// matching entry here degrades to '/other' rather than to itself.
//
// The three lists mirror resolveRoute() in public/js/router.js. They are
// ALLOWLISTS — anything off them folds to '/other'.
const CLIENT_ERROR_SCREENS = [
  'inbox', 'freunde', 'konto', 'neu', 'entdecken', 'login', 'register', 'forgot-password',
];
const CLIENT_ERROR_ROUND_TABS = [
  'start', 'regal', 'chronik', 'pokale', 'retired', 'completed', 'wishlist',
  'recommendations', 'design', 'tags', 'settings',
];
const CLIENT_ERROR_ROUND_ITEMS = ['game', 'member', 'session'];

function clientErrorPathShape(pathname) {
  const parts = String(pathname || '').replace(/\/+$/, '').split('/').filter(Boolean);
  if (!parts.length) return '/';
  if (parts.length === 1 && CLIENT_ERROR_SCREENS.indexOf(parts[0]) !== -1) return '/' + parts[0];
  if (parts[0] === 'u' && parts.length === 2) return '/u/:username';
  if (parts[0] === 'vote' && parts.length >= 2) return '/vote/:token';
  if (parts[0] === 'round') {
    if (parts.length === 2) return parts[1] === 'new' ? '/round/new' : '/round/:rid';
    if (parts.length === 3 && CLIENT_ERROR_ROUND_TABS.indexOf(parts[2]) !== -1) {
      return '/round/:rid/' + parts[2];
    }
    if (parts.length >= 4 && CLIENT_ERROR_ROUND_ITEMS.indexOf(parts[2]) !== -1) {
      return '/round/:rid/' + parts[2] + '/:id';
    }
  }
  return '/other';
}

// A shape is exactly a string that is its OWN shape — so the server validates
// with the same function that produced the value, and there is no second regex
// to drift out of sync with the route table above.
function isClientErrorPathShape(value) {
  return typeof value === 'string' && clientErrorPathShape(value) === value;
}

/* --------------------------------- the source ----------------------------- */

// Only our own scripts under /js/. An extension or an injected script must not
// be able to write arbitrary text into a field the operator reads, so the check
// is a shape allowlist on the pathname PLUS an origin match, and the origin is
// passed in rather than read from `location` — which keeps this pure and
// testable, and makes the caller state which origin it trusts.
//
// The name pattern admits the production build's content-hashed spelling
// (js/core.js -> js/core.7e38c5aa.js, scripts/build.js), which is the ONLY one
// production ever reports.
const CLIENT_ERROR_SCRIPT_RE = /^\/(js\/[A-Za-z0-9._-]{1,60}\.js)$/;

function clientErrorSource(filename, line, origin) {
  const raw = String(filename || '');
  if (!raw || !Number.isInteger(line) || line < 1) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!origin || url.origin !== origin) return null;
  const m = url.pathname.match(CLIENT_ERROR_SCRIPT_RE);
  return m ? m[1] + ':' + line : null;
}

/* -------------------------------- the report ------------------------------ */

// A `SyntaxError`'s message QUOTES THE INPUT IT WAS PARSING, so for that one
// class the name is all we may send. Measured:
//
//   JSON.parse('{"members":["Anna Schmidt"')
//   // SyntaxError: Expected ',' or '}' after property value in JSON at position 26
//   //   …and in Chrome the message embeds a snippet of the string itself.
//
// Any unhandled rejection from a `res.json()` is therefore a rejection whose
// message may carry round, member or session data — the exact trap
// .claude/rules/logging-a-caught-fault.md §1 records for loadData() on the
// server, pointed the other way. Nothing diagnostic is lost: for a parse error
// the class plus `source` is the whole story.
const CLIENT_ERROR_OPAQUE = ['SyntaxError'];

function clientErrorMessage(error) {
  if (error && CLIENT_ERROR_OPAQUE.indexOf(error.name) !== -1) return error.name;
  const raw = typeof error === 'string' ? error : (error && error.message);
  const text = String(raw == null ? '' : raw).trim();
  return text ? text.slice(0, CLIENT_ERROR_MESSAGE_MAX) : null;
}

// Per page load, so both bounds reset on navigation rather than on a timer.
let clientErrorsSent = 0;
let clientErrorsSeen = [];

// The report to send, or null when it must not be sent at all: an unknown kind
// (a typo at a call site must not become an untracked stream — the same
// discipline as trackEvent's EVENTS set), the per-load cap, or a duplicate.
//
// De-duplication is on kind + message + source, which is what collapses a throw
// inside a render loop into one request. Kept separate from the send so the
// whole decision is testable without a network or a document.
function clientErrorReport(kind, opts) {
  const o = opts || {};
  if (CLIENT_ERROR_KINDS.indexOf(kind) === -1) return null;
  if (clientErrorsSent >= CLIENT_ERROR_MAX_PER_LOAD) return null;

  const message = clientErrorMessage(o.error);
  const source = clientErrorSource(o.filename, o.line, o.origin);
  const key = kind + '|' + message + '|' + source;
  if (clientErrorsSeen.indexOf(key) !== -1) return null;
  clientErrorsSeen.push(key);
  clientErrorsSent += 1;

  const report = { kind };
  if (message) report.message = message;
  if (source) report.source = source;
  report.path = clientErrorPathShape(o.pathname);
  if (o.locale) report.locale = o.locale;
  return report;
}

// Test seam: the two bounds are per page load, and a spec drives several loads.
function resetClientErrorBudget() {
  clientErrorsSent = 0;
  clientErrorsSeen = [];
}

// The one impure entry point. `where` carries { filename, line } for the two
// browser-supplied kinds; an explicit call omits it.
//
// Everything is inside one try/catch and the fetch rejection is swallowed, so
// the reporter can neither throw (which would fire the 'error' handler below
// and recurse) nor reject (which would fire 'unhandledrejection' and do the
// same). keepalive, so a report from a page that is unloading still goes out.
function reportClientError(kind, error, where) {
  try {
    const w = where || {};
    const report = clientErrorReport(kind, {
      error: error,
      filename: w.filename,
      line: w.line,
      pathname: window.location.pathname,
      origin: window.location.origin,
      locale: typeof getLocale === 'function' ? getLocale() : null,
    });
    if (!report) return;
    window.fetch('/api/client-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(function () {});
  } catch {
    // Best-effort by design: a broken reporter must not break the page it is
    // reporting about.
  }
}

// window 'error' also fires for a failed <img>/<script> LOAD, but only in the
// capture phase and without a message — a bubbling listener that checks
// `message` sees script errors only, which is what we want. A resource 404 is
// the server's business, not a browser fault.
function installClientErrorReporting() {
  window.addEventListener('error', function (e) {
    if (!e || !e.message) return;
    reportClientError('uncaught', e.error || e.message, { filename: e.filename, line: e.lineno });
  });
  window.addEventListener('unhandledrejection', function (e) {
    reportClientError('unhandled_rejection', e && e.reason);
  });
}

// Installed at load time rather than from main.js, so a throw anywhere in the
// rest of the shell — including one that stops main.js running at all — is
// still reported. Guarded so `require`ing this file into Node for its pure
// helpers does nothing.
try {
  if (typeof window !== 'undefined' && window.addEventListener) installClientErrorReporting();
} catch { /* see reportClientError */ }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CLIENT_ERROR_KINDS,
    CLIENT_ERROR_MESSAGE_MAX,
    CLIENT_ERROR_MAX_PER_LOAD,
    clientErrorPathShape,
    isClientErrorPathShape,
    clientErrorSource,
    clientErrorMessage,
    clientErrorReport,
    resetClientErrorBudget,
  };
}
