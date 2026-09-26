/* Spielwirbel – the USER design registry (#1184): every design an ACCOUNT can
   wear. Since the flip (#1202) it is the only design registry there is: rounds
   no longer pick a palette or a world, they carry a colour marker
   (round-marker.js) that each design paints in its own eight colours.

   A design is a page tone, an accent, a scheme and, optionally, an OVERRIDE
   STYLESHEET of its own. Klassisch is the original look, so it declares no colours
   at all: it IS the :root default in styles.css, and saying so twice is how the
   two drift. Every other design states its two colours here and ships its
   layout in public/css/designs/<id>.css, loaded on demand by design.js.

   WHY THESE TWO COLOURS LIVE HERE. paintDesign() (round-theme.js) writes `page` and `accent`
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
   PR — the flip (#1202) did it for Der Tisch.

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
//
// `marks` (#1199) is the design's brand assets: the manifest's icons, the
// favicon, the apple-touch icon and the link-preview image. Every design brings
// its own (operator decision after the Tisch review, T11.2), and three readers
// share this one list — the manifest route (lib/web-manifest.js), design.js,
// which re-points the head's <link>s when a design is worn, and
// test/design-marks.test.js, which checks every file exists at the size it
// declares. Paths are literals for the same build reason `stylesheet` is.
//
// The POSTER fields (#1277) are what the first-start chooser prints for a
// design under a design that composes it as posters (Der Tisch's T5.3/T5.4).
// Every one is OPTIONAL, and a row without them still gets a usable poster —
// test/design-posters-tisch.test.js renders one to prove it:
//
//   `wordmarkKey`  the bill's big word. Absent: the design's own name.
//   `taglineKey`   the line under it. Absent: no line.
//   `shortKey`     the phone row's one sentence. Absent: `descKey`.
//   `ritualKeys`   the words this design says at the table, joined with „·".
//                  They are the APP's own keys, not copies — a design that
//                  renames nothing (Der Tisch, T9 / B8) must show the words the
//                  app actually uses, and a copy would drift from them.
//                  Absent: no line.
//   `poster`       { ground: [top, bottom], ink, sub } — the bill's printing
//                  colours, painted INLINE from here, because a poster has to
//                  show a design's material while the page wears another, and
//                  loading every design's stylesheet to draw them is exactly
//                  what the chooser must not do. Absent: the design's
//                  `page`/`accent` through the tile's --tile-* defaults.
//
// `glyph` (#1215) is the design's own SIGN — a Tabler class the Ocean chooser
// prints on each design's postcard (O5.3 / O5.5: „Jedes Design hat ein eigenes
// Zeichen … kein stiller Markenwechsel"). Klassisch keeps the die it has always
// worn. Optional: a row without one falls back to the palette glyph.
//
// `poster` is NOT a set of tokens and is never applied to the page — which is
// why Klassisch may state one while still declaring no `page`/`accent` (it IS
// :root, and restating those would drift). test/a11y-contrast.test.js sweeps
// it: `ink` is the wordmark, set at display size, and must clear 3:1 on both
// ground stops; `sub` is small text — the tagline, and the wordmark in the
// phone's 58px tile — and must clear 4.5:1 on both.
const DESIGN_REGISTRY = [
  // The original look. No `page`/`accent`: styles.css's :root already is Klassisch,
  // so applyDesign clears the two inline properties instead of restating them —
  // which is also what makes "Klassisch renders exactly as before" provable
  // rather than merely likely.
  {
    id: 'klassisch',
    labelKey: 'design.klassisch.name',
    descKey: 'design.klassisch.desc',
    // T5.3 prints Klassisch's bill with the BRAND rather than the design's
    // name: it is the look Spielwirbel has always had.
    wordmarkKey: 'app.title',
    glyph: 'ti-dice-3',
    taglineKey: 'design.klassisch.tagline',
    shortKey: 'design.klassisch.short',
    ritualKeys: ['startSession.potHeading', 'round.startSession', 'startSession.draw'],
    poster: { ground: ['#f6f3ec', '#eae5d9'], ink: '#c2410c', sub: '#6b6358' },
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
    // They are the accents the eight retired palettes carried after #145's
    // contrast correction, so a round that wore Salbei before the flip (#1202)
    // still reads as the same sage under Klassisch.
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
    // Klassisch's marks, EXACTLY as public/manifest.webmanifest declares them —
    // test/design-marks.test.js pins the equality, so this row cannot drift from
    // the file `?design=klassisch` is answered with. The white die on orange stays
    // Klassisch's for good (T11.2: "keinen stillen Markenwechsel"); since the
    // flip (#1202) index.html's static head carries the FACE's marks instead.
    marks: {
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
      favicon: { href: '/icons/icon-192.png', sizes: '192x192' },
      appleTouch: '/icons/apple-touch-icon.png',
      og: '/icons/og-image.png',
    },
    enabled: true,
  },
  /* Der Tisch (#1188), from docs/design/tisch/Tisch-T1-Komponenten.dc.html.
     Live since the flip (#1202): every account that had not chosen wears it,
     and it is the FACE a logged-out visitor sees.

     THE PAGE IS NUSSBAUM, not the near-black the #1184 stub carried. A dark
     design's page is the reference every contrast in the app is measured
     against, and this one sits much higher than the night-coloured pages the
     dark block was first tuned on (luminance .026 against .010) — so the tuned alpha washes and the
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
    // No wordmarkKey: T5.3's bill says „Der Tisch", which is the name.
    glyph: 'ti-chess',
    taglineKey: 'design.tisch.tagline',
    shortKey: 'design.tisch.short',
    ritualKeys: ['startSession.potHeading', 'round.startSession', 'startSession.draw'],
    // Tannenfilz top stop to foot (T8.1), the gold wordmark — gold is T1's
    // display colour, legal as text on felt from 24px, and the poster sets it
    // at 25px — and T5.3's pale-green tagline ink.
    poster: { ground: ['#2f6b4d', '#1c4531'], ink: '#f0cf86', sub: '#eaf6ec' },
    scheme: 'dark',
    page: '#3b2a12',
    accent: '#d9a951',
    stylesheet: '/css/designs/tisch.css',
    // May be the FACE (#1198): the four pages outside the SPA — login.html,
    // kontakt.html, /faq and the legal pages — carry a copy of this design's
    // tokens under `:root[data-design="tisch"]`, because they never load its
    // stylesheet. test/standalone-page-brand.test.js requires that copy of every
    // design marked here, pins each value against this design's own resolved
    // token, and refuses a FACE_DESIGN that is neither Klassisch nor marked — so
    // the face can never sit on a design the public pages would render as
    // Klassisch.
    face: true,
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
    // T11.2: felt with the gold whirl, no brass edge (it smears into a grey rim
    // at 16px). The 192/512 pair is full-bleed like Klassisch's; the maskable
    // one is its own file because its whirl has to sit inside the inner 60%.
    // Rendered by scripts/render-design-marks.js — never hand-edited.
    marks: {
      icons: [
        { src: '/icons/tisch/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/tisch/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/tisch/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      favicon: { href: '/icons/tisch/favicon-32.png', sizes: '32x32' },
      appleTouch: '/icons/tisch/apple-touch-icon.png',
      og: '/icons/tisch/og-image.png',
    },
    // Which recap-card layout the share buttons draw while this design is worn
    // (recap-card-tisch.js). Absent = the classic card, unchanged.
    card: 'tisch',
    enabled: true,
  },
  /* Ocean (#1210), from docs/design/ocean/Ocean-O1-Komponenten.dc.html (the
     token source) and Ocean-O8-Farben.dc.html (the measurements). A LIGHT
     design — the first after Klassisch — so its failure class is the inverse of
     Der Tisch's: saturated colour on near-white, and text over a page-height
     gradient whose dark end nobody measured. Both real findings of the review
     (docs/design/pruefung-ocean-2026-09-20.md) lived exactly there.

     Live since its go-live (#1222): selectable in the chooser and on Konto for
     every account. The screens are #1211-#1221; nobody is moved into it, and
     the first-start chooser was deliberately not asked again for it.

     Page and accent are O1's „Seite" and „Akzent". The accent carries text on
     the page (5.5:1), the surface (6.1:1) and down to the „Flach" water stop
     (4.8:1), and on nothing darker — see the water tokens in ocean.css. */
  {
    id: 'ocean',
    labelKey: 'design.ocean.name',
    descKey: 'design.ocean.desc',
    /* The postcard (#1215, O5.3/O5.4): the wave is Ocean's sign (README point
       9 — `ti-shell` does not exist in this font). The poster runs Gischt to
       Küstenwasser, O1's own two ends of the water: the accent wordmark a
       Tisch-worn chooser prints on it is 3.6:1 on the coast stop, over the 3:1
       display bar, and the ink subline is 8.7:1 there — swept by
       test/a11y-contrast.test.js with every other poster. No ritualKeys: Ocean
       renames nothing the app says yet (O9), so it has no words of its own to
       print. */
    glyph: 'ti-wave-sine',
    shortKey: 'design.ocean.short',
    poster: { ground: ['#eef7fa', '#a9c9d8'], ink: '#0e6690', sub: '#10283a' },
    page: '#e4f1f5',
    accent: '#0e6690',
    stylesheet: '/css/designs/ocean.css',
    /* The eight markers are the eight PERSON colours (O14.1 „Farbmarker — die
       Tidenlinie dieser Runde"), in member-colors.js's own order and with the
       package's names. `deep` is each colour's DARKENED variant — the row
       review finding R1 asked to be derived for all eight, not only the three
       O8.1 draws (#8a3418, #4a4396, #6f440a, used verbatim). The other five
       are the same move in oklab: lightness x0.754 and chroma x0.83, the mean
       of those three, which lands every one of them at 7.8:1 or better on the
       surface. The darkened row is ALSO what „wer ist gerade dran" prints a
       name in at 26px (O2/O4), so ocean.css re-declares it as --person-deep-*
       tokens for the stylesheet to read; test/design-tokens.test.js pins
       the two copies equal.

       White on every one of the sixteen clears 4.5:1 (the tightest is Koralle
       at 4.52:1), so the default markerInk stands. */
    markers: [
      { key: 'koralle', labelKey: 'marker.ocean.koralle', color: '#c6522c', deep: '#8a3418' },
      { key: 'seegras', labelKey: 'marker.ocean.seegras', color: '#198663', deep: '#005b40' },
      { key: 'seeigel', labelKey: 'marker.ocean.seeigel', color: '#726bc7', deep: '#4a4396' },
      { key: 'bernstein', labelKey: 'marker.ocean.bernstein', color: '#a66815', deep: '#6f440a' },
      { key: 'anemone', labelKey: 'marker.ocean.anemone', color: '#c34d74', deep: '#892d4d' },
      { key: 'lagune', labelKey: 'marker.ocean.lagune', color: '#2f6f9e', deep: '#164a6e' },
      { key: 'tang', labelKey: 'marker.ocean.tang', color: '#54821d', deep: '#345801' },
      { key: 'purpur', labelKey: 'marker.ocean.purpur', color: '#993556', deep: '#6b1c38' },
    ],
    /* Ocean's own marks (#1222 — the go-live decided them; #1220 had scoped
       them out and the row carried Klassisch's orange die until then): the
       whirl in Gischt on the accent water. The `glyph` above is a different
       thing — the chooser postcard's sign. Rendered by
       scripts/render-design-marks.js — never hand-edited. */
    marks: {
      icons: [
        { src: '/icons/ocean/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/ocean/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/ocean/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      favicon: { href: '/icons/ocean/favicon-32.png', sizes: '32x32' },
      appleTouch: '/icons/ocean/apple-touch-icon.png',
      og: '/icons/ocean/og-image.png',
    },
    // A person's NAME prints in the marker's `deep`, never in the colour
    // itself (design.js personNameInk) — review rule 2, person colour is no text
    // under 24px here.
    personInk: 'deep',
    // O8.3's share card in its three formats (recap-card-ocean.js, #1220).
    card: 'ocean',
    enabled: true,
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
// the legal pages — and the one every account wears until it chooses (#1202
// moved it from Klassisch to Der Tisch; lib/account-design.js has the rule).
//
// The pages OUTSIDE the SPA read it too (#1198), and none of them waits for
// GET /api/config to do it, because every one would then paint Klassisch and
// repaint a moment later: /faq and the legal pages are server-rendered and
// stamp it onto <html data-design> in lib/faq.js / lib/legal.js, and
// login.html / kontakt.html load this file plus js/pages/face.js in <head>,
// synchronously, before the body exists. Each page carries its own copy of
// the tokens of every design marked `face: true` above.
const FACE_DESIGN = 'tisch';

/* The design that is always there to go back to: Klassisch, the look Spielwirbel
   started with („Wie bisher", operator decision 2026-09-19). A fixed id rather
   than FACE_DESIGN, which names the face and moved at the flip — the chooser's
   „Wie bisher" badge and the switch-back count (lib/account-design.js) both mean
   THIS design, whatever the face is. */
const CLASSIC_DESIGN = 'klassisch';

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

/* The brand marks a design wears, falling back to the face's — a design added
   without its own marks shows the face's icons rather than none. */
function designMarks(id) {
  const design = designById(id);
  return (design && design.marks) || designById(FACE_DESIGN).marks;
}

/* The manifest URL a page wearing `id` links to (#1199).

   The FACE gets the bare path, so a logged-out page, the standalone pages that
   hard-code it (login.html, kontakt.html, the FAQ) and index.html all
   agree on one URL. Any other design names itself in the query, and the route
   (lib/web-manifest.js) answers with that design's icons and colours — or with
   the face's, if the id is not selectable on this instance.

   A query parameter rather than a credentialed fetch of "the account's design":
   the page already KNOWS which design it wears, so the server never has to read
   an account to answer, the response is the same for everyone who asks for the
   same URL (cacheable, no Vary), and the access cookie keeps its one narrow job
   (the /uploads gate). The PR for #1199 records the trade-off. */
function manifestHref(id) {
  const design = designById(id);
  if (!design || design.id === FACE_DESIGN) return '/manifest.webmanifest';
  return '/manifest.webmanifest?design=' + encodeURIComponent(design.id);
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
    DESIGN_REGISTRY, FACE_DESIGN, CLASSIC_DESIGN, DESIGN_CHOOSER_REVISION, designById, designMarks, manifestHref,
    designMarkers, markerOf, markerInk, DEFAULT_MARKER_INK,
    selectableDesigns, selectableDesignIds, isSelectableDesign,
  };
}
