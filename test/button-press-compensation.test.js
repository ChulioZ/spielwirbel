'use strict';

/* #615 — the chunky-button press effect shrinks the bottom border and adds a
   compensating bottom margin so nothing below the button moves. That margin was
   an ABSOLUTE value, and `.btn:active` (0,2,0) outranks any component rule
   (0,1,0), so a button declaring its own bottom margin had it REPLACED on press
   rather than added to: `.hub-cta`'s 18px became 2.5px and the whole Start tab
   below the CTA jumped up ~15.5px for the duration of the press.

   The compensation is additive now, through `--press-mb`. This pins the
   arithmetic — pressed margin === resting margin + the border shrink — so a
   future retune of the press effect cannot silently reintroduce the clobber.
   CSS-text test; see `.claude/rules/css-text-assertions-strip-comments.md`. */

const test = require('node:test');
const assert = require('node:assert');

const { RULES, bodyOf } = require('./support/css');

const MB = '--press-mb';

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

/* The two independent pressable families. `.handover__go` is deliberately not a
   `.btn` (white on the dark handover stage, its own radius and border) but
   copies the same border-shrink mechanic, so it is subject to the same bug. */
const PRESSABLE_ROOTS = ['.btn', '.handover__go'];

// Matches a `:active` rule belonging to either family, incl. compounds.
const ACTIVE_RULE = /^\.(?:btn[\w-]*|handover__go)(?::active|\.[\w-]+:active)$/;

/* Every pressable that declares its own `:active` margin, with where its resting
   and pressed bottom border widths come from. A `.btn` variant that declares
   neither inherits `.btn:active` wholesale, so its arithmetic is the base one. */
const VARIANTS = [
  { rest: '.btn', active: '.btn:active' },
  { rest: '.btn--ghost', active: '.btn--ghost:active' },
  { rest: '.btn--sm', active: '.btn--sm:active' },
  { rest: '.handover__go', active: '.handover__go:active' },
];

const borderOf = (selector, fallback) => {
  const body = bodyOf(selector);
  const own = decl(body, 'border-bottom-width');
  if (own) return px(own);
  /* `.handover__go` spells its resting width as the `border-bottom: 4px solid …`
     shorthand. Without this branch it would silently fall back to `.btn`'s 4px —
     the same number today, so the assertion would look derived while actually
     being a coincidence, and would stop tracking the moment either changes. */
  const shorthand = decl(body, 'border-bottom');
  const width = shorthand && shorthand.match(/(-?[\d.]+)px/);
  return width ? Number(width[1]) : fallback;
};

test('every pressable declares its own --press-mb default', () => {
  /* Custom properties INHERIT, so a component outside the `.btn` tree has no
     value to read. `calc(var(--press-mb) + 2.5px)` would then be invalid at
     computed-value time and margin-bottom would fall back to 0 — silently
     REMOVING the compensation rather than making it additive. */
  for (const selector of PRESSABLE_ROOTS) {
    const value = decl(bodyOf(selector), MB);
    assert.ok(value, `${selector} must declare its own ${MB} default`);
    assert.strictEqual(px(value), 0, `${selector}'s ${MB} must default to 0px`);
  }
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

test('no pressable :active rule sets an absolute bottom margin', () => {
  /* The generalized form of the bug: any absolute value here replaces whatever
     bottom margin the component declared. Catches a new variant added later
     without reading the two tests above — in either family. */
  let checked = 0;
  for (const [selector, body] of RULES) {
    if (!ACTIVE_RULE.test(selector)) continue;
    const value = decl(body, 'margin-bottom');
    if (value === null) continue;
    checked += 1;
    assert.match(value, new RegExp(`var\\(${MB}\\)`),
      `${selector} sets margin-bottom: ${value} — it must be relative to var(${MB})`);
  }
  /* Anti-vacuous: a regex that stopped matching anything would pass this loop
     silently, which is exactly how a guard like this rots. */
  assert.ok(checked >= VARIANTS.length,
    `only ${checked} :active margin rules matched, expected at least ${VARIANTS.length}`);
});

test('no button component declares what .btn also declares — such a rule is dead', () => {
  /* The general form of the second half of #615. A component rule on a `.btn`
     element is (0,1,0) and so is `.btn`, which is declared LAST of the three, so
     every property named in both resolves to `.btn`'s value.

     Both CTAs had this. `.hub-cta`'s font-size/padding/border-radius sat dead
     from the day it was built — it rendered at ordinary button size while its
     own rule asked for a larger one — and `.rail__cta` carried a
     `var(--text-md)`/`12px 16px` that had never once applied. They were resolved
     in opposite directions (the phone CTA's moved into `.btn.hub-cta` and now
     apply; the rail's were deleted, so `.btn`'s values are the decision), and
     this asserts the invariant both answers satisfy: nothing dead is left behind.

     Anything that must beat `.btn` goes in a COMPOUNDED rule. Note the list is
     the selectors, not the properties — a fourth property added to either block
     tomorrow is caught without editing this test. */
  const props = (selector) => new Set(
    [...bodyOf(selector).matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map((m) => m[1]),
  );
  const btn = props('.btn');
  for (const selector of ['.hub-cta', '.rail__cta']) {
    const body = bodyOf(selector);
    assert.ok(body, `${selector} must exist for this assertion to mean anything`);
    const dead = [...props(selector)].filter((p) => btn.has(p));
    assert.deepStrictEqual(dead, [],
      `${selector} declares ${dead.join(', ')}, which .btn also declares and wins — `
      + `move to a compounded .btn${selector} rule, or delete it`);
  }
});

test('.hub-cta keeps display at (0,1,0), so the desktop rail hide still outranks it', () => {
  /* `.app .rail-owned { display: none }` (0,2,0) is what removes this button
     from the desktop layout, and it is declared ~200 lines ABOVE. Promoting the
     rule that sets the CTA's `display` to (0,2,0) makes that a tie decided by
     source order — which this one wins — so the phone CTA renders on desktop
     beside the rail's own. Nothing errors; there are simply two CTAs.
     See `.claude/rules/responsive-content-width.md`. */
  assert.match(bodyOf('.hub-cta'), /(?:^|;)\s*display\s*:/,
    '.hub-cta must be the rule that sets display, at a bare (0,1,0)');
  assert.strictEqual(bodyOf('.btn.hub-cta') && /(?:^|;)\s*display\s*:/.test(bodyOf('.btn.hub-cta')), false,
    '.btn.hub-cta must NOT set display — (0,2,0) would beat the .app .rail-owned hide on source order');
});

test('.hub-cta: its --press-mb equals the resting bottom margin it must preserve', () => {
  /* The two numbers live in two declarations and have to agree; if they drift,
     the press either still jumps (too small) or pushes down (too large). */
  const resting = shorthandBottom(decl(bodyOf('.hub-cta'), 'margin'));
  assert.ok(resting > 0,
    '.hub-cta must declare a resting bottom margin — without one this whole spec is vacuous');

  /* Compounded on purpose: `.btn` also declares --press-mb and is declared LATER
     in the sheet, so a bare `.hub-cta` would tie at (0,1,0) and lose on source
     order, silently resetting the CTA's compensation to 0.
     See `.claude/rules/ds-row-is-a-click-target.md` for the same shape. */
  const override = decl(bodyOf('.btn.hub-cta'), MB);
  assert.ok(override, `.btn.hub-cta must declare ${MB} (compounded, to outrank .btn)`);
  assert.strictEqual(px(override), resting,
    `.hub-cta's ${MB} must equal its resting bottom margin`);
});
