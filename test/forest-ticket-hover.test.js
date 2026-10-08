'use strict';

/* #1571: on the Forest hub, hovering the live ticket blanked the
   recommendations teaser in WebKit for as long as the hover lasted. Measured
   with the headless WebKit probe (.claude/rules/browser-pane-is-chromium-only.md):
   the base hover's rotate() is what tips it — the teaser sits in .hub-cards'
   column flow — while translateY alone, or the flow without columns, leaves the
   teaser painted. Forest's fix is a hover that lifts without rotating.

   jsdom paints nothing and the Browser pane is Chromium, so neither can see the
   bug itself; this pins the rule that removed it, and that Klassisch keeps its
   own hover untouched (the issue scoped the fix to Forest). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rulesOf, bodyOf, topLevel } = require('./support/css');

const FOREST_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'forest.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const FOREST_RULES = rulesOf(FOREST_CSS);
// Existence is looked up in the UNCONDITIONAL rules only, so a grouped @media
// reset naming the same selector cannot answer for a deleted rule
// (.claude/rules/css-rule-lookup-answers-with-the-media-reset.md).
const FOREST_TOP = rulesOf(topLevel(FOREST_CSS));

const FOREST_HOVER = ':root[data-design="forest"] .forest-hub .ticket:hover';
const transformOf = (body) => {
  const m = /(?:^|;)\s*transform\s*:\s*([^;]+)/.exec(body || '');
  return m ? m[1].trim() : null;
};

test('Forest lifts the hub ticket on hover without rotating it', () => {
  const t = transformOf(bodyOf(FOREST_HOVER, FOREST_TOP));
  assert.ok(t, `forest.css must state a transform for ${FOREST_HOVER}`);
  assert.match(t, /translateY\(\s*-2px\s*\)/, 'the hover keeps the base lift');
  assert.doesNotMatch(t, /rotate/, 'a rotated ticket blanks the teaser in WebKit (#1571)');
});

test('no Forest rule puts a rotation back on a hovered ticket', () => {
  const rotating = FOREST_RULES
    .filter(([sel]) => /\.ticket[^,]*:hover/.test(sel))
    .filter(([, body]) => /rotate/.test(transformOf(body) || ''));
  assert.deepEqual(rotating.map(([sel]) => sel), []);
});

test('Klassisch keeps its own tilted ticket hover (the fix is Forest-scoped)', () => {
  assert.match(transformOf(bodyOf('.ticket:hover', rulesOf(topLevel()))) || '', /rotate\(/);
});
