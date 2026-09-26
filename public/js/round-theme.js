'use strict';

/* How the worn DESIGN and the round's colour MARKER reach the page: the two
   custom properties every other rule derives from, the root attribute a dark
   scheme hangs off, the browser-chrome tag that must move with them, the
   marker's three tokens, and the one colour ramp that flips with the scheme.

   Split out of core.js by #956. Since the flip (#1202) a ROUND no longer owns a
   design at all — the eight palettes and seven worlds it could pick are gone —
   so the page is always the ACCOUNT's design (design.js) and the only thing a
   round still puts on the document is its marker. That is why a round screen
   calls applyMarker(round) and a screen outside a round calls applyMarker(null):
   the null is the clear that keeps a round's colour from leaking onto home.

   No `module.exports`: every function here touches `document`, so requiring it
   from Node would enter the coverage report almost entirely unreachable and
   drag `coverage:ci` under its floor — the constraint
   `.claude/rules/frontend-helper-modules-and-coverage.md` exists for. The specs
   reach these through the jsdom harness (`test/support/dom.js`) instead. */

const STANDARD_ACCENT = '#c2410c';

// A dark design (#904) lives on <html data-scheme="dark">. It carries no
// ornament: everything it does is a TOKEN override in styles.css, so no view and
// no component rule ever asks which scheme it is in. Since the flip the design
// in force is the only thing that decides it (designScheme(), design.js).
function setScheme(scheme) {
  const el = document.documentElement;
  if (scheme === 'dark') el.dataset.scheme = 'dark';
  else delete el.dataset.scheme;
}

const isDarkScheme = () => document.documentElement.dataset.scheme === 'dark';

// The mobile browser toolbar and the installed PWA's chrome are tinted from
// <meta name="theme-color">, which index.html ships at the standard accent (#523).
// It follows the ACCENT rather than the page colour, so the chrome is a
// saturated brand tone at every moment. Keep this in lockstep with the --brand
// the caller just applied, never with a re-derivation — the two must not be
// able to disagree.
function setThemeColor(accent) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', accent);
}

/* Paint the design in force: page background + accent. Everything else —
   placeholders, borders, accent surfaces, the page glow and the finale stage —
   derives from these two custom properties via CSS color-mix (see styles.css).

   Klassisch declares no colours — it IS the :root default — so its entry takes
   the removeProperty branch and the page comes out byte-for-byte as it always
   did. That is the whole reason the registry leaves Klassisch colourless rather
   than restating the two hexes. Called by applyDesign() (design.js), the one
   writer of --page-bg/--brand. */
function paintDesign() {
  const root = document.documentElement.style;
  setScheme(designScheme());
  const user = activeDesign();
  if (user && user.page && user.accent) {
    root.setProperty('--page-bg', user.page);
    root.setProperty('--brand', user.accent);
    setThemeColor(user.accent);
  } else {
    root.removeProperty('--page-bg');
    root.removeProperty('--brand');
    setThemeColor(STANDARD_ACCENT);
  }
}

/* ------------------------------- Colour marker ------------------------------ */

/* The round's marker INDEX (#1187): what it stored, else what its retired
   design maps to, else its id's hash — round-marker.js decides, from the round
   alone. */
function roundMarker(round) {
  return resolveMarker(round);
}

/* The two hexes a marker paints with, in the design the VIEWER wears. Reading
   the design from the ACTIVE design (not from the round) is the point of the
   indirection: the same round is Salbei to someone on Klassisch and Tannenfilz
   to someone on Der Tisch. Since the flip (#1202) every round has one — a round
   that wore a world resolves to that world's mapped marker (round-marker.js). */
function markerColors(round) {
  const id = (activeDesign() || {}).id || FACE_DESIGN;
  const marker = markerOf(id, roundMarker(round));
  // The ink travels WITH the colour: a marker is a dark fill in every design, so
  // its ink must not flip with the scheme the way --on-accent does. See
  // markerInk() in designs.js for the measurement — and markerInkOf(), since a
  // design may give one marker its own ink (Das Programmheft's Zinnober, #1371).
  return marker && { ...marker, ink: markerInkOf(id, marker) };
}

// An inline `style` fragment for one round, used where many rounds are on screen
// at once and a root property cannot serve them all (the lobby grid).
function markerStyle(round) {
  const m = markerColors(round);
  return m ? `--marker:${m.color};--marker-deep:${m.deep};--marker-ink:${m.ink}` : '';
}

// Put the round's marker on the document root, beside --page-bg/--brand. Called
// with the round by every round screen and with null by every screen that is
// not inside one, so leaving a round never leaks its colour onto home.
function applyMarker(round) {
  const root = document.documentElement.style;
  const m = round ? markerColors(round) : null;
  // `data-marked` is the SELECTOR half: CSS cannot ask whether a custom property
  // is set, so every marker rule keys off this attribute and reads --marker
  // inside. Same shape as data-scheme, and cleared the same way, so a screen
  // outside a round can never paint a leftover band.
  const el = document.documentElement;
  if (m) {
    root.setProperty('--marker', m.color);
    root.setProperty('--marker-deep', m.deep);
    root.setProperty('--marker-ink', m.ink);
    el.dataset.marked = '';
  } else {
    root.removeProperty('--marker');
    root.removeProperty('--marker-deep');
    root.removeProperty('--marker-ink');
    delete el.dataset.marked;
  }
}

// Color for a value on the 0–5 ramp: deep red → red → yellow → green (good).
// The lightness is 30%, not the more obvious 42%, for contrast (#145): the scale
// is used BOTH as a fill under white text (.score-pill) and as text on the page
// (the Chronik and results score lines — the game-detail ring this was first
// derived against is gone since #1039, where the score became a pill on the
// cover; the text leg still binds elsewhere, so neither half may be dropped).
// At 42% the yellow-green middle only reached
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

/* WHICH RUNG of a design's score ramp a value lands on (#1191, T8.2).
 *
 * `avgColor` above is a CONTINUOUS ramp: every value between 0 and 5 gets its
 * own hue. A design may instead ship a ramp of discrete STOPS — Der Tisch does,
 * and its two halves are tuned separately, pills rising light with alternating
 * ink, bars darker so they read on paper. A continuous function cannot express
 * that, and a design's stylesheet cannot compute it: the value lives in JS.
 *
 * So the JS states the RUNG and the CSS states the COLOUR. A site that used to
 * write an inline `background`/`color` now writes `--sc` (the continuous value,
 * which stays the default), and one that a design must repaint PER RUNG writes
 * `data-stop` beside it — today the distribution bars and the score pills.
 *
 * `--sc` is DATA, not the override point: an inline custom property beats a
 * stylesheet rule for that same property exactly as an inline `background`
 * does, so a design sets `--sc-fill`, which the stylesheet reads in front of
 * `--sc` and which nothing writes inline
 * (.claude/rules/inline-custom-properties-cannot-be-overridden.md).
 *
 * Returns a STRING, because 'veto' is one of the rungs: below 1 a badly vetoed
 * game is not "a bad 1", it is off the scale, and T8.2 gives it its own tone.
 * Null in, null out — a game nobody rated has no rung and gets no attribute,
 * which is what keeps `[data-stop]` from matching an empty row.
 *
 * Named for the RAMP, not for the score: `scoreColor`'s sibling in
 * game-stats.js is `scoreStop`, which feeds a score's DISPLAYED value in
 * here. Two names because they take two different domains — the same split
 * `avgColor`/`scoreColor` already has, and the reason that split exists.
 *
 * RATING_MIN/RATING_MAX come from rating-faces.js, which loads AFTER this file.
 * They are read inside the body, never at load time, so the shared-scope
 * load-order trap does not bite (.claude/rules/frontend-script-load-order.md).
 */
function rampStop(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  if (value < RATING_MIN) return 'veto';
  return String(Math.min(RATING_MAX, Math.round(value)));
}
