'use strict';

/* The four content worlds (#905): Ocean, Chess, Horror and Dinosaurs on the
   #903 machinery. test/round-worlds.test.js pins the MECHANISM for every entry
   in WORLDS — the token set, the slots, the bands, the media gates — so this
   file only pins what is specific to shipping a world as CONTENT: that the
   registry holds the six, that each committed face is a real font rather than
   a fetched error page, that a single-weight face reaches the bold headings
   ask for without a synthesised faux-bold, and that the pages the issue
   worried about colliding stay apart. Named after what it covers rather than
   after a module (.claude/rules/test-file-names-collide-silently.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CSS } = require('./support/css');
const { PALETTES, WORLDS, DESIGNS } = require('../public/js/round-designs');

const ROOT = path.join(__dirname, '..');
const SIX = ['forest', 'scifi', 'ocean', 'chess', 'horror', 'dinos'];

test('the six worlds ship, in registry order, and Dinosaurs took the place the issue gave it', () => {
  assert.deepEqual(WORLDS.map((w) => w.id), SIX);
  assert.ok(!DESIGNS.some((d) => /princess|prinzessin/i.test(d.id + d.labelKey)),
    'the fourth world is Dinosaurs by operator decision (#905), not a princess world');
  const horror = WORLDS.find((w) => w.id === 'horror');
  assert.equal(horror.scheme, 'dark', 'Horror takes the dark page #904 made possible');
  for (const id of ['ocean', 'chess', 'dinos']) {
    assert.equal(WORLDS.find((w) => w.id === id).scheme, undefined, `${id} is a light page`);
  }
});

test('every committed world face is a genuine woff2, not a fetched error page', () => {
  /* The faces were fetched from a CDN. A 404 body saved under a .woff2 name
     passes the "file exists" check in round-worlds.test.js and ships a font
     that never renders — the world silently falls back to Baloo 2. The first
     four bytes of WOFF2 are the tag 'wOF2'. */
  const faces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  for (const w of WORLDS) {
    const files = faces.filter((b) => b.includes(`font-family: '${w.font}'`))
      .map((b) => /url\('fonts\/([^']+)'\)/.exec(b)[1]);
    assert.ok(files.length >= 1, `${w.font}: no @font-face`);
    for (const f of files) {
      const head = fs.readFileSync(path.join(ROOT, 'public/fonts', f)).subarray(0, 4).toString('latin1');
      assert.equal(head, 'wOF2', `${f} does not start with the WOFF2 tag (got ${JSON.stringify(head)})`);
    }
  }
});

test('every world face covers weight 700 without synthesis', () => {
  /* Headings ask for 700 (h1–h3 and forty-odd display rules). A face declared at
     400 only is matched for that request and then faux-bolded by the browser —
     a smear over Creepster and Alfa Slab One, which are already heavy. So a
     single-weight face must declare a RANGE that includes 700; a multi-weight
     face must ship a 700 file. Either way, the bold headings land on a real
     face (#905). */
  const faces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  for (const w of WORLDS) {
    const weights = faces.filter((b) => b.includes(`font-family: '${w.font}'`))
      .map((b) => /font-weight:\s*(\d+)(?:\s+(\d+))?/.exec(b))
      .map((m) => [Number(m[1]), Number(m[2] || m[1])]);
    assert.ok(weights.some(([lo, hi]) => lo <= 700 && hi >= 700),
      `${w.font}: no declared weight covers 700 (${JSON.stringify(weights)})`);
  }
});

test('no two designs share a page hex, and the warm light pages keep their distance', () => {
  /* round-designs.test.js already refuses a world reusing a PALETTE page (the
     legacy hex path). This is the wider statement: every design's page is its
     own, worlds included — a shared page would make two cards on the design
     screen identical below the ornaments. The distance half is the issue's own
     worry, made checkable: Dinosaurs sits on a warm limestone, and so do Sand
     and Standard; the ornaments do the real work of telling them apart, but the
     PAGE must not be a hex-neighbour of either, or a screenshot without an
     ornament in frame reads as the same design. */
  const pages = DESIGNS.map((d) => d.page.toLowerCase());
  assert.equal(new Set(pages).size, pages.length, 'a page hex is used twice');
  const rgb = (hex) => hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16));
  const dist = (a, b) => Math.max(...rgb(a).map((c, i) => Math.abs(c - rgb(b)[i])));
  const dinos = WORLDS.find((w) => w.id === 'dinos');
  for (const id of ['sand', 'standard']) {
    const p = PALETTES.find((x) => x.id === id);
    assert.ok(dist(dinos.page, p.page) >= 3, `dinos page ${dinos.page} is a hex-neighbour of ${id} ${p.page}`);
    assert.ok(dist(dinos.accent, p.accent) >= 40, `dinos accent ${dinos.accent} is close to ${id}'s ${p.accent}`);
  }
  // And Ocean is BLUE, so it never meets Dinosaurs' fern-teal: the blue channel
  // leads the accent, where a teal's green channel would.
  const ocean = WORLDS.find((w) => w.id === 'ocean');
  const [r, g, b] = rgb(ocean.accent);
  assert.ok(b > g && b > r, `ocean accent ${ocean.accent} is not blue-led`);
});

test('each world names its own emblem, and the four new glyphs are declared in the icon subset', () => {
  const icons = fs.readFileSync(path.join(ROOT, 'public/fonts/tabler-icons.css'), 'utf8');
  for (const w of WORLDS) {
    assert.ok(icons.includes(`.${w.icon}::before`), `${w.icon} is not declared`);
  }
  assert.equal(new Set(WORLDS.map((w) => w.icon)).size, WORLDS.length, 'two worlds share an emblem');
});
