/* Spielwirbel – applying a USER design (#1184): the root attribute every design
   rule keys off, the override stylesheet fetched on demand, and the tokens
   round-theme.js falls back to when no round design is in force.

   The seam, stated once because everything after this issue is "one more
   design":

   - `<html data-design="…">` is the hook. An attribute, not a custom property,
     for the same reason data-world is one — a whole family of rules has to
     switch at once, and only a selector can do that.
   - A design's COLOURS come from the registry (designs.js) and are written as
     the same two inline custom properties a round design uses, by the same
     function (applyBackground). One writer, so the two can never disagree.
   - A design's LAYOUT comes from its own stylesheet, injected once, only when
     the design is actually applied. Klassisch has none: styles.css is Klassisch.
   - Nothing is ever CLEARED. A round's design still wins while it is applied —
     rounds keep their palettes and worlds until the flip (#1202) — but leaving
     a round falls back to the user's design rather than to the :root defaults.

   No module.exports: every function here touches `document`, so requiring it
   from Node would enter the coverage report almost entirely unreachable and
   drag coverage:ci under its floor
   (.claude/rules/frontend-helper-modules-and-coverage.md). The specs reach
   these through the jsdom harness (test/support/dom.js). */

'use strict';

// The design currently worn. Module state rather than a read of the DOM
// attribute: round-theme.js asks this on every repaint, and an attribute a
// hand-edited page could carry is not a thing to trust as a registry key.
let activeDesignId = FACE_DESIGN;

// The design the screen on display was RENDERED under, and whether any screen
// has been rendered yet. Distinct from activeDesignId because a chooser preview
// repaints without committing: the screen underneath still carries the markup of
// the committed design, and it is the committed one a save has to compare with.
let committedDesignId = FACE_DESIGN;
let designViewsAreReady = false;

// Called by routeTo() once the first screen has rendered. Before that there is
// nothing to re-render, and currentView() is still its showHome default — so a
// re-render during boot would paint the home screen over the cold load.
function designViewsReady() {
  designViewsAreReady = true;
}

// The registry entry round-theme.js falls back to when a screen has no round
// design of its own. Klassisch's entry carries no page/accent on purpose, so
// the caller's "does it have colours?" check clears the inline properties and
// the page resolves to the :root defaults — byte-for-byte today's look.
function activeDesign() {
  return designById(activeDesignId) || designById(FACE_DESIGN);
}

// THE one question a view asks when a design composes a screen differently
// (#1262 and its sibling Tisch structure issues): "is this design worn right
// now?". Every branch in a view goes through here rather than reading
// <html data-design> itself, so there is one place that answers it and one
// grep that finds every screen a design restructures. Klassisch is never
// branched on — its DOM is the default path, untouched.
function designIs(id) {
  return activeDesign().id === id;
}

// 'dark' or 'light' for the design in force. round-theme.js's setScheme uses it
// as the fallback, which is what keeps a dark user design dark on home, the
// account screens and every other surface outside a round.
function designScheme() {
  const d = activeDesign();
  return d && d.scheme === 'dark' ? 'dark' : 'light';
}

// Injected once per design and then left in place: switching back to Klassisch
// makes the rules stop matching on their own, so re-fetching on every change
// would buy nothing. `data-design` on the link is the idempotence key.
function loadDesignStylesheet(design) {
  if (!design || !design.stylesheet) return;
  if (document.querySelector('link[data-design="' + design.id + '"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = design.stylesheet;
  link.dataset.design = design.id;
  document.head.appendChild(link);
}

/* The head's brand links follow the design (#1199): the manifest (so an install
   takes this design's icon and theme colour), the favicon and the apple-touch
   icon (which iOS reads off the DOM at "Add to Home Screen" time — there is no
   manifest step to hook).

   Written only when the value actually differs. For the face that is never:
   index.html ships exactly the face's marks (test/design-marks.test.js pins
   the equality), so a Klassisch visitor's head is not touched at all — and a
   manifest <link> whose href is re-set is a manifest the browser may re-fetch.

   The link-preview image is deliberately not here: scrapers never run this
   script, so og:image is whatever index.html says, which is the face's. */
function setHeadLink(selector, href, sizes) {
  const link = document.querySelector(selector);
  if (!link || !href) return;
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  if (sizes && link.getAttribute('sizes') !== sizes) link.setAttribute('sizes', sizes);
}

function applyDesignMarks(design) {
  const marks = designMarks(design.id);
  setHeadLink('link[rel="manifest"]', manifestHref(design.id));
  setHeadLink('link[rel="icon"]', marks.favicon.href, marks.favicon.sizes);
  setHeadLink('link[rel="apple-touch-icon"]', marks.appleTouch);
}

// Wear a design. An unknown id falls back to the face rather than throwing: the
// only callers are boot and (from #1186) the picker, and a stored id whose
// design has since been retired must not leave the app unpainted.
//
// Deliberately POLICY-FREE: this paints whatever it is given, and does not ask
// whether the design is selectable. It cannot — `enabled` is resolved against
// NODE_ENV, which exists only on the server. The gate therefore lives at the
// two boundaries that can enforce it: initDesign() below, which applies only
// what GET /api/config listed, and PATCH /me, which validates before storing
// (#1186). Adding a check here would look like a gate while being one a page's
// own console can step around, which is worse than none.
//
// applyBackground(null) at the end is not a clear — it is the repaint. It means
// "no ROUND design here", which round-theme.js now resolves to this design's
// tokens. Keeping it as the single writer of --page-bg/--brand is what stops
// the two layers from fighting over the same two properties.
//
// A screen that branches on designIs() builds its markup once, so a COMMITTED
// change re-renders the current screen (#1266) — otherwise it keeps the old
// markup under the new stylesheet. Two callers opt out:
// - `{ preview: true }` — the chooser's live preview. It repaints only and
//   commits nothing, so the save that follows re-renders the screen underneath;
//   re-rendering on each preview would rebuild the chooser and lose the pick.
// - `{ rendering: true }` — a view setting the design as part of its OWN render
//   (the vote-link page). It commits without re-rendering, or the view would
//   re-enter itself through currentView().
function applyDesign(id, { preview = false, rendering = false } = {}) {
  const design = designById(id) || designById(FACE_DESIGN);
  activeDesignId = design.id;
  document.documentElement.dataset.design = design.id;
  loadDesignStylesheet(design);
  applyDesignMarks(design);
  applyBackground(null);
  if (preview) return design.id;
  const changed = design.id !== committedDesignId;
  committedDesignId = design.id;
  if (changed && !rendering && designViewsAreReady) currentView();
  return design.id;
}

// TEMPORARY (#1184): `?design=<id>` is how an unfinished design is opened for
// review. It is not a back door — the id has to appear in the set GET
// /api/config reports, and the server builds that set from `enabled` under
// NODE_ENV=production. So in production this flag can only ever select a design
// that is already live.
function requestedDesign() {
  try {
    return new URLSearchParams(window.location.search).get('design') || '';
  } catch { return ''; }
}

/* THE DEVICE FALLBACK (#1186), for an instance running with accounts OFF.
   A self-hosted, shared-password instance has no account to hang the choice on,
   so the design lives on the device instead — the same shape and the same
   guards as the locale in i18n.js.

   try/catch on BOTH sides: localStorage throws outright in a Safari private
   window and wherever site data is blocked, and a design preference is not worth
   a boot that dies before the first render
   (.claude/rules/preview-pane-paint-artifacts.md's family — the browser lying
   about storage rather than about pixels). A value this build has never heard of
   reads as nothing, so a retired design leaves the page on the face rather than
   unpainted. */
const DEVICE_DESIGN_KEY = 'design';

function storedDesign() {
  try {
    return localStorage.getItem(DEVICE_DESIGN_KEY) || '';
  } catch { return ''; }
}

function storeDesign(id) {
  try {
    localStorage.setItem(DEVICE_DESIGN_KEY, id);
  } catch { /* private mode / blocked site data: the choice just does not persist */ }
}

/* Wear the design the SESSION says to, and answer which one that is.

   Called from bootApp once the account state is resolved, from enterApp after a
   login, and from the picker after a change — i.e. every point at which the
   answer can differ from what boot painted. Deliberately tolerant of being
   called when nothing has changed: applyDesign is idempotent.

   The precedence is accounts-first and it matters. With accounts ON, the stored
   account field is the whole answer and the device key is not consulted at all —
   otherwise a user who picked Tisch on their laptop would keep seeing a stale
   device value on it after switching to Klassisch on their phone. With accounts
   OFF there is no account, so the device key IS the answer.

   `?design=` still wins over both, because its whole job is to preview a design
   without storing anything (and the server has already vetted it). */
function applyAccountDesign() {
  if (typeof accountsActive === 'function' && accountsActive()) {
    const me = typeof accountUser !== 'undefined' ? accountUser : null;
    return applyDesign((me && me.design) || FACE_DESIGN);
  }
  return applyDesign(storedDesign() || FACE_DESIGN);
}

// Applied synchronously first, so nothing renders undesigned while the account
// probe and the config request are in flight. The device key is read here
// because it costs nothing and removes a visible repaint on an accounts-off
// instance; with accounts on it is absent, so this resolves to the face and
// applyAccountDesign() settles it a moment later.
function initDesign() {
  applyDesign(storedDesign() || FACE_DESIGN);
  const wanted = requestedDesign();
  if (!wanted || wanted === activeDesignId) return;
  withAppConfig((cfg) => {
    const allowed = (cfg && Array.isArray(cfg.designs)) ? cfg.designs : [];
    if (allowed.indexOf(wanted) !== -1) applyDesign(wanted);
  });
}
