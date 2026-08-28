'use strict';

/* The Regal's filter gating, after #827 collapsed three affordances into one.
 *
 * #349 had hidden the tag chips behind a phone-only "Filter" button below 860px
 * (`.filter-toggle` + `.regal-filter.is-open`, a pure-CSS mechanism), while the
 * „Weitere Filter" drawer beside it collapsed at EVERY width. #827 deleted the
 * first: there is one `<details>` now, holding both halves, collapsed at every
 * width on both screens.
 *
 * This file pins that the old mechanism is GONE and cannot creep back, because
 * its return is silent in the worst way: a `.regal-filter .filter-chips
 * { display: none }` rule below 860px would now hide the tag chips INSIDE an
 * open panel — a user on a phone taps „Filter", the panel opens, and the tags
 * they were looking for are simply not there. Nothing throws, nothing is red,
 * and the metadata rows below still render, so the panel looks finished.
 *
 * CSS is asserted as text: jsdom applies no external stylesheet (comments
 * stripped, whole-class matched — .claude/rules/css-text-assertions-strip-comments.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { bodyOf, mediaBlocks, whole, RULES } = require('./support/css');

test('the phone-only tag toggle is gone from the stylesheet entirely', () => {
  assert.equal(bodyOf('.filter-toggle'), null,
    '.filter-toggle is back — #827 replaced it with the one .fpanel disclosure');
  assert.equal(bodyOf('.filter-toggle__badge'), null, '.filter-toggle__badge is back');
  const open = RULES.filter(([sel]) => whole('.regal-filter').test(sel) && /\.is-open/.test(sel));
  assert.deepEqual(open.map(([sel]) => sel), [],
    'a `.regal-filter.is-open` rule is back — that is the second collapse mechanism #827 removed');
});

test('no @media block gates the Regal filter by width any more', () => {
  const gated = mediaBlocks().filter(([, css]) => whole('.regal-filter').test(css));
  assert.deepEqual(gated.map(([q]) => q), [],
    'a width-gated .regal-filter block is back; the panel collapses by disclosure, at every width');
});

test('nothing hides the shared .filter-chips class by width, anywhere', () => {
  // The class is shared with the game-detail, add-game and session tag pickers,
  // and since #827 the Regal's copy lives INSIDE the open panel — so a
  // display:none on it is wrong at both ends.
  const hidden = RULES
    .filter(([sel]) => whole('.filter-chips').test(sel) && !/\[hidden\]/.test(sel))
    .filter(([, body]) => /display:\s*none/.test(body));
  assert.deepEqual(hidden.map(([sel]) => sel), []);
});

test('the panel badge honours [hidden] (its explicit display would override it)', () => {
  // `.fpanel__badge { display: inline-flex }` beats the UA sheet's
  // `[hidden] { display: none }`, so without this rule a zero-filter panel would
  // show a "0" badge. Same trap `.filter-chips[hidden]` records.
  assert.match(bodyOf('.fpanel__badge') || '', /display:\s*inline-flex/);
  const guard = bodyOf('.fpanel__badge[hidden]');
  assert.ok(guard, '.fpanel__badge[hidden] rule not found');
  assert.match(guard, /display:\s*none/);
});

test('the setup screen lets the open panel take the whole filter row', () => {
  // The count stepper and the panel share a flex row; without this the body
  // would unfold inside the panel's own narrow column and the ~84 category
  // chips would wrap into a tower beside the stepper.
  assert.match(bodyOf('.setup-filterbar') || '', /flex-wrap:\s*wrap/);
  const open = RULES.find(([sel]) => whole('.setup-filterbar').test(sel) && /\.fpanel\[open\]/.test(sel));
  assert.ok(open, 'no rule widens the setup filter row for an open panel');
  assert.match(open[1], /flex:\s*1\s+1\s+100%/);
});
