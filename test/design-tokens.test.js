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
const fs = require('node:fs');
const path = require('node:path');
const { CSS, RULES, bodyOf, ROOT: SUPPORT_ROOT } = require('./support/css');

const ROOT = bodyOf(':root');
const decls = (prop) => [...CSS.matchAll(new RegExp(`${prop}:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim());

const TEXT_STEPS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'];

test('the :root block declares the full token scale', () => {
  for (const name of [
    '--shadow-1', '--shadow-2', '--shadow-3',
    '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-pill',
    '--dur-fast', '--dur-base', '--dur-slow', '--ease-out',
    ...TEXT_STEPS.map((s) => `--text-${s}`),
  ]) {
    assert.match(ROOT, new RegExp(`${name}\\s*:`), `${name} is missing from :root`);
  }
});

/* ---- Type scale (#470) ----
   22 hardcoded sizes, every integer from 10 to 22, with 14/15/16/17px alone
   carrying 109 declarations — four body sizes no reader can tell apart. */

const textPx = (step) => {
  const m = ROOT.match(new RegExp(`--text-${step}:\\s*(\\d+)px`));
  assert.ok(m, `--text-${step} should be declared in px`);
  return Number(m[1]);
};

test('the type scale ascends', () => {
  const px = TEXT_STEPS.map(textPx);
  for (let i = 1; i < px.length; i++) {
    assert.ok(px[i] > px[i - 1], `--text-${TEXT_STEPS[i]} (${px[i]}) must exceed --text-${TEXT_STEPS[i - 1]} (${px[i - 1]})`);
  }
});

/* U-R04: body and UI text may never get SMALLER. The four steps at or below
   18px are where all the reading text lives, so each carries a floor — a
   future retune may open the scale out, never tighten it downward. Above 18px
   there is deliberately no floor: display type may round down. */
test('the four reading steps never fall below the accessibility floor', () => {
  for (const [step, floor] of [['xs', 12], ['sm', 14], ['md', 16], ['lg', 18]]) {
    assert.ok(
      textPx(step) >= floor,
      `--text-${step} is ${textPx(step)}px — below the ${floor}px floor. Shrinking body text is ` +
      'the commonest way a redesign regresses accessibility (U-R04).',
    );
  }
});

/* The survivors, each marked `glyph, not type` in the stylesheet: a font-size
   that sizes a GLYPH inside a fixed box (avatar initials, a cover placeholder,
   the finale seal) is a fraction of that box, not a hierarchy level. Putting
   one on the scale would resize it inside an unchanged box the next time a
   step is retuned. The list is exhaustive on purpose — any OTHER bare px fails
   the assertion below, so a new literal cannot slip in beside them. */
const GLYPH_LITERALS = [
  // avatar initials, sized to the circle
  '.avatar', '.avatar--add', '.avatar-stack__more', '.recap-fav__who .avatar', '.result-people__person .avatar',
  '.stage__voter-avatar .avatar', '.nr-seat__avatar', '.nr-seat--empty .nr-seat__avatar',
'.podium__col--multi .podium__avatar', 
    '.podium__avatar', '.profile-head .avatar', '.member-avatar', '.handover__avatar',
  // placeholder glyphs centred in a cover / thumb / tile box
  '.ticket__img', '.session-card__img', '.round-card__emblem', '.lobby-cta__icon',
  '.landing-card__icon', '.landing-step__num', '.feed-item__img', '.result-row__img',
  '.pool-thumb', '.pool-thumb .ti', '.pool-tile__img', '.game-card__img', '.vote__img',
  '.gd-img', '.lookup__thumb--none .ti', '.archive-row__img .ti', '.rec-card__img .ti',
  '.result-podium__img .ti',
  '.recap-fav__cover .ti',
  // a glyph or number sized to its own small box
  '.result-row__bars .bar', '.result-row__bars .bar--retire .ti',
  '.stage__voter-check .ti', '.stage__seal > .ti', '.mood .ti',
  '.fchip__x',
  '.game-card__pick',
  // large standalone marks
  '.auth__logo', '.paste-zone__icon',
];

const fontSizes = RULES.flatMap(([sel, body]) =>
  [...body.matchAll(/font-size:\s*([^;]+)/g)].map((m) => [sel, m[1].trim()]));

test('every font-size draws from the type scale, except the named glyph literals', () => {
  const exempt = new Set(GLYPH_LITERALS);
  const offenders = fontSizes
    // `inherit` and the one `em` are relative by design, not a size choice.
    .filter(([, v]) => !v.includes('var(--text-') && v !== 'inherit' && !/^[\d.]+em$/.test(v))
    .filter(([sel]) => !exempt.has(sel))
    .map(([sel, v]) => `${sel} { font-size: ${v} }`);

  assert.deepEqual(offenders, [], `bare font-size (use a --text-* token): ${offenders.join(' | ')}`);
});

/* The anti-vacuous half: an exemption list nobody re-checks rots into names
   that no longer exist, and every stale entry silently widens the assertion
   above. Each must still be a real rule carrying a real bare px. */
test('no glyph exemption is stale', () => {
  const literal = new Set(fontSizes.filter(([, v]) => /^\d+px$/.test(v)).map(([sel]) => sel));
  const stale = GLYPH_LITERALS.filter((sel) => !literal.has(sel));

  assert.deepEqual(stale, [], `exempted but no longer a bare-px rule — delete these: ${stale.join(', ')}`);
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

/* One ring recipe per meaning (2026-08-07 audit): "currently selected on a
   picker" drifted to 2px on `.cover-pick.is-current` while the member swatch,
   avatar hover and focus rings all say 3px of --brand-edge. The inset chosen-row
   ring (`.result-row.is-chosen`) is a different treatment on purpose and stays
   out of scope — the filter keys on non-inset --brand-edge rings only. */
test('every --brand-edge ring is 3px', () => {
  const rings = decls('box-shadow')
    .filter((v) => RING.test(v) && v.includes('--brand-edge') && !v.includes('inset'));
  assert.ok(rings.length >= 3, `expected the ring family, found only ${rings.length}`);
  const offenders = rings.filter((v) => !v.startsWith('0 0 0 3px'));
  assert.deepEqual(offenders, [], `a selection ring drifted off 3px: ${offenders.join(' | ')}`);
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

/* Every derivation interpolates in oklab (#544). The count of srgb mixes had
   grown 31 -> 37 -> 39 between the audit finding and the fix, purely because
   nothing stopped a new tone being minted in the old space — so the migration
   is worth little without something that keeps it migrated. */
test('every color-mix() derives in oklab, across all four surfaces', () => {
  /* An ALLOWLIST, not a ban on the string "srgb". A denylist passes for
     `in oklch`, `in hsl`, `in lab` and a malformed `color-mix(var(--a), …)`
     alike — the same enumeration hole `.claude/rules/ci-aggregate-gate.md`
     records, where a guard could only see the bad states someone had thought
     of. Asserting what each mix MUST say has no such gap.

     oklab and not oklch, deliberately: every mix in this app has at least one
     achromatic or near-achromatic endpoint (#000, #fff, --surface, --page-bg,
     --ink, transparent, the stage's #201a15 / #f7f2e9), so none of them travels
     between two distinct hues. A neutral endpoint has no meaningful hue for
     oklch to interpolate toward, and forcing one would hold chroma up through a
     mix whose whole purpose is to drop it — which is how you get a "tinted"
     grey that is actually saturated. If a genuinely bi-chromatic mix is ever
     added, that is the moment to revisit this, not before. */
  const SURFACES = ['public/styles.css', 'public/kontakt.html', 'public/login.html', 'lib/faq.js'];
  const offenders = [];
  let total = 0;
  for (const rel of SURFACES) {
    // Comments are stripped because this file's own :root comment discusses the
    // sRGB it replaced — .claude/rules/css-text-assertions-strip-comments.md.
    const src = fs.readFileSync(path.join(SUPPORT_ROOT, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const mixes = [...src.matchAll(/color-mix\(\s*([^,]*),/g)];
    // Anti-vacuous: a surface that stopped declaring any mix would otherwise
    // satisfy this test by having nothing to check, per surface and never over
    // the union (the floor `standalone-page-brand.test.js` gets right).
    assert.ok(mixes.length > 0, `${rel} declares no color-mix() at all — has it moved?`);
    total += mixes.length;
    for (const m of mixes) {
      if (m[1].trim() !== 'in oklab') offenders.push(`${rel}: color-mix(${m[1].trim()}, …)`);
    }
  }
  assert.deepEqual(offenders, [], 'these mixes do not interpolate in oklab');
  assert.ok(total >= 45, `expected the full set of derivations, found only ${total}`);
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
