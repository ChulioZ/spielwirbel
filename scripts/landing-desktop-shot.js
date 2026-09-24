'use strict';

/*
 * The landing page's DESKTOP capture (#1199, operator decision 2026-09-24):
 * the round hub's Start tab at 1440 CSS px, shown as one wide band under the
 * hero so the page does not read as a phone-only app. Used by
 * capture-landing-shots.js; its own file because that script sits at the
 * 700-line source budget, and everything desktop-specific lives here.
 *
 * WHY THIS DOES NOT REPEAT #1090. #1090 retired a 1280-wide shelf capture
 * because the two-column hero gave it 660-800px, where its tile labels shrank
 * to ~9px. The band gives this one the page's own width (capped at 1200 CSS px
 * in styles.css), i.e. 0.83x of the 1440 it was laid out at — app text renders
 * at ~11-12px there, which is readable. The phone walkthrough stays for phones.
 *
 * Not a phone shot, so none of the phone crops' reasoning applies: the Start
 * tab is not viewport-sized and the rail is fixed, so the crop is DERIVED from
 * the page like the result shot's (§5 of the rule) — the rail's own box plus
 * a breath, floored at MIN_HEIGHT so a short locale does not change the band's
 * aspect ratio far from the others.
 */

// 1.25x: the band renders at most 1200 CSS px, so this is 1.5x that box — on
// the low side of the rule's ~1.8-2.2x, deliberately. A 2x raster of a 1440-wide
// page is ~2880px and roughly triples the file for a picture a desktop visitor
// sees at arm's length; 1.5x keeps it sharp on a retina laptop at the width it
// actually renders. Measured, not guessed: see the rule's §5a.
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1.25, mobile: false };

// Below this the band's aspect ratio would drift between locales for no reason
// a visitor could see; above it the crop follows the rail.
const MIN_HEIGHT = 900;

// Read by capture()'s probeGeometry via the `desktop` fields it adds; kept here
// so the crop's inputs and its derivation sit together.
const PROBE = `(() => {
  const rail = document.querySelector('.rail');
  const items = [...document.querySelectorAll('.rail a, .rail button')].map((e) => e.getBoundingClientRect().bottom);
  return {
    hasRail: !!rail && getComputedStyle(rail).display !== 'none',
    railItemsBottom: items.length ? Math.round(Math.max(...items)) : null,
    railBottom: rail ? Math.round(rail.getBoundingClientRect().bottom) : null,
    cta: !!document.querySelector('.hub-cta, .rail__cta'),
  };
})()`;

// The cut: 24px below the rail's own box — not its last entry, since Der Tisch
// frames the rail as a wood panel whose padding runs ~22px past the entry, and
// cutting at the entry sliced that panel's bottom edge off (measured on the
// first Tisch run) — never shorter than MIN_HEIGHT.
// Throws rather than guessing — main()'s catch turns it into a clean fail().
function desktopCrop(geom, locale) {
  const d = geom.desktop;
  if (!d || !d.hasRail || !d.railBottom) {
    throw new Error(`the ${locale} desktop hub renders no rail at ${VIEWPORT.width}px — is it the round hub?`);
  }
  if (!d.cta) throw new Error(`the ${locale} desktop hub shows no start button — not the Start tab`);
  return Math.max(MIN_HEIGHT, Math.max(d.railBottom, d.railItemsBottom || 0) + 24);
}

module.exports = { VIEWPORT, PROBE, desktopCrop };
