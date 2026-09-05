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

// Coordinated colour schemes: light background + matching accent. The first is
// the default (warm cream + orange). Labels are translation keys. Accents are
// kept soft and slightly muted so they sit well next to the member colours,
// the gold family and the neutral surfaces.
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
];

// Worlds. `world` is the data-world value (the id itself), `font` the display
// face declared in styles.css (self-hosted, fetched only when a rule applies
// it), `icon` the emblem glyph on the home tile. Each world's ornament set is
// CSS only — the six slots under "Worlds" in styles.css. A world's page sits no
// darker than Schiefer's, the palette page the semantic colours (--good/--warn)
// were tuned against: at #e6ecf3 Sci-Fi was the new darkest page and pulled
// both to 4.45:1 — test/a11y-contrast.test.js measures every design.
const WORLDS = [
  { id: 'forest', labelKey: 'theme.forest', page: '#ecf1e4', accent: '#356427', world: 'forest', font: 'Averia Serif Libre', icon: 'ti-trees' },
  { id: 'scifi', labelKey: 'theme.scifi', page: '#e9eff5', accent: '#2c5c9c', world: 'scifi', font: 'Chakra Petch', icon: 'ti-planet' },
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
