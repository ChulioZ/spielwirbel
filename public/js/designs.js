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

   WHY THESE TWO COLOURS LIVE HERE. applyBackground() writes `page` and `accent`
   as INLINE custom properties on <html>, which outrank every stylesheet — so a
   copy of either in a design's own file would be dead text that reads as the
   source of truth.

   The DERIVED tokens (--surface, --ink, the gold family) are a different
   question, and #1188 answered it: test/support/theme.js now resolves a token
   through the design's own `:root[data-design="<id>"]` block before styles.css,
   so a colour declared THERE is swept by the contrast suite exactly like a
   :root token. Der Tisch uses that for its walnut surface and paper ink. What
   is still forbidden is a colour anywhere ELSE in the file — the resolver does
   not read component rules, so one there ships unmeasured, which is exactly the
   regression #145 was about. See
   .claude/rules/design-stylesheets-are-shell-assets.md and
   .claude/rules/design-colour-blocks-are-scheme-gated.md.

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

// One row per design. `labelKey`/`descKey` name the i18n keys the picker renders
// (#1186). Both are EXPLICIT fields rather than keys assembled from the id, so a
// grep for 'design.tisch.name' finds the registry row AND the nine lang files —
// an assembled key is invisible to exactly the search that would catch a missing
// translation (.claude/rules/source-scanning-guards-enumerate-shapes.md).
// `markers` is the eight round colours this design paints a round's marker
// index with (#1187) — see public/js/round-marker.js for why the stored value
// is an index and not one of these hexes.
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
  {
    id: 'klassisch',
    labelKey: 'design.klassisch.name',
    descKey: 'design.klassisch.desc',
    // The eight ACCENTS of the eight light palettes, in the palettes' own order
    // (#1187) — not their page tones. The accent is what identified a palette:
    // three of the eight pages are near-identical creams (#f4f1ea / #f6efe2 /
    // #f8ede6) and two are near-identical greys, so a page-tone marker would
    // barely tell two rounds apart. The accents are also the values #145
    // already tuned to carry 4.5:1 against white, which is exactly the bar a
    // marker has to clear as a FILL under the emblem glyph.
    //
    // `deep` is each accent at 74% of every channel — the darker stop for the
    // band's foot and the card edge. Written out as hex rather than a runtime
    // color-mix() because the recap card paints on a CANVAS, where there is no
    // cascade to resolve one against.
    //
    // Keep these equal to round-designs.js's light PALETTES until the flip
    // (#1202) retires that file: test/round-marker.test.js pins the pair, so a
    // second #145-style accent correction cannot move one and not the other.
    markers: [
      { key: 'standard', labelKey: 'theme.standard', color: '#c2410c', deep: '#8f3009' },
      { key: 'blaugrau', labelKey: 'theme.blaugrau', color: '#3a67b1', deep: '#2a4c83' },
      { key: 'salbei', labelKey: 'theme.salbei', color: '#397a4b', deep: '#2a5a37' },
      { key: 'rose', labelKey: 'theme.rose', color: '#b23a72', deep: '#832a54' },
      { key: 'lavendel', labelKey: 'theme.lavendel', color: '#6d55c4', deep: '#503e91' },
      { key: 'sand', labelKey: 'theme.sand', color: '#91641a', deep: '#6b4a13' },
      { key: 'schiefer', labelKey: 'theme.schiefer', color: '#33688f', deep: '#254c69' },
      { key: 'pfirsich', labelKey: 'theme.pfirsich', color: '#b34d2e', deep: '#843922' },
    ],
    enabled: true,
  },
  /* Der Tisch (#1188), from docs/design/tisch/Tisch-T1-Komponenten.dc.html.
     Still `enabled: false` — the screens are #1189-#1200 and the flip is #1202.

     THE PAGE IS NUSSBAUM, not the near-black the #1184 stub carried. A dark
     design's page is the reference every contrast in the app is measured
     against, and this one sits much higher than the four night-coloured worlds
     (luminance .026 against Obsidian's .010) — so the tuned alpha washes and the
     dark block's neutral percentages land closer together on it, and two derived
     tokens have to be re-picked in tisch.css rather than inherited. That is
     recorded there, at the tokens themselves.

     THE ACCENT IS MESSING, not the gold the stub used. Gold #f0cf86 is T1's
     RANK colour — „Siegerzeile, Pokale, Krone — nie Aktion" — and --brand is the
     app's action colour: every primary button, active chip and .link-btn. The
     two jobs are not the same one, so gold stays in the gold family (below, in
     the stylesheet) and brass carries --brand. Brass also satisfies the dark
     constraint --brand has and gold's job does not: it is light enough to read
     as link text on the page (6.4:1) while taking dark ink as a fill (6.4:1),
     which is the flip .claude/rules/dark-designs-and-the-on-accent-flip.md §1
     describes. */
  {
    id: 'tisch',
    labelKey: 'design.tisch.name',
    descKey: 'design.tisch.desc',
    scheme: 'dark',
    page: '#3b2a12',
    accent: '#d9a951',
    stylesheet: '/css/designs/tisch.css',
    // The eight FELTS of docs/design/tisch/Tisch-T8-Farben.dc.html -> "T8.1
    // Filze", in the package's own order, so index 0 is Tannenfilz — the
    // default the sheet marks. `color` is the felt's light gradient stop and
    // `deep` its low end, which is the pair the package measures: paper ink
    // #f6ecd8 clears 4.5:1 on every LIGHT stop (Ockerfilz is the tight one at
    // 4.56:1), so a felt that is retuned has that number recomputed.
    //
    // Tisch's RENDERING of the marker is #1189/#1191/#1199's; only the colours
    // live here, because the registry is what makes the index design-neutral —
    // the machinery is not provably plural with one design's set in it.
    markerInk: '#f6ecd8',
    markers: [
      { key: 'tannenfilz', labelKey: 'marker.tisch.tannenfilz', color: '#2f6b4d', deep: '#1c4531' },
      { key: 'kobaltfilz', labelKey: 'marker.tisch.kobaltfilz', color: '#2f5d7a', deep: '#16354a' },
      { key: 'burgunderfilz', labelKey: 'marker.tisch.burgunderfilz', color: '#7a2f3f', deep: '#461b25' },
      { key: 'pflaumenfilz', labelKey: 'marker.tisch.pflaumenfilz', color: '#5d4a7a', deep: '#33264a' },
      { key: 'tabakfilz', labelKey: 'marker.tisch.tabakfilz', color: '#6b4a2f', deep: '#3d2917' },
      { key: 'moosfilz', labelKey: 'marker.tisch.moosfilz', color: '#4a5b2f', deep: '#2a341a' },
      { key: 'taubenfilz', labelKey: 'marker.tisch.taubenfilz', color: '#44525c', deep: '#262f36' },
      { key: 'ockerfilz', labelKey: 'marker.tisch.ockerfilz', color: '#7a6a2f', deep: '#443a1a' },
    ],
    enabled: false,
  },
];

/* Which run of the first-start chooser an account has seen (#1186). A REVISION
   rather than a boolean, so adding a design later can ask everyone once more by
   moving this string — a boolean would make that impossible without a data
   migration, which the JSON backend does not do (CLAUDE.md).

   Stamped SERVER-side (POST /design-chooser-seen), never sent by the client, for
   the same reason newsRevision() is: a client that chose its own value could
   claim to have seen a run that does not exist and silence the chooser forever. */
const DESIGN_CHOOSER_REVISION = '2026-09-22';

// The design a logged-OUT surface wears — the landing page, the login screen,
// the legal pages. Klassisch until the flip (#1202) moves the face to Tisch.
const FACE_DESIGN = 'klassisch';

/* The ink a design writes ON its markers, and the one place the default lives.

   NOT `--on-accent`, which is the reflex and is wrong here for the reason
   `.claude/rules/theme-derived-colors.md` records for `--gold-ink`: a fill that
   does NOT flip with the scheme needs an ink that does not flip either. Every
   marker in the registry is a dark, saturated tone — Klassisch's are the palette
   accents, Tisch's are felts — so the ink is light in both directions, while
   `--on-accent` is white on a light design and near-black on a dark one. Under
   Der Tisch that put the picker's check glyph at 2.81:1 on Tannenfilz, measured;
   white is 4.5:1 or better on all sixteen.

   A design may still state its own: Tisch writes its package's paper #f6ecd8
   rather than pure white. test/a11y-contrast.test.js sweeps whichever value the
   design declares against both stops of all eight of its markers. */
const DEFAULT_MARKER_INK = '#ffffff';

function markerInk(id) {
  const design = designById(id);
  return (design && design.markerInk) || DEFAULT_MARKER_INK;
}

/* The eight marker colours a design paints an index with. Every registry row
   declares them, so this never returns a short list — but a design added without
   them would silently render `undefined` on four surfaces, which is why
   test/round-marker.test.js loops the whole registry rather than the two rows
   that exist today. */
function designMarkers(id) {
  const design = designById(id);
  return (design && design.markers) || [];
}

function markerOf(designId, index) {
  const markers = designMarkers(designId);
  return markers[index] || markers[0] || null;
}

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
    DESIGN_REGISTRY, FACE_DESIGN, DESIGN_CHOOSER_REVISION, designById,
    designMarkers, markerOf, markerInk, DEFAULT_MARKER_INK,
    selectableDesigns, selectableDesignIds, isSelectableDesign,
  };
}
