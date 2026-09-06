/* Spielwirbel – the design registry (#903): every design a round can pick.

   Two lists. PALETTES are the colour schemes — a page tone and an accent, from
   which styles.css derives every other tone. WORLDS are designs with a
   personality on top of the colours: a display face, a backdrop motif and
   ornament framing, keyed off `<html data-world="…">`, which applyBackground()
   (core.js) sets from the entry's `world`. A world is ADDITIVE over the same two
   tokens a palette sets, so an unstyled world degrades to a palette
   (.claude/rules/theme-derived-colors.md).

   Every design has a STABLE id and the stored shape is
   `{ type: 'theme', id, page, accent }`. Before this file a design was
   identified by its page hex — workable for eight palettes, impossible for
   worlds, whose ornaments cannot be derived from `#ecf1e4`. Rounds saved back
   then carry no id, so resolveDesign() keeps the hex lookup as the LEGACY path:
   render-time resolution, the same approach resolveAccent documents for the
   #145 accent correction, and the reason this repo has no migration code
   (CLAUDE.md). That fallback searches PALETTES only — worlds did not exist when
   hex-only rounds were saved, so a world's page hex without an id is never a
   world.

   Dependency-free with the module.exports guard so the specs and the contrast
   harness can require it (.claude/rules/frontend-helper-modules-and-coverage.md).
   The SERVER deliberately does not: lib/routes/background.js stores the id
   without checking it against this list, because an unknown id resolves to the
   plain palette here, and a server-side check would turn the list into a
   cross-boundary contract (.claude/rules/shared-constants-across-the-stack.md). */

'use strict';

// Coordinated colour schemes: a page tone + a matching accent. The first is the
// default (warm cream + orange). Labels are translation keys. Accents are kept
// soft and slightly muted so they sit well next to the member colours, the gold
// family and the neutral surfaces.
//
// `scheme: 'dark'` (#904) is the third field a design may carry, and it is the
// ONLY thing that says a page is dark: applyBackground() puts it on
// <html data-scheme> and styles.css re-derives --surface, --ink, the neutral
// direction and every ink-on-a-fill from there. It is declared rather than
// measured from `page` so the registry stays the single statement of what a
// design IS — but the two must agree, and test/a11y-contrast.test.js fails a
// dark page that forgot to say so (and a light one that claims it).
const PALETTES = [
  { id: 'standard', labelKey: 'theme.standard', page: '#f4f1ea', accent: '#c2410c', std: true },
  { id: 'blaugrau', labelKey: 'theme.blaugrau', page: '#eef2f7', accent: '#3a67b1' },
  { id: 'salbei', labelKey: 'theme.salbei', page: '#eaf1ea', accent: '#397a4b' },
  { id: 'rose', labelKey: 'theme.rose', page: '#f6ecf1', accent: '#b23a72' },
  { id: 'lavendel', labelKey: 'theme.lavendel', page: '#efedf8', accent: '#6d55c4' },
  // Sand and Pfirsich were darkened for contrast (#145): the accent is not just
  // a fill, it is also link/breadcrumb TEXT on the page (`--brand`), and at
  // #a2701d / #c95633 those two sat at 3.8:1 — so picking either theme put every
  // link in the app below AA. Both now clear 4.5:1 on their own page and on
  // white. Any new design has to clear both; test/a11y-contrast.test.js loops
  // this whole file, worlds included.
  { id: 'sand', labelKey: 'theme.sand', page: '#f6efe2', accent: '#91641a' },
  { id: 'schiefer', labelKey: 'theme.schiefer', page: '#e9eef3', accent: '#33688f' },
  { id: 'pfirsich', labelKey: 'theme.pfirsich', page: '#f8ede6', accent: '#b34d2e' },
  // The one dark palette: the token machinery with no ornament in the way, which
  // is also the harder contrast case — nothing hides behind artwork. Named for
  // the stone, like Sand and Schiefer, rather than for the time of day: „Nacht"
  // / "Night" is a word test/session-naming.test.js correctly refuses, because
  // it cannot tell a design label from a name for the evening itself (#899).
  { id: 'obsidian', labelKey: 'theme.obsidian', page: '#141318', accent: '#b98df0', scheme: 'dark' },
];

// Worlds. `world` is the data-world value (the id itself), `font` the display
// face declared in styles.css (self-hosted, fetched only when a rule applies
// it), `icon` the emblem glyph on the home tile. Each world's ornament set is
// CSS only — the six slots under "Worlds" in styles.css.
//
// Sci-Fi went DARK in #904 (page #e9eff5 -> #0e1622, accent #2c5c9c -> #4fb3ef).
// Its six ornaments — a circuit grid, a ringed planet, a starfield — were drawn
// for a night sky and shipped on a pale blue page only because the stylesheet
// could not express a dark one at the time (#903 scoped that out). A round that
// picked it keeps its `id`, so resolveDesign() hands back these colours and the
// round turns dark on its next render: the same render-time correction the
// #145 accent fix used, and the reason there is no migration.
const WORLDS = [
  { id: 'forest', labelKey: 'theme.forest', page: '#ecf1e4', accent: '#356427', world: 'forest', font: 'Averia Serif Libre', icon: 'ti-trees' },
  { id: 'scifi', labelKey: 'theme.scifi', page: '#0e1622', accent: '#4fb3ef', world: 'scifi', font: 'Chakra Petch', icon: 'ti-planet', scheme: 'dark' },
  // The four content worlds (#905). Each clears the same two bars as the first
  // two — the accent as text on its own page and on its own surface — and none
  // shares a page hex with a palette (test/round-designs.test.js). Dinosaurs is
  // the one drawn AGAINST its neighbours: warm and prehistoric like half the
  // registry, so it takes fossil and rock rather than foliage (that is Forest)
  // and a fern-teal accent on limestone rather than bone-cream (Sand, Standard).
  // Ocean therefore sits on marine BLUE, not teal, so the two never meet.
  // Horror takes the dark page #904 made possible: a near-black plum with an
  // acid-green accent — the one accent family no other design uses.
  { id: 'ocean', labelKey: 'theme.ocean', page: '#e4f1f5', accent: '#0e6690', world: 'ocean', font: 'Comfortaa', icon: 'ti-fish' },
  { id: 'chess', labelKey: 'theme.chess', page: '#f3f2f5', accent: '#38343f', world: 'chess', font: 'Playfair Display', icon: 'ti-chess-knight' },
  { id: 'horror', labelKey: 'theme.horror', page: '#120c14', accent: '#9fdc70', world: 'horror', font: 'Creepster', icon: 'ti-ghost', scheme: 'dark' },
  { id: 'dinos', labelKey: 'theme.dinos', page: '#f3efe3', accent: '#0f6b5f', world: 'dinos', font: 'Alfa Slab One', icon: 'ti-bone' },
];

const DESIGNS = PALETTES.concat(WORLDS);

// The app's own glyph (cover.js's GAME_ICON), for a round without a world.
const DEFAULT_DESIGN_ICON = 'ti-tornado';

// The registry entry a stored design stands for, or null for none/legacy/
// unknown — in which case the caller keeps whatever was stored.
function resolveDesign(bg) {
  if (!bg || bg.type !== 'theme') return null;
  if (bg.id) {
    const byId = DESIGNS.find((d) => d.id === bg.id);
    if (byId) return byId;
  }
  if (!bg.page) return null;
  const page = String(bg.page).toLowerCase();
  return PALETTES.find((p) => p.page === page) || null;
}

function designIcon(bg) {
  const design = resolveDesign(bg);
  return (design && design.icon) || DEFAULT_DESIGN_ICON;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PALETTES, WORLDS, DESIGNS, resolveDesign, designIcon };
}
