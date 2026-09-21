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

// The registry entry round-theme.js falls back to when a screen has no round
// design of its own. Klassisch's entry carries no page/accent on purpose, so
// the caller's "does it have colours?" check clears the inline properties and
// the page resolves to the :root defaults — byte-for-byte today's look.
function activeDesign() {
  return designById(activeDesignId) || designById(FACE_DESIGN);
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
function applyDesign(id) {
  const design = designById(id) || designById(FACE_DESIGN);
  activeDesignId = design.id;
  document.documentElement.dataset.design = design.id;
  loadDesignStylesheet(design);
  applyBackground(null);
  return design.id;
}

// TEMPORARY (#1184): `?design=<id>` is how an unfinished design is opened for
// review until the account field and the picker land (#1186). It is not a
// back door — the id has to appear in the set GET /api/config reports, and the
// server builds that set from `enabled` under NODE_ENV=production. So in
// production this flag can only ever select a design that is already live.
function requestedDesign() {
  try {
    return new URLSearchParams(window.location.search).get('design') || '';
  } catch { return ''; }
}

// Applied synchronously first, so nothing renders undesigned while the config
// request is in flight; the query flag then re-applies once the server has said
// which designs exist. Until #1186 there is no stored per-account design, so
// the face is the only starting point.
function initDesign() {
  applyDesign(FACE_DESIGN);
  const wanted = requestedDesign();
  if (!wanted || wanted === activeDesignId) return;
  withAppConfig((cfg) => {
    const allowed = (cfg && Array.isArray(cfg.designs)) ? cfg.designs : [];
    if (allowed.indexOf(wanted) !== -1) applyDesign(wanted);
  });
}
