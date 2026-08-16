'use strict';

/* The lookup menu's keyboard navigation state (#542): which suggestion is
   active as ArrowDown/ArrowUp move through the list, and how that survives the
   re-render every provider arrival triggers. Pure arithmetic, so it is unit
   tested directly — the DOM half (aria-activedescendant, the highlight class,
   Escape scoping) is verified in a browser. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { nextLookupIndex, lookupOptionIndex } = require('../public/js/lookup-nav');

test('ArrowDown from nothing active selects the first option, ArrowUp the last', () => {
  assert.equal(nextLookupIndex(-1, 3, 'ArrowDown'), 0);
  assert.equal(nextLookupIndex(-1, 3, 'ArrowUp'), 2);
});

test('ArrowDown/ArrowUp step and wrap around the list', () => {
  assert.equal(nextLookupIndex(0, 3, 'ArrowDown'), 1);
  assert.equal(nextLookupIndex(1, 3, 'ArrowDown'), 2);
  assert.equal(nextLookupIndex(2, 3, 'ArrowDown'), 0, 'wraps past the end');
  assert.equal(nextLookupIndex(0, 3, 'ArrowUp'), 2, 'wraps past the start');
  assert.equal(nextLookupIndex(0, 1, 'ArrowDown'), 0, 'a single option stays put');
});

// The input is an *editable* combobox, so every other key has to keep its native
// effect — hijacking Left/Right or Home/End would break caret movement in a
// field the user is still typing in. null is how the caller knows not to
// preventDefault.
test('keys the widget does not own return null, so the caret keys still work', () => {
  ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Escape', 'a', 'Tab']
    .forEach((key) => assert.equal(nextLookupIndex(-1, 3, key), null, key));
});

test('an empty list has nothing to move through', () => {
  assert.equal(nextLookupIndex(-1, 0, 'ArrowDown'), null);
  assert.equal(nextLookupIndex(-1, 0, 'ArrowUp'), null);
});

// A slower provider's results re-render the menu underneath the highlight, so
// the index in hand can outlive the list it referred to.
test('an out-of-range index reads as nothing active rather than moving from it', () => {
  assert.equal(nextLookupIndex(7, 3, 'ArrowDown'), 0);
  assert.equal(nextLookupIndex(7, 3, 'ArrowUp'), 2);
  assert.equal(nextLookupIndex(null, 3, 'ArrowDown'), 0);
});

// --- lookupOptionIndex: re-locating the active option after a re-render ------

// Since #790 there is one option per hit, identified by its provider plus that
// provider's own id — note '13' appears under two providers, which is exactly
// the collision matching on the id alone would get wrong.
const OPTIONS = [
  { provider: 'bgg', providerId: '13' },
  { provider: 'steam', providerId: '13' },
  { provider: 'bgg', providerId: '230802' },
];

test('an option is re-found by provider AND providerId, not by either alone', () => {
  assert.equal(lookupOptionIndex(OPTIONS, { provider: 'steam', providerId: '13' }), 1);
  assert.equal(lookupOptionIndex(OPTIONS, { provider: 'bgg', providerId: '230802' }), 2);
  // Same id, a provider that is no longer in the list.
  assert.equal(lookupOptionIndex(OPTIONS, { provider: 'xbox', providerId: '13' }), -1);
  // Same provider, a hit that dropped out of the list.
  assert.equal(lookupOptionIndex(OPTIONS, { provider: 'bgg', providerId: 'gone' }), -1);
});

test('the highlight follows its option when a re-render moves it', () => {
  const ref = { provider: 'bgg', providerId: '230802' };
  assert.equal(lookupOptionIndex(OPTIONS, ref), 2);
  // A better-matching hit lands above it: same option, new index.
  const reordered = [{ provider: 'bgg', providerId: '9209' }].concat(OPTIONS);
  assert.equal(lookupOptionIndex(reordered, ref), 3);
});

test('no selection, or no list, is -1 rather than a crash or a stray match', () => {
  assert.equal(lookupOptionIndex(OPTIONS, null), -1);
  assert.equal(lookupOptionIndex(OPTIONS, undefined), -1);
  assert.equal(lookupOptionIndex(null, { provider: 'bgg', providerId: '13' }), -1);
});
