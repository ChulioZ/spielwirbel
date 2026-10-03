'use strict';

/*
 * Forest's marks are its WORDMARK BADGE (#1475): the flat Laubgrün disc with
 * the whirl, standing on the clearing's light ground — the favicon is the bare
 * disc on transparent. test/design-marks.test.js checks every design's files
 * exist at their sizes; it cannot see a picture. This reads the committed PNGs'
 * pixels at a few points that only the badge composition satisfies, so a
 * re-render from a recipe that drifted back to a full-bleed square (#1465's
 * first marks), or a disc that leaves the maskable safe zone, goes red.
 *
 * Seen red against #1465's marks (the full-bleed leaf gradient): the ground
 * corner and the safe-zone ring both read as leaf green.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { designById } = require('../public/js/designs');

const FOREST = designById('forest');
const PUBLIC = path.join(__dirname, '..', 'public');

// A minimal PNG reader: 8-bit RGB or RGBA, non-interlaced — what headless
// Chrome's capture writes. Returns pixel(x, y) -> [r, g, b, a].
function readPng(rel) {
  const buf = fs.readFileSync(path.join(PUBLIC, rel.replace(/^\//, '')));
  let pos = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, `${rel}: 8-bit`);
      type = data[9];
      assert.equal(data[12], 0, `${rel}: not interlaced`);
    }
    if (kind === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = { 2: 3, 6: 4 }[type];
  assert.ok(bpp, `${rel}: colour type ${type} is RGB or RGBA`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = (v + pred) & 255;
    }
  }
  return {
    width,
    pixel: (x, y) => {
      const i = Math.round(y) * stride + Math.round(x) * bpp;
      return [out[i], out[i + 1], out[i + 2], bpp === 4 ? out[i + 3] : 255];
    },
  };
}

const ACCENT = [0x35, 0x64, 0x27];
const near = (px, rgb, tol = 6) => rgb.every((v, i) => Math.abs(px[i] - v) <= tol);
// The clearing: light, the page running into moss — never the leaf green.
const ground = (px) => px[3] === 255 && px[0] > 190 && px[1] > 210 && px[2] > 180;

test('the app icons are the badge on the clearing: light corners, a leaf-green disc, the whirl inside it', () => {
  const [i192, i512] = FOREST.marks.icons;
  for (const rel of [i192.src, i512.src, FOREST.marks.appleTouch]) {
    const img = readPng(rel);
    const s = img.width;
    for (const [x, y] of [[2, 2], [s - 3, 2], [2, s - 3], [s - 3, s - 3]]) {
      assert.ok(ground(img.pixel(x, y)), `${rel}: corner (${x},${y}) is ${img.pixel(x, y)}, not the clearing`);
    }
    // Inside the disc, above the whirl: the flat accent.
    assert.ok(near(img.pixel(s / 2, s * 0.17), ACCENT), `${rel}: the disc is ${img.pixel(s / 2, s * 0.17)}`);
    // The whirl's top bar crosses the centre column in the light print.
    const column = Array.from({ length: Math.round(s * 0.3) }, (_, i) => img.pixel(s / 2, s * 0.35 + i));
    assert.ok(column.some((px) => px[0] > 200 && px[1] > 200), `${rel}: no whirl in the disc`);
  }
});

test('the maskable icon keeps the whole disc inside the 80% safe circle', () => {
  const rel = FOREST.marks.icons.find((i) => /maskable/.test(i.purpose)).src;
  const img = readPng(rel);
  const c = img.width / 2;
  const r = img.width * 0.4;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const px = img.pixel(c + Math.cos(a) * r, c + Math.sin(a) * r);
    assert.ok(ground(px), `${rel}: the safe circle's edge at ${k}/16 is ${px} — the disc reaches it`);
  }
  assert.ok(near(img.pixel(c, c - r * 0.65), ACCENT), `${rel}: the disc is drawn`);
});

test('the favicon is the bare badge: transparent corners, the disc to the edge', () => {
  const img = readPng(FOREST.marks.favicon.href);
  assert.equal(img.pixel(0, 0)[3], 0, 'the corner is transparent');
  assert.equal(img.pixel(31, 31)[3], 0);
  assert.ok(near(img.pixel(16, 2), ACCENT, 10), `the disc reaches the top edge: ${img.pixel(16, 2)}`);
});
