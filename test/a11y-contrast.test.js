'use strict';

/* Contrast regressions are invisible: nothing throws, nothing renders wrong —
   the numbers just quietly drop below the WCAG AA bar again (#145). These tests
   pin the colour sources the audit had to fix, so a future palette tweak fails
   here instead of shipping.

   #904 changed what "the bar" means. Until then every design was light, so the
   two backgrounds text could land on were white (`--surface`) and the darkest
   theme page — and both were constants this file could lift out of `:root` with
   a regex. A design may now be DARK, which inverts `--surface`, `--ink`, the
   direction of every neutral mix and the ink on every saturated fill. So a check
   written against `:root` alone would keep measuring the light values over a
   dark page and keep passing.

   Everything below therefore loops the registry and resolves each token FOR THE
   DESIGN (test/support/theme.js), which reads the real declarations out of
   styles.css rather than restating them. "The darkest page" and "white" are no
   longer special cases hand-picked here; each design is measured against its own
   page and its own surface, which covers both ends by construction. */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { rulesOf, bodyOf, mediaBlocks, whole, CSS } = require('./support/css');
const { loadApp } = require('./support/dom');
const {
  contrast, luminance, hsl, composite, evaluate, tokensFor, alphaOf,
} = require('./support/theme');

// Every design a round can pick — the palettes AND the worlds — required off
// the registry, so a new design is measured automatically instead of silently
// escaping these checks. (#903 replaced a regex over views-round-detail.js; the
// registry is a dependency-free module precisely so this file can require it.)
const { DESIGNS } = require('../public/js/round-designs');
const { MEMBER_COLORS } = require('../public/js/member-colors');
assert.ok(DESIGNS.length >= 11, 'expected the nine palettes plus the two worlds');

const THEMES = DESIGNS.map(tokensFor);
const name = (t) => `${t.design.id}${t.dark ? ' (dark)' : ''}`;

/* Anti-vacuous, and it guards the whole file: every loop below is "for each
   design", so a registry that lost its dark entries would leave each one green
   while measuring nothing about the direction this issue exists for. */
test('the registry ships designs in BOTH directions, or none of the checks below mean anything', () => {
  assert.ok(THEMES.some((t) => t.dark), 'no dark design ships — the dark half of every check below is vacuous');
  assert.ok(THEMES.some((t) => !t.dark), 'no light design ships');
});

/* `scheme` is DECLARED in round-designs.js rather than measured off the page,
   so the registry stays the single statement of what a design is. The cost of
   declaring is that it can disagree with the colour — a dark page that forgot
   the flag renders dark ink on a dark background, everywhere at once — so the
   two are pinned to each other here. */
test('every design that LOOKS dark says so, and every design that says so looks dark', () => {
  const wrong = THEMES
    .filter((t) => (luminance(t.page) < 0.5) !== t.dark)
    .map((t) => `${t.design.id}: page ${t.design.page} but scheme=${t.design.scheme || 'light'}`);
  assert.deepEqual(wrong, [], 'the declared scheme and the page colour disagree');
});

const AA_TEXT = 4.5; // normal-size text
const AA_LARGE = 3.0; // >=24px, or >=18.66px bold

/* One place to collect "colour X on background Y, per design" so a failure names
   the design, the pair and the number rather than just going red. */
function sweep(pairs, bar = AA_TEXT) {
  const failures = [];
  for (const t of THEMES) {
    for (const [label, fg, bg] of pairs(t)) {
      const ratio = contrast(fg, bg);
      if (ratio < bar) failures.push(`${name(t)} — ${label} = ${ratio.toFixed(2)}:1`);
    }
  }
  return failures;
}

// --- the two ink levels and the accent, on the two surfaces they land on -----

test('every theme accent clears AA as text on its own page and on its own surface', () => {
  /* The accent becomes --brand, which is not only a fill: `.link-btn` paints
     inline actions with it straight on the page, and the theme card prints each
     design's name in its own accent. Sand and Pfirsich shipped at 3.8:1, so
     choosing either put every link in the app below AA (#145).

     "On its own surface" was "on white" until #904. For a light design that is
     the same assertion — `--surface` IS #ffffff there — but a dark design's card
     is a lift off its page, and white is a background it never paints. */
  assert.deepEqual(sweep((t) => [
    ['accent on the page', t.brand, t.page],
    ['accent on --surface', t.brand, t.surface],
  ]), [], 'the accent is used as link text on both surfaces');
});

test('the ink pair clears AA on every design, on the page and on the card', () => {
  /* --ink and --ink-soft are the body and muted text of the whole app, and they
     land on both the page (a bare .link-btn, a section note) and a card. On a
     light design they are the two fixed dark hexes in :root; on a dark one the
     scheme block replaces both, and nothing else in this file would notice if
     that replacement were wrong. */
  assert.deepEqual(sweep((t) => [
    ['--ink on the page', t.ink, t.page],
    ['--ink on --surface', t.ink, t.surface],
    ['--ink-soft on the page', t.inkSoft, t.page],
    ['--ink-soft on --surface', t.inkSoft, t.surface],
    ['--ink-soft on --sunken', t.inkSoft, t.sunken],
  ]), [], 'the app draws all of its text in these two');
});

test('the semantic colours clear AA as text on every design page and card', () => {
  /* Measured on BOTH backgrounds these colours actually land on: cards are
     --surface, but a bare .link-btn sits straight on the page. Checking white
     alone hid three sub-AA values (#145) — and checking the LIGHT values alone
     would now hide three more, because #117c38 on Sci-Fi's page is 2.0:1. The
     dark block re-picks all three rather than lightening them by rule. */
  assert.deepEqual(sweep((t) => ['good', 'warn', 'danger'].flatMap((k) => [
    [`--${k} on the page`, t[k], t.page],
    [`--${k} on --surface`, t[k], t.surface],
  ])), [], 'used as text on --surface and directly on --page-bg');
});

test('the gold family keeps its label legible on its own wash and on the card', () => {
  /* Trophies and winners: --gold-deep is the text, --gold-soft the surface under
     it. Both flip on a dark design (a pale-yellow chip carrying near-black text
     would be a light island on a night page); --gold and --gold-edge deliberately
     do not, because they are the medal and seal mid-tone and the finale stage
     they sit on is dark either way. */
  assert.deepEqual(sweep((t) => [
    ['--gold-deep on --gold-soft', t.goldDeep, t.goldSoft],
    ['--gold-deep on --surface', t.goldDeep, t.surface],
    ['--ink on --gold-soft', t.ink, t.goldSoft],
  ]), [], 'the Pokale cards draw --gold-deep on --gold-soft');
});

// --- --on-accent: the one ink every saturated fill carries (#904) ------------

test('--on-accent clears AA on every fill it is painted over', () => {
  /* The token that replaced 20 literal `#fff`s. It is white on every light
     design — so on those this is the assertion that was implicit before — and
     near-black on a dark one, because a dark design's accent must be LIGHT to
     clear 4.5:1 as link text on its own page (asserted above), which makes white
     on it unreadable. The two facts are the same fact, and this is the half of
     it nothing else measures. */
  assert.deepEqual(sweep((t) => [
    ['--on-accent on the accent (.btn--primary, .chip.is-on)', t.onAccent, t.brand],
    ['--on-accent on --brand-strong (.exp-pill)', t.onAccent, t.brandStrong],
    ['--on-accent on --good (.stage__voter-check)', t.onAccent, t.good],
    ['--on-accent on --warn', t.onAccent, t.warn],
    ['--on-accent on --danger (.chip.is-excluded)', t.onAccent, t.danger],
  ]), [], 'every fill in the app that carries ink carries this one');
});

test('--brand-strong stays the readable accent on a brand tint, in both directions', () => {
  /* `background: var(--brand-tint); color: var(--brand)` lands 4.33-4.92 across
     the light accents, so four of them miss the bar (#633). --brand-strong is
     the fix, and the reason it was renamed off `--brand-dark` in #904: on a dark
     design it mixes toward WHITE, because "stronger than the accent" and "darker
     than the accent" stopped being the same thing. */
  assert.deepEqual(sweep((t) => [
    ['--brand-strong on --brand-tint', t.brandStrong, t.brandTint],
    ['--brand-strong on --brand-tint-soft', t.brandStrong, t.brandTintSoft],
  ]), [], 'accent chips draw --brand-strong on a tint');
});

// --- the rating scale (avgColor) -------------------------------------------

/* Evaluate the REAL avgColor rather than parsing it (#890).

   This used to lift one fixed lightness out of core.js with
   `/hsl\(\$\{hue\},\s*(\d+)%,\s*(\d+)%\)/`, which stopped being possible the
   moment the lightness became an expression — and would have failed *open* for
   any shape it could still match. Running the shipped function measures what
   ships, and it costs one jsdom boot for the whole file
   (`.claude/rules/testing-views-under-jsdom.md`). Since #904 it also reads the
   scheme off the document, so the harness sets the same hook applyBackground()
   does instead of modelling the branch. */
const APP = loadApp();
after(() => APP.close());

const setScheme = (dark) => APP.run(
  dark
    ? "document.documentElement.dataset.scheme = 'dark'"
    : 'delete document.documentElement.dataset.scheme',
);

function avgRgb(avg, dark) {
  setScheme(dark);
  const css = APP.run(`avgColor(${avg})`);
  const m = /^hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)$/.exec(css);
  assert.ok(m, `avgColor(${avg}) returned ${css}, which is not an hsl() triple`);
  return hsl(Number(m[1]), Number(m[2]), Number(m[3]));
}

/* The pre-#890 formula, restated by hand on purpose: the no-op assertion below
   is only worth anything if its expectation is INDEPENDENT of the function it
   checks. Derived from core.js it could not fail. */
const avgHue = (avg) => Math.max(0, Math.min(120, ((avg - 1) / 4) * 120));

/* The sweep starts at 0, not at 1. Zero is a real, reachable value on this scale
   — a game every voter sent to the trash averages 0 (#797), and scoreColor
   clamps the Spielwirbel-Score to the same floor (#893) — so the bottom fifth of
   the ramp was simply unmeasured until #890 gave it its own colour. */
const SWEEP = [];
for (let avg = 0; avg <= 5.0001; avg += 0.1) SWEEP.push(Math.round(avg * 10) / 10);

test('every rating on the 0–5 scale clears AA as a fill under its own ink', () => {
  const failures = [];
  for (const t of THEMES) {
    for (const avg of SWEEP) {
      const ratio = contrast(avgRgb(avg, t.dark), t.onAccent);
      if (ratio < AA_TEXT) failures.push(`${name(t)} Ø${avg.toFixed(1)} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `.score-pill is 14px --on-accent text on avgColor(); needs ${AA_TEXT}:1`);
});

test('every rating clears AA-large as ring text on each design page', () => {
  const failures = [];
  for (const t of THEMES) {
    for (const avg of SWEEP) {
      // .gd-ring__num is 24px/700 -> large text; the ring stroke is a graphical
      // object. Both sit at the 3:1 bar.
      const ratio = contrast(avgRgb(avg, t.dark), t.page);
      if (ratio < AA_LARGE) failures.push(`${name(t)} Ø${avg.toFixed(1)} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `.gd-ring__num draws avgColor() on the page; needs ${AA_LARGE}:1`);
});

/* The zero must be its OWN colour, not the 1's (#890). Without this the results
   distribution paints its two leftmost columns identically — the whole reason
   the ramp gained a lightness term. Asserted in both schemes, because #904 made
   the term move the other way on a dark page and a sign slip there would be
   invisible on the light one. */
test('the retirement end of the ramp is distinguishable from a 1, in both schemes', () => {
  for (const dark of [false, true]) {
    setScheme(dark);
    assert.notEqual(APP.run('avgColor(0)'), APP.run('avgColor(1)'),
      `avgColor(0) and avgColor(1) must not be the same colour (dark=${dark})`);
  }
});

/* And the ripple stops there. Every avgColor/scoreColor consumer in the app —
   the score pills, the detail ring, the vote tiles, the score on the result row
   — is unchanged for anything at or above 1, which is what made #890's colour
   change safe to ship without re-auditing each of them. #904 kept the LIGHT ramp
   byte-identical for the same reason: a dark design is a new branch, not a
   retune of the existing one. */
test('the light ramp is unchanged for every value at or above 1', () => {
  setScheme(false);
  const drifted = SWEEP
    .filter((avg) => avg >= 1)
    .filter((avg) => APP.run(`avgColor(${avg})`) !== `hsl(${avgHue(avg)}, 60%, 30%)`)
    .map((avg) => `Ø${avg.toFixed(1)} -> ${APP.run(`avgColor(${avg})`)}`);
  assert.deepEqual(drifted, [], 'the 1–5 half of the light ramp moved — every consumer of it changed too');
});

// --- member avatar palette --------------------------------------------------

/* What a palette hex is actually PAINTED as, via the shipped memberTone(): the
   stored hex on a light design, lifted toward white on a dark one (#904). Run
   rather than restated, for the reason avgColor is. */
function memberTone(color, dark) {
  setScheme(dark);
  return evaluate(APP.run(`memberTone(${JSON.stringify(color)})`), THEMES[0].design);
}

test('every member tone carries its initials at AA, on every design', () => {
  assert.deepEqual(sweep((t) => MEMBER_COLORS.map((c) => [
    `${c} initials`, t.onAccent, memberTone(c, t.dark),
  ])), [], '.avatar / .nr-seat__avatar render --on-accent initials on these');
});

test('every member tone clears AA as the voter name printed on the vote card', () => {
  /* personColor() is not only a fill: `.vote__who strong` prints the person's
     name in it, as TEXT. The background is the card (`.vote` is --surface), not
     the page — worth stating, because measuring it against --page-bg instead
     reports every light design at ~4.0:1 and looks like a real finding.

     On a light design this is the palette's documented tuning (4.5:1 on white).
     On a dark one the stored hexes would land near 1.6:1 on the lifted surface,
     which is what memberTone()'s lift is for. */
  assert.deepEqual(sweep((t) => MEMBER_COLORS.map((c) => [
    `${c} as the voter name`, memberTone(c, t.dark), t.surface,
  ])), [], '.vote__who draws the person in their own tone on the .vote card');
});

test('the stored palette is untouched — the lift is render-time only', () => {
  /* The eight hexes are a shared constant the server validates against
     (.claude/rules/shared-constants-across-the-stack.md). If memberTone() ever
     became a second palette rather than a render-time transform, a member could
     store a colour PATCH .../members/:mid rejects with 400 — the exact shape of
     #420. So: the light scheme must hand back the hex it was given. */
  setScheme(false);
  const drifted = MEMBER_COLORS.filter((c) => APP.run(`memberTone(${JSON.stringify(c)})`) !== c);
  assert.deepEqual(drifted, [], 'memberTone() must be the identity on a light design');
});

// --- the lobby hero band (#543) ---------------------------------------------

test('the lobby hero band keeps its heading AND its muted sub-line at AA', () => {
  /* The signed-in greeting sits on a brand wash since #543, so its two lines no
     longer land on the bare page. Deepening that wash renders nothing wrong —
     the text just quietly drops below the bar — which is exactly the invisible
     class of regression this file exists for. */
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

  const glowAlpha = alphaOf(/--page-glow:\s*([^;]+);/.exec(bodyOf(':root'))[1]);
  // Any further accent layer in the same rule stacks on top of the wash.
  const extra = [...band[1].matchAll(/var\(--brand\)\s*(\d+)%/g)]
    .reduce((sum, m) => sum + Number(m[1]) / 100, 0);
  const alpha = glowAlpha + extra;

  assert.deepEqual(sweep((t) => {
    const bg = composite(t.brand, t.page, alpha);
    return [['--ink on the band', t.ink, bg], ['--ink-soft on the band', t.inkSoft, bg]];
  }), [], '.lobby-head sits on this wash: its heading in --ink, its sub-line in --ink-soft');
});

// --- the game detail page's Wunschliste state chip (#663) -------------------

test('the Wunschliste state chip clears AA on every theme', () => {
  /* The third state chip beside a game's title. Its two siblings encode a
     semantic (--warn for aussortiert, --good for durchgespielt); wanting a game
     is neither a warning nor an achievement, so this one takes the round's own
     accent — which puts it on exactly the token pair the milestone chip below
     had to reason its way to, and for the same reason: `--brand` ON a brand tint
     lands 4.33-4.92 and misses AA on four of the eight light accents.

     Unlike that chip this is real TEXT, not an aria-hidden glyph, so the strict
     bar is the one that binds rather than the one we choose to hold. Asserting
     the tokens is what makes the arithmetic apply to the shipped chip: a retune
     to bare `var(--brand)` reddens here instead of dropping four themes under AA
     in silence. */
  const chip = bodyOf('.tag--wish');
  assert.ok(chip, 'the .tag--wish rule was not found');
  assert.match(chip, /background:\s*var\(--brand-tint\)/,
    'the wish chip no longer washes with --brand-tint, so the numbers below do not apply to it');
  assert.match(chip, /color:\s*var\(--brand-strong\)/,
    'the wish chip label must stay --brand-strong: plain --brand drops to 4.33:1 on Salbei');

  assert.deepEqual(sweep((t) => [['the wish chip', t.brandStrong, t.brandTint]]), [],
    'the Wunschliste chip draws --brand-strong on --brand-tint');
});

// --- the Chronik milestone rows (#633) --------------------------------------

test('the Chronik milestone row keeps its label, its meta line AND its icon at AA', () => {
  /* Milestone shelf events (played through / retired / back on the shelf) sit
     on a brand wash since #633, so their three ink levels no longer land on the
     bare --surface every other timeline row uses. Unlike the lobby band above,
     this wash is OPAQUE — `--brand-tint*` mixes the accent into `--surface`, not
     into transparency — so it does not vary with the page colour, only with the
     accent and the surface under it.

     The icon is measured at the strict TEXT bar even though it is an
     aria-hidden glyph whose meaning the adjacent label already carries (1.4.11
     non-text, 3.0, is what actually binds it). That is deliberate: at
     `var(--brand)` four of the eight light accents land 4.33-4.38, i.e. they pass
     the bar that binds and fail the one a reader would assume, which is precisely
     the reading someone retuning this later would have to re-derive. */
  const rowBg = bodyOf('.tl-act.tl-act--milestone');
  assert.ok(rowBg, 'the .tl-act.tl-act--milestone rule was not found');
  assert.match(rowBg, /background:\s*var\(--brand-tint-soft\)/,
    'the milestone row no longer washes with --brand-tint-soft, so the numbers below do not apply to it');

  const chip = bodyOf('.tl-act--milestone .tl-act__icon');
  assert.ok(chip, 'the .tl-act--milestone .tl-act__icon rule was not found');
  assert.match(chip, /background:\s*var\(--brand-tint\)/,
    'the icon chip no longer washes with --brand-tint, so the numbers below do not apply to it');
  assert.match(chip, /color:\s*var\(--brand-strong\)/,
    'the icon glyph must stay --brand-strong: plain --brand drops to 4.33:1 on Salbei');

  assert.deepEqual(sweep((t) => [
    ['--ink on the milestone wash', t.ink, t.brandTintSoft],
    ['--ink-soft on the milestone wash', t.inkSoft, t.brandTintSoft],
    ['the chip glyph', t.brandStrong, t.brandTint],
  ]), [], 'a milestone row draws --ink on the wash, --ink-soft for its meta, --brand-strong on the chip');
});

// --- the finale stage's own ink levels (#544) --------------------------------

test('the finale stage keeps its sub-line and its note legible on every theme', () => {
  /* The stage is dark under BOTH schemes — it is a curtain, not a surface — and
     its three ink levels are derived through a two-step chain (--stage-ink
     diluted into --stage-bg), so a retune of either end moves them without
     touching the tones themselves.

     This exists because #544's space switch cost contrast here and nothing would
     have noticed: unretuned, --stage-muted fell 5.48 -> 5.12 and --stage-faint
     3.59 -> 3.30. Both stayed on the same side of their bar, so every check in
     this file passed while the darkest text on the darkest screen quietly lost a
     fifth of its headroom.

     KNOWN GAP, deliberately pinned below AA: `.stage__note` is 12px/700 in
     --stage-faint and measures ~3.58:1, i.e. it does NOT meet the 4.5 bar for
     normal text. That predates this change (3.59:1 in sRGB) and fixing it means
     choosing a lighter tone, which is a design decision about the finale rather
     than a derivation one. The floor below is therefore a NON-REGRESSION guard,
     not a pass — do not read a green here as "the note is accessible". */
  const FAINT_FLOOR = 3.5;
  // .stage__sub (16px/700) and .stage__voter-name (12px/800) both take --stage-muted.
  assert.deepEqual(sweep((t) => [['--stage-muted', t.stageMuted, t.stageBg]]), [],
    `--stage-muted must clear ${AA_TEXT}:1 on the stage`);
  assert.deepEqual(sweep((t) => [['--stage-faint', t.stageFaint, t.stageBg]], FAINT_FLOOR), [],
    `--stage-faint must not fall below ${FAINT_FLOOR}:1 on the stage`);
});

test('the curtain still reads as darker than the page it covers', () => {
  /* On a light design that is self-evident. On a dark one it is the constraint
     that made --stage-anchor a token: the stage anchored at #201a15 over a
     night-blue page is a warm patch of nearly the same lightness, i.e. not a
     curtain at all. The dark block re-anchors it deeper. */
  const wrong = THEMES
    .filter((t) => luminance(t.stageBg) >= luminance(t.page))
    .map((t) => `${name(t)}: stage ${luminance(t.stageBg).toFixed(3)} vs page ${luminance(t.page).toFixed(3)}`);
  assert.deepEqual(wrong, [], 'the finale stage must be darker than the page');
});

// --- the whites that stayed, and the ones that must not come back -----------

/* The acceptance criterion #904 set: every `#fff` left in the sheet is either a
   token's own light default or carries a reason. A comment cannot be checked, so
   the reason is encoded here — the list is exhaustive, and any OTHER bare white
   fails, which is what stops a new one slipping in beside them.

   Each entry is a rule whose white is NOT theme-dependent, for one of three
   reasons: it is the light default of a token the dark block overrides; it sits
   on the finale stage, which is dark either way; or it sits on a scrim of its
   own rather than on a theme surface. */
const WHITE_EXEMPT = new Map([
  [':root', 'the light defaults of --surface / --on-accent, and the two --stage-* lifts'],
  [':root[data-scheme="dark"], .theme-card[data-scheme="dark"]',
    'the dark scheme\'s own defaults: --shade is white BECAUSE the page is dark'],
  ['.gd-img__edit', 'on its own black scrim gradient, not on a theme surface'],
  ['.stage__lock', 'on --gold, which does not flip: the stage is dark either way'],
]);

test('no bare white is painted outside the rules that justify one', () => {
  const offenders = [];
  for (const [sel, body] of rulesOf(CSS)) {
    const key = sel.replace(/\s+/g, ' ').trim();
    if (WHITE_EXEMPT.has(key)) continue;
    for (const decl of body.split(';')) {
      // `white-space` is a property, not a colour.
      const d = decl.trim().replace(/white-space/g, '');
      if (/#fff\b|#ffffff\b|(^|[\s:,(])white\b|rgba\(\s*255,\s*255,\s*255/i.test(d)) {
        offenders.push(`${key} { ${decl.trim()} }`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    'a bare white must be tokenised (--surface / --on-accent) or added to WHITE_EXEMPT with a reason');
});

/* The anti-vacuous half, the shape test/design-tokens.test.js uses for its glyph
   list: an exemption nobody re-checks rots into a selector that no longer exists,
   and every stale entry silently widens the assertion above. */
test('no white exemption is stale', () => {
  const withWhite = new Set(rulesOf(CSS)
    .filter(([, body]) => /#fff\b|#ffffff\b|rgba\(\s*255,\s*255,\s*255/i.test(body))
    .map(([sel]) => sel.replace(/\s+/g, ' ').trim()));
  const stale = [...WHITE_EXEMPT.keys()].filter((sel) => !withWhite.has(sel));
  assert.deepEqual(stale, [], `exempted but no longer paints a white — delete these: ${stale.join(', ')}`);
});
