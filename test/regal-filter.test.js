'use strict';

/* The Regal's filter gating, after #827 collapsed three affordances into one and
 * #844 moved the body out of the page into an overlay.
 *
 * #349 had hidden the tag chips behind a phone-only "Filter" button below 860px
 * (`.filter-toggle` + `.regal-filter.is-open`, a pure-CSS mechanism), while the
 * „Weitere Filter" drawer beside it collapsed at EVERY width. #827 deleted the
 * first: there is one control now, holding both halves, collapsed at every
 * width on both screens — and since #844 it opens as an overlay rather than
 * unfolding in the page.
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

test('the applied-chip row honours [hidden] (its explicit display would override it)', () => {
  // `.fbar__chips { display: flex }` beats the UA sheet's
  // `[hidden] { display: none }`, so without this rule an unfiltered screen would
  // still pay the bar's 8px gap for an empty row. Same trap the badge this
  // replaced recorded, and the one `.filter-chips[hidden]` records.
  assert.match(bodyOf('.fbar__chips') || '', /display:\s*flex/);
  const guard = bodyOf('.fbar__chips[hidden]');
  assert.ok(guard, '.fbar__chips[hidden] rule not found');
  assert.match(guard, /display:\s*none/);
});

test('NOTHING re-widens the setup filter row for an open panel (#844)', () => {
  /* This is the bug, in one assertion. #827 carried
       `.setup-filterbar > :has(> .fpanel[open]) { flex: 1 1 100% }`
     so the expanding body could use the full row instead of unfolding inside its
     own narrow flex column — and that 100% flex-basis is exactly what forced the
     mount onto a new flex line, taking the „Filter" button with it and pushing
     the pool preview down. One click moved two things the user had not touched.

     Since #844 the body opens as an overlay, so it needs no room in this row at
     all. Any rule granting the mount a full-row basis is the bug returning: it
     could only be there to make room for a body that is no longer in the flow. */
  assert.match(bodyOf('.setup-filterbar') || '', /flex-wrap:\s*wrap/,
    'the row still wraps — the stepper and the trigger must not overflow it');
  const widened = RULES.filter(([sel, body]) =>
    whole('.setup-filterbar').test(sel) && /flex(-basis)?:[^;]*100%/.test(body));
  assert.deepEqual(widened.map(([sel]) => sel), [],
    'a rule gives the filter mount the whole setup row again — the trigger will jump lines (#844)');
  // And the selector that carried it is gone outright, so it cannot come back
  // under a different declaration either.
  const details = RULES.filter(([sel]) => /\.fpanel\[open\]/.test(sel));
  assert.deepEqual(details.map(([sel]) => sel), [],
    'a `.fpanel[open]` rule is back — the panel is not a <details> any more');
});
