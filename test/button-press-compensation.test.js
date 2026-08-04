'use strict';

/* #615 — the chunky-button press effect shrinks the bottom border and adds a
   compensating bottom margin so nothing below the button moves. That margin was
   an ABSOLUTE value, and `.btn:active` (0,2,0) outranks any component rule
   (0,1,0), so a button declaring its own bottom margin had it REPLACED on press
   rather than added to: `.hub-cta`'s 18px became 2.5px and the whole Start tab
   below the CTA jumped up ~15.5px for the duration of the press.

   The compensation is additive now, through `--btn-mb`. This pins the
   arithmetic — pressed margin === resting margin + the border shrink — so a
   future retune of the press effect cannot silently reintroduce the clobber.
   CSS-text test; see `.claude/rules/css-text-assertions-strip-comments.md`. */

const test = require('node:test');
const assert = require('node:assert');

const { RULES, bodyOf } = require('./support/css');

const MB = '--btn-mb';

// A single declaration's value out of a rule body, e.g. decl(body, 'margin-bottom').
const decl = (body, prop) => {
  if (!body) return null;
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

const px = (value) => {
  const m = value && value.match(/^(-?[\d.]+)px$/);
  return m ? Number(m[1]) : null;
};

/* The bottom value of a `margin` shorthand: 1 value -> all, 2 -> [v,h],
   3 -> [t,h,b], 4 -> [t,r,b,l]. */
function shorthandBottom(value) {
  if (!value) return null;
  const parts = value.split(/\s+/);
  if (parts.length === 1) return px(parts[0]);
  if (parts.length === 2) return px(parts[0]);
  return px(parts[2]);
}

/* Every button variant that declares its own `:active` margin, with where its
   resting and pressed bottom border widths come from. A variant that declares
   neither inherits `.btn:active` wholesale, so its arithmetic is the base one. */
const VARIANTS = [
  { rest: '.btn', active: '.btn:active' },
  { rest: '.btn--ghost', active: '.btn--ghost:active' },
  { rest: '.btn--sm', active: '.btn--sm:active' },
];

const borderOf = (selector, fallback) => {
  const own = decl(bodyOf(selector), 'border-bottom-width');
  return own ? px(own) : fallback;
};

test('.btn declares the --btn-mb default, so an unstyled button compensates from 0', () => {
  const value = decl(bodyOf('.btn'), MB);
  assert.ok(value, `.btn must declare ${MB}`);
  assert.strictEqual(px(value), 0, `${MB} must default to 0px`);
});

test('every :active margin compensates the border shrink ADDITIVELY, never absolutely', () => {
  const baseRest = px(decl(bodyOf('.btn'), 'border-bottom-width'));
  const basePressed = px(decl(bodyOf('.btn:active'), 'border-bottom-width'));
  assert.ok(baseRest > basePressed, 'the base press must shrink the bottom border');

  for (const { rest, active } of VARIANTS) {
    const shrink = borderOf(rest, baseRest) - borderOf(active, basePressed);
    const got = decl(bodyOf(active), 'margin-bottom');
    assert.ok(got, `${active} must declare margin-bottom`);

    /* A variant whose border does not shrink compensates by nothing — but it
       must still restate the resting margin, or it clobbers it back to zero.
       Writing a bare `0` there is the original bug, one variant over. */
    const want = shrink === 0
      ? `var(${MB})`
      : `calc(var(${MB}) + ${shrink}px)`;
    assert.strictEqual(got, want,
      `${active}: pressed margin must be the resting margin plus the ${shrink}px border shrink`);
  }
});

test('no button :active rule sets an absolute bottom margin', () => {
  /* The generalized form of the bug: any absolute value here replaces whatever
     bottom margin the component declared. Catches a fourth variant added later
     without reading the two tests above. */
  for (const [selector, body] of RULES) {
    if (!/^\.btn[\w-]*(:active|\.[\w-]+:active)$/.test(selector)) continue;
    const value = decl(body, 'margin-bottom');
    if (value === null) continue;
    assert.match(value, new RegExp(`var\\(${MB}\\)`),
      `${selector} sets margin-bottom: ${value} — it must be relative to var(${MB})`);
  }
});

test('.hub-cta: its --btn-mb equals the resting bottom margin it must preserve', () => {
  /* The two numbers live in two declarations and have to agree; if they drift,
     the press either still jumps (too small) or pushes down (too large). */
  const resting = shorthandBottom(decl(bodyOf('.hub-cta'), 'margin'));
  assert.ok(resting > 0,
    '.hub-cta must declare a resting bottom margin — without one this whole spec is vacuous');

  /* Compounded on purpose: `.btn` also declares --btn-mb and is declared LATER
     in the sheet, so a bare `.hub-cta` would tie at (0,1,0) and lose on source
     order, silently resetting the CTA's compensation to 0.
     See `.claude/rules/ds-row-is-a-click-target.md` for the same shape. */
  const override = decl(bodyOf('.btn.hub-cta'), MB);
  assert.ok(override, `.btn.hub-cta must declare ${MB} (compounded, to outrank .btn)`);
  assert.strictEqual(px(override), resting,
    `.hub-cta's ${MB} must equal its resting bottom margin`);
});
