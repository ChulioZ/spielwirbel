'use strict';

/* The toast's shape and width (#858).

   A toast whose message wraps to more than one line rendered as a huge black
   ellipse covering the card underneath, because `border-radius` was
   `var(--radius-pill)` (999px). A radius that large is only a PILL while the box
   is one line tall — past that the four corner arcs meet and the shape
   degenerates. On a phone almost any interpolated game title reaches the wrap,
   so this was the normal case there, not an edge one.

   Two independent gaps compounded, and both are pinned below: the unconditional
   pill radius, and the box's width. Note the width half is NOT what #858's issue
   body described — it attributed the wrapping to shrink-to-fit "against the
   viewport ... edge-to-edge with no gutter", and prescribed a `max-width` alone.
   Measured, that cap changes nothing: `left: 50%` moves the box's start edge to
   the middle, so the available space is only the half-viewport to its right and
   shrink-to-fit clamps at 187.5px on a 375px screen, far below any cap. The
   explicit `width` is the half that does the work — see the assertion below and
   `.claude/rules/centred-fixed-overlay-needs-a-width.md`.

   The radius bound is DERIVED from the stylesheet's own type tokens rather than
   hardcoded, because that is the way it goes silently wrong: 26px is only "half
   a single-line box" as long as --text-lg is 18px at line-height 1.5. Retune the
   type scale and a hardcoded 26 would keep passing while the single-line toast
   quietly stopped being a pill.

   jsdom applies no external stylesheet and has no layout engine, so these are
   CSS-TEXT assertions (parsing traps live in test/support/css.js — see
   `.claude/rules/css-text-assertions-strip-comments.md`). Route 1 is unavailable
   for a CSS-text assertion; each test below was verified by reinstating the
   pre-fix declarations on purpose and watching the NAMED test go red
   (`.claude/rules/break-the-code-on-purpose.md`). The browser pass at 375px is
   the proof that the rendered shape is right, and it is recorded in the PR. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bodyOf, rootPx } = require('./support/css');

const TOAST = bodyOf('.toast');

/* The toast's border-box height at `lines` lines, in px, read from the tokens it
   actually inherits rather than assumed. */
function boxHeight(lines) {
  const body = bodyOf('body');
  assert.ok(body, 'expected a body rule');

  const size = body.match(/font-size:\s*var\(--text-(\w+)\)/);
  assert.ok(size, 'body should size its text from a --text-* token');
  const fontPx = rootPx(`--text-${size[1]}`);
  assert.ok(fontPx, `--text-${size[1]} is not declared in px`);

  const lh = body.match(/line-height:\s*([\d.]+)\s*;/);
  assert.ok(lh, 'body should declare a unitless line-height');

  const pad = TOAST.match(/padding:\s*(\d+)px/);
  assert.ok(pad, '.toast should declare its padding in px');

  return fontPx * Number(lh[1]) * lines + Number(pad[1]) * 2;
}

test('.toast exists and inherits the body type it is measured against', () => {
  assert.ok(TOAST, 'expected a .toast rule');
  // The derivation above is only valid while the toast takes body's type; a
  // font-size or line-height of its own would move the box under a radius that
  // no longer matches it.
  assert.doesNotMatch(TOAST, /font-size:/, '.toast now sets its own font-size — re-derive the radius bound');
  assert.doesNotMatch(TOAST, /line-height:/, '.toast now sets its own line-height — re-derive the radius bound');
});

test('.toast does not use the pill radius', () => {
  assert.doesNotMatch(
    TOAST, /border-radius:\s*var\(--radius-pill\)/,
    'a pill radius is wrong for a box that can be multi-line — it paints as an ellipse (#858)',
  );
});

test('a single-line toast is still a pill, and a wrapped one is not an ellipse', () => {
  const m = TOAST.match(/border-radius:\s*(\d+)px/);
  assert.ok(m, '.toast should declare a fixed px radius');
  const radius = Number(m[1]);

  const [one, two] = [boxHeight(1), boxHeight(2)];
  assert.ok(one > 0 && two > one, 'could not derive the toast box heights');

  // >= half the box: the browser clamps an over-large radius proportionally, so
  // one line renders exactly as the old pill did.
  assert.ok(
    radius >= one / 2,
    `border-radius ${radius}px is under half a single-line toast (${one}px tall) — a one-line ` +
    'toast would stop being a pill and the change would be visible on every toast',
  );

  // ... and strictly under half a TWO-line box, so the corner arcs cannot meet
  // as soon as the message wraps — which is the ellipse itself.
  assert.ok(
    radius < two / 2,
    `border-radius ${radius}px is at least half a two-line toast (${two}px tall) — the corners meet ` +
    'and it paints as an ellipse again (#858)',
  );
});

test('.toast is capped so it keeps a gutter at phone widths', () => {
  const m = TOAST.match(/max-width:\s*([^;]+);/);
  assert.ok(m, '.toast declares no max-width — it is shrink-to-fit and wraps at the screen edge (#858)');
  const value = m[1];

  /* The cap is INERT on its own. The toast is `position: fixed; left: 50%`, so
     its containing block offers only the half-viewport to the right of that
     offset and shrink-to-fit clamps there long before max-width applies —
     measured at 375px: 187.5px wide, six lines tall. An explicit width is what
     makes the box size against the cap instead. Deleting it looks like removing
     a redundant declaration and silently restores the six-line box. */
  assert.match(
    TOAST, /width:\s*max-content/,
    'without an explicit width the max-width above does nothing — the box clamps at half the viewport (#858)',
  );

  assert.match(value, /100vw\s*-\s*(\d+)px/, 'the cap must subtract a gutter from the viewport width');
  const gutter = Number(value.match(/100vw\s*-\s*(\d+)px/)[1]);
  assert.ok(gutter >= 16, `only ${gutter}px of total gutter — the toast sits against both screen edges`);

  // A fixed ceiling as well, or a single-line toast stretches absurdly wide on
  // a desktop viewport.
  assert.match(value, /min\(/, 'the cap should also hold a fixed maximum, not only a viewport term');
});

test('a wrapped toast reads as a centred block', () => {
  assert.match(
    TOAST, /text-align:\s*center/,
    'the toast is centred in the viewport, so ragged left-aligned lines read as misplaced',
  );
});
