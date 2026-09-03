'use strict';

/* Contrast regressions are invisible: nothing throws, nothing renders wrong —
   the numbers just quietly drop below the WCAG AA bar again (#145). These tests
   pin the three colour sources the audit had to fix, so a future palette tweak
   fails here instead of shipping. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Comment-stripped, brace-matched parsing for the one assertion that has to find
// a rule inside a media query — `.claude/rules/css-text-assertions-strip-comments.md`.
const { rulesOf, bodyOf, mediaBlocks, whole } = require('./support/css');

const ROOT = path.join(__dirname, '..');
const CORE = fs.readFileSync(path.join(ROOT, 'public/js/core.js'), 'utf8');
const PALETTE = fs.readFileSync(path.join(ROOT, 'public/js/member-colors.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');

// --- WCAG 2.1 relative luminance + contrast ratio ---------------------------
const srgb = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const luminance = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// Mirrors the CSS hsl() the app emits, so the test measures what ships.
const hsl = (h, s, l) => {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
  );
};

const WHITE = [255, 255, 255];

// --- Oklab, because that is the space the stylesheet derives in (#544) -------
/* Every color-mix() in styles.css interpolates `in oklab`. This file's whole
   value is that its arithmetic is the arithmetic the BROWSER runs — so a mix
   simulated with a channel lerp would be measuring a colour the app no longer
   paints, and would keep reporting a comfortable pass over a real regression.
   Note this is only true of color-mix(); see `composite` below for the other
   thing that looks identical and must NOT move to oklab. */
const toLin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

const rgbToOklab = ([r, g, b]) => {
  const [lr, lg, lb] = [r, g, b].map((v) => toLin(v / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
};

const oklabToRgb = ([L, A, B]) => {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((v) => Math.round(Math.max(0, Math.min(1, toSrgb(v))) * 255));
};

/* What `color-mix(in oklab, a <pA>%, b)` computes. Takes a hex string or an rgb
   triple on either side, so a chained token (--stage-muted mixes a mix into a
   mix) reads as the chain it is rather than round-tripping through hex. */
const rgb = (c) => (Array.isArray(c) ? c : hex(c));
const mixOklab = (a, b, pA) => {
  const A = rgbToOklab(rgb(a));
  const B = rgbToOklab(rgb(b));
  return oklabToRgb(A.map((v, i) => v * pA + B[i] * (1 - pA)));
};

// The declared value of a plain-hex custom property in :root.
const rootHex = (name) => {
  const m = new RegExp(`\\${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(CSS);
  assert.ok(m, `${name} should be a plain hex in :root`);
  return m[1];
};

// Every theme a round can pick, read out of views-round-detail.js so a new theme
// is measured automatically instead of silently escaping these checks.
function themes() {
  const block = /const THEMES = \[([\s\S]*?)\];/.exec(
    fs.readFileSync(path.join(ROOT, 'public/js/views-round-detail.js'), 'utf8')
  );
  assert.ok(block, 'THEMES should be a literal array');
  const found = [...block[1].matchAll(/page:\s*'(#[0-9a-f]{6})',\s*accent:\s*'(#[0-9a-f]{6})'/gi)]
    .map((m) => ({ page: m[1], accent: m[2] }));
  assert.ok(found.length >= 8, 'expected every theme to declare a page and an accent');
  return found;
}
const THEMES = themes();
const PAGES = THEMES.map((th) => th.page);
// The darkest page is the worst case for coloured text drawn straight on it.
const DARKEST = PAGES.map(hex).sort((a, b) => luminance(a) - luminance(b))[0];

const AA_TEXT = 4.5; // normal-size text
const AA_LARGE = 3.0; // >=24px, or >=18.66px bold

// --- the rating scale (avgColor) -------------------------------------------

// Read the lightness straight out of core.js, so the test tracks the shipped
// value rather than a copy that could drift away from it.
function avgColorLightness() {
  const m = /hsl\(\$\{hue\},\s*(\d+)%,\s*(\d+)%\)/.exec(CORE);
  assert.ok(m, 'avgColor should emit an hsl() template with saturation and lightness');
  return { sat: Number(m[1]), light: Number(m[2]) };
}
const avgHue = (avg) => Math.max(0, Math.min(120, ((avg - 1) / 4) * 120));

test('every rating on the 1–5 scale clears AA as a fill under white text', () => {
  const { sat, light } = avgColorLightness();
  const failures = [];
  for (let avg = 1; avg <= 5.0001; avg += 0.1) {
    const rgb = hsl(avgHue(avg), sat, light);
    const ratio = contrast(rgb, WHITE);
    if (ratio < AA_TEXT) failures.push(`Ø${avg.toFixed(1)} = ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], `.score-pill is 14px white text on avgColor(); needs ${AA_TEXT}:1`);
});

test('every rating clears AA-large as ring text on each theme page', () => {
  const { sat, light } = avgColorLightness();
  const failures = [];
  for (const page of PAGES) {
    for (let avg = 1; avg <= 5.0001; avg += 0.1) {
      const ratio = contrast(hsl(avgHue(avg), sat, light), hex(page));
      // .gd-ring__num is 24px/700 -> large text; the ring stroke is a graphical
      // object. Both sit at the 3:1 bar.
      if (ratio < AA_LARGE) failures.push(`${page} Ø${avg.toFixed(1)} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `.gd-ring__num draws avgColor() on the page; needs ${AA_LARGE}:1`);
});

// --- member avatar palette --------------------------------------------------

function memberColors() {
  const block = /const MEMBER_COLORS = \[([\s\S]*?)\];/.exec(PALETTE);
  assert.ok(block, 'MEMBER_COLORS should be a literal array in member-colors.js');
  const found = block[1].match(/#[0-9a-f]{6}/gi) || [];
  assert.equal(found.length, 8, 'the palette should still hold 8 colors');
  return found;
}

test('every podium rank disc carries its white numeral at AA', () => {
  /* The podium's rank numeral sits in a FILLED disc (#891), which is a different
     contrast problem from the `.rank-medal--*` glyph colours it looks like — and
     the reflex is to reuse those. Measured: white on `--gold #d99a06` is 2.45:1
     and on the silver `#9ca3af` 1.94:1, so borrowing them would have put the one
     character that states the rank below AA on two of the three tiers.

     Read out of :root by name, so retuning a tone reddens here rather than
     quietly dropping the numeral off the bar again. */
  const failures = ['gold', 'silver', 'bronze']
    .map((tone) => {
      const name = `--medal-${tone}-disc`;
      return { name, ratio: contrast(hex(rootHex(name)), WHITE) };
    })
    .filter(({ ratio }) => ratio < AA_TEXT)
    .map(({ name, ratio }) => `${name} = ${ratio.toFixed(2)}:1`);
  assert.deepEqual(failures, [], `white numerals below AA on: ${failures.join(', ')}`);
});

test('every member color carries white initials at AA', () => {
  const failures = memberColors()
    .map((c) => ({ c, ratio: contrast(hex(c), WHITE) }))
    .filter(({ ratio }) => ratio < AA_TEXT)
    .map(({ c, ratio }) => `${c} = ${ratio.toFixed(2)}:1`);
  assert.deepEqual(failures, [], '.avatar / .nr-seat__avatar render white initials on these');
});

// --- semantic colours used as text -----------------------------------------

test('every theme accent clears AA as text on its own page and on white', () => {
  // The accent becomes --brand, which is not only a fill: `.link-btn` paints
  // inline actions with it straight on the page, and the theme
  // card prints each theme's name in its own accent. Sand and Pfirsich shipped
  // at 3.8:1, so choosing either put every link in the app below AA (#145).
  const failures = [];
  for (const { page, accent } of THEMES) {
    const onPage = contrast(hex(accent), hex(page));
    const onWhite = contrast(hex(accent), WHITE);
    if (onPage < AA_TEXT) failures.push(`${accent} on its page ${page} = ${onPage.toFixed(2)}:1`);
    if (onWhite < AA_TEXT) failures.push(`${accent} on --surface = ${onWhite.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], 'the accent is used as link text on both surfaces');
});

test('the semantic colours clear AA as text on white AND on the darkest theme page', () => {
  const failures = [];
  for (const name of ['--good', '--warn', '--danger', '--ink-soft']) {
    const m = new RegExp(`\\${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(CSS);
    assert.ok(m, `${name} should be a plain hex in :root`);
    // Measured on BOTH backgrounds these colours actually land on: cards are
    // white --surface, but a bare .link-btn sits straight on the page. Checking
    // white alone hid three sub-AA values (#145).
    for (const [where, bg] of [['white', WHITE], ['darkest page', DARKEST]]) {
      const ratio = contrast(hex(m[1]), bg);
      if (ratio < AA_TEXT) failures.push(`${name} ${m[1]} on ${where} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], 'used as text on --surface and directly on --page-bg');
});

// --- the lobby hero band (#543) ---------------------------------------------

/* Composite `fg` over `bg` at `alpha` — what a translucent wash actually paints,
   and therefore the background the text on it is really measured against.

   This one stays a plain sRGB channel lerp and must NOT follow #544 into oklab,
   even though it is the same three lines as `mixOklab` above. It models ALPHA
   COMPOSITING — a translucent layer painted over an opaque one, which the
   compositor does in the device space — not a color-mix(). The two are easy to
   conflate because the token feeding it (--page-glow) is itself written as a
   color-mix; that mix is with `transparent`, which under premultiplied alpha
   resolves to "--brand at 7% alpha" in EVERY interpolation space, so the space
   switch leaves this call site's input and its arithmetic alone. */
const composite = (fg, bg, alpha) =>
  hex(fg).map((v, i) => Math.round(v * alpha + hex(bg)[i] * (1 - alpha)));

test('the lobby hero band keeps its heading AND its muted sub-line at AA', () => {
  /* The signed-in greeting sits on a brand wash since #543, so its two lines no
     longer land on the bare page. Deepening that wash renders nothing wrong —
     the text just quietly drops below the bar — which is exactly the invisible
     class of regression this file exists for. Measured: the sub-line is `.muted`
     (--ink-soft) and clears AA by 0.14 at the shipped strength, but sits at
     4.28:1 on Schiefer at 13% brand. */
  const band = mediaBlocks()
    .filter(([query]) => /min-width:\s*1280px/.test(query))
    .flatMap(([, css]) => rulesOf(css))
    .find(([sel, body]) => whole('.lobby-head').test(sel) && /background-color:/.test(body));
  assert.ok(band, 'the lobby hero band rule was not found');

  /* Pinned to the TOKEN, not to a percentage. The band's whole licence is that
     it is no darker than the halo `body` already paints over the top of every
     page — so a literal color-mix here would let someone retune the band past
     the ceiling these numbers were measured against, with this test still
     green because it had checked the literal it was handed. */
  assert.match(band[1], /background-color:\s*var\(--page-glow\)/,
    'the band no longer tints with --page-glow, so the ceiling measured below does not apply to it');

  const glow = /--page-glow:\s*color-mix\(in oklab,\s*var\(--brand\)\s*([\d.]+)%/.exec(bodyOf(':root'));
  assert.ok(glow, '--page-glow should be a color-mix of --brand with transparent');
  // Any further accent layer in the same rule stacks on top of the wash.
  const extra = [...band[1].matchAll(/var\(--brand\)\s*(\d+)%/g)]
    .reduce((sum, m) => sum + Number(m[1]) / 100, 0);
  const alpha = Number(glow[1]) / 100 + extra;

  const failures = [];
  for (const { page, accent } of THEMES) {
    const bg = composite(accent, page, alpha);
    for (const name of ['--ink', '--ink-soft']) {
      const ratio = contrast(hex(rootHex(name)), bg);
      if (ratio < AA_TEXT) {
        failures.push(`${name} on the band over ${page} = ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [],
    '.lobby-head sits on this wash: its heading in --ink, its sub-line in --ink-soft');
});

// --- the game detail page's Wunschliste state chip (#663) -------------------

test('the Wunschliste state chip clears AA on every theme', () => {
  /* The third state chip beside a game's title. Its two siblings encode a
     semantic (--warn for aussortiert, --good for durchgespielt); wanting a game
     is neither a warning nor an achievement, so this one takes the round's own
     accent — which puts it on exactly the token pair the milestone chip below
     had to reason its way to, and for the same reason: `--brand` ON a brand tint
     lands 4.33-4.92 and misses AA on four of the eight accents.

     Unlike that chip this is real TEXT, not an aria-hidden glyph, so the strict
     bar is the one that binds rather than the one we choose to hold. Asserting
     the tokens is what makes the arithmetic below apply to the shipped chip: a
     retune to bare `var(--brand)` reddens here instead of dropping four themes
     under AA in silence. */
  const chip = bodyOf('.tag--wish');
  assert.ok(chip, 'the .tag--wish rule was not found');
  assert.match(chip, /background:\s*var\(--brand-tint\)/,
    'the wish chip no longer washes with --brand-tint, so the numbers below do not apply to it');
  assert.match(chip, /color:\s*var\(--brand-dark\)/,
    'the wish chip label must stay --brand-dark: plain --brand drops to 4.33:1 on Salbei');

  // Read both mixes out of :root rather than restating them, so a retune of
  // either token lands here instead of leaving a stale number behind.
  const tint = /--brand-tint:\s*color-mix\(in oklab,\s*var\(--brand\)\s*([\d.]+)%,\s*var\(--surface\)\)/.exec(bodyOf(':root'));
  assert.ok(tint, '--brand-tint should be a color-mix of --brand into --surface');
  const darkMix = /--brand-dark:\s*color-mix\(in oklab,\s*var\(--brand\),\s*#000\s*([\d.]+)%\)/.exec(bodyOf(':root'));
  assert.ok(darkMix, '--brand-dark should be a color-mix of --brand toward #000');

  const surface = rootHex('--surface');
  const failures = [];
  for (const { accent } of THEMES) {
    const label = mixOklab(accent, '#000000', 1 - Number(darkMix[1]) / 100);
    const bg = mixOklab(accent, surface, Number(tint[1]) / 100);
    const ratio = contrast(label, bg);
    if (ratio < AA_TEXT) failures.push(`the wish chip under ${accent} = ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], 'the Wunschliste chip draws --brand-dark on --brand-tint');
});

// --- the Chronik milestone rows (#633) --------------------------------------

test('the Chronik milestone row keeps its label, its meta line AND its icon at AA', () => {
  /* Milestone shelf events (played through / retired / back on the shelf) sit
     on a brand wash since #633, so their three ink levels no longer land on the
     bare white --surface every other timeline row uses. Unlike the lobby band
     above, this wash is OPAQUE — `--brand-tint*` mixes the accent into
     `--surface`, not into transparency — so it does not vary with the page
     colour, only with the accent.

     The icon is measured at the strict TEXT bar even though it is an
     aria-hidden glyph whose meaning the adjacent label already carries (1.4.11
     non-text, 3.0, is what actually binds it). That is deliberate: at
     `var(--brand)` four of the eight accents land 4.33-4.38, i.e. they pass the
     bar that binds and fail the one a reader would assume, which is precisely
     the reading someone retuning this later would have to re-derive. Pinning
     the strict bar makes `--brand-dark` the thing that has to stay. */
  const rowBg = bodyOf('.tl-act.tl-act--milestone');
  assert.ok(rowBg, 'the .tl-act.tl-act--milestone rule was not found');
  assert.match(rowBg, /background:\s*var\(--brand-tint-soft\)/,
    'the milestone row no longer washes with --brand-tint-soft, so the numbers below do not apply to it');

  const chip = bodyOf('.tl-act--milestone .tl-act__icon');
  assert.ok(chip, 'the .tl-act--milestone .tl-act__icon rule was not found');
  assert.match(chip, /background:\s*var\(--brand-tint\)/,
    'the icon chip no longer washes with --brand-tint, so the numbers below do not apply to it');
  assert.match(chip, /color:\s*var\(--brand-dark\)/,
    'the icon glyph must stay --brand-dark: plain --brand drops to 4.33:1 on Salbei');

  // Both tints mix the accent into --surface, so read their strengths from the
  // tokens rather than restating them — a retune of either lands here.
  const strength = (token) => {
    const m = new RegExp(`\\${token}:\\s*color-mix\\(in oklab,\\s*var\\(--brand\\)\\s*([\\d.]+)%,\\s*var\\(--surface\\)\\)`)
      .exec(bodyOf(':root'));
    assert.ok(m, `${token} should be a color-mix of --brand into --surface`);
    return Number(m[1]) / 100;
  };
  const surface = rootHex('--surface');
  const wash = strength('--brand-tint-soft');
  const chipMix = strength('--brand-tint');
  // --brand-dark is 87% accent over black; mirrors the :root color-mix.
  const darkMix = /--brand-dark:\s*color-mix\(in oklab,\s*var\(--brand\),\s*#000\s*([\d.]+)%\)/.exec(bodyOf(':root'));
  assert.ok(darkMix, '--brand-dark should be a color-mix of --brand toward #000');
  const darken = 1 - Number(darkMix[1]) / 100;

  const failures = [];
  for (const { accent } of THEMES) {
    const rowBgPx = mixOklab(accent, surface, wash);
    // The label goes to --ink, the timestamp and the actor line stay --ink-soft.
    for (const name of ['--ink', '--ink-soft']) {
      const ratio = contrast(hex(rootHex(name)), rowBgPx);
      if (ratio < AA_TEXT) failures.push(`${name} on the milestone wash under ${accent} = ${ratio.toFixed(2)}:1`);
    }
    const glyph = mixOklab(accent, '#000000', darken);
    const ratio = contrast(glyph, mixOklab(accent, surface, chipMix));
    if (ratio < AA_TEXT) failures.push(`the chip glyph under ${accent} = ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [],
    'a milestone row draws --ink on the wash, --ink-soft for its meta, --brand-dark on the chip');
});

// --- the finale stage's own ink levels (#544) --------------------------------

test('the finale stage keeps its sub-line and its note legible on every theme', () => {
  /* The stage is the app's one DARK surface, and its three ink levels are
     derived through a two-step chain (--stage-ink diluted into --stage-bg), so
     a retune of either end moves them without touching the tones themselves.

     This exists because #544's space switch cost contrast here and nothing
     would have noticed: unretuned, --stage-muted fell 5.48 -> 5.12 and
     --stage-faint 3.59 -> 3.30. Both stayed on the same side of their bar, so
     every check in this file passed while the darkest text on the darkest
     screen quietly lost a fifth of its headroom. The percentages were nudged
     back (62 -> 65, 45 -> 48); this is what stops that being undone silently.

     KNOWN GAP, deliberately pinned below AA: `.stage__note` is 12px/700 in
     --stage-faint and measures ~3.58:1, i.e. it does NOT meet the 4.5 bar for
     normal text. That predates this change (3.59:1 in sRGB) and fixing it means
     choosing a lighter tone, which is a design decision about the finale rather
     than a derivation one. The floor below is therefore a NON-REGRESSION guard,
     not a pass — do not read a green here as "the note is accessible". */
  const root = bodyOf(':root');
  const pct = (re, what) => {
    const m = re.exec(root);
    assert.ok(m, what);
    return Number(m[1]) / 100;
  };
  const bgMix = pct(/--stage-bg:\s*color-mix\(in oklab,\s*var\(--brand\)\s*([\d.]+)%,\s*#201a15\)/,
    '--stage-bg should mix --brand into the dark curtain');
  const inkMix = pct(/--stage-ink:\s*color-mix\(in oklab,\s*var\(--brand\)\s*([\d.]+)%,\s*#f7f2e9\)/,
    '--stage-ink should mix --brand into the warm near-white');
  const mutedMix = pct(/--stage-muted:\s*color-mix\(in oklab,\s*var\(--stage-ink\)\s*([\d.]+)%,\s*var\(--stage-bg\)\)/,
    '--stage-muted should dilute --stage-ink into --stage-bg');
  const faintMix = pct(/--stage-faint:\s*color-mix\(in oklab,\s*var\(--stage-ink\)\s*([\d.]+)%,\s*var\(--stage-bg\)\)/,
    '--stage-faint should dilute --stage-ink into --stage-bg');

  const FAINT_FLOOR = 3.5;
  const failures = [];
  for (const { accent } of THEMES) {
    const bg = mixOklab(accent, '#201a15', bgMix);
    const ink = mixOklab(accent, '#f7f2e9', inkMix);
    // .stage__sub (16px/700) and .stage__voter-name (12px/800) both take --stage-muted.
    const muted = contrast(mixOklab(ink, bg, mutedMix), bg);
    if (muted < AA_TEXT) failures.push(`--stage-muted under ${accent} = ${muted.toFixed(2)}:1`);
    // .stage__note (12px/700) — see the KNOWN GAP note above.
    const faint = contrast(mixOklab(ink, bg, faintMix), bg);
    if (faint < FAINT_FLOOR) failures.push(`--stage-faint under ${accent} = ${faint.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [],
    `--stage-muted must clear ${AA_TEXT}:1 and --stage-faint must not fall below ${FAINT_FLOOR}:1 on the stage`);
});
