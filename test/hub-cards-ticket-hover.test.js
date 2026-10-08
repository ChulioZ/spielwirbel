'use strict';

/* #1571: in WebKit, hovering a tilted ticket on the round hub blanked every
   card in the column flow below it (the recommendations teaser among them) for
   as long as the hover lasted — in Klassisch, Die Brücke and Forest alike. Two
   things combine: the base hover's rotate(), and .hub-cards being a multicol
   container. Giving the flow its own stacking context keeps it painted.
   Measured with the headless WebKit probe
   (.claude/rules/browser-pane-is-chromium-only.md); the fix lives on the
   container, so the ticket keeps its tilt in every design.

   jsdom paints nothing and the Browser pane is Chromium, so neither can see the
   bug itself; this pins the rule that removed it, and that no design sheet takes
   it back off. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CSS, rulesOf, bodyOf, topLevel, whole, declaredValue } = require('./support/css');

const DESIGN_DIR = path.join(__dirname, '..', 'public', 'css', 'designs');
const SHEETS = [['styles.css', CSS], ...fs.readdirSync(DESIGN_DIR)
  .filter((f) => f.endsWith('.css'))
  .map((f) => [f, fs.readFileSync(path.join(DESIGN_DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')])];

test('the hub card flow is its own stacking context', () => {
  // Existence is looked up in the unconditional rules only
  // (.claude/rules/css-rule-lookup-answers-with-the-media-reset.md).
  const body = bodyOf('.hub-cards', rulesOf(topLevel()));
  assert.ok(body, 'styles.css must declare .hub-cards');
  assert.match(body, /(?:^|;)\s*columns\s*:/, 'precondition: .hub-cards is a column flow');
  assert.equal(declaredValue(body, 'isolation'), 'isolate',
    'a column flow under a rotated hovered ticket blanks in WebKit without its own stacking context (#1571)');
});

/* The subject is the last compound of each selector in a group: a rule about
   `.hub-cards > .card-slot` styles the slot, not the flow. */
const SUBJECT_HUB_CARDS = whole('.hub-cards');
const namesFlow = (selector) => selector.split(',').some((part) => {
  const subject = part.trim().split(/\s*[\s>+~]\s*/).pop();
  return SUBJECT_HUB_CARDS.test(subject) && !/::/.test(subject);
});

test('no stylesheet takes the stacking context back off .hub-cards', () => {
  let seen = 0;
  const resets = [];
  for (const [file, css] of SHEETS) {
    for (const [sel, body] of rulesOf(css)) {
      if (!namesFlow(sel)) continue;
      seen += 1;
      const value = declaredValue(body, 'isolation');
      if (value && value !== 'isolate') resets.push(`${file}: ${sel.trim()} → isolation: ${value}`);
    }
  }
  // Anti-vacuous: the base rule plus the design sheets' own .hub-cards rules.
  assert.ok(seen >= 5, `expected to find the .hub-cards rules, saw ${seen}`);
  assert.deepEqual(resets, []);
});

test('the ticket keeps its tilt — the fix is on the container, not the hover', () => {
  const t = declaredValue(bodyOf('.ticket:hover', rulesOf(topLevel())) || '', 'transform') || '';
  assert.match(t, /rotate\(/);
});
