'use strict';

/* The design registry (#903): every design a round can pick, with a STABLE id.
   Before it, a design was identified by its page hex — fine for eight palettes,
   impossible for worlds, where the ornament set and the display face cannot be
   derived from `#ecf1e4`. Required into Node on purpose: the file is
   dependency-free with the module.exports guard, which is what lets
   test/a11y-contrast.test.js loop palettes AND worlds rather than regex-parsing
   a view file (.claude/rules/frontend-helper-modules-and-coverage.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PALETTES, WORLDS, DESIGNS, resolveDesign, designIcon } = require('../public/js/round-designs');

const HEX = /^#[0-9a-f]{6}$/;

test('every design carries a stable id, a page, an accent and a label key', () => {
  assert.ok(PALETTES.length >= 8, 'the eight palettes are still here');
  assert.ok(WORLDS.length >= 2, 'Forest and Sci-Fi ship with the machinery');
  assert.deepEqual(DESIGNS, [...PALETTES, ...WORLDS], 'DESIGNS is the two lists in order');
  const ids = DESIGNS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, `ids must be unique: ${ids.join(', ')}`);
  for (const d of DESIGNS) {
    // Lower-case slug, short: it is stored on the round and travels through the
    // background route, whose zod cap every id round-trips in background.test.js.
    assert.match(d.id, /^[a-z][a-z0-9-]{1,31}$/, `${d.id} is not a short slug`);
    assert.match(d.page, HEX, `${d.id}: page must be a lower-case 6-digit hex`);
    assert.match(d.accent, HEX, `${d.id}: accent must be a lower-case 6-digit hex`);
    assert.match(d.labelKey, /^theme\./, `${d.id}: label is an i18n key`);
  }
  assert.equal(PALETTES[0].id, 'standard');
  assert.equal(PALETTES[0].std, true, 'the first palette is the default design');
});

test('a world names its DOM hook, its display face and its emblem glyph', () => {
  for (const w of WORLDS) {
    assert.equal(w.world, w.id, `${w.id}: the data-world value is the id itself`);
    assert.equal(typeof w.font, 'string');
    assert.ok(w.font.length > 0, `${w.id}: a world brings its own display face`);
    assert.match(w.icon, /^ti-[a-z0-9-]+$/, `${w.id}: the emblem glyph is a Tabler class`);
  }
  for (const p of PALETTES) {
    assert.equal(p.world, undefined, `${p.id}: a palette has no world hook`);
  }
});

test('no world shares a page hex with a palette, so the legacy hex path stays unambiguous', () => {
  const palettePages = new Set(PALETTES.map((p) => p.page));
  for (const w of WORLDS) {
    assert.ok(!palettePages.has(w.page), `${w.id} reuses palette page ${w.page}`);
  }
});

test('resolveDesign finds a design by id before anything else', () => {
  const forest = WORLDS.find((w) => w.id === 'forest');
  const salbei = PALETTES.find((p) => p.id === 'salbei');
  // A stale snapshot — the stored page/accent belong to a palette — still
  // resolves to the world the id names, exactly as a corrected accent does.
  assert.equal(resolveDesign({ type: 'theme', id: 'forest', page: salbei.page, accent: salbei.accent }), forest);
  assert.equal(resolveDesign({ type: 'theme', id: 'salbei', page: '#000000', accent: '#000000' }), salbei);
});

test('a round saved before ids resolves by its page hex — palettes only', () => {
  const salbei = PALETTES.find((p) => p.id === 'salbei');
  assert.equal(resolveDesign({ type: 'theme', page: salbei.page.toUpperCase(), accent: '#123456' }), salbei);
  // Worlds did not exist when hex-only rounds were saved, so a world's page hex
  // without an id must never conjure a world.
  for (const w of WORLDS) {
    assert.equal(resolveDesign({ type: 'theme', page: w.page, accent: w.accent }), null, w.id);
  }
});

test('an unknown id falls back to the hex path, then to null', () => {
  const salbei = PALETTES.find((p) => p.id === 'salbei');
  assert.equal(resolveDesign({ type: 'theme', id: 'nope', page: salbei.page, accent: salbei.accent }), salbei);
  assert.equal(resolveDesign({ type: 'theme', id: 'nope', page: '#123456', accent: '#654321' }), null);
  assert.equal(resolveDesign({ type: 'theme', page: '#123456', accent: '#654321' }), null);
  assert.equal(resolveDesign({ type: 'color', color: '#fff7ed' }), null);
  assert.equal(resolveDesign({ type: 'none' }), null);
  assert.equal(resolveDesign(null), null);
  assert.equal(resolveDesign(undefined), null);
});

test('designIcon names the world glyph and falls back to the app glyph', () => {
  const forest = WORLDS.find((w) => w.id === 'forest');
  assert.equal(designIcon({ type: 'theme', id: 'forest', page: forest.page, accent: forest.accent }), forest.icon);
  assert.equal(designIcon({ type: 'theme', page: PALETTES[1].page, accent: PALETTES[1].accent }), 'ti-tornado');
  assert.equal(designIcon(null), 'ti-tornado');
});
