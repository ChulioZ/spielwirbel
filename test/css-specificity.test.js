'use strict';

/* `specificity()` in test/support/css.js decides, for eight other specs, which
   of two rules the browser will actually apply — and it is compared against
   selectors read straight out of `public/styles.css`, which carries 23 `:not()`
   selectors and plenty of attribute selectors. Until #1053 it counted both
   naively, so two of its answers were wrong in the direction that matters:

     .setup-addons__chip[aria-expanded="true"]   read (0,2,1), really (0,2,0)
     *:not(.rail):not(.dock)                     read (0,4,0), really (0,2,0)

   The first is how #1053 hid: an over-count reads a genuine TIE as an outright
   win, and a tie is precisely the state those specs exist to catch, because a
   tie is decided by source order. Nothing was red — the helper simply answered
   a question nobody re-checked.

   These cases come from the CSS Selectors Level 4 specificity rules, not from
   the implementation: `:is()`/`:not()`/`:has()` take their most specific
   argument and contribute nothing themselves, `:where()` contributes nothing at
   all, an attribute selector is one class-level unit whatever its value, and a
   pseudo-ELEMENT is element-level where a pseudo-class is class-level. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { specificity, outranks, RULES } = require('./support/css');

const CASES = [
  // the plain shapes the helper always handled
  ['.a', [0, 1, 0]],
  ['.a .b', [0, 2, 0]],
  ['.a.b', [0, 2, 0]],
  ['button.chip', [0, 1, 1]],
  ['#x .a', [1, 1, 0]],
  ['a:hover', [0, 1, 1]],
  ['.stamp::before', [0, 1, 1]],
  // an attribute selector is ONE class-level unit, and its value is not a tag
  ['.setup-addons__chip[aria-expanded="true"]', [0, 2, 0]],
  ['[hidden]', [0, 1, 0]],
  ['input[type=text]', [0, 1, 1]],
  // the functional pseudo-classes
  ['.a:where(.b.c)', [0, 1, 0]],
  ['*:not(.rail):not(.dock)', [0, 2, 0]],
  ['.a:is(.b, #c)', [1, 1, 0]],
  ['.app:has(.pass) > *:not(.rail):not(.dock):is(.back-row, .pass)', [0, 5, 0]],
  // the pair #1053 turned on: a real tie, decided by source order
  ['.chip.is-on', [0, 2, 0]],
  ['.setup-addons__chip[aria-expanded="true"]:not(.is-on)', [0, 3, 0]],
];

test('specificity() matches the Selectors Level 4 rules for every shape this sheet uses', () => {
  const wrong = CASES
    .filter(([sel, want]) => specificity(sel).join(',') !== want.join(','))
    .map(([sel, want]) => `${sel} => ${specificity(sel).join(',')}, expected ${want.join(',')}`);
  assert.deepEqual(wrong, []);
});

test('a TIE does not outrank — the whole point of the eight specs that call this', () => {
  assert.equal(outranks('.chip.is-on', '.setup-addons__chip[aria-expanded="true"]'), false);
  assert.equal(outranks('.setup-addons__chip[aria-expanded="true"]', '.chip.is-on'), false);
  assert.ok(outranks('.setup-addons__chip[aria-expanded="true"]:not(.is-on)', '.chip.is-on'));
});

test('every selector in the shipped sheet is countable, and the sheet still exercises both hard shapes', () => {
  /* Anti-vacuous. The cases above are hand-written, so they would keep passing
     against a helper that has stopped matching anything the app ships; and a
     sheet that lost its `:not()` and attribute selectors would make the two
     corrections above untested rather than unneeded. */
  const selectors = RULES.map(([sel]) => sel).filter((sel) => !sel.startsWith('@') && !sel.startsWith('from') && !sel.startsWith('to') && !/^\d/.test(sel));
  assert.ok(selectors.length > 1000, `only ${selectors.length} selectors parsed out of the sheet`);
  for (const sel of selectors) {
    const s = specificity(sel);
    assert.ok(s.every((n) => Number.isInteger(n) && n >= 0), `${sel} => ${s}`);
  }
  assert.ok(selectors.filter((s) => s.includes(':not(')).length >= 20, 'the sheet no longer exercises :not()');
  assert.ok(selectors.filter((s) => /\[[\w-]+="/.test(s)).length >= 3, 'the sheet no longer exercises a quoted attribute selector');
});
