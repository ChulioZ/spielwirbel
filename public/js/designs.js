/* Spielwirbel – the USER design registry (#1184): every design an ACCOUNT can
   wear, as opposed to round-designs.js, which lists every design a ROUND can
   pick. The two coexist deliberately for the whole transition — rounds keep
   their palettes and worlds until the flip (#1202) — so do not fold one into
   the other, and do not read an entry here as a round background.

   A design is a page tone, an accent, a scheme and, optionally, an OVERRIDE
   STYLESHEET of its own. Klassisch is today's look, so it declares no colours
   at all: it IS the :root default in styles.css, and saying so twice is how the
   two drift. Every other design states its two colours here and ships its
   layout in public/css/designs/<id>.css, loaded on demand by design.js.

   WHY THE COLOURS LIVE HERE AND NOT IN THE STYLESHEET. test/a11y-contrast.test.js
   resolves every token FOR A DESIGN out of styles.css given `page`, `accent` and
   `scheme` (test/support/theme.js). A colour declared in a design's own override
   file is therefore invisible to that suite — it would ship unmeasured, which is
   exactly the regression #145 was about. So: colours here, layout there. A
   design that genuinely needs to override a DERIVED token (--surface, --ink, …)
   has to teach the harness to read design stylesheets first; that is a note for
   #1188, not a thing to do quietly.

   `enabled` is the gate, in code rather than in an env var (operator decision
   2026-09-20: a switch that is never true before the flip and never false after
   it is not configuration). In production only enabled designs exist; outside it
   every registered design is selectable, so an unfinished one can be built and
   reviewed on dev-temp-data and in the tests. Enabling a design is a one-line
   PR — which is what the flip issue does.

   Dependency-free with the module.exports guard, for two reasons: the contrast
   harness requires it, and so does the SERVER — lib/app.js answers GET
   /api/config with the selectable ids, and lib/routes/account.js will validate
   PATCH /me against the same list (#1186). One list, no copy
   (.claude/rules/shared-constants-across-the-stack.md). */

'use strict';

// One row per design. `labelKey` is deliberately absent until the picker exists
// (#1186): nothing renders a design's name yet, and nine locales' worth of dead
// keys would be added blind. `markers` (the eight round colours each design
// renders in its own way) belongs to #1187 for the same reason.
//
// `stylesheet` is a LITERAL, quoted path on purpose. The production build
// (#141) content-hashes public/css/** and rewrites quoted references to it, and
// it can only rewrite what it can see as a string — a path assembled at runtime
// ('/css/designs/' + id + '.css') would survive the build unrewritten and 404,
// because the un-hashed copy is deleted. See
// .claude/rules/design-stylesheets-are-shell-assets.md.
const DESIGN_REGISTRY = [
  // Today's look. No `page`/`accent`: styles.css's :root already is Klassisch,
  // so applyDesign clears the two inline properties instead of restating them —
  // which is also what makes "Klassisch renders exactly as before" provable
  // rather than merely likely.
  { id: 'klassisch', enabled: true },
  // A STUB (#1184). The gold is the reviewed package's dominant accent
  // (docs/design/tisch/), but no Tisch screen exists yet: its stylesheet holds
  // placeholder layout tokens only, and the real T1/T8 token set lands with
  // #1188. `enabled: false` keeps it out of production entirely.
  //
  // The felt is DARKER than the package's `#3f6a48` surface tone, and that is a
  // measurement rather than a preference: styles.css's dark block derives
  // --surface, --sunken and both inks from --page-bg, so three of the app's
  // tuned washes (the winners' 22% gold, the dock's 14% brand, the friend
  // tile's 11% cover) put --ink-soft below 4.5:1 once the page rises much past
  // Obsidian's luminance. Measured with the whole contrast suite: `#131d17`
  // fails those three at 4.28-4.39:1 and this clears all 52 checks. Those
  // alphas are shipped and tuned, so a NEW design moves its own page rather
  // than lowering them — each of the three test messages says so. #1188 picks
  // the real felt against the same suite.
  {
    id: 'tisch',
    scheme: 'dark',
    page: '#0f1712',
    accent: '#f0cf86',
    stylesheet: '/css/designs/tisch.css',
    enabled: false,
  },
];

// The design a logged-OUT surface wears — the landing page, the login screen,
// the legal pages. Klassisch until the flip (#1202) moves the face to Tisch.
const FACE_DESIGN = 'klassisch';

function designById(id) {
  return DESIGN_REGISTRY.find((d) => d.id === id) || null;
}

// The designs that may be applied at all. `production` is passed in rather than
// read off process.env here, because this file also runs in the browser, where
// there is no such thing — the server decides and tells the client through GET
// /api/config.
function selectableDesigns({ production = false } = {}) {
  return production ? DESIGN_REGISTRY.filter((d) => d.enabled) : DESIGN_REGISTRY.slice();
}

function selectableDesignIds(opts) {
  return selectableDesigns(opts).map((d) => d.id);
}

// An allowlist test, never a denylist: an id this file has never heard of is
// refused, which is what keeps a hand-crafted PATCH or a stale client from
// putting an arbitrary string on <html data-design>.
function isSelectableDesign(id, opts) {
  return typeof id === 'string' && selectableDesigns(opts).some((d) => d.id === id);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DESIGN_REGISTRY, FACE_DESIGN, designById,
    selectableDesigns, selectableDesignIds, isSelectableDesign,
  };
}
