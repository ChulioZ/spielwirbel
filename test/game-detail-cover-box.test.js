'use strict';

/* The game detail screen's cover (#1041): it stands as a box with a hard depth
 * edge that grows on hover, and nothing on it rotates.
 *
 * Slice C2 of the 2026-09-12 Spielepass deep-dive. The first proposal carried its
 * playfulness in a TILT on the stamps and the cover; the operator rejected that
 * outright, which makes "no rotation" an acceptance criterion rather than an
 * aesthetic preference — and it has no symptom in the DOM, so it is pinned here.
 * `session-stamps.test.js` guards the stamp half.
 *
 * This file was `game-detail-press.test.js` until #1122 removed the entry
 * animation that gave it that name; the press is now asserted as an ABSENCE, in
 * `test/result-motion.test.js`, because the keyframe was shared with the result
 * screen. What is left here is the cover, which the press never touched.
 *
 * Everything is a CSS-TEXT assertion: the pane omits an animating layer from
 * screenshots (`.claude/rules/preview-pane-paint-artifacts.md`) and jsdom applies
 * no external stylesheet at all. The parsing traps are in `test/support/css.js`
 * (`.claude/rules/css-text-assertions-strip-comments.md`).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RULES, rulesOf, bodyOf, mediaBlocks } = require('./support/css');

/* The cover's depth edge. Two separate things are pinned: that it exists at all
 * above the stack breakpoint, and that its colour is DERIVED. A hard shadow is
 * the natural place to write a literal warm grey (the issue proposed one), and
 * on the seven dark designs a 16%-black edge against a dark surface is simply
 * invisible — the rule reads as working and paints nothing anyone can see
 * (`.claude/rules/theme-derived-colors.md`). */
test('the cover stands on a theme-derived hard edge, and lifts on hover', () => {
  const wide = mediaBlocks().filter(([q]) => /min-width:\s*701px/.test(q)).map(([, css]) => css);
  assert.equal(wide.length, 1, 'one block owns the box treatment');
  const rules = rulesOf(wide[0]);
  const img = bodyOf('.gd-img', rules);
  assert.ok(img, 'the cover takes no depth edge above the stack breakpoint');
  assert.match(img, /box-shadow:[^;]*\b0\s+var\(--gd-edge-ink\)/, 'the edge is a hard, unblurred layer');
  assert.match(img, /--gd-edge-ink:\s*color-mix\([^;]*var\(--shade\)/,
    'a literal grey is invisible on the seven dark designs');

  const hover = bodyOf('.gd-cover:hover :is(.gd-img, .gd-score)', rules);
  assert.ok(hover, 'the pill must travel with the cover it is pinned to, or it drifts off the corner');
  assert.match(hover, /transform:\s*translate\(/, 'the box lifts');
  assert.match(img, /transition:[^;]*transform/, 'and it is a transition, not a jump');
});

/* Below the stack breakpoint the cover is the full column width with nothing to
 * stand off, so the edge would read as a stray line down the page rather than as
 * a box. 701, not 700: it has to tile with the `max-width: 700px` block that
 * stacks the card, or at exactly 700px both apply. */
test('none of the box treatment reaches the stacked layout', () => {
  const box = RULES.filter(([sel, body]) =>
    /\.gd-(img|cover|score)\b/.test(sel) && /--gd-edge-ink|transform:\s*translate/.test(body));
  assert.ok(box.length >= 3, `expected the edge, the hover lift and the hover edge, got ${box.length}`);
  for (const [sel] of box) {
    const owner = mediaBlocks().find(([, css]) => rulesOf(css).some(([s]) => s === sel));
    assert.ok(owner && /min-width:\s*701px/.test(owner[0]),
      `${sel} is not gated to the unstacked layout`);
  }
});

/* The operator rejected tilt outright (2026-09-12). `session-stamps.test.js`
 * guards the stamps; the cover and its pill are the other two things the
 * rejected proposal rotated, and a rotation on either has no DOM symptom. */
test('nothing on the cover or its pill rotates', () => {
  const rotated = RULES
    .filter(([sel, body]) => /\.(gd-img|gd-cover|gd-score|score-pill--lg)\b/.test(sel) && /\brotate[\s(]/.test(body))
    .map(([sel]) => sel);
  assert.deepEqual(rotated, [], 'tilt was rejected for this screen');
});
