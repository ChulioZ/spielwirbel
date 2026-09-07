'use strict';

/* How a round's DESIGN reaches the page: the two custom properties every other
   rule derives from, the two root attributes a world and a dark scheme hang
   off, the browser-chrome tag that must move with them, and the one colour ramp
   that flips with the scheme.

   Split out of core.js by #956. It is a real seam rather than a line-count
   trim: nothing here reads a round, a game or a vote — the whole module is
   "given a stored design blob, what does the document look like" — and its only
   dependency is `resolveDesign` from round-designs.js, which is why the script
   tag sits directly after that one. `avgColor` comes along because it asks the
   same question as the rest of the file (`isDarkScheme()`), not because it is
   about scores; `displayScore`/`scoreColor` stayed behind with the score code
   that owns their domain.

   No `module.exports`: every function here touches `document`, so requiring it
   from Node would enter the coverage report almost entirely unreachable and
   drag `coverage:ci` under its floor — the constraint
   `.claude/rules/frontend-helper-modules-and-coverage.md` exists for. The specs
   reach these through the jsdom harness (`test/support/dom.js`) instead. */

const STANDARD_ACCENT = '#c2410c';

// The accent a stored design should actually paint with. Rounds save a snapshot
// of the palette, so when a theme's accent is corrected — as Sand and Pfirsich
// were for contrast (#145) — a round that picked it earlier still carries the
// old, failing value. Resolving against the registry (round-designs.js) on
// every render fixes those rounds the next time they are drawn, which is the
// same render-time (not capture-time) approach cover sizing takes and keeps the
// repo free of one-time migration code (CLAUDE.md). An unknown design — a
// legacy or hand-edited one — keeps whatever was stored.
function resolveAccent(bg) {
  const design = resolveDesign(bg);
  return design ? design.accent : bg.accent;
}

// A world (#903) lives on <html data-world="…">: the one hook every ornament
// rule and the display-face override in styles.css key off. An attribute rather
// than a custom property for the same reason the browser chrome is a tag: a
// whole family of rules has to switch on and off at once, and only a selector
// can do that. Cleared when there is no world, so leaving a Forest round never
// leaks its vines onto home.
function setWorld(world) {
  const el = document.documentElement;
  if (world) el.dataset.world = world;
  else delete el.dataset.world;
}

// A dark design (#904) lives on <html data-scheme="dark">, the sibling hook to
// data-world and set the same way. It carries no ornament: everything it does
// is a TOKEN override in styles.css, so no view and no component rule ever asks
// which scheme it is in. Cleared when the design is light — or when there is no
// design at all, which is what keeps home, login, the landing page and the
// account screens light while one of the rounds they list is dark.
function setScheme(scheme) {
  const el = document.documentElement;
  if (scheme === 'dark') el.dataset.scheme = 'dark';
  else delete el.dataset.scheme;
}

const isDarkScheme = () => document.documentElement.dataset.scheme === 'dark';

// The mobile browser toolbar and the installed PWA's chrome are tinted from
// <meta name="theme-color">, which index.html ships at the standard accent — so
// inside a Schiefer or Blaugrau round the frame around the app stayed
// brand-orange (#523). It follows the ACCENT rather than the page colour: the
// standard theme's accent IS that static default, so the chrome is a saturated
// brand tone at every moment and nothing flips when a round is entered or left.
// Keep this in lockstep with the --brand the caller just applied, never with a
// re-derivation — the two must not be able to disagree.
function setThemeColor(accent) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', accent);
}

// Apply the round's design: page background + accent color. Everything else —
// placeholders, borders, accent surfaces, the page glow and the finale stage —
// derives from these two custom properties via CSS color-mix (see styles.css).
// A world sets the same two and adds only the root attribute (setWorld), so its
// ornaments are additive over the tokens and a palette is a world with none.
function applyBackground(bg) {
  const root = document.documentElement.style;
  const design = resolveDesign(bg);
  setWorld(design && design.world);
  setScheme(design && design.scheme);
  if (bg && bg.type === 'theme' && bg.page && bg.accent) {
    const accent = resolveAccent(bg);
    root.setProperty('--page-bg', design ? design.page : bg.page);
    root.setProperty('--brand', accent);
    setThemeColor(accent);
  } else if (bg && bg.type === 'color' && bg.color) {
    // Legacy stored design: only a page color, standard accent.
    root.setProperty('--page-bg', bg.color);
    root.removeProperty('--brand');
    setThemeColor(STANDARD_ACCENT);
  } else {
    // No design -> fall back to the :root defaults.
    root.removeProperty('--page-bg');
    root.removeProperty('--brand');
    setThemeColor(STANDARD_ACCENT);
  }
}

// Color for a value on the 0–5 ramp: deep red → red → yellow → green (good).
// The lightness is 30%, not the more obvious 42%, for contrast (#145): the scale
// is used BOTH as a fill under white text (.score-pill) and as text/stroke on the
// page (.gd-ring__num, the ring). At 42% the yellow-green middle only reached
// 2.4:1 under white — every rating badge in the app failed WCAG AA. 30% is the
// lightest value that clears 4.5:1 under white across the whole hue range (worst
// case 4.5 at avg 3.0) while the ring still clears the 3:1 large-text bar on
// every theme page. The hue is untouched, so the red→yellow→green reading is
// unchanged; don't lighten it back without re-checking both uses.
//
// On a dark design (#904) BOTH of those uses invert together, which is why the
// ramp cannot simply stay put: at 30% the ring is 2.6:1 on a dark page, and the
// pill's ink is --on-accent, which is now near-black. 66% is the mirror of the
// same two constraints — light enough to clear 3:1 as the ring on the darkest
// shipped page, dark enough to carry --on-accent at 4.5:1 as a fill. Hue and
// saturation are identical in both directions, so a 2 is the same orange-red
// whichever design the round picked.
const AVG_LIGHT = 30;
const AVG_LIGHT_DARK = 66;
function avgColor(avg) {
  const hue = Math.max(0, Math.min(120, ((avg - 1) / 4) * 120));
  // Below 1 the hue formula is already clamped at 0, so everything down there
  // would otherwise be the SAME red as a 1 (#890). The RATING scale no longer
  // reaches it — it starts at 1 since #909 — but the SCORE scale does: a badly
  // vetoed game floors at `SCORE_MIN` and `scoreColor` hands that straight in
  // here, so a 0,4 and a 1,0 must not print as one colour. Move the lightness
  // rather than bending the hue: continuous, and a provable no-op for values
  // >= 1, which is what bounds the ripple through every other consumer. The
  // step goes AWAY from the ink either way — darker under white text on a light
  // design, lighter under near-black ink on a dark one — so it can only add
  // contrast for both uses, never spend it.
  const off = Math.max(0, Math.min(1, 1 - avg));
  const dark = isDarkScheme();
  const light = dark ? AVG_LIGHT_DARK + 10 * off : AVG_LIGHT - 10 * off;
  return `hsl(${hue}, 60%, ${light}%)`;
}
