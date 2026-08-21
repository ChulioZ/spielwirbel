'use strict';

/* The icon-only .link-btn's tap target (#817).
 *
 * `.link-btn` declares `padding: 0`, so a lone glyph inside one measures about
 * 16x22 CSS px — under WCAG 2.2 SC 2.5.8's 24x24 floor. The recommendation
 * card's dismiss button became icon-only, so the modifier that gives it real
 * bounds is now load-bearing and nothing else can see it: jsdom applies no
 * external stylesheet, so the DOM specs next door assert the class is present
 * and cannot assert it does anything.
 *
 * Comments are stripped before matching — a brace-free comment mentioning the
 * selector otherwise binds the regex to the next rule that opens, and the test
 * passes against a stylesheet the rule has been deleted from
 * (.claude/rules/css-text-assertions-strip-comments.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(selector) {
  const re = new RegExp(`(?:^|})\\s*${selector.replace(/[.\\-]/g, '\\$&')}\\s*{([^}]*)}`, 'm');
  const m = CSS.match(re);
  return m && m[1];
}

test('.link-btn--icon gives a lone glyph a target of its own (SC 2.5.8)', () => {
  const body = ruleBody('.link-btn--icon');
  assert.ok(body, 'expected a .link-btn--icon rule in public/styles.css');

  const padding = body.match(/padding:\s*(\d+)px/);
  assert.ok(padding, 'expected an explicit padding — .link-btn itself is padding:0');

  /* The floor, derived rather than hard-coded: the glyph's own box is the
     16x22 measured on the shipped card, and SC 2.5.8 wants 24x24. So the
     narrow axis needs (24 - 16) / 2 = 4px a side. 6px is what shipped, which
     leaves headroom without pushing the action row to a second line.

     Asserting the DERIVED number is what makes this discriminating: a test
     pinned to `padding: 6px` would go red on a harmless retune to 8px and
     green on a regression to 2px, which is exactly backwards. */
  const GLYPH_NARROW_PX = 16;
  const SC_2_5_8_FLOOR_PX = 24;
  const needed = (SC_2_5_8_FLOOR_PX - GLYPH_NARROW_PX) / 2;
  assert.ok(
    Number(padding[1]) >= needed,
    `padding ${padding[1]}px leaves the icon-only button under ${SC_2_5_8_FLOOR_PX}px; needs >= ${needed}px a side`,
  );
});

test('the dismiss button actually carries the modifier', () => {
  // Without this the rule above guards a class nobody applies — the vacuous
  // green that .claude/rules/break-the-code-on-purpose.md is about. The
  // rendered-DOM half is in test/recommend-view.test.js; this pins the source
  // so deleting the class fails here too, in the file that owns the CSS claim.
  const view = fs.readFileSync(path.join(ROOT, 'public/js/views-recommend.js'), 'utf8');
  assert.match(view, /data-act="dismiss"[^>]*link-btn--icon|link-btn--icon[^>]*data-act="dismiss"/);
});
