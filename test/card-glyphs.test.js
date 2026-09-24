'use strict';

/*
 * The Tabler outlines a canvas draws (#1199, public/js/card-glyphs.js).
 *
 * They were read once out of the bundled woff2 and are data from then on, so
 * the failures worth pinning are the ones a hand edit or a botched regeneration
 * would produce silently: an outline drawn in the font's own y-UP space (the
 * glyph lands upside down and ~900 units off the card), a face missing from the
 * scale, or a glyph the card asks for that the table does not hold — which
 * Path2D would draw as nothing at all.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CARD_GLYPHS, CARD_GLYPH_BOX, CARD_FACES } = require('../public/js/card-glyphs');
const { MOODS } = require('../public/js/rating-faces');

const coords = (d) => (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

test('every outline sits inside the y-down box it claims', () => {
  for (const [name, d] of Object.entries(CARD_GLYPHS)) {
    assert.match(d, /^M/, `${name} is an SVG path`);
    const n = coords(d);
    assert.ok(n.length > 20, `${name} has real geometry`);
    // Tabler draws inside a 1000-unit em with a little overshoot below the
    // baseline (the faces reach y = 917 of the y-down box); nothing may leave it.
    for (const v of n) {
      assert.ok(v >= 0 && v <= CARD_GLYPH_BOX, `${name}: coordinate ${v} is outside 0..${CARD_GLYPH_BOX}`);
    }
    // The flip. In font space the whirl's widest bar is at the TOP (largest y);
    // flipped into canvas space it must be at the smallest y. An unflipped
    // table puts the widest bar at the bottom and every glyph upside down.
    if (name === 'tornado') {
      const ys = n.filter((_, i) => i % 2 === 1);
      assert.ok(Math.min(...ys) < 200, 'the whirl opens at the top of its box, as it does on screen');
    }
  }
});

test('the five faces are the vote scale’s, in its order', () => {
  // The REAL scale, required rather than restated: a face added to, removed
  // from or reordered on the vote card reddens here instead of drawing the
  // wrong face — or a gap — on every shared card.
  assert.deepEqual(CARD_FACES, MOODS.map((m) => m.replace(/^ti-/, '')));
  for (const face of CARD_FACES) assert.ok(CARD_GLYPHS[face], `${face} has an outline`);
});

test('every glyph the card draws is in the table', () => {
  const card = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'recap-card-tisch.js'), 'utf8');
  const asked = [...card.matchAll(/tischGlyph\(ctx, '([\w-]+)'/g)].map((m) => m[1]);
  assert.ok(asked.length >= 3, 'the card’s glyph calls were found');
  for (const name of asked) assert.ok(CARD_GLYPHS[name], `the card draws '${name}', which card-glyphs.js lacks`);
});
