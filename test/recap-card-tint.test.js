'use strict';

/* recapTint stamps the world backdrop; it must never build a PATTERN.
 *
 * The bug this guards (the Chronik „Teilen" button on WebKit): the backdrop was
 * tiled with `ctx.createPattern(svgImage, 'repeat')`, and WEBKIT TAINTS a canvas
 * that such a pattern touches — same-origin or not, `data:` URI or not. The
 * tint's scratch canvas is drawn onto the card, tainting that too, so the
 * export's `canvas.toBlob()` threw `SecurityError` and the view toasted
 * „Das Bild konnte nicht erstellt werden." Measured in a headless WKWebView:
 * all eight PALETTES exported, all seven WORLDS failed — Chromium exported all
 * sixteen, which is why the pane could never have found it
 * (.claude/rules/browser-pane-is-chromium-only.md).
 *
 * So the assertions below are about the MECHANISM, not about the pixels: that
 * the mask is stamped with drawImage, that it is rasterized at the backing-store
 * scale first (constraint 3 — a 1x tile would ship a soft backdrop and fail
 * nothing), and that createPattern is not reached at all. The taint itself is
 * unobservable here: jsdom has no 2d canvas and node has no WebKit, which is the
 * reason this spec exists rather than a rendering one.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

/* A recording 2d context, installed on EVERY canvas the code creates — the
   tint's own scratch canvas and the scratch tile inside it. jsdom's
   getContext('2d') answers null, so without this recapTint cannot run at all. */
function boot() {
  const dom = loadApp();
  dom.run(`
    globalThis.__calls = [];
    HTMLCanvasElement.prototype.getContext = function () {
      const canvas = this;
      return {
        canvas,
        globalCompositeOperation: 'source-over',
        fillStyle: '#000',
        scale: (...a) => __calls.push({ on: canvas, m: 'scale', a }),
        fillRect: (...a) => __calls.push({ on: canvas, m: 'fillRect', a }),
        drawImage: (...a) => __calls.push({ on: canvas, m: 'drawImage', a }),
        createPattern: (...a) => { __calls.push({ on: canvas, m: 'createPattern', a }); return null; },
      };
    };
  `);
  return dom;
}
/* Copied out of the jsdom realm: a cross-realm array fails assert.deepEqual on
   its prototype alone, which reads as a content mismatch between two `[]`. */
const calls = (dom, m) => Array.from(dom.get('__calls'))
  .filter((c) => c.m === m)
  .map((c) => ({ on: c.on, a: Array.from(c.a) }));

// A world backdrop is a 240x240 SVG; the card's glow band is 540x240 at 2x.
const MASK = { naturalWidth: 240, naturalHeight: 240 };
const W = 540;
const H = 240;

test('the tiled backdrop is STAMPED, never turned into a pattern', () => {
  const dom = boot();
  dom.call('recapTint', MASK, W, H, '#c2410c', 2, true);

  assert.deepEqual(calls(dom, 'createPattern'), [],
    'recapTint built a pattern — WebKit taints the card and toBlob() throws SecurityError');

  // Every stamp but the mask's own rasterization, i.e. the tiles on the band.
  const stamps = calls(dom, 'drawImage').filter((c) => c.a[0] === MASK ? false : true);
  const grid = stamps.map((c) => `${c.a[1]},${c.a[2]}`).sort();
  assert.deepEqual(grid, ['0,0', '240,0', '480,0'],
    'the band must be covered edge to edge, exactly as a repeat pattern covered it');
  for (const s of stamps) {
    assert.deepEqual(s.a.slice(3), [240, 240], 'a tile must be stamped at the mask\'s own size');
  }
  dom.close();
});

test('the tile is rasterized at the backing-store scale, so stamping costs no sharpness', () => {
  /* Constraint 3, and the one thing that CANNOT be seen by eye in the preview
     pane: a tile rasterized at 1x and stamped at 1x logical size paints at half
     the resolution of everything around it on a phone screenshot, with no error
     anywhere. */
  const dom = boot();
  dom.call('recapTint', MASK, W, H, '#c2410c', 2, true);

  const raster = calls(dom, 'drawImage').find((c) => c.a[0] === MASK);
  assert.ok(raster, 'the mask is never rasterized into a tile');
  assert.deepEqual(raster.a.slice(3), [480, 480], 'the tile is rasterized at 1x — the backdrop ships soft');
  assert.equal(raster.on.width, 480, 'the tile canvas is too small for a 2x backing store');
  assert.equal(raster.on.height, 480);
  dom.close();
});

test('an untiled mask is still stretched in one draw', () => {
  /* The control: the frame and the scene take the other branch, and an
     assertion set that only ever ran the tiling branch would be satisfied by a
     recapTint that had lost the other one entirely. */
  const dom = boot();
  dom.call('recapTint', MASK, 110, 70, '#c2410c', 2, false);

  const draws = calls(dom, 'drawImage');
  assert.equal(draws.length, 1, 'an untiled mask must be drawn exactly once');
  assert.deepEqual(draws[0].a.slice(1), [0, 0, 110, 70]);
  dom.close();
});

test('a mask with no intrinsic size draws nothing instead of spinning forever', () => {
  /* A stamping loop steps by the tile size, so a mask reporting a literal 0
     would spin forever and hang the share — where the pattern it replaced
     merely painted nothing. The fixture below reports NO size at all, so the
     step is NaN and the loop exits at once: deliberate, because the assertion
     then fails fast instead of hanging CI, while still going red the moment the
     guard goes (measured — `if (true)` reddens exactly this test). */
  const dom = boot();
  dom.call('recapTint', { naturalWidth: 0, naturalHeight: 0 }, W, H, '#c2410c', 2, true);

  assert.deepEqual(calls(dom, 'drawImage'), [], 'a sizeless mask must not be stamped');
  dom.close();
});
