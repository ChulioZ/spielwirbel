'use strict';

/* Der Tisch's ANMELDEN, KONTO and DESIGN-WAHL (#1193) — the screen layer for
 * T5.1-T5.4, over #1188's tokens and overlay.
 *
 * As in test/tisch-regal-pass.test.js, most of this slice is repaint and
 * repaint is already covered generically: test/tisch-hub-lobby.test.js derives
 * "a rule reading a scheme-gated token is itself scheme-gated" over the whole
 * file, and test/design-layer.test.js refuses a colour literal or a shadowed
 * token outside the root blocks. A rule added here is picked up by all three
 * with nobody editing a list.
 *
 * What none of them can see is the four claims below. Three are contrast, and
 * the reason the contrast harness misses them is the same each time: it sweeps
 * the TOKENS a design declares, against the grounds the design declares, and
 * every one of these is a token painted on a ground that only exists a few
 * elements deep — inside an overlay, on a card's own gradient, on a tint mixed
 * from a property the overlay re-points.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rulesOf, bodyOf } = require('./support/css');
const { contrast, evaluate, token } = require('./support/theme');
const { designById } = require('../public/js/designs');

const SHEET = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = rulesOf(SHEET);
const TISCH = designById('tisch');
const AA = 4.5;

// The body of the Tisch rule whose selector group mentions `needle`.
const bodyFor = (needle) => {
  const hit = RULES.find(([sel]) => sel.replace(/\s+/g, ' ').includes(needle));
  return hit ? hit[1] : null;
};
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+)`).exec(body || '');
  return m && m[1].trim().replace(/\s+/g, ' ');
};
// Every colour expression in a background declaration, gradient stops included.
const coloursIn = (value) =>
  (value.match(/var\(--[\w-]+\)|color-mix\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-f]{3,8}/gi) || [])
    .filter((c) => !/^var\(--(felt-weave|felt-grain|wood-grain|cast|cast-soft|cast-deep|shadow-\d)\)$/.test(c));

/* 1 — THE OVERLAY RE-POINTS EVERY PROPERTY ITS STICKY BARS PAINT FROM.
 *
 * `.sheet__head` and `.sheet__actions` are sticky, so each needs an opaque
 * backdrop for the sheet's content to scroll under — and both take it from
 * `--page-bg`, which is an inline property on <html> carrying the design's
 * PAGE colour. Until #1193 the Tisch overlay re-pointed five properties and
 * not that one, so both bars painted walnut on top of the sheet's paper while
 * the overlay's paper ink stayed on them: measured 1.08:1 on the design
 * chooser's own „Wähl dir ein Design.", in every sheet in the app.
 *
 * Derived from styles.css rather than pinning the property name, so renaming
 * `--page-bg` or giving one bar a different source keeps this honest: whatever
 * those two bars paint from, the overlay has to answer for.
 */
test('the paper overlay re-points every property the sticky sheet bars paint from', () => {
  const overlay = bodyFor('.sheet,');
  assert.ok(overlay, 'the Tisch overlay rule is gone — did .sheet stop being re-pointed?');

  const bars = ['.sheet__head', '.sheet__actions'];
  const sources = new Set();
  for (const bar of bars) {
    const body = bodyOf(bar);
    assert.ok(body, `${bar} is gone from styles.css — this test names the wrong element`);
    const bg = decl(body, 'background');
    assert.ok(bg, `${bar} paints no background; a sticky bar without one shows the content through it`);
    for (const c of coloursIn(bg)) {
      const v = /^var\((--[\w-]+)\)$/.exec(c);
      if (v) sources.add(v[1]);
    }
  }
  assert.ok(sources.size, 'neither sticky bar paints from a custom property — re-read this test');

  for (const prop of sources) {
    assert.match(overlay, new RegExp(`(?:^|[;{\\s])${prop}\\s*:`),
      `${prop} is what the sticky sheet bars paint from, and the overlay does not re-point it: `
      + 'both bars will paint the PAGE colour on top of the paper, under paper ink');
  }
});

/* 2 — THE INK ON THOSE BARS IS THEN LEGIBLE.
 *
 * Claim 1 is structural and would be satisfied by re-pointing --page-bg at
 * anything at all. This is the measurement, and it is the one the contrast
 * harness cannot make: --ink is swept against the design's own surfaces, never
 * against a property that only becomes paper four elements into a sheet.
 */
test('paper ink clears AA on whatever the overlay re-points --page-bg to', () => {
  const overlay = bodyFor('.sheet,');
  const pageBg = decl(overlay, '--page-bg');
  assert.ok(pageBg, '--page-bg is no longer re-pointed inside the overlay (see the test above)');

  const ink = evaluate(decl(overlay, '--ink'), TISCH);
  const ratio = contrast(ink, evaluate(pageBg, TISCH));
  assert.ok(ratio >= AA,
    `the overlay's ink measures ${ratio.toFixed(2)}:1 on the ground its sticky bars paint (floor ${AA})`);
});

/* 3 — THE SIGN-IN PLANK IS A GROUND ITS OWN LINK TEXT CAN LIVE ON.
 *
 * `.auth__card` is the one place in this slice that paints its own ground, and
 * the first attempt made it the plank-like `--wood-light -> --surface`
 * gradient. At the light stop, brass — which is `--brand`, i.e. the colour of
 * `.link-btn`, and `.auth__links` sits ON this card — measures 4.37:1. That is
 * the number the token block calls „tight on purpose" for a control FILL,
 * where SC 1.4.11's 3:1 binds; as a ground for text it is under the floor.
 *
 * Written over every colour in the declaration rather than over the token it
 * happens to use today, so re-introducing the gradient fails on its light stop
 * however it is spelled.
 */
test('every stop of the sign-in card clears AA against the link colour on it', () => {
  const body = bodyFor('.auth__card');
  assert.ok(body, 'the Tisch .auth__card rule is gone');

  const brand = token('--brand', TISCH);
  const stops = coloursIn(decl(body, 'background'));
  assert.ok(stops.length, '.auth__card paints no ground — it would sit invisibly on the felt');

  for (const stop of stops) {
    const ratio = contrast(brand, evaluate(stop, TISCH));
    assert.ok(ratio >= AA,
      `.auth__links' brass measures ${ratio.toFixed(2)}:1 on the card stop ${stop} (floor ${AA})`);
  }
});

/* 4 — A POSTER PRINTS ITSELF FROM THE REGISTRY.
 *
 * T5.3 shows one poster per design in its own material, and the whole point of
 * the tile rule is that it names no design: both stops come from the entry's
 * own `page`/`accent`, inline on the card as --tile-page / --tile-accent. A
 * design added to the registry later then needs no CSS at all.
 *
 * The trap this pins is a rule that reaches for one of THIS design's tokens —
 * a felt, a gold — to make the tile look better under Der Tisch. It would, and
 * every other design's poster would quietly wear Tisch's material.
 */
test('the poster tile is printed only from the registry properties', () => {
  const body = bodyFor('.design-tile');
  assert.ok(body, 'the Tisch .design-tile rule is gone');

  const used = coloursIn(decl(body, 'background'));
  assert.ok(used.length >= 2, 'the tile paints fewer than two colours — it cannot show a material');

  for (const c of used) {
    const vars = c.match(/--[\w-]+/g) || [];
    for (const v of vars) {
      assert.ok(v === '--tile-page' || v === '--tile-accent',
        `the tile paints with ${v}, which belongs to Der Tisch: every other design's poster `
        + 'would then be printed in Tisch\'s material. Only --tile-page/--tile-accent may appear here.');
    }
  }
});
