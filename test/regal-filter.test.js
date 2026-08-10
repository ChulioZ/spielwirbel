'use strict';

/* On a phone, a round with many custom tags pushed the Regal cover grid below
   the fold behind a tall wrapped block of filter chips; #349 collapses the
   chips behind a "Filter" button below 860px and leaves them inline from 860px
   up. That gating is pure CSS scoped to `.regal-filter`, so it fails silently
   in both directions from Node: a blanket rule on the shared `.filter-chips`
   class would also blank the game-detail / add-game / session tag pickers, and
   a dropped media block would strand the chips on either phones or desktop.
   Pin the gating and the 859/860 adjacency here (comments stripped, whole-class
   matched — see .claude/rules/css-text-assertions-strip-comments.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { bodyOf, rulesOf, mediaBlocks, whole } = require('./support/css');

// The @media blocks that govern the Regal filter — identified by scoping rules
// to `.regal-filter` (the dock's own 859/860 blocks never mention it).
const regalBlocks = mediaBlocks().filter(([, css]) => whole('.regal-filter').test(css));
const narrow = regalBlocks.find(([q]) => /max-width/.test(q));
const wide = regalBlocks.find(([q]) => /min-width/.test(q));

test('.filter-toggle is hidden by default (inert on wide screens)', () => {
  const base = bodyOf('.filter-toggle');
  assert.ok(base, '.filter-toggle base rule not found in styles.css');
  assert.match(base, /display:\s*none/);
});

test('below 860px the toggle shows and the Regal chips collapse behind it', () => {
  assert.ok(narrow, 'no narrow @media block scopes rules to .regal-filter');
  const rules = rulesOf(narrow[1]);
  // The button appears...
  assert.match(bodyOf('.regal-filter .filter-toggle', rules) || '', /display:\s*inline-flex/);
  // ...the chips are hidden by default...
  assert.match(bodyOf('.regal-filter .filter-chips', rules) || '', /display:\s*none/);
  // ...and revealed only when the wrapper is toggled open.
  assert.match(bodyOf('.regal-filter.is-open .filter-chips', rules) || '', /display:\s*flex/);
});

test('the bulk toggle (#723) collapses WITH the chips it acts on', () => {
  // It is a sibling of `.filter-chips`, not a child, so it inherits none of the
  // collapse above — without its own pair of rules it would either offer
  // "Alle abwählen" over filters the user cannot see, or (having been hidden
  // once) never come back when the panel opens. Neither is reachable from
  // jsdom, which applies no external stylesheet, so this is the only guard.
  assert.ok(narrow, 'no narrow @media block scopes rules to .regal-filter');
  const rules = rulesOf(narrow[1]);
  assert.match(bodyOf('.regal-filter .tag-bulk', rules) || '', /display:\s*none/);
  assert.match(bodyOf('.regal-filter.is-open .tag-bulk', rules) || '', /display:\s*inline-block/);
});

test('the bulk toggle collapse is scoped to the Regal, not the shared class', () => {
  // The session setup screen carries the same `.tag-bulk`, permanently visible
  // beside its field label. A bare `.tag-bulk { display: none }` on narrow would
  // hide it there with nothing to say so — the `.filter-chips` trap above, one
  // control over.
  assert.ok(narrow, 'no narrow @media block scopes rules to .regal-filter');
  const offenders = rulesOf(narrow[1]).filter(([sel, body]) =>
    sel === '.tag-bulk' && /display:\s*none/.test(body));
  assert.deepEqual(offenders, [], 'the narrow block hides the bare .tag-bulk class');
});

test('the AND/OR mode control (#726) collapses WITH the chips it governs', () => {
  // Same reasoning as the bulk toggle above: it is a sibling of `.filter-chips`,
  // so it inherits none of the collapse and would otherwise offer a combination
  // mode over chips the user cannot see while the panel is shut.
  assert.ok(narrow, 'no narrow @media block scopes rules to .regal-filter');
  const rules = rulesOf(narrow[1]);
  assert.match(bodyOf('.regal-filter .tag-mode', rules) || '', /display:\s*none/);
  assert.match(bodyOf('.regal-filter.is-open .tag-mode:not([hidden])', rules) || '',
    /display:\s*flex/);
});

test('the open-panel rule must not beat the hidden attribute (#726)', () => {
  // `.tag-mode` is `display: flex`, so `.tag-mode[hidden]` (0,2,0) is what hides
  // it on a round with fewer than two included tags. A reveal written as
  // `.regal-filter.is-open .tag-mode` is (0,3,0) and would win — showing an
  // empty two-option control over a filter it cannot apply to. The `:not()` is
  // what stops the two competing at all, so its ABSENCE is the failure to catch.
  assert.ok(narrow, 'no narrow @media block scopes rules to .regal-filter');
  const offenders = rulesOf(narrow[1]).filter(([sel, body]) =>
    sel === '.regal-filter.is-open .tag-mode' && /display:/.test(body));
  assert.deepEqual(offenders, [],
    'the reveal must be guarded with :not([hidden]) rather than unconditional');
  // And the guard it is protecting has to exist in the first place.
  assert.match(bodyOf('.tag-mode[hidden]') || '', /display:\s*none/);
});

test('the mode control collapse is scoped to the Regal, not the shared class', () => {
  // The session setup screen carries the same `.tag-mode`, shown inline whenever
  // two tags are included. A bare `.tag-mode { display: none }` on narrow would
  // make the mode unreachable on every phone there — the `.filter-chips` trap
  // again, one control further on.
  assert.ok(narrow, 'no narrow @media block scopes rules to .regal-filter');
  const offenders = rulesOf(narrow[1]).filter(([sel, body]) =>
    sel === '.tag-mode' && /display:\s*none/.test(body));
  assert.deepEqual(offenders, [], 'the narrow block hides the bare .tag-mode class');
});

test('from 860px up the toggle is gone and the inline chips are unchanged', () => {
  assert.ok(wide, 'no wide @media block scopes rules to .regal-filter');
  const rules = rulesOf(wide[1]);
  assert.match(bodyOf('.regal-filter .filter-toggle', rules) || '', /display:\s*none/);
  // The chips are NOT re-hidden here — they inherit the base `.filter-chips`
  // display:flex, so the wide Regal looks exactly as before this change.
  assert.equal(bodyOf('.regal-filter .filter-chips', rules), null,
    'the wide block must not restyle the Regal chips');
});

test('the badge honours the hidden attribute (explicit display would override it)', () => {
  // `.filter-toggle__badge { display: inline-flex }` beats the UA sheet's
  // `[hidden] { display: none }`, so without this guard the no-active-filters
  // badge renders its literal "0" — the same trap `.icon-picker[hidden]` fixes.
  const guard = bodyOf('.filter-toggle__badge[hidden]');
  assert.ok(guard, '.filter-toggle__badge[hidden] rule not found');
  assert.match(guard, /display:\s*none/);
});

test('the collapse never hides the shared .filter-chips class globally', () => {
  // A blanket `.filter-chips { display: none }` on narrow would also blank the
  // game-detail / add-game / session tag pickers — the reason the collapse is
  // scoped to `.regal-filter`. This is the exact silent break to guard against.
  assert.ok(narrow, 'no narrow @media block scopes rules to .regal-filter');
  const offenders = rulesOf(narrow[1]).filter(([sel, body]) =>
    sel === '.filter-chips' && /display:\s*none/.test(body));
  assert.deepEqual(offenders, [], 'the narrow block hides the bare .filter-chips class');
});

test('the narrow and wide blocks tile the width axis with no gap (859/860)', () => {
  assert.ok(narrow && wide, 'both Regal-filter media blocks must exist');
  const max = Number(narrow[0].match(/max-width:\s*(\d+)px/)[1]);
  const min = Number(wide[0].match(/min-width:\s*(\d+)px/)[1]);
  assert.equal(max, 859);
  assert.equal(min, max + 1, 'the phone/desktop filter blocks must be adjacent');
});
