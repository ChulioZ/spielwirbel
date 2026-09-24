'use strict';

/* Der Tisch's REGAL, SPIELEPASS and add-game LOOKUP (#1190) — the screen layer
 * for T3.3-T3.5 and T6.2-T6.4, over #1189's hub and #1188's tokens.
 *
 * Almost all of this slice is repaint, and repaint is covered generically
 * already: test/tisch-hub-lobby.test.js derives "a rule reading a scheme-gated
 * token is itself scheme-gated" over the whole file, and test/design-layer's two
 * sweeps refuse a colour literal or a token shadow outside the root blocks. A
 * rule added here is picked up by all three without anyone editing a list —
 * measured, by ungating `.lookup__menu` on purpose and watching the first of
 * them go red naming that test.
 *
 * What those cannot see is the two claims below, which is why this file exists.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rulesOf } = require('./support/css');
const { contrast, token } = require('./support/theme');
const { designById } = require('../public/js/designs');

const SHEET = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = rulesOf(SHEET);
const bodyFor = (needle) => {
  const hit = RULES.find(([sel]) => sel.replace(/\s+/g, ' ').includes(needle));
  return hit ? hit[1] : null;
};

const AA = 4.5;

/* 1 — THE BOARDS' PITCH.
 *
 * The plank under each board is one repeating background on the grid rather
 * than a per-card element (the stylesheet says why). That buys a continuous
 * rule across the column gaps and costs one invariant: the background TILE must
 * be exactly as tall as a grid row plus its gap, or every board after the first
 * drifts — a few pixels at row two, half a cover by row ten. It is a slow,
 * cumulative error, so the top of a shelf looks perfectly correct and only a
 * long one shows it.
 *
 * Nothing else can catch it. jsdom applies no stylesheet, and a browser check
 * would have to scroll a 40-game shelf to the bottom to see a gap that only
 * opens there. So what is pinned is the DERIVATION: the tile height, the row
 * height and the gap are all written from the same four custom properties, and
 * none of the three is a number. A literal is how the drift gets in — someone
 * retunes the cover height and updates two of the three places.
 */
test('the board pitch is derived from the shelf variables, never written as a number', () => {
  const body = bodyFor('.cards');
  assert.ok(body, 'the Regal grid rule is gone — did .cards move?');

  const decl = (prop) => {
    const m = new RegExp(`(^|[;{\\s])${prop}\\s*:\\s*([^;]+)`).exec(body);
    return m && m[2].trim();
  };

  assert.equal(decl('grid-auto-rows'), 'var(--shelf-row)',
    'a row must be --shelf-row, or the tile below stops describing it');
  assert.match(decl('background-size'), /^100%\s+var\(--shelf-pitch\)$/,
    'the tile must be exactly --shelf-pitch tall');

  /* The pitch and the gap are the pair that has to agree: pitch = row + gap.
     Both are written from the plank and the clearance, so they cannot disagree
     without one of them being edited into a literal. */
  assert.match(decl('--shelf-pitch'),
    /calc\(\s*var\(--shelf-row\)\s*\+\s*var\(--shelf-plank\)\s*\+\s*var\(--shelf-clear\)\s*\)/,
    '--shelf-pitch must be the row plus the plank plus the clearance');
  assert.match(decl('row-gap'),
    /calc\(\s*var\(--shelf-plank\)\s*\+\s*var\(--shelf-clear\)\s*\)/,
    'the row gap must be the plank plus the clearance — the same two the pitch adds');
  assert.equal(decl('--shelf-row'), 'calc(var(--shelf-cover) + var(--shelf-body))',
    'a row is the cover box plus the body under it');

  /* The density tier (T7.7) re-declares the two SIZE variables on the same
     element and deliberately leaves the derivations alone, so the pitch
     re-resolves for free. If it ever states its own row, gap or tile, the two
     tiers can drift apart — which is the same bug one selector over. */
  const dense = bodyFor(':nth-of-type(40)');
  assert.ok(dense, 'the T7.7 density rule is gone');
  for (const prop of ['grid-auto-rows', 'background-size', '--shelf-pitch', '--shelf-row']) {
    assert.doesNotMatch(dense, new RegExp(`(^|[;{\\s])${prop}\\s*:`),
      `the density tier must not restate ${prop} — it inherits the derivation`);
  }
});

/* 2 — „STEHT SCHON IM REGAL", the one line in this slice whose ink had to
 * change rather than be restyled.
 *
 * Inside a sheet Der Tisch flips `--surface` to paper, and the three status
 * tokens were not re-pointed with it: `--warn`, which the app paints this hint
 * in, is an amber tuned against walnut. On cream it is 1.55:1.
 *
 * The CONTROL is the whole point of this test and it is the half that makes it
 * discriminating. Asserting only that the shipped ink clears AA would pass just
 * as well against the bug, because the assertion would never have looked at
 * what the app paints without this rule — so the old value is measured here
 * too, and the test says out loud that it fails. Remove the rule and the first
 * assertion goes red; weaken the rule to any other token tuned for walnut and
 * it goes red as well.
 */
test('the duplicate hint is readable on the sheet\'s paper, where --warn is not', () => {
  const tisch = designById('tisch');
  const paper = token('--paper', tisch);
  const shipped = bodyFor('.sheet .field__hint--dup');
  assert.ok(shipped, 'the dup-hint rule is gone — is the hint back on --warn?');
  const m = /color:\s*var\((--[a-z-]+)\)/.exec(shipped);
  assert.ok(m, `the dup hint must take a token, not a literal: ${shipped}`);

  const ink = token(m[1], tisch);
  const ratio = contrast(ink, paper);
  assert.ok(ratio >= AA,
    `the dup hint paints ${m[1]} on the sheet's paper at ${ratio.toFixed(2)}:1; it needs ${AA}:1`);

  const warn = contrast(token('--warn', tisch), paper);
  assert.ok(warn < AA,
    `--warn now measures ${warn.toFixed(2)}:1 on paper. If the status tokens were re-pointed `
    + 'for the overlay (#1195), this rule is redundant — delete it and this test with it, '
    + 'rather than leaving a fix whose reason has gone.');
});

/* 3 — THE PHONE TOOLBAR'S REORDER is gone (#1278), and must not come back by
 * position.
 *
 * It existed to move the BGG-import button — the Regal row's first child —
 * below the chips on a phone. #1278 took the import out of the Tisch row (the
 * add sheet carries it), so the search is first in the DOM and nothing needs
 * reordering; test/tisch-regal-toolbar.test.js pins the new row.
 *
 * What survives is the trap that rule was guarded against: `.section-tools` is
 * shared with the three archive screens (views-archive.js), whose first child
 * is a `.link-btn` too. A positional `:first-child` rule on the row would
 * banish the Wunschliste's „Spiel hinzufügen" to a row of its own.
 */
test('no phone toolbar rule addresses the shared tools row by position', () => {
  const phone = SHEET.match(/@media \(max-width: 859px\)\s*\{([\s\S]*?)\n\}/g) || [];
  const block = phone.find((b) => b.includes('.section-tools'));
  assert.ok(block, 'the phone toolbar block is gone');
  const positional = block.split('\n').filter((l) => /\.section-tools[^{]*:first-child/.test(l));
  assert.deepEqual(positional, [],
    'a positional rule on the shared tools row also reaches the three archive screens');
});
