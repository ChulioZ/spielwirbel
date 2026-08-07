'use strict';

/* The Chronik shelf rows at phone widths (2026-08-07 UI audit).

   #361 fixed these rows' fragmentation with "one line, only the label wraps":
   `.tl-act__text` is the row's only flexible item, actor + timestamp are
   `flex: none; white-space: nowrap`. Correct on one line — but #207's actor
   span later added ~44px more fixed meta, and at 390px the fixed parts
   (icon + gaps + "· von <name>" + "07.08.2026, 22:50" + ✕) left the LABEL
   about 79px: one word per line, the very fragmentation #361 closed, back in
   a new shape. Nothing failed — the meta was nowrap and the label was
   "allowed to wrap internally", exactly as specified.

   The ≤520px rule drops the meta to a quiet second line instead. This spec
   pins its three load-bearing declarations, because each fails silently:
   without `flex-wrap` the row overflows, without the near-100% basis the label
   shares line 1 with the meta again, and without `margin-left: auto` the ✕
   sits mid-line instead of closing the meta line at the right edge. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CSS, mediaBlocks, rulesOf } = require('./support/css');

const rules = mediaBlocks()
  .filter(([query]) => /max-width:\s*520px/.test(query))
  .flatMap(([, css]) => rulesOf(css));

const bodyIn520 = (selector) => {
  const hit = rules.find(([sel]) => sel.split(',').map((s) => s.trim()).includes(selector));
  return hit ? hit[1] : null;
};

test('≤520px: the timeline row may wrap', () => {
  const act = bodyIn520('.tl-act');
  assert.ok(act, 'expected a .tl-act rule inside a max-width:520px block');
  assert.match(act, /flex-wrap:\s*wrap/, 'the meta can only drop to line 2 if the row wraps');
});

test('≤520px: the label claims the first line', () => {
  const text = bodyIn520('.tl-act__text');
  assert.ok(text, 'expected a .tl-act__text rule inside a max-width:520px block');
  // A flex-basis near 100% is what forces the wrap after the label; the exact
  // indent subtraction may be retuned, the near-full-width basis may not.
  assert.match(text, /flex:\s*1 1 calc\(100%/, 'the label must take (nearly) the full row so the meta wraps');
});

test('≤520px: the dismiss button closes the meta line at the right edge', () => {
  const del = bodyIn520('.tl-act__del');
  assert.ok(del, 'expected a .tl-act__del rule inside a max-width:520px block');
  assert.match(del, /margin-left:\s*auto/);
});

/* The narrow overrides tie their base rules at (0,1,0), so they win on SOURCE
   ORDER alone — the dock-hide shape from responsive-content-width.md, licensed
   only while the block sits adjacent BELOW the component. A refactor hoisting
   it above `.tl-act` (where the app's main ≤520px block lives, ~line 876) would
   disable every declaration above silently; flex-none-cancels-flex-wrap.md
   records three overrides lost exactly that way. */
test('the narrow block sits AFTER the .tl-act base rules it overrides', () => {
  const base = CSS.search(/\.tl-act\s*\{/);
  const override = CSS.search(/@media \(max-width: 520px\)[^{]*\{\s*\.tl-act\s*\{/);
  assert.ok(base >= 0 && override >= 0, 'expected both the base rule and the narrow block');
  assert.ok(override > base, 'the ≤520px .tl-act block must stay below the base rule, or its ties lose on source order');
});
