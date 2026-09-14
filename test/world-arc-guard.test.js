'use strict';

/* The SVG arc guard (#1081) — split out of test/round-worlds.test.js by #1082,
 * which pushed that file past the 700-line budget.
 *
 * This is its own concern by the seam test rather than by line count: it asks an
 * ARITHMETIC question about path data (does any arc ask for a radius the browser
 * will silently scale up?) and is edited when the artwork changes, while its
 * former neighbours assert the slot rules and are edited when a slot does. The
 * two have no shared fixtures beyond `CSS` itself.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bodyOf } = require('./support/css');
const { WORLDS } = require('../public/js/round-designs');

/* ---- the arc guard (#1081) ------------------------------------------------
 *
 * Both Horror moons painted ZERO pixels in production, and nothing could see
 * it: the SVG parsed, the mask applied, the token was present, every geometry
 * assertion above stayed green, and the ornament simply was not there.
 *
 * The mechanism is in the SVG spec: an elliptical arc whose radius is too small
 * to reach its own endpoint is not an error — the radii are SCALED UP until it
 * just fits. A crescent drawn as two arcs on a 72px chord whose inner arc asks
 * for r 29 therefore becomes two identical half-circles, which cancel exactly.
 *
 * So the guard is arithmetic on the path data, and it applies the SPEC's own
 * test rather than a paraphrase of it (F.6.6.2):
 *
 *     Λ = (x₁′/rx)² + (y₁′/ry)²,  scaled up iff Λ > 1
 *
 * where (x₁′, y₁′) is half the endpoint delta rotated by −φ. The obvious
 * shorthand — "2·rx and 2·ry must both reach the chord" — is WRONG and was
 * measured wrong: it flags `a 10 8 0 0 1 20 0`, a flat-ended ellipse where the
 * short radius is the one perpendicular to the chord and nothing is scaled at
 * all. Three of Forest's mushroom caps are that shape, and a guard that fails on
 * correct artwork gets weakened until it stops catching the real thing.
 *
 * It cannot judge whether a mask LOOKS right — node has no canvas, and the ink
 * measurements that found this live on the bench — but it catches the one
 * failure that is invisible in every other direction.
 */

/* `a rx ry rot large sweep dx dy`, relative. The uppercase form is absolute and
   carries no chord computable from the command alone, so it is skipped rather
   than guessed at — no world mask uses one today.

   `SEP` is the whole reason this is not a one-liner. In SVG path data a MINUS
   SIGN is itself a separator, so the shipped Horror crescent spells its endpoint
   `0-72`, with no space. A pattern demanding `[\s,]+` between dx and dy matches
   nothing there — and the first draft of this guard swept every world, reported
   clean, and missed both of the moons it was written for
   (.claude/rules/source-scanning-guards-enumerate-shapes.md: what varies is the
   syntax around the token, not the token). */
const SEP = '(?:[\\s,]+|(?=-))';
const N = '(-?[\\d.]+)';
const ARC_RE = new RegExp(
  `a[\\s,]*${N}${SEP}${N}${SEP}${N}[\\s,]*([01])[\\s,]*([01])[\\s,]*${N}${SEP}${N}`, 'g');

function badArcs(css) {
  const out = [];
  for (const m of css.matchAll(ARC_RE)) {
    if (m[0][0] !== 'a') continue; // relative only
    const [rx, ry, rot, , , dx, dy] = m.slice(1).map(Number);
    // A zero radius is a straight line by spec, and deliberate where it appears.
    if (rx === 0 || ry === 0) continue;
    const phi = (rot * Math.PI) / 180;
    const x1 = (Math.cos(phi) * dx + Math.sin(phi) * dy) / 2;
    const y1 = (-Math.sin(phi) * dx + Math.cos(phi) * dy) / 2;
    const lambda = (x1 / rx) ** 2 + (y1 / ry) ** 2;
    if (lambda > 1 + 1e-9) {
      out.push(`a ${rx} ${ry} … ${dx} ${dy} — Λ ${lambda.toFixed(2)}, so both radii are scaled by ${Math.sqrt(lambda).toFixed(2)}×`);
    }
  }
  return out;
}

test('the arc guard can see a radius that is too small for its chord', () => {
  // The guard's own self-test, with the shape that shipped. Without it a broken
  // regex reports "no bad arcs" over every world and the check is vacuous.
  assert.deepEqual(badArcs("d='M0 0a36 36 0 0 1 0 72z'"), [], 'a radius exactly half the chord is legal');
  assert.equal(badArcs("d='M0 0a29 29 0 0 0 0 72z'").length, 1, 'the shipped Horror crescent must be caught');
  assert.equal(badArcs("d='M0 0a40 20 0 0 0 0 72z'").length, 1,
    'a short radius ALONG the chord is still scaled — here ry, on a vertical chord');
  // …and the negative that the naive "2r >= chord" form gets wrong: a flat
  // ellipse whose SHORT radius is perpendicular to the chord is untouched.
  assert.deepEqual(badArcs("d='M0 0a10 8 0 0 1 20 0z'"), [],
    'a flat-ended ellipse is legal — three of Forest\'s mushroom caps are this shape');
  // The SPELLING that shipped: a minus sign as the separator, no space. The
  // first draft of this guard swept every world clean and missed both moons.
  assert.equal(badArcs("d='M70 22a36 36 0 1 0 0 72a29 29 0 1 1 0-72z'").length, 1,
    'the compact `0-72` endpoint form must be parsed, not skipped');
});

test('no world mask asks for an arc radius the browser will silently scale up', () => {
  let checked = 0;
  const bad = [];
  for (const w of WORLDS) {
    const body = bodyOf(`[data-world="${w.id}"]`);
    assert.ok(body, `no token block for ${w.id}`);
    for (const [, token, value] of body.matchAll(/(--world-[\w-]+):\s*(url\("data:image\/svg\+xml,[^"]*"\))/g)) {
      checked += 1;
      for (const hit of badArcs(decodeURIComponent(value))) bad.push(`${w.id} ${token}: ${hit}`);
    }
  }
  // Anti-vacuous: counts masks actually put through the check, so a lookup that
  // stopped finding any would fail here rather than reporting a clean sweep.
  assert.ok(checked >= 30, `expected to scan every world's masks, scanned ${checked}`);
  assert.deepEqual(bad, [],
    `these arcs are scaled up silently and paint the wrong shape (a crescent becomes two cancelling half-discs):\n  ${bad.join('\n  ')}`);
});
