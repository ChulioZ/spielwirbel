'use strict';

/* The design-system tokens in `public/styles.css` :root — elevation, radii,
   motion — and the rule that components draw from them rather than inventing
   their own values.
 *
 * This exists because the drift is invisible: every one-off shadow, stray radius
 * and hand-tuned duration renders perfectly on its own, and only the whole app
 * side by side looks unauthored. Nothing in CI noticed that the app had grown 8
 * shadow recipes, that `.hub-cta` carried a literal `18px` duplicating the
 * radius token, or that pills were spelled both `999px` and `99px`.
 *
 * Parsing goes through test/support/css.js — comments are stripped first, per
 * .claude/rules/css-text-assertions-strip-comments.md. Every assertion below was
 * verified by reinstating the pre-token CSS on purpose and watching it go red.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CSS, RULES, bodyOf } = require('./support/css');

const ROOT = bodyOf(':root');
const decls = (prop) => [...CSS.matchAll(new RegExp(`${prop}:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim());

test('the :root block declares the full token scale', () => {
  for (const name of [
    '--shadow-1', '--shadow-2', '--shadow-3',
    '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-pill',
    '--dur-fast', '--dur-base', '--dur-slow', '--ease-out',
  ]) {
    assert.match(ROOT, new RegExp(`${name}\\s*:`), `${name} is missing from :root`);
  }
});

/* Elevation is the one that regressed hardest, so it gets the strict form: a
   box-shadow is either a ramp token or one of the shapes that is NOT elevation.
   The exemptions are deliberate and narrow:
     - `0 0 0 <n>px` — a ring, not a shadow. The focus rings live here and must
       never be restyled for looks (accessibility floor, U-R04).
     - `inset …`     — .ticket--live's accent edge.
     - `none`        — a reset. */
const RING = /^0 0 0 \d+px/;
const isElevation = (v) => v !== 'none' && !v.includes('inset') && !RING.test(v);

test('every elevation box-shadow comes from the 3-step ramp', () => {
  const offenders = decls('box-shadow')
    .filter(isElevation)
    .filter((v) => !/^var\(--shadow-[123]\)$/.test(v));

  assert.deepEqual(offenders, [], `ad-hoc box-shadow values (use --shadow-1/2/3): ${offenders.join(' | ')}`);
});

test('the ramp is ordered — each step is softer and further than the last', () => {
  // The ambient (second) layer's blur is what reads as distance.
  const blur = (name) => {
    const m = ROOT.match(new RegExp(`${name}:[^;]*,\\s*0 \\d+px (\\d+)px`));
    assert.ok(m, `${name} should layer a key shadow over an ambient one`);
    return Number(m[1]);
  };
  const [b1, b2, b3] = ['--shadow-1', '--shadow-2', '--shadow-3'].map(blur);
  assert.ok(b1 < b2 && b2 < b3, `ramp must increase: ${b1} / ${b2} / ${b3}`);
});

/* The two radius defects this pass fixed, pinned so neither can come back.
   Note what is NOT asserted: 2/6/10/14/16/22px are still literals on purpose
   (each is a per-component call), so a blanket "no literal radius" rule would
   be a lie. These two are different — they are duplication, not choice. */
test('no literal radius duplicates a token value', () => {
  const tokenPx = [...ROOT.matchAll(/--radius-(?:sm|md|lg|xl):\s*(\d+)px/g)].map((m) => m[1]);
  assert.ok(tokenPx.length >= 4, 'expected the radius scale to be declared in px');

  for (const px of tokenPx) {
    const dup = new RegExp(`border-radius:\\s*${px}px\\s*;`);
    assert.ok(
      !dup.test(CSS),
      `border-radius: ${px}px is a literal copy of a --radius-* token — use the token, ` +
      'or retuning the scale will silently skip this rule',
    );
  }
});

test('pill radii use --radius-pill, not a bare 99px/999px', () => {
  const bare = decls('border-radius').filter((v) => /^9{2,3}px$/.test(v));
  assert.deepEqual(bare, [], 'a fully-round radius must be var(--radius-pill) — both 99px and 999px shipped before');
});

test('every transition duration comes from the motion scale', () => {
  const offenders = decls('transition').filter((v) => /\d+m?s/.test(v));
  assert.deepEqual(offenders, [], `hardcoded durations (use --dur-*): ${offenders.join(' | ')}`);
});

test('no transition animates `all`', () => {
  // `all` animates properties nobody chose — including ones a later edit adds.
  const offenders = decls('transition').filter((v) => /(^|,)\s*all\s/.test(v));
  assert.deepEqual(offenders, [], `transition: all names no property: ${offenders.join(' | ')}`);
});

/* U-001 / theme-derived-colors.md: a chip that is really "a tint of the page or
   the accent" must derive from the tokens, or it stays put while the round's
   theme changes around it. `.tag--players` was a fixed blue for exactly this
   reason, sitting next to the accent-derived `.tag--custom`.
   The semantics are intentionally exempt — see the rule. */
const THEME_EXEMPT = /--good|--warn|--danger|--gold|rank-medal/;

test('no .tag-- variant hardcodes a hex colour', () => {
  const offenders = RULES
    .filter(([sel]) => /\.tag--/.test(sel) && !THEME_EXEMPT.test(sel))
    .filter(([, body]) => /(?:background|color)\s*:\s*#[0-9a-fA-F]{3,8}/.test(body))
    .map(([sel]) => sel);

  assert.deepEqual(offenders, [], `theme-independent hex in a tag chip: ${offenders.join(', ')}`);
});

test('the sheet backdrop derives from --ink rather than repeating its value', () => {
  const body = bodyOf('.sheet-backdrop');
  assert.ok(body, 'expected a .sheet-backdrop rule');
  assert.match(
    body, /background:\s*color-mix\([^)]*var\(--ink\)/,
    'the backdrop must be a color-mix on --ink; a literal rgba() copy goes stale when --ink is retuned',
  );
});

/* Retired with the platform/duration/type tags in #242. They outlived the
   feature by four releases, carrying hardcoded hex the whole time. */
test('the tag variants retired in #242 stay deleted', () => {
  for (const dead of ['.tag--digital', '.tag--analog', '.tag--duration', '.tag--platform']) {
    assert.ok(
      !RULES.some(([sel]) => sel.split(',').some((s) => s.trim() === dead)),
      `${dead} is dead CSS — nothing in public/js references it`,
    );
  }
});
