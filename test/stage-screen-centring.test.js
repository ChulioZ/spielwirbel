'use strict';

/* The session flow's stage screens compose against the viewport (#870).

   The hand-off card, the vote card and the finale replace the whole page — each
   `show*` in views-session.js appends exactly one block to `.app`, with no rail,
   no dock and no siblings. At desktop they were pinned to the top of that space:
   measured at 1440x1100 the finale was 509px tall starting at y=153, leaving a
   326px band of bare page above the footer, so the app's one deliberately
   theatrical screen read as a small dark rectangle stuck to the top of a big
   light page.

   Route 1 is not available for a CSS text assertion — the stylesheet already
   exists — so every assertion below was verified by breaking styles.css on
   purpose and watching THIS file's named test go red
   (.claude/rules/break-the-code-on-purpose.md). What each break proves is
   recorded next to the assertion it defends.

   Parsing traps (stripped comments, whole-class matching) live in
   test/support/css.js — see .claude/rules/css-text-assertions-strip-comments.md. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mediaBlocks, rulesOf } = require('./support/css');

/* Every rule declared under a `min-width: <px>` query, as [px, selector, body].
   The width matters as much as the rule: the whole point is that the phone
   presentation is untouched, and a query flipped to `max-width` — or to a
   min-width small enough to catch a phone — is the one edit that would change
   it while leaving every "the rule exists" assertion green. */
const minWidthRules = () => mediaBlocks()
  .map(([query, css]) => [query.match(/min-width:\s*(\d+)px/), css])
  .filter(([m]) => m)
  .flatMap(([m, css]) => rulesOf(css).map(([sel, body]) => [Number(m[1]), sel, body]));

// The classes named in a selector group, one per comma-separated part.
const screensIn = (selector) => selector
  .split(',')
  .map((part) => {
    const last = (part.trim().split(/[\s>]+/).pop() || '').replace(/\)$/, '');
    return (last.match(/\.[\w-]+/) || [null])[0];
  })
  .filter(Boolean)
  .sort();

// The centring rule, looked up by shape rather than by exact selector text so
// that adding a fourth stage screen to it does not read as its deletion.
const centringRule = () => {
  const hits = minWidthRules().filter(([, sel, body]) =>
    /^\.app:has\(/.test(sel.trim()) && /justify-content:/.test(body));
  assert.equal(hits.length, 1,
    `expected exactly one .app centring rule, found ${hits.length}`);
  return hits[0];
};

// Its companion, which stops the same screens shrink-to-fitting as flex items.
const widthRule = () => {
  const hits = minWidthRules().filter(([, sel, body]) =>
    /^\.app\s*>/.test(sel.trim()) && /width:\s*100%/.test(body));
  assert.equal(hits.length, 1,
    `expected exactly one .app > * width rule, found ${hits.length}`);
  return hits[0];
};

test('the stage screens centre in the space between the chrome and the footer', () => {
  /* Breaking `justify-content: safe center` out of the rule, or deleting the
     whole media block, reddens this test by name — which is what makes it
     evidence rather than decoration. */
  const [bp, , body] = centringRule();

  // `.app` is a block by default, so a centring context has to be established
  // before `justify-content` means anything at all. Dropping either of these two
  // declarations leaves a rule that reads correct and centres nothing.
  assert.match(body, /display:\s*flex/,
    '.app is not made a flex container, so justify-content is inert');
  assert.match(body, /flex-direction:\s*column/,
    'without a column direction this centres on the horizontal axis instead');

  /* `safe`, not a bare `center`. Free space inside `.app` cannot go negative
     while it stays `flex-shrink: 0`, so this is insurance rather than a live
     branch — but the failure it insures against is unrecoverable rather than
     ugly: a stage taller than the space would be centred into overflow ABOVE
     the scroll origin, i.e. its top would be unreachable. */
  assert.match(body, /justify-content:\s*safe\s+center/,
    'a bare `center` can push a tall stage into unreachable overflow');

  /* The phone presentation must be untouched. 860px is the breakpoint
     .vote--split already uses to go landscape; the floor here is deliberately
     looser than that so retuning the breakpoint is allowed and dropping it to
     phone width is not. */
  assert.ok(bp >= 768,
    `the centring applies from ${bp}px, which reaches phones — the phone screens are already full-height`);
});

test('every centred stage screen keeps its full column width', () => {
  /* The trap this defends, which is silent in the direction that matters: each
     of the three sizes itself with `max-width` plus `margin-inline: auto`, and a
     flex item with auto inline margins is NOT stretched — it shrink-to-fits. So
     the moment the centring rule lands without this companion, all three cards
     quietly narrow to their content width. `.app` documents the same trap and
     the same remedy on itself.

     Asserted as PARITY rather than as "the rule mentions .stage": a fourth stage
     screen added to one list and not the other is exactly the edit that would
     ship the narrowing, and only comparing the two lists notices it. */
  const [centreBp, centreSel] = centringRule();
  const [widthBp, widthSel] = widthRule();

  const centred = screensIn(centreSel.replace(/^\.app:has\(/, '').replace(/\)$/, ''));
  const sized = screensIn(widthSel);

  assert.ok(centred.length >= 3,
    `only ${centred.length} screen(s) are centred; the flow has three (hand-off, vote, finale)`);
  assert.deepEqual(sized, centred,
    'these lists disagree, so a centred stage screen shrinks to its content width');
  assert.equal(widthBp, centreBp,
    `the width fix applies from ${widthBp}px but the centring from ${centreBp}px, so there is a range that narrows`);
});
