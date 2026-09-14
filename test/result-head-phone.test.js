'use strict';

/* The result screen's head on a phone (#1078).

   #1055 made the title a whole sentence and solved the DESKTOP problem with
   `.page-head--result > :first-child { flex: 1 1 0; min-width: 0 }` — the
   sentence wraps in its own column so „Teilen" keeps the right edge. At 390px
   that same rule is the problem: measured before this change, the title column
   kept 228 of 362px because a 118px button and a 16px gap sat beside it, so the
   sentence became four lines of 30px display type — a 234px head that pushed the
   Tisch to y=557, below the fold, on the screen whose entire content is the
   Tisch.

   Measured after, at 390px: head 234 -> 146px, title column 228 -> 362px (two
   lines instead of four), the date on one line instead of two, „Teilen" at
   x=14 below it, and the Tisch at y=469. At 900px nothing moved: row, 30px,
   button flush at the right edge.

   These are TEXT assertions, so Route 1 is not available — jsdom applies no
   external stylesheet (.claude/rules/break-the-code-on-purpose.md). Each was
   seen red against its own deliberate break. Comments are stripped by
   test/support/css.js, which matters more than usual here: the explanatory
   comment above the rules names every class and value they set
   (.claude/rules/css-text-assertions-strip-comments.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bodyOf, mediaBlocks, rulesOf, declaredValue } = require('./support/css');

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public/styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const PHONE = () => mediaBlocks()
  .filter(([q]) => /max-width:\s*639px/.test(q))
  .flatMap(([, css]) => rulesOf(css));

const phoneRule = (selector) => PHONE()
  .find(([sel]) => sel.replace(/\s+/g, ' ').trim() === selector);

test('the desktop head is untouched: the title column still takes the row', () => {
  // Anti-vacuous, and the thing a phone fix is most likely to break. #1055's
  // rule is what keeps „Teilen" at the right edge for the sentence title.
  const el = bodyOf('.page-head--result > :first-child');
  assert.ok(el, '#1055\'s flexible title column is gone — „Teilen" wraps to its own line at 900px again');
  assert.match(el, /flex:\s*1 1 0/);
  assert.match(el, /min-width:\s*0/, 'without min-width the column refuses to shrink below its longest word');
});

test('below 640px the head drops one type step', () => {
  const rule = phoneRule('.page-head--result h1');
  assert.ok(rule, 'the phone type step is gone — the sentence is back to 30px in a 362px column');
  assert.match(declaredValue(rule[1], 'font-size'), /var\(--text-2xl\)/,
    'the precedent is .gd-info h1, which drops 3xl -> 2xl at its own phone breakpoint');
  assert.ok(declaredValue(rule[1], 'line-height'),
    'the wrapped sentence needs its leading tightened; 45px of default leading on four lines is the bulk of the head');
});

test('the phone type step WINS its tie with .page-head h1, which is decided by source order', () => {
  /* Both selectors are (0,1,1) — a TIE, not a win, so `outranks()` cannot
     answer this and specificity is the wrong thing to assert. What actually
     decides it is position in the sheet: the later rule takes the property. So
     assert the position, which is the decision rather than an ingredient
     (.claude/rules/assert-the-decision-not-its-ingredients.md).

     This is this sheet's standing trap, called out in the `.tisch-bar` block
     a few thousand lines down. */
  const base = SHEET.indexOf('.page-head h1');
  const phone = SHEET.indexOf('.page-head--result h1');
  assert.ok(base >= 0 && phone >= 0, 'one of the two rules is gone');
  assert.ok(phone > base,
    'the phone type step was moved ABOVE `.page-head h1`; both are (0,1,1), so the earlier one now wins and the title stays 30px');
});

test('below 640px the head stacks, so the sentence gets the full content width', () => {
  const rule = phoneRule('.page-head--result');
  assert.ok(rule, 'the head no longer stacks on a phone — „Teilen" is back beside the title, taking 63% of the row');
  assert.equal(declaredValue(rule[1], 'flex-direction'), 'column');
  assert.equal(declaredValue(rule[1], 'align-items'), 'flex-start',
    '„Teilen" must sit at the left content edge, not centred or stretched full width');
  assert.ok(declaredValue(rule[1], 'gap'), 'the stacked head sets its own gap; the row gap of 16px is too much vertically');
});

test('the stacked column resets the flex basis it inherits from the desktop rule', () => {
  /* `flex: 1 1 0` in a COLUMN means "share the height", which is not what the
     desktop rule is for — the title block would be stretched against the button
     rather than sized by its own content. */
  const rule = phoneRule('.page-head--result > :first-child');
  assert.ok(rule, 'the phone block no longer resets the basis — `flex: 1 1 0` is sharing HEIGHT in a column');
  assert.match(declaredValue(rule[1], 'flex-basis') || '', /auto/);
});

test('nothing reserves space for a share button that is not rendered', () => {
  /* `canShareResult()` is false outside a secure context, so a plain-HTTP
     self-host renders no button at all. A flex GAP applies only between items,
     which is why the stacked head may set one — measured at 360px with the
     button removed: head 121px, title column 121px, stray gap 0. A margin on the
     button, or padding on the head, would not have that property. */
  const rule = phoneRule('.page-head--result');
  assert.doesNotMatch(rule[1], /padding-bottom|margin-bottom/,
    'a bottom spacing on the head shows as a stray gap when the share button is absent — use the flex gap');
});
