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

const {
  rulesOf, bodyOf, bodyOfIn, topLevel, mediaBlocks, whole, CSS, RULES, matchesEl, declaredValue,
  resolvedDeclaration,
} = require('./support/css');
const { loadApp } = require('./support/dom');
const {
  contrast, luminance, hsl, composite, evaluate, tokensFor, alphaOf, mixOklab, toHex, rgb,
} = require('./support/theme');

// Every design a round can pick — the palettes AND the worlds — required off
// the registry, so a new design is measured automatically instead of silently
// escaping these checks. (#903 replaced a regex over views-round-detail.js; the
// registry is a dependency-free module precisely so this file can require it.)
const { DESIGNS } = require('../public/js/round-designs');
const { DESIGN_REGISTRY, markerInk } = require('../public/js/designs');
const { MEMBER_COLORS } = require('../public/js/member-colors');
assert.ok(DESIGNS.length >= 11, 'expected the nine palettes plus the two worlds');

/* BOTH registries (#1184). A design is per USER now as well as per round, and a
   user design's colours land on exactly the same tokens — so it is folded into
   the ONE list every sweep below loops, rather than getting a few assertions of
   its own. Every check in this file therefore covers a new design for free,
   which is the same reason #903 made the round registry requirable.

   Only the entries that DECLARE colours: Klassisch is the :root default itself
   and has no page/accent to resolve (test/design-layer.test.js pins that), so
   it is already measured as the light half of every assertion here.

   A user design's own override stylesheet (public/css/designs/<id>.css) IS read
   here since #1188: `tokensFor` resolves a token through the design's
   `:root[data-design="<id>"]` block before styles.css's two, so Der Tisch's
   walnut --surface and paper --ink are measured by every sweep below without
   any of them being edited. That block is the ONLY part of the file the
   resolver sees — a colour on a component rule is still invisible, which is
   what test/design-layer.test.js's two sweeps enforce, and the coverage guard
   at the end of this file closes the remaining gap: resolvable is not the same
   as measured. See .claude/rules/design-stylesheets-are-shell-assets.md. */
const USER_DESIGNS = DESIGN_REGISTRY.filter((d) => d.page && d.accent);

const THEMES = DESIGNS.concat(USER_DESIGNS).map(tokensFor);

// A rule whose selector may be one MEMBER of a grouped, newline-separated
// selector — bodyOf() compares the whole text and would miss it.
const slotBodyFor = (sel) => (rulesOf(CSS).find(([s]) => s.split('\n')
  .map((x) => x.trim().replace(/,$/, '')).includes(sel)) || [])[1] || null;
const name = (t) => `${t.design.id}${t.dark ? ' (dark)' : ''}`;

/* Anti-vacuous, and it guards the whole file: every loop below is "for each
   design", so a registry that lost its dark entries would leave each one green
   while measuring nothing about the direction this issue exists for. */
test('the registry ships designs in BOTH directions, or none of the checks below mean anything', () => {
  assert.ok(THEMES.some((t) => t.dark), 'no dark design ships — the dark half of every check below is vacuous');
  assert.ok(THEMES.some((t) => !t.dark), 'no light design ships');
  // And that the USER registry really is in the loop. Without this, dropping
  // the concat above would leave every sweep green while measuring only the
  // round designs — the failure mode #1184's whole seam exists under.
  assert.ok(USER_DESIGNS.length >= 1,
    'no user design declares colours — this file is back to covering one registry');
  for (const d of USER_DESIGNS) {
    assert.ok(THEMES.some((t) => t.design.id === d.id), `${d.id} is not being measured`);
  }
});

/* The round MARKER (#1187). Every design maps the same index 0-7 onto its own
   eight colours, and every one of those is a FILL that carries the design's
   `--on-accent` ink — in the picker's swatch today, and in whatever each design
   paints on the four surfaces. So the whole cross-product is swept, not just
   the design whose screens exist.

   It is the 4.5:1 TEXT bar rather than the 3:1 non-text one, deliberately. The
   glyph on the swatch is a check mark carrying the "this is the chosen one"
   state, and a marker is also each design's licence to put a label on the
   colour — Tisch's package states the same bar for paper ink on a felt, with
   Ockerfilz at 4.56:1 as its tightest. Holding the strict bar here costs
   nothing today and removes a judgement someone would otherwise re-derive per
   design (.claude/rules/theme-derived-colors.md).

   The ink is the design's `markerInk`, NOT its `--on-accent`. A marker is a
   dark fill in every design and does not flip with the scheme, so its ink must
   not either — measured: under Der Tisch, `--on-accent` is near-black and put
   the picker's check glyph at 2.81:1 on Tannenfilz. That is the `--gold-ink`
   case in .claude/rules/theme-derived-colors.md, and it is why this sweep found
   a real defect rather than merely passing. */
test('every design\u2019s eight markers carry its own ink at 4.5:1', () => {
  const fails = [];
  let checked = 0;
  for (const d of DESIGN_REGISTRY) {
    const ink = rgb(markerInk(d.id));
    const markers = d.markers || [];
    assert.equal(markers.length, 8, `${d.id} declares ${markers.length} markers`);
    for (const m of markers) {
      // The swatch is a gradient from `color` to `deep`, so the LIGHT stop is
      // the critical ground for ink on a dark design and the deep one for a
      // light design — measure both rather than guessing which way a design
      // runs.
      for (const stop of [m.color, m.deep]) {
        checked++;
        // rgb(): `contrast` compares TRIPLES, and a hex string handed to it
        // returns NaN — which is never < 4.5, so this whole sweep passed against
        // a marker at 1.2:1 until it was broken on purpose
        // (.claude/rules/break-the-code-on-purpose.md).
        const ratio = contrast(ink, rgb(stop));
        if (ratio < 4.5) fails.push(`${d.id}/${m.key} ${stop}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.equal(checked, DESIGN_REGISTRY.length * 16, 'the sweep did not cover every design');
  assert.deepEqual(fails, [], `markers below AA for their own ink:\n${fails.join('\n')}`);
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

/* WCAG 1.4.3's large-text carve-out, as an EXPLICIT named branch (#1184).
 *
 * Until now every site that used AA_LARGE picked the constant by hand and put
 * the size and weight in a prose comment beside it (".gd-ring__num is 24px/700
 * -> large text"). That is where the carve-out actually lives, so nothing could
 * check it and nothing stopped a site from claiming it for 16px text — the one
 * way this whole file could be wrong in the *lenient* direction, which is the
 * direction no failing assertion can find.
 *
 * The thresholds are the SC's own, taken as written (operator decision): 24px
 * regular, or 18.66px bold. `bold` is >= 700 — the spec says "bold", and this
 * codebase only ever uses 600 or 700, so 600 deliberately does NOT qualify.
 * Passing the size in means a retune that shrinks a label moves its bar
 * automatically instead of silently keeping the concession.
 */
const LARGE_PX = 24;
const LARGE_BOLD_PX = 18.66;
function barFor({ px, weight = 400 }) {
  const large = px >= LARGE_PX || (weight >= 700 && px >= LARGE_BOLD_PX);
  return large ? AA_LARGE : AA_TEXT;
}

test('the large-text carve-out is applied to large text and nothing else', () => {
  /* The branch's own self-test. Both directions are needed: only the negatives
     prove it grants the concession rather than always granting it — which is
     what a check written the obvious way (assert the two large cases pass) is
     completely blind to. */
  assert.equal(barFor({ px: 24 }), AA_LARGE, '24px regular is large');
  assert.equal(barFor({ px: 32 }), AA_LARGE);
  assert.equal(barFor({ px: 18.66, weight: 700 }), AA_LARGE, '18.66px bold is large');
  assert.equal(barFor({ px: 22, weight: 700 }), AA_LARGE);

  assert.equal(barFor({ px: 23.9 }), AA_TEXT, 'just under 24px regular is NOT large');
  assert.equal(barFor({ px: 18.65, weight: 700 }), AA_TEXT, 'just under 18.66px bold is NOT large');
  assert.equal(barFor({ px: 22, weight: 600 }), AA_TEXT, '600 is semibold; the SC says bold');
  assert.equal(barFor({ px: 14 }), AA_TEXT);
  assert.equal(barFor({ px: 16, weight: 700 }), AA_TEXT, 'bold does not make small text large');
});

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
    // #957 put a MUTED line on the gold wash too — `.spotlight__state`, the
    // „Gespielt"/„Läuft noch" under each table's spotlight. --ink-soft is a
    // step down from --ink, so the pair it clears is not implied by the row
    // above and needs its own entry.
    ['--ink-soft on --gold-soft', t.inkSoft, t.goldSoft],
  ]), [], 'the Pokale cards draw --gold-deep on --gold-soft, the split spotlights a muted state line');
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

// --- the ink that WINS, not the ink the rule intends (#1053) ----------------

/* Everything above measures a pair of TOKENS. `--on-accent on the accent
   (.btn--primary, .chip.is-on)` is exactly the right pair for a set add-on chip
   — and it passed for months while the app painted `--brand-strong` on
   `--brand` at 1.07–1.31:1 on a chip that was both set and OPEN, because
   `.setup-addons__chip[aria-expanded="true"]` ties `.chip.is-on` on specificity
   and is declared ~5800 lines later. The ingredients were all fine; the decision
   was made somewhere no token pair can see
   (`.claude/rules/assert-the-decision-not-its-ingredients.md`).

   So this section resolves the cascade for the real element and measures
   whatever ink actually wins. Reverting the fix reddens the selector assertion
   AND the sweep, and the sweep reports the real per-design ratios. */

// The three states of an add-on chip, as `renderAddonRow` builds and paints one
// (`public/js/setup-addons.js`: the classes from `add`/`paint`, `aria-expanded`
// from `show`/`close`). Only the third was broken; the first two are the control.
const OPEN_UNSET = { tag: 'button', classes: ['chip', 'setup-addons__chip'], attrs: { 'aria-expanded': 'true' } };
const CLOSED_SET = { tag: 'button', classes: ['chip', 'setup-addons__chip', 'is-on'], attrs: { 'aria-expanded': 'false' } };
const OPEN_SET = { tag: 'button', classes: ['chip', 'setup-addons__chip', 'is-on'], attrs: { 'aria-expanded': 'true' } };

// The `var(--x)` a resolved declaration names, mapped onto the per-design token.
const TOKENS = {
  '--on-accent': 'onAccent', '--brand': 'brand', '--brand-strong': 'brandStrong',
  '--surface': 'surface', '--ink': 'ink', '--ink-soft': 'inkSoft', '--line': 'line',
  '--control-edge': 'controlEdge', '--control-fill': 'controlFill',
};
const tokenOf = (decl) => {
  const m = /var\((--[\w-]+)\)/.exec(decl.value);
  assert.ok(m && TOKENS[m[1]], `${decl.sel} resolves to "${decl.value}" — add its token to TOKENS so it can be measured`);
  return TOKENS[m[1]];
};

test('an add-on chip that is both SET and OPEN keeps its filled look — the ink that wins is --on-accent', () => {
  const ink = resolvedDeclaration(OPEN_SET, 'color');
  const fill = resolvedDeclaration(OPEN_SET, 'background');
  assert.equal(tokenOf(ink), 'onAccent',
    `${ink.sel} wins the ink and paints "${ink.value}" — the accent on the accent, which is invisible`);
  assert.equal(tokenOf(fill), 'brand', `${fill.sel} wins the fill and paints "${fill.value}"`);
});

test('the other two add-on chip states are untouched: closed + set stays filled, open + unset keeps the accent ink', () => {
  /* The control. Without it, a matcher that matched nothing — or one that
     ignored `:not()` — would satisfy the test above by accident. */
  assert.equal(tokenOf(resolvedDeclaration(CLOSED_SET, 'color')), 'onAccent');
  assert.equal(tokenOf(resolvedDeclaration(CLOSED_SET, 'background')), 'brand');
  assert.equal(tokenOf(resolvedDeclaration(OPEN_UNSET, 'color')), 'brandStrong');
  // --control-fill since #1140: on a light design it still resolves to the white
  // --surface this asserted before, on a dark one to --sunken-soft.
  assert.equal(tokenOf(resolvedDeclaration(OPEN_UNSET, 'background')), 'controlFill');
});

test('the RESOLVED ink/fill pair of an open + set add-on chip clears AA on every design', () => {
  /* Measured off the winning declarations rather than off the pair the rule
     hopes for, which is the whole point: with the fix reverted this reports
     1.07–1.31:1 per design instead of going green on the intended tokens. */
  const ink = tokenOf(resolvedDeclaration(OPEN_SET, 'color'));
  const fill = tokenOf(resolvedDeclaration(OPEN_SET, 'background'));
  assert.deepEqual(sweep((t) => [['the open + set add-on chip label', t[ink], t[fill]]]), [],
    'the label of a chip that is both set and open');
});

test('an open + set add-on chip carries a state marker clearing 3:1 on both of its adjacencies', () => {
  /* Splitting the two rules removes the collision but also removes the only cue
     that said "open" on a set chip — its border already reads --brand-strong
     when closed. The ring restores it, and SC 1.4.11 binds because it is a state
     indicator rather than decoration. Its adjacencies are the fill it sits on
     and the border it sits against; it never touches the page, and nothing
     could — no palette token clears 3:1 against --brand AND --page-bg at once
     (the numbers are in the comment above the rule). */
  const ring = resolvedDeclaration(OPEN_SET, 'box-shadow');
  assert.match(ring.value, /^inset\b/,
    `${ring.sel} draws the open marker outside the chip — its adjacency is then the page, which nothing can clear`);
  const ink = tokenOf(ring);
  assert.deepEqual(sweep((t) => [
    ['the open marker on the chip fill', t[ink], t.brand],
    ['the open marker on the chip border', t[ink], t.brandStrong],
  ], AA_LARGE), [], 'SC 1.4.11 — a non-text state indicator needs 3:1 against every colour it touches');
  // And no other state may claim it, or the ring stops meaning "open".
  for (const [label, el] of [['closed + set', CLOSED_SET], ['open + unset', OPEN_UNSET]]) {
    const hits = RULES.filter(([sel, body]) => declaredValue(body, 'box-shadow') && matchesEl(sel, el));
    assert.deepEqual(hits.map(([sel]) => sel), [], `a ${label} chip must carry no ring`);
  }
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
      // .gd-ring__num is 24px/700 -> large text (barFor); the ring stroke is a graphical
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

// --- the session stamps (#1040) ---------------------------------------------

/* The Stempelkarte on the game detail screen re-inks its whole component from
   one custom property, `--sc`, which the view sets from scoreColor(). So the
   whole 0-5 ramp lands on a fill mixed from itself, on every design — three
   pairs, each at a different bar, none of them checkable by eye.

   Everything below reads the real declarations out of styles.css rather than
   restating them. That is what makes the numbers mean anything: the sweeps
   measure "score ink on the stamp's fill", and a change that inked the small
   lines with `--sc` instead of `--ink` would otherwise leave every sweep here
   green while putting real body text at 4.15:1. */
const stampFill = (t, ink) => {
  const decl = bodyOf('.stamp::before');
  assert.ok(decl, '.stamp::before is gone — the sweeps below measure nothing');
  const m = /background:\s*color-mix\(in oklab,\s*var\(--sc\)\s*([\d.]+)%,\s*var\(--surface\)\)/.exec(decl);
  assert.ok(m, `.stamp::before no longer fills with a tint of --sc over --surface: ${decl}`);
  return mixOklab(ink, t.surface, Number(m[1]) / 100);
};

/* The anti-vacuous half, and the one that actually binds: which token each line
   is painted in. The sweeps are only a check on the RIGHT pairs while these
   hold, and a swap here is exactly the change an author would make to get the
   score colour onto more of the stamp. */
test('the stamp paints each line in the token its contrast was measured for', () => {
  assert.match(bodyOf('.stamp'), /color:\s*var\(--ink\)/,
    '.stamp body text must stay --ink — score ink bottoms out at 4.15:1 on this fill');
  assert.match(bodyOf('.stamp--muted'), /color:\s*var\(--ink-soft\)/);
  assert.match(bodyOf('.stamp__date'), /color:\s*var\(--sc\)/,
    'the date is the one line inked from the score, and the only one big enough for it');
  assert.match(bodyOf('.stamp__date'), /font-size:\s*var\(--text-xl\)/,
    '22px/700 is what puts the date at the 3:1 AA-large bar rather than 4.5:1');
});

// 22px/700. The instructive one: 22px is UNDER the 24px regular threshold, so
// this line qualifies only because it is bold — drop it to 600 and the branch
// correctly demands 4.5:1, which is exactly what the weight assertion above
// pins in the stylesheet. The SC 1.4.11 bars elsewhere in this file
// deliberately do NOT go through barFor: non-text contrast is 3:1 at any size.
const DATE_BAR = barFor({ px: 22, weight: 700 });
test('the stamp date clears AA-large in every score colour, on every design', () => {
  const failures = [];
  for (const t of THEMES) {
    for (const avg of SWEEP) {
      const ink = avgRgb(avg, t.dark);
      const ratio = contrast(ink, stampFill(t, ink));
      if (ratio < DATE_BAR) failures.push(`${name(t)} \u00d8${avg.toFixed(1)} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `.stamp__date is 22px/700 --sc on a tint of itself; needs ${DATE_BAR}:1`);
});

test('the stamp body lines clear AA on the reddest and the greenest fill alike', () => {
  const failures = [];
  for (const t of THEMES) {
    for (const avg of SWEEP) {
      const fill = stampFill(t, avgRgb(avg, t.dark));
      for (const [label, fg] of [['--ink', t.ink], ['--ink-soft', t.inkSoft]]) {
        const ratio = contrast(fg, fill);
        if (ratio < AA_TEXT) failures.push(`${name(t)} \u00d8${avg.toFixed(1)} ${label} = ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], `.stamp__status / .stamp__win sit on the stamp fill; needs ${AA_TEXT}:1`);
});

/* 1.4.11, and the expensive one. The border is the stamp's ONLY boundary — the
   fill is within 1.2:1 of the page on several designs — so it is the thing that
   makes a stamp a stamp rather than four lines of loose text (#1037, one
   component over). The worn-edge mask spends that contrast directly, and at the
   0.72 the design first called for it lands at 2.52:1: a deliberately faded
   boundary, drawn by a rule that reads as pure decoration. */
test('the worn edge never fades the stamp border below the 3:1 non-text bar', () => {
  const decl = bodyOf('.stamp::before');
  const alpha = /rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/.exec(decl);
  assert.ok(alpha, `.stamp::before lost its worn-edge mask stop: ${decl}`);
  const floor = Number(alpha[1]);
  const failures = [];
  for (const t of THEMES) {
    const inks = SWEEP.map((avg) => [`\u00d8${avg.toFixed(1)}`, avgRgb(avg, t.dark)]);
    inks.push(['muted', t.inkSoft]);
    for (const [label, ink] of inks) {
      const ratio = contrast(composite(ink, t.page, floor), t.page);
      if (ratio < AA_LARGE) failures.push(`${name(t)} ${label} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [],
    `the mask fades the border to ${floor} alpha over the page; needs ${AA_LARGE}:1`);
});

// --- member avatar palette --------------------------------------------------

/* What a palette hex is actually PAINTED as, via the shipped memberTone(): the
   stored hex on a light design, lifted toward white on a dark one (#904). Run
   rather than restated, for the reason avgColor is. */
/* Takes the DESIGN, not just its scheme. It used to evaluate against
   THEMES[0].design — harmless while the only design-dependent thing in the
   emitted mix was the scheme boolean deciding whether there was a mix at all,
   and wrong since #1188 made the lift itself a token: a `var(--member-lift)`
   resolved against Klassisch reports every design at the shipped 42% fallback,
   including one that declares its own. */
function memberTone(color, design) {
  setScheme(design.scheme === 'dark');
  return evaluate(APP.run(`memberTone(${JSON.stringify(color)})`), design);
}

test('every member tone carries its initials at AA, on every design', () => {
  assert.deepEqual(sweep((t) => MEMBER_COLORS.map((c) => [
    `${c} initials`, t.onAccent, memberTone(c, t.design),
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
    `${c} as the voter name`, memberTone(c, t.design), t.surface,
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
  assert.match(chip, /color:\s*var\((?:--brand-ink,\s*var\()?--brand-strong\)/,
    'the wish chip label must stay --brand-strong: plain --brand drops to 4.33:1 on Salbei');

  assert.deepEqual(sweep((t) => [['the wish chip', t.brandStrong, t.brandTint]]), [],
    'the Wunschliste chip draws --brand-strong on --brand-tint');
});

/* The applied-filter chip (#1037). Its fill was its ONLY boundary, and a fill is
   not a boundary: `--brand-tint` measures 1.04-1.16:1 against `--page-bg` on the
   twelve light designs and 1.47-1.52 on the three dark ones, so the chip has
   never been visible as a shape anywhere. What rescued it everywhere but Chess
   was the LABEL — `--brand-strong` is a saturated orange/blue/green, so hue alone
   said "chip". Chess's accent is `#38343f`, a desaturated near-black, so the
   label resolves to something indistinguishable from body ink and the chip
   disappears completely, taking its `.fchip__x` control with it.

   So this is a component defect on all fifteen designs that only one makes
   visible, and the fix is a border rather than a Chess accent retune — the next
   desaturated design would reintroduce it.

   The bar is SC 1.4.11's 3:1, not AA text contrast: the chip is a meaningful
   non-text graphic, and it is the one place a filter can be re-read (and removed)
   after the panel closes, so "which filters are on" is information the screen
   states nowhere else.

   The tone is READ OUT of the declaration and resolved per design rather than
   restated here, which is what makes the sweep discriminating: a retune to
   `--brand-edge` — the natural "softer border" reach — reddens on the numbers
   below, where a test asserting the token name by hand would only red on the
   name. Measured, `--brand-edge` lands 1.37-2.40 and fails on all fifteen. */
test('the applied-filter chip has a border that clears the 3:1 non-text bar on every design', () => {
  const chip = bodyOf('.fchip');
  assert.ok(chip, 'the .fchip rule was not found');

  assert.match(chip, /background:\s*var\(--brand-tint\)/,
    'the chip no longer washes with --brand-tint, so the reasoning above does not apply to it');
  assert.match(chip, /color:\s*var\((?:--brand-ink,\s*var\()?--brand-strong\)/,
    'the chip label must stay --brand-strong: plain --brand on a brand tint drops to 4.33:1 on Salbei');

  const declared = /border:\s*[\d.]+px\s+solid\s+(var\(--[\w-]+\)|#[0-9a-f]{3,8})/i.exec(chip);
  assert.ok(declared, '.fchip declares no solid border — its tint fill is 1.04:1 against the page, so the chip has no boundary at all');

  const failures = [];
  for (const t of THEMES) {
    const ratio = contrast(evaluate(declared[1], t.design), t.page);
    if (ratio < AA_LARGE) failures.push(`${name(t)} — ${declared[1]} on the page = ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [],
    `.fchip's border is the chip's only boundary and sits on --page-bg; needs ${AA_LARGE}:1`);
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
  assert.match(chip, /color:\s*var\((?:--brand-ink,\s*var\()?--brand-strong\)/,
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

test('the seal\'s padlock clears the 3:1 non-text bar, and the pair cannot flip apart', () => {
  /* #937. The badge was `color: #fff` on `background: var(--gold)` — 2.45:1,
     identical on light and dark because --gold does not flip. SC 1.4.11 arguably
     exempts it (it is aria-hidden decoration and the stage copy carries the
     meaning), but the glyph is the thing that says "sealed", and --gold is a
     FILL here and nowhere else in the app, so the fix costs no other screen.

     BOTH declarations are read out of the rule rather than named here, because
     the failure this guards against is somebody reaching for --gold-deep: it is
     the obvious "use the existing dark gold", it FLIPS to pale #f0c25c on a dark
     design (1.5:1 on a fill that stayed put), and even its light value is 2.9:1
     — just under the bar. A test pinning the current hex would be green against
     that; a test computing the declared pair is not. */
  const lock = bodyOf('.stage__lock');
  assert.ok(lock, 'the .stage__lock rule was not found');
  const ink = /color:\s*(var\(--[\w-]+\)|#[0-9a-f]{3,8})/i.exec(lock);
  const fill = /background:\s*(var\(--[\w-]+\)|#[0-9a-f]{3,8})/i.exec(lock);
  assert.ok(ink && fill, '.stage__lock must declare both its ink and its fill for this to mean anything');

  const failures = [];
  for (const t of THEMES) {
    const ratio = contrast(evaluate(ink[1], t.design), evaluate(fill[1], t.design));
    if (ratio < AA_LARGE) failures.push(`${name(t)} — ${ink[1]} on ${fill[1]} = ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [],
    `the padlock is a non-text graphic and needs ${AA_LARGE}:1 against the seal it sits on`);

  /* And the pair must be scheme-INDEPENDENT, which is the property that makes
     one ratio per design enough.

     Until #1188 this was asserted as "every design agrees on one ratio", which
     was a stronger statement than the guard needed and stopped being true the
     moment a design owned its own gold: Der Tisch's rank family is the
     package's (--gold #f0cf86, --gold-ink #4a3423, 7.74:1) rather than the
     app's #d99a06/#6b3405 at 4.05:1. Both are correct and neither flips.

     So the invariant is restated as what it always meant — read the same
     design's pair under BOTH schemes and require them to agree — which still
     fails on the mistake it was written for. `--gold-deep` is the obvious
     wrong reach and DOES flip (#92400e light, #f0c25c dark), so substituting
     it reddens this per design rather than only in aggregate. */
  const flips = [];
  for (const t of THEMES) {
    /* Only a design that could appear in EITHER scheme — i.e. one whose tokens
       come from styles.css alone. A design with a scheme-gated block of its own
       (#1188) has no light appearance at all, so reading it "under light" would
       resolve tokens the browser would never paint for it, and any difference
       found would be an artefact of the probe rather than a flip. Those designs
       cannot flip by construction: each of the two tokens is declared once, in
       the one block that applies to them. */
    const own = DESIGN_BLOCKS.get(t.design.id);
    if (own && own.scheme) continue;
    const under = (dark) => contrast(
      evaluate(ink[1], { ...t.design, scheme: dark ? 'dark' : 'light' }),
      evaluate(fill[1], { ...t.design, scheme: dark ? 'dark' : 'light' })).toFixed(2);
    if (under(false) !== under(true)) flips.push(`${name(t)} (${under(false)} light / ${under(true)} dark)`);
  }
  assert.ok(THEMES.length - flips.length > 5, 'too few designs reached the flip check — it is going vacuous');
  assert.deepEqual(flips, [],
    'the seal is one fill in both schemes, so neither half of the pair may follow the scheme');
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
  ['.gd-score .score-info', 'on its own translucent-black scrim over box art, like .gd-img__edit'],
  ['.gd-score .score-info:hover, .gd-score .score-info:focus-visible',
    'the same scrim, deepened — still not on a theme surface'],
  ['.vote-qr__code',
    'a QR code MUST be dark-on-light or a camera refuses it, so this one surface '
    + 'deliberately does not follow the round\'s design (#1170)'],
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

/* `--placeholder` is a fallback GLYPH tone — the icon on an empty image box, and
   nothing that is read as prose. `.result-people__label` had been drawing the
   results screen's „TEILGENOMMEN" line in it, i.e. all but invisible (1.07:1 on
   a light design), and the dark scheme is what surfaced it.

   #938 took the token from 18.5% to 45% (and #1140 to 53% on a dark design), so
   „far too faint to read" is no longer why this rule holds — at 45% it still
   falls short of AA for text (3.23:1 worst case against --surface, against a 4.5
   bar), and the rule now stands on what the
   token is FOR rather than on how invisible it happens to be. Keep it that way:
   a future retune that did clear 4.5 would still be the wrong tone for a label.

   The exemptions are the boxes the token is actually for. Each must still be a
   glyph container, never a run of text. */
const PLACEHOLDER_GLYPHS = new Set([
  '.session-card__img', '.game-card__img', '.feed-item__img', '.e-tile__img',
  '.lookup__thumb--none .ti', '.pool-tile__img',
]);

test('--placeholder paints glyph boxes, never text', () => {
  const offenders = rulesOf(CSS)
    .filter(([, body]) => /(^|[;{\s])color:\s*var\(--placeholder\)/.test(body))
    .map(([sel]) => sel.replace(/\s+/g, ' ').trim())
    .filter((sel) => !PLACEHOLDER_GLYPHS.has(sel));
  assert.deepEqual(offenders, [],
    '--placeholder is a glyph/hairline tone below AA for text — labels need --ink-soft');
});

/* The other half of the same token: it must be VISIBLE where it does paint.

   At 18.5% it was not — a state icon on its --sunken box measured 1.58:1 on a
   light design and 1.44:1 on a dark one, so an empty session/feed/lookup box
   read as blank rather than as "no picture here", and a guest chip's dashed edge
   barely registered as an edge (#938).

   Everything the token paints is a NON-TEXT graphic that carries meaning — a
   state glyph, the dashed boundary that marks a guest, the stand-in lines on a
   theme card — so the bar is SC 1.4.11's 3:1, not AA text contrast. The four
   backgrounds are the ones its call sites actually land on: --sunken (the five
   image boxes, .avatar--guest, the guest add button, a guest's seat on the ring),
   --sunken-soft (that seat under the pointer — it was .guest-chip until #1016
   moved guests onto the ring), and --surface / --page-bg (.theme-card__line,
   which declares no background of its own and shows whichever sits behind the
   picker).

   Measured per design rather than pinned as a percentage, so a new design whose
   page sits differently against --shade fails here instead of shipping a glyph
   nobody can see. */
test('--placeholder clears the 3:1 non-text bar wherever it paints', () => {
  const failures = sweep((t) => [
    ['glyph / dashed edge on --sunken', t.placeholder, t.sunken],
    ['dashed edge on --sunken-soft', t.placeholder, t.sunkenSoft],
    ['theme-card line on --surface', t.placeholder, t.surface],
    ['theme-card line on --page-bg', t.placeholder, t.page],
  ], AA_LARGE);
  assert.deepEqual(failures, [],
    '--placeholder is a meaningful non-text graphic — SC 1.4.11 wants 3:1');
});

test('no --placeholder exemption is stale', () => {
  const using = new Set(rulesOf(CSS)
    .filter(([, body]) => /(^|[;{\s])color:\s*var\(--placeholder\)/.test(body))
    .map(([sel]) => sel.replace(/\s+/g, ' ').trim()));
  const stale = [...PLACEHOLDER_GLYPHS].filter((sel) => !using.has(sel));
  assert.deepEqual(stale, [], `exempted but no longer paints in --placeholder: ${stale.join(', ')}`);
});

/* A <button> does NOT inherit `color` — the UA gives it `buttontext`, which is
   ~black. On a light design that is indistinguishable from --ink, so four rules
   had shipped with `font: inherit` and no `color` and looked perfect; on a dark
   one the account menu's five rows rendered black on a dark surface at 1.40:1.

   `font: inherit` is the tell, because it is only ever written on a form control
   — the one place inheritance has to be asked for. It is not a complete guard
   (a control styled without `font: inherit` is invisible to it), and it cannot
   be: what actually finds these is a contrast sweep over the RENDERED page in a
   dark round, which no jsdom spec can run. It pins the exact shape that bit. */
test('a control that inherits its font inherits its colour too', () => {
  const offenders = rulesOf(CSS)
    .filter(([, body]) => /font:\s*inherit/.test(body) && !/(^|[;{\s])color\s*:/.test(body))
    .map(([sel]) => sel.replace(/\s+/g, ' ').trim());
  assert.deepEqual(offenders, [],
    'these take the UA\'s buttontext (~black), which is unreadable on a dark design');
});

// --- die Tafel's score fill (#1056) -----------------------------------------

/* The result row IS its own bar: a `::before` whose width is the Spielwirbel-
   Score and whose colour is a tint of `scoreColor()` over the surface. So the
   whole 0-5 ramp lands under the row's own text, on every design — and unlike
   the stamp's, this ground is under `--ink` AND `--ink-soft` at ordinary body
   size, which is the 4.5:1 bar rather than 3:1.

   The alpha is read out of the sheet rather than restated, so tightening the
   tint is what this test measures. It is also what SETS the ceiling: raise it
   until this goes red and you have found the maximum the ramp allows.

   `.tafel-top .trow` tints from `--gold` instead — one colour, not a ramp, but
   at a higher alpha, so it is measured separately. */
test('the row fill is mixed in CSS from the accent the view hands over', () => {
  const fill = bodyOf('.trow::before');
  assert.ok(fill, '.trow::before is gone — the sweeps below measure nothing');
  assert.match(fill, /background:\s*color-mix\(in oklab, var\(--fill-tint\) var\(--fill-a\),\s*var\(--surface\)\)/,
    'the fill must be a tint of the row accent over --surface, or the sweeps measure the wrong ground');
});

/* Reads the alpha off whichever `.trow` rule declares it — `.trow` is declared
   three times (phone, base, one-line) and only one carries the token. */
const fillAlpha = (sel) => {
  const bodies = RULES.filter(([s2]) => s2 === sel).map(([, b]) => b);
  const body = bodies.find((b) => /--fill-a:/.test(b));
  assert.ok(body, `${sel} declares no --fill-a`);
  return Number(/--fill-a:\s*(\d+)%/.exec(body)[1]) / 100;
};

test('every score on the 0-5 ramp clears AA as a row fill, under body ink and muted ink alike', () => {
  const alpha = fillAlpha('.trow');
  const failures = [];
  for (const t of THEMES) {
    for (const avg of SWEEP) {
      const ground = mixOklab(avgRgb(avg, t.dark), t.surface, alpha);
      for (const [label, ink] of [['--ink', t.ink], ['--ink-soft', t.inkSoft]]) {
        const ratio = contrast(ink, ground);
        if (ratio < AA_TEXT) failures.push(`${name(t)} ${label} \u00d8${avg.toFixed(1)} = ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures.slice(0, 8), [],
    `${failures.length} pairs fail: the row fill is ${(alpha * 100).toFixed(0)}% of the score colour over --surface; body text on it needs ${AA_TEXT}:1`);
});

test('the winners\' gold fill clears AA too, at its higher alpha', () => {
  const alpha = fillAlpha('.tafel-top .trow');
  const failures = [];
  for (const t of THEMES) {
    const ground = mixOklab(t.gold, t.surface, alpha);
    for (const [label, ink] of [['--ink', t.ink], ['--ink-soft', t.inkSoft]]) {
      const ratio = contrast(ink, ground);
      if (ratio < AA_TEXT) failures.push(`${name(t)} ${label} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [],
    `the winners' rows fill at ${(alpha * 100).toFixed(0)}% --gold over --surface; body text on it needs ${AA_TEXT}:1`);
});

/* The tripwire for the premise above (#1184). Several grounds in this file are
   composited against the STANDARD light --surface because the screens they
   describe — home, the lobby, the account screens — used to be un-themable.
   They are not any more: applyDesign() puts the user's design on <html>, so a
   dark one takes those screens dark everywhere at once.

   Nothing ships today because the only dark user design is `enabled: false`.
   Enabling one is a one-line PR (#1202), and that PR must land these grounds
   with it — so this fails at exactly that moment, naming the design, rather
   than letting a re-derivation nobody remembers slip through a diff that
   changes one boolean. */
test('no ENABLED user design is dark — several grounds above assume home is light', () => {
  const darkEnabled = DESIGN_REGISTRY
    .filter((d) => d.enabled && d.scheme === 'dark')
    .map((d) => d.id);
  assert.deepEqual(darkEnabled, [],
    'a dark user design is now selectable, so the un-themed screens are no longer light: '
    + 're-derive the home tile motif ground (and any sibling compositing against the standard '
    + '--surface) per user design before enabling it');
});

/* The dock's world motif (#1082). The dock is the one element on a phone that is
   on screen every second, which is why the world now reaches it — and it is
   therefore also the one where a motif under the labels is least escapable.

   Measured against the WORLD's --surface, not white. The home tile carries the
   same motif at .16 and clears comfortably because the lobby it sits in is never
   themed; the dock inherits the round's own surface, where .16 lands at 4.44:1
   on Chess — under the bar, and on a LIGHT world rather than one of the dark
   ones the issue expected to bind. */
test('the dock motif leaves its labels over AA on every design', () => {
  const decl = slotBodyFor('[data-world] .dock::before');
  assert.ok(decl, '[data-world] .dock::before is gone — did the dock motif move?');
  const m = /opacity:\s*([\d.]+)/.exec(decl);
  assert.ok(m, `the dock motif declares no opacity: ${decl}`);
  const alpha = Number(m[1]);

  const failures = [];
  for (const t of THEMES) {
    // The motif's densest pixel is a fully covered silhouette, i.e. the accent
    // at the full declared alpha over the dock's --surface.
    const ground = composite(t.brand, t.surface, alpha);
    const ratio = contrast(t.inkSoft, ground);
    if (ratio < AA_TEXT) failures.push(`${name(t)} = ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [],
    `the dock paints its world motif at ${(alpha * 100).toFixed(0)}% --brand over --surface; `
    + `.dock__item is --ink-soft and needs ${AA_TEXT}:1. The issue's .16 lands at 4.44:1 on Chess.`);
});

/* The home round tile's world motif (#1138). The sibling of the dock check
   above, and the host nothing measured: `:is(.theme-card, .round-card)[data-world]::before`
   declares its alpha as `var(--motif-a, <literal>)`, and the LITERAL is reached
   by the home tile alone — every world card in the picker is a poster and
   overrides it (views-round-settings.js sets posters:true for the WELTEN group,
   which is the world registry itself).

   The ground is the thing to get right, and it is not the world's. Home calls
   applyBackground(null), so the lobby stays STANDARD; the tile carries only
   --brand (and data-scheme far enough to fix its emblem's ink), and #904's dark
   block is scoped to :root and .theme-card precisely so a dark round's tile
   does NOT turn dark — "one dark tile in a light lobby would read as a
   patchwork" (views-home.js). So the composite is the world's accent over the
   standard LIGHT --surface, with the standard --ink-soft on top: one ground,
   not one per design. Measuring it per design instead would report a pairing
   the app never paints, which is the trap the backdrop budget in
   test/round-worlds.test.js documents from the other direction.

   That scoping is a premise, so it is pinned below rather than assumed: widen
   the dark block to .round-card and this test's ground is wrong, which should
   be loud.

   #1184 WIDENED IT FROM THE OTHER SIDE, and the pin could not see that. Home is
   still un-themed by any ROUND, but the un-themed surfaces now wear the USER's
   design, so `:root[data-scheme="dark"]` applies on home whenever the account
   has picked a dark one — and the lobby's --surface is then dark, not the
   standard white this test composites against. It is still correct today only
   because no dark user design is ENABLED; the test directly below is the
   tripwire for that, because "the premise is fine for now" is the sentence that
   rots.

   It shipped at .16 from #1082 until #1138, i.e. at 4.44:1 on Chess — under the
   bar, and on a LIGHT world rather than one of the dark ones #1138 was about.
   Same miss, same cause and the same landing value as the dock's .16 above. */
test('the home tile motif leaves its meta line over AA on every world', () => {
  const decl = slotBodyFor(':is(.theme-card, .round-card)[data-world]::before');
  assert.ok(decl, 'the card/tile world motif is gone — did it move?');
  const m = /opacity:\s*var\(--motif-a,\s*([\d.]+)\)/.exec(decl);
  assert.ok(m, `the tile motif declares no --motif-a fallback: ${decl}`);
  const alpha = Number(m[1]);

  // The premise: the lobby, and therefore this tile, is never dark.
  const darkSel = rulesOf(CSS).map(([s]) => s).find((s) => s.includes(':root[data-scheme="dark"]'));
  assert.ok(darkSel, 'the dark token block is gone');
  assert.ok(!/\.round-card/.test(darkSel),
    `the dark block now covers .round-card (${darkSel.trim()}) — the tile can be dark, so this check's ground is stale`);

  const std = DESIGNS.find((d) => d.std);
  assert.ok(std, 'no standard design in the registry — the lobby ground would be a guess');
  const lobby = tokensFor(std);
  const worlds = DESIGNS.filter((d) => d.world);
  // Anti-vacuous: a registry that lost its worlds leaves the loop green over nothing.
  assert.ok(worlds.length >= 7, `only ${worlds.length} worlds — the loop below measures too little`);

  const failures = [];
  for (const w of worlds) {
    // .round-card__last is --ink-soft at --text-sm: normal-size text, AA.
    // The densest pixel is a fully covered silhouette, i.e. the full alpha.
    const ground = composite(tokensFor(w).brand, lobby.surface, alpha);
    const ratio = contrast(lobby.inkSoft, ground);
    if (ratio < AA_TEXT) failures.push(`${w.id} = ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [],
    `the home tile paints its world motif at ${(alpha * 100).toFixed(0)}% of the world's --brand `
    + `over the standard --surface; .round-card__last is --ink-soft and needs ${AA_TEXT}:1. `
    + 'Chess binds: .16 lands at 4.44:1, .14 at 4.61:1.');
});

/* The Freundeskreis cover wash (#1094, on the person TILE since #1136). Unlike
   every fill above it, the layer is an arbitrary USER-FACING IMAGE — a game
   cover — so there is no token to mix with and no average to assume. The honest
   worst case is the extremes: pure black over a light design, pure white over a
   dark one, which is what a very dark or very bright cover approaches.

   Measured at FULL alpha on purpose. The tile's second line wraps to fill the
   tile's width, so it really does reach the far right where the mask is fully
   opaque — the fade buys the text nothing and must not be credited to it.

   This used to carry a third paragraph exempting the card's --accent link
   buttons, which would fail at full alpha (4.03:1 on Salbei) and did not fail in
   fact because the mask had not opened where they sat. #1136 removed the buttons
   with the card: a person tile carries no action at all, so the two ink levels
   below are now the whole of what paints over this layer. */
test('the friend tile\'s cover wash keeps its text over AA, for any cover', () => {
  const decl = bodyOf('.k-tile__art');
  assert.ok(decl, '.k-tile__art is gone — did the wash move?');
  const m = /(^|[\s;])opacity:\s*([\d.]+)/.exec(decl);
  assert.ok(m, `.k-tile__art declares no opacity: ${decl}`);
  const alpha = Number(m[2]);

  const failures = [];
  for (const t of THEMES) {
    for (const [cover, coverName] of [['#000000', 'a black cover'], ['#ffffff', 'a white cover']]) {
      const ground = composite(cover, t.surface, alpha);
      for (const [label, ink] of [['--ink', t.ink], ['--ink-soft', t.inkSoft]]) {
        const ratio = contrast(ink, ground);
        if (ratio < AA_TEXT) failures.push(`${name(t)} ${label} under ${coverName} = ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [],
    `the wash paints a cover at ${(alpha * 100).toFixed(0)}% over --surface; the tile's text needs `
    + `${AA_TEXT}:1. The issue's starting .17 lands at 3.84:1 on Sci-Fi dark — lower the alpha, `
    + 'do not widen this test.');
});

/* The Tischkarte's initials watermark (#1075). It sits in the card's top-right
   corner on top of the wash, and the SIZE is what keeps it off the text — both
   sizes were measured against the painted ink of every label, figure, chip and
   ribbon and are written into the stylesheet beside the rule.

   One thing can still reach it and does: a very long NAME at 1280px, which is
   `--ink`. So that is what this checks — and `--ink-soft` deliberately is not,
   because no --ink-soft surface overlaps the mark at the shipped sizes.

   Worth knowing before reading the number: the card's radial peak ALREADY
   measures 3.26:1 for --ink-soft with no watermark at all. That is #1074's own
   reason the corner carries no text; it is not something this added, and it is
   why a naive "every ink over the densest pixel" sweep here would fail on
   shipped code and tempt someone to lighten the wrong thing.

   BE HONEST ABOUT WHAT THIS CAN SEE. `--ink` is very dark, so the bar is not
   reached until roughly .5 alpha — measured: .30 still passes at 5.67:1, .50
   fails at 4.36:1. So this catches a watermark turned into a BLOCK, not one
   nudged a few points up. What really bounds the alpha here is taste and the
   geometry above, neither of which a contrast test can hold; the number that
   ships is the issue's, and the sizes beside it are the measured half. */
test('the Tischkarte watermark leaves the name legible over it', () => {
  const body = bodyOf('.member-card__mark');
  assert.ok(body, '.member-card__mark is gone — did the watermark move?');
  const m = /opacity:\s*([\d.]+)/.exec(body);
  assert.ok(m, `the watermark declares no opacity: ${body}`);
  const alpha = Number(m[1]);

  const failures = [];
  for (const t of THEMES) {
    for (const tone of MEMBER_COLORS) {
      // The card: a 13% linear wash, then the 26% radial at its densest, then
      // the watermark on top — all of them the member's own tone.
      const base = mixOklab(tone, t.surface, 0.13);
      const wash = mixOklab(tone, base, 0.26);
      const ground = composite(tone, wash, alpha);
      const ratio = contrast(t.ink, ground);
      if (ratio < AA_TEXT) failures.push(`${name(t)} on ${tone} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures.slice(0, 6), [],
    `the watermark paints the member tone at ${(alpha * 100).toFixed(0)}% over the card's wash; `
    + `the name (--ink) can overlap it at 1280px and needs ${AA_TEXT}:1`);
});

/* Die Spielerkarte's wash (#1132). The card is `.member-card`'s frame shared by
   selector, and it paints the account's own palette colour at 13% under the
   text — but where the Tischkarte's text is `--ink` throughout, this one carries
   a MUTED meta line („Mitglied seit … · 3 Runden · 9 Spiele"), so `--ink-soft`
   on that wash is a bar the member page never had to clear.

   It does clear it, and not by much: the worst pair over every design and every
   palette tone measures 4.82:1 against the 4.5 bar. That is why the line stays
   at the LINEAR wash's strength — the radial peak measures 3.26:1 for the same
   ink, which is #1074's own reason the card's top-right corner carries no text
   and is not something this added. Moving the meta line up into that corner, or
   deepening the 13%, re-opens this.

   `--ink` is measured beside it so the figure strip's labels are covered by the
   same sweep rather than by inheritance from the member page's own test. */
test('the Spielerkarte\'s wash keeps its muted meta line over AA, in every account colour', () => {
  const body = bodyOfIn('.profile-card', rulesOf(topLevel()));
  assert.ok(body, '.profile-card no longer shares the card frame — re-measure the wash it has now');
  const mix = /color-mix\(in oklab, var\(--m-tone\) (\d+)%, var\(--surface\)\)/.exec(body);
  assert.ok(mix, `the card's linear wash is not a --m-tone/--surface mix: ${body}`);
  const alpha = Number(mix[1]) / 100;

  const failures = [];
  for (const th of THEMES) {
    for (const tone of MEMBER_COLORS) {
      const wash = mixOklab(tone, th.surface, alpha);
      for (const [label, ink] of [['--ink', th.ink], ['--ink-soft', th.inkSoft]]) {
        const ratio = contrast(ink, wash);
        if (ratio < AA_TEXT) failures.push(`${name(th)} ${label} on ${tone} = ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures.slice(0, 6), [],
    `the card washes the account's tone at ${(alpha * 100).toFixed(0)}% under its meta line; `
    + `the muted ink needs ${AA_TEXT}:1. Lower the alpha, do not widen this test.`);
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

/* ---- #1140: the control edge, and the dark neutral ramp ------------------

   On a dark design --line resolved BETWEEN the page and --surface (7% against
   --surface's 9%), so a chip's border measured 1.05:1 against the chip's own
   fill — the boundary that identifies the control separated it from nothing.
   Two tokens came out of that: --control-edge carries SC 1.4.11's 3:1 for the
   ~25 borders that identify a control, and --control-fill gives a control on a
   dark design a tone of its own instead of repeating its parent's --surface.

   Every rule whose border identifies an interactive control. .vote and
   .rec-undone are deliberately NOT here although both drew a --line border in
   the issue's grep: each is a <div> container (the voting card, a dismissed-
   recommendation status row), and 1.4.11 binds a boundary only where it
   identifies a control. Add a selector here when you add a control — that is
   what stops a new one quietly taking the structural hairline. */
const CONTROL_RULES = [
  '.chip', '.tag-mode__opt', '.btn', '.input, .select', '.sort-select',
  '.search-pill', '.fbar__trigger', '.stepper__btn', '.stepper__val',
  '.icon-picker__trigger', '.icon-picker__btn', '.mood', '.opt-card',
  '.theme-card', '.game-card__pick', '.winner-chip',
  '.team-chip', '.tables-seat', '.lang-picker', '.topbar__acct',
  '.landing-chip', '.paste-zone', '.cover-pick',
  '.nr-seat--out .nr-seat__avatar',
];

test('every control rule still exists — otherwise the scan below guards nothing', () => {
  const missing = CONTROL_RULES.filter((sel) => !bodyOf(sel) && !slotBodyFor(sel));
  assert.deepEqual(missing, [],
    'renamed or deleted; re-point CONTROL_RULES or the border scan passes vacuously');
  assert.ok(CONTROL_RULES.length >= 20, 'the control list has been gutted');
});

/* The scan enumerates the CALL SHAPES a border is written in, not just the
   token — `.claude/rules/source-scanning-guards-enumerate-shapes.md`. This
   sheet spells a control's edge four ways: the `border:` shorthand at 1px,
   1.5px and 2px, `2px dashed`, and `border-color:` on a state rule. A pattern
   anchored to `border:` alone would pass over the dashed and border-color
   forms while looking exhaustive.

   Proven by reverting .mood's border to var(--line) on purpose: this test goes
   red naming .mood, and its sibling below stays green. */
test('no interactive control draws its edge with the structural --line', () => {
  const BORDER = /\bborder(?:-(?:color|top|right|bottom|left|inline|block)[\w-]*)?\s*:[^;]*var\(--line\)/;
  const offenders = CONTROL_RULES
    .filter((sel) => BORDER.test(bodyOf(sel) || slotBodyFor(sel) || ''))
    .map((sel) => `${sel} — border still var(--line)`);
  assert.deepEqual(offenders, [],
    '--line is the ~1.4:1 structural hairline; a control boundary needs --control-edge at 3:1');
});

test('every control rule actually declares --control-edge — the scan above is not satisfied by deleting the border', () => {
  const without = CONTROL_RULES
    .filter((sel) => !/var\(--control-edge\)/.test(bodyOf(sel) || slotBodyFor(sel) || ''));
  assert.deepEqual(without, [], 'declares no --control-edge border at all');
});

test('--control-edge clears the 3:1 non-text bar on both grounds, on every design', () => {
  const failures = sweep((t) => [
    ['control edge on its own fill (--control-fill)', t.controlEdge, t.controlFill],
    ['control edge on the card behind it (--surface)', t.controlEdge, t.surface],
    ['control edge on the page (--page-bg)', t.controlEdge, t.page],
  ], AA_LARGE);
  assert.deepEqual(failures, [],
    'a border that identifies a control is a meaningful non-text graphic — SC 1.4.11 wants 3:1');
});

/* The three neutral tones, measured against the ground each one actually sits
   on, with the LIGHT designs' shipped ratios as the bar. Pinning a ratio rather
   than a percentage is the point: light is the half that was always right, so a
   dark design is asked to reach what light already ships instead of hitting a
   number somebody typed. All three ran at 1.04–1.15 on dark before #1140. */
// A hair under each light minimum (1.37 / 1.25 / 1.20, all on chess), so the
// design that DEFINES the floor is not sitting on a rounding boundary. The
// gap to what this replaced is two orders of slack either way: every dark
// design measured 1.04-1.15 before #1140.
const LIGHT_FLOOR = { line: 1.36, sunken: 1.24, sunkenSoft: 1.19 };

test('the dark neutral ramp separates from --surface as well as the light one does', () => {
  const failures = [];
  for (const t of THEMES) {
    for (const [key, label] of [['line', '--line'], ['sunken', '--sunken'], ['sunkenSoft', '--sunken-soft']]) {
      const ratio = contrast(t[key], t.surface);
      if (ratio < LIGHT_FLOOR[key]) failures.push(`${name(t)} — ${label} on --surface = ${ratio.toFixed(2)}:1 (floor ${LIGHT_FLOOR[key]})`);
    }
  }
  assert.deepEqual(failures, [],
    'on a dark design --surface is a lift off the page, so a tone mixed at the light percentage lands on top of it');
});

test('the dark ramp keeps its ORDER — soft, sunken, line, edge, each a real step off the page', () => {
  const failures = [];
  for (const t of THEMES) {
    const steps = [t.sunkenSoft, t.sunken, t.line, t.controlEdge].map((c) => contrast(c, t.page));
    const sorted = steps.every((v, i) => i === 0 || v >= steps[i - 1]);
    if (!sorted) failures.push(`${name(t)} — off the page: ${steps.map((v) => v.toFixed(2)).join(' < ')}`);
  }
  assert.deepEqual(failures, [],
    'the names describe an ordering; on dark the tones run upward, but soft must still be the shallowest');
});

test('a control never repeats its parent card exactly — --control-fill is a real step on every design', () => {
  const failures = [];
  for (const t of THEMES) {
    // Light keeps the white-on-white pair on purpose: there the 3:1 border IS
    // the boundary, and moving it would restyle every light design. What must
    // never happen is a dark design where BOTH are identical, i.e. no boundary
    // at all beyond a border that used to be 1.05:1.
    const same = toHex(t.controlFill) === toHex(t.surface);
    if (t.dark && same) failures.push(`${name(t)} — --control-fill is exactly --surface (${toHex(t.surface)})`);
  }
  assert.deepEqual(failures, [], 'a dark control needs its own tone, not its parent repeated');
});

/* Raising the resting edge to 3:1 silently inverts the hover affordance, and
   nothing else would have caught it: --brand-edge measures 1.39-1.95:1 against a
   control's fill, so a control resting at 3.1-3.7 would have got FAINTER under
   the pointer. Five controls (.mood, .winner-chip, .cover-pick and the two
   focus rules) already moved to --brand; the other nine now do too.

   Measured rather than pinned as "never --brand-edge": the decision is "hover is
   at least as strong as rest", and a future token could satisfy it differently. */
test('hovering a control never WEAKENS its edge', () => {
  const HOVER_TOKENS = { '--brand': 'brand', '--brand-edge': 'brandEdge', '--control-edge': 'controlEdge' };
  /* A FILLED variant (.btn--primary, .chip.is-on) repaints its own ground, so
     its hover border is measured against --brand rather than --control-fill and
     is not this test's business. Detect that from the variant's own rule instead
     of listing them: anything that declares a background other than
     --control-fill has left the plain-control case behind. */
  const repainted = new Set(rulesOf(CSS)
    .filter(([, body]) => /(^|[;{\s])background(?:-color)?:\s*var\((?!--control-fill)/.test(body))
    .map(([sel]) => sel.trim()));
  const base = (sel) => sel.trim().replace(/:(?:hover|focus|focus-within|not)\b.*$/, '');
  const hovers = rulesOf(CSS)
    .filter(([sel]) => /:(?:hover|focus|focus-within)\b/.test(sel)
      && CONTROL_RULES.some((c) => base(sel).startsWith(c.split(',')[0]))
      && !repainted.has(base(sel)))
    .map(([sel, body]) => [sel.trim(), /border-color:\s*var\((--[\w-]+)\)/.exec(body)])
    .filter(([, m]) => m);
  assert.ok(hovers.length >= 9, `only ${hovers.length} control hover borders found — has the scan drifted?`);

  const failures = [];
  for (const [sel, m] of hovers) {
    const key = HOVER_TOKENS[m[1]];
    assert.ok(key, `${sel} hovers to ${m[1]} — add it to HOVER_TOKENS so it can be measured`);
    for (const t of THEMES) {
      const rest = contrast(t.controlEdge, t.controlFill);
      const hot = contrast(t[key], t.controlFill);
      if (hot < rest) failures.push(`${name(t)} — ${sel} ${hot.toFixed(2)}:1 < resting ${rest.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures.slice(0, 6), [], 'the hover border is fainter than the resting one');
});


// --- a design's OWN colour tokens (#1188) ------------------------------------
/* Everything above measures the tokens styles.css declares. A design may also
   declare tokens of its own — Der Tisch's felt, its paper overlay family and
   its score ramp — and those are resolvable by `token()` but belong to no pair
   any sweep above knows about. Measured here by name, and then the coverage
   guard below asserts that NO design token is left out of this section.

   Written as "the design that declares it" rather than "Tisch", so a second
   design declaring `--paper` is measured for free and one that declares
   something new fails the coverage guard instead of shipping unmeasured. */
const { token, DESIGN_BLOCKS } = require('./support/theme');

const declares = (t, name) => {
  const block = DESIGN_BLOCKS.get(t.design.id);
  return Boolean(block && new RegExp(`(?:^|[;{\\s])${name}:`).test(block.all));
};
const withToken = (name) => THEMES.filter((t) => declares(t, name));

/* The VALUE a design declares for a token, as written. `token()` resolves a
   colour; this is for the two cases where the text itself is the subject — an
   alpha the resolver has no ground to composite against. */
const declaredIn = (t, name) => {
  const block = DESIGN_BLOCKS.get(t.design.id);
  const m = block && new RegExp(`(?:^|[;{\\s])${name}:\\s*([^;}]+)`).exec(block.all);
  return m ? m[1].trim() : null;
};

/* `rgba(r, g, b, a)` -> [[r, g, b], a]. Deliberately NOT alphaOf(), which reads
   a `color-mix(… , transparent)`: the compositing alphas in a design sheet are
   written as rgba literals (the --cast and --brass-sheen families), so a mix
   parser would assert on every one of them. */
const rgbaParts = (expr) => {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/.exec(expr);
  assert.ok(m, `${expr} is not an rgba() literal`);
  return [[+m[1], +m[2], +m[3]], m[4] === undefined ? 1 : +m[4]];
};

test('a design that declares a PAPER overlay family keeps every pair on it at AA', () => {
  /* An overlay in Der Tisch is a printed card on a wood table, so `.sheet`,
     `.dialog`, `.popover` and `.menu` re-point --surface/--ink/--control-* at
     this family. That re-point lives on a component rule, which the resolver
     cannot follow — so the pairs are measured here, against the tokens the
     rule points at. Keep this in step with that rule in tisch.css. */
  const hosts = withToken('--paper');
  assert.ok(hosts.length >= 1, 'no design declares --paper — this test is vacuous');
  const failures = [];
  for (const t of hosts) {
    const v = (n) => token(n, t.design);
    const pairs = [
      ['--paper-ink on --paper', v('--paper-ink'), v('--paper'), AA_TEXT],
      ['--paper-ink on --paper-raised', v('--paper-ink'), v('--paper-raised'), AA_TEXT],
      ['--paper-ink-soft on --paper', v('--paper-ink-soft'), v('--paper'), AA_TEXT],
      ['--paper-ink-soft on --paper-raised', v('--paper-ink-soft'), v('--paper-raised'), AA_TEXT],
      // Review finding A4 — the tertiary ink on the RAISED paper is the one
      // that measured 4.23:1 in the package.
      ['--paper-faint on --paper-raised', v('--paper-faint'), v('--paper-raised'), AA_TEXT],
      /* There is deliberately no `--paper-on-accent`. The ink on a saturated
         fill is a property of the fill, not of the ground behind it — brass is
         light on paper exactly as on wood — so the overlay leaves --on-accent
         alone and the global sweep above already covers that pair. Adding one
         measured 1.97:1, which is how the absence became deliberate. */
      // …and the control edge has to identify a control against both paper grounds.
      ['--paper-edge on --paper', v('--paper-edge'), v('--paper'), AA_LARGE],
      ['--paper-edge on --paper-raised', v('--paper-edge'), v('--paper-raised'), AA_LARGE],
      /* #1195: the rest of the overlay's re-point. The two status inks are
         text on every paper ground an overlay has — including --paper-sunken,
         which is now what --sunken/--sunken-soft resolve to inside one (a chip
         ground, the close disc). --warn and --accent take --paper-faint, so
         that token is measured on the two new grounds as well. */
      ...['--paper', '--paper-raised', '--paper-sunken'].flatMap((g) => [
        [`--paper-good on ${g}`, v('--paper-good'), v(g), AA_TEXT],
        [`--paper-danger on ${g}`, v('--paper-danger'), v(g), AA_TEXT],
        [`--paper-ink on ${g}`, v('--paper-ink'), v(g), AA_TEXT],
        [`--paper-ink-soft on ${g}`, v('--paper-ink-soft'), v(g), AA_TEXT],
      ]),
      ['--paper-faint on --paper', v('--paper-faint'), v('--paper'), AA_TEXT],
      ['--paper-faint on --paper-sunken', v('--paper-faint'), v('--paper-sunken'), AA_TEXT],
      // --brand-tint resolves to --gold-hi inside an overlay: the menu's hover.
      ['--paper-ink on --gold-hi', v('--paper-ink'), v('--gold-hi'), AA_TEXT],
      // The destructive button: paper on the red fill, and the fill itself has
      // to identify the control against the paper (SC 1.4.11), since its rim is
      // decorative.
      ['--paper-danger-ink on --paper-danger', v('--paper-danger-ink'), v('--paper-danger'), AA_TEXT],
      ['--paper-danger on --paper', v('--paper-danger'), v('--paper'), AA_LARGE],
    ];
    for (const [label, fg, bg, bar] of pairs) {
      const ratio = contrast(fg, bg);
      if (ratio < bar) failures.push(`${name(t)} — ${label} = ${ratio.toFixed(2)}:1 (bar ${bar})`);
    }
  }
  assert.deepEqual(failures, [], 'the overlay inverts the scheme on a subtree; its pairs get the same bars');
});

test('Der Tisch\'s editor rows keep their marks and a red label legible under the pointer (#1273)', () => {
  /* T15a's form rows (tisch.css „Rows"): a row that is a button lifts to
     --brand-tint on hover, which the overlay re-points at --gold-hi. The row's
     icon and the owners' state tick are --paper-faint (non-text, 3:1), and the
     cover editor's „Bild entfernen" row writes its label in --danger, i.e.
     --paper-danger inside an overlay (text, 4.5:1). Their RESTING grounds are
     --paper-raised, which the paper-family test above already holds. */
  const hosts = withToken('--paper');
  assert.ok(hosts.length >= 1, 'no design declares --paper — this test is vacuous');
  const failures = [];
  for (const t of hosts) {
    const v = (n) => token(n, t.design);
    for (const [label, fg, bg, bar] of [
      ['--paper-faint on --gold-hi (row icon / tick, hovered)', v('--paper-faint'), v('--gold-hi'), AA_LARGE],
      ['--paper-danger on --gold-hi (destructive row, hovered)', v('--paper-danger'), v('--gold-hi'), AA_TEXT],
      ['--paper-faint on --paper-raised (row icon / tick)', v('--paper-faint'), v('--paper-raised'), AA_LARGE],
    ]) {
      const ratio = contrast(fg, bg);
      if (!(ratio >= bar)) failures.push(`${name(t)} — ${label} = ${ratio.toFixed(2)}:1 (bar ${bar})`);
    }
  }
  assert.deepEqual(failures, []);
});

test('Der Tisch\'s hub tiles keep their figures and labels at AA on the grounds they sit on (#1262/#1263)', () => {
  /* The Rundenpuls stat tiles paint a number in --ink and a label in --ink-soft
     on --sunken; the off-shelf count tiles paint name and count in --ink on
     --surface with a gold glyph, a non-text mark (SC 1.4.11, 3:1). The seat
     captions and badges sit on the felt and on paper, whose pairs the two tests
     beside this one already hold. Measured for every design that declares the
     felt, i.e. every design that wears these tiles. */
  const hosts = withToken('--felt');
  assert.ok(hosts.length >= 1, 'no design declares --felt — this test is vacuous');
  const failures = [];
  for (const t of hosts) {
    const v = (n) => token(n, t.design);
    for (const [label, fg, bg, bar] of [
      ['--ink on --sunken (tile figure)', v('--ink'), v('--sunken'), AA_TEXT],
      ['--ink-soft on --sunken (tile label)', v('--ink-soft'), v('--sunken'), AA_TEXT],
      ['--ink on --surface (count tile)', v('--ink'), v('--surface'), AA_TEXT],
      ['--gold on --surface (tile glyph)', v('--gold'), v('--surface'), AA_LARGE],
    ]) {
      const ratio = contrast(fg, bg);
      if (!(ratio >= bar)) failures.push(`${name(t)} — ${label} = ${ratio.toFixed(2)}:1 (bar ${bar})`);
    }
  }
  assert.deepEqual(failures, []);
});

test('Der Tisch\'s app chrome keeps the plate, the kicker and the account name at AA (#1279)', () => {
  /* The top bar is walnut (--wood-deep) under Der Tisch; the wordmark sits on
     the brass plate (a --brass-hi → --gold-deep gradient, so both stops are
     measured); the lobby kicker is --ink-soft both in the bar and, on a phone,
     on the page; the account name is --ink on the button's --control-fill. */
  const hosts = withToken('--wood-deep').filter((t) => declares(t, '--brass-hi'));
  assert.ok(hosts.length >= 1, 'no design declares the walnut bar and the brass plate — this test is vacuous');
  const failures = [];
  for (const t of hosts) {
    const v = (n) => token(n, t.design);
    for (const [label, fg, bg] of [
      ['plate --on-accent on --brass-hi', v('--on-accent'), v('--brass-hi')],
      ['plate --on-accent on --gold-deep', v('--on-accent'), v('--gold-deep')],
      ['bar kicker --ink-soft on --wood-deep', v('--ink-soft'), v('--wood-deep')],
      ['lobby kicker --ink-soft on --page-bg', v('--ink-soft'), v('--page-bg')],
      ['account name --ink on --control-fill', v('--ink'), v('--control-fill')],
    ]) {
      const ratio = contrast(fg, bg);
      if (!(ratio >= AA_TEXT)) failures.push(`${name(t)} — ${label} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, []);
});

test('the Chronik session strip keeps its date column at AA on wood and on paper (#1271)', () => {
  /* The strip's date column changes ground with the width (tisch.css): on a
     desktop it stands on the walnut PAGE beside the paper and takes --gold; on
     a phone it moves INTO the paper, where the day is the paper ink and the
     month --accent-deep. The strip re-points --ink on a component rule the
     resolver cannot follow, so each pair is named here. The folded
     shelf-change run's dashed --gold-edge rim is the only thing marking it as a
     control on the wood (SC 1.4.11). */
  const hosts = withToken('--paper');
  assert.ok(hosts.length >= 1, 'no design declares --paper — this test is vacuous');
  const failures = [];
  let checked = 0;
  for (const t of hosts) {
    const v = (n) => token(n, t.design);
    for (const [label, fg, bg, bar] of [
      ['date --gold on --page-bg', v('--gold'), v('--page-bg'), AA_TEXT],
      ['day --paper-ink on --paper', v('--paper-ink'), v('--paper'), AA_TEXT],
      ['day --paper-ink on --paper-raised', v('--paper-ink'), v('--paper-raised'), AA_TEXT],
      ['month --accent-deep on --paper', v('--accent-deep'), v('--paper'), AA_TEXT],
      ['month --accent-deep on --paper-raised', v('--accent-deep'), v('--paper-raised'), AA_TEXT],
      ['run rim --gold-edge on --page-bg', v('--gold-edge'), v('--page-bg'), AA_LARGE],
    ]) {
      checked++;
      const ratio = contrast(fg, bg);
      // `!(ratio >= bar)`, not `ratio < bar`: a NaN from a wrong-shaped token
      // must fail here rather than pass (nan-passes-every-threshold-guard.md).
      if (!(ratio >= bar)) failures.push(`${name(t)} — ${label} = ${ratio.toFixed(2)}:1 (bar ${bar})`);
    }
  }
  assert.ok(checked >= 6, 'no strip pair was measured');
  assert.deepEqual(failures, [], 'the Chronik strip\'s date column and run rim must clear their bars');
});

test('a design that declares a FELT keeps its own ink on it, and keeps the accent off it below 24px', () => {
  /* Review finding A1, as a measurement rather than as prose. Gold on the light
     stop of Tannenfilz is 4.20:1, so gold is a DISPLAY colour on felt and text
     under 24px uses --felt-ink. Both halves are asserted: the paper ink clears
     AA, and the accent is checked only against the large-text bar — if it ever
     cleared AA_TEXT the rule could be relaxed, and if it drops under AA_LARGE
     it cannot even be a heading. */
  const hosts = withToken('--felt');
  assert.ok(hosts.length >= 1, 'no design declares --felt — this test is vacuous');
  const failures = [];
  for (const t of hosts) {
    const v = (n) => token(n, t.design);
    // The LIGHT stop is the critical ground: the felt is a gradient down to
    // --felt-deep, so anything clearing the light end clears the whole sweep.
    for (const [label, fg, bar] of [
      ['--felt-ink', v('--felt-ink'), AA_TEXT],
      ['--felt-ink-soft', v('--felt-ink-soft'), AA_TEXT],
      /* The display carve-out is GOLD and only gold. --brand is measured here
         too and is NOT in this list on purpose: brass on Tannenfilz is 2.93:1,
         below even the large-text bar, so the accent has no place on the table
         surface at any size. That is why the felt family carries its own ink
         and its own active-chip fill (finding A3) instead of borrowing the
         accent, and it is a finding beyond the review — A1 measured gold on
         felt and nobody measured brass. */
      ['--gold as display type only', v('--gold'), AA_LARGE],
    ]) {
      const ratio = contrast(fg, v('--felt'));
      if (ratio < bar) failures.push(`${name(t)} — ${label} on --felt = ${ratio.toFixed(2)}:1 (bar ${bar})`);
    }
    // Finding A3: an ACTIVE chip on felt darkens until it carries the felt ink.
    const chip = contrast(v('--felt-ink'), v('--felt-chip-on'));
    if (chip < AA_TEXT) failures.push(`${name(t)} — --felt-ink on --felt-chip-on = ${chip.toFixed(2)}:1`);

    /* The WEAVE the felt is ruled with (#1189), composited over the light stop
       — which is the pixel a glyph actually lands on, and the reason this is
       measured rather than excluded as decoration. The package's own weave is
       white at 3.5%, and on that grained pixel --felt-ink-soft measures 4.43:1:
       under AA, from a gradient nobody thinks of as a colour. A darkening weave
       can only ADD contrast for a light ink, so it is also what keeps the three
       ungrained pairs above the worst case. */
    const grain = declaredIn(t, '--felt-grain');
    if (grain) {
      const [tone, alpha] = rgbaParts(grain);
      const ruled = composite(tone, v('--felt'), alpha);
      for (const [label, fg, bar] of [
        ['--felt-ink', v('--felt-ink'), AA_TEXT],
        ['--felt-ink-soft', v('--felt-ink-soft'), AA_TEXT],
        ['--gold as display type only', v('--gold'), AA_LARGE],
      ]) {
        const ratio = contrast(fg, ruled);
        if (ratio < bar) failures.push(`${name(t)} — ${label} on the RULED felt = ${ratio.toFixed(2)}:1 (bar ${bar})`);
      }
    }
  }
  assert.deepEqual(failures, [], 'text on the table surface is the design\'s own ink, never its accent');
});

test('a design that declares a brass PLATE carries its ink and its rim on it', () => {
  /* #1189. The plate is the design's one "this is the thing itself" surface —
     the hub CTA, the active rail row, the active dock entry, a round's name on
     its table — and it is a GRADIENT from --brass-hi down to --brand, so the
     ink has to clear the light stop as well as the accent the global sweep
     already covers. The rim is a boundary that identifies a control, so it
     takes SC 1.4.11's 3:1 rather than the text bar. */
  const hosts = withToken('--brass-hi');
  assert.ok(hosts.length >= 1, 'no design declares --brass-hi — this test is vacuous');
  const failures = [];
  for (const t of hosts) {
    const v = (n) => token(n, t.design);
    for (const [label, fg, bg, bar] of [
      ['--on-accent on --brass-hi', v('--on-accent'), v('--brass-hi'), AA_TEXT],
      ['--gold-edge on --brass-hi (the rim)', v('--gold-edge'), v('--brass-hi'), AA_LARGE],
    ]) {
      const ratio = contrast(fg, bg);
      if (ratio < bar) failures.push(`${name(t)} — ${label} = ${ratio.toFixed(2)}:1 (bar ${bar})`);
    }
  }
  assert.deepEqual(failures, [], 'the plate gradient must carry one ink across both of its stops');
});

test('a design that declares a deep ACCENT measures it where it is used: on paper', () => {
  /* #1189. T1's Zinnober is „laufende Abstimmung, Gefahr, Marke", and the
     surface it labels is the „Abstimmung läuft" card, which is PAPER laid on
     the table. So it is measured against the paper family and not against the
     page — the light member of the same hue (--danger) is the one that goes on
     wood, and the global sweep already covers that. Getting the two the wrong
     way round is legible in neither place. */
  const hosts = withToken('--accent-deep');
  assert.ok(hosts.length >= 1, 'no design declares --accent-deep — this test is vacuous');
  const failures = [];
  for (const t of hosts) {
    const v = (n) => token(n, t.design);
    for (const [label, bg] of [['--paper', v('--paper')], ['--paper-raised', v('--paper-raised')]]) {
      const ratio = contrast(v('--accent-deep'), bg);
      if (ratio < AA_TEXT) failures.push(`${name(t)} — --accent-deep on ${label} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], 'the deep accent is a kicker on paper, so it takes the text bar there');
});

test('a design that declares its own SCORE ramp carries a legible number on every stop', () => {
  /* T8.2. The ramp is six fills — a veto tone below 1, then the five tile
     values — each with the ink its half of the ramp takes. */
  const hosts = withToken('--score-1');
  assert.ok(hosts.length >= 1, 'no design declares a score ramp — this test is vacuous');
  const failures = [];
  for (const t of hosts) {
    const v = (n) => token(n, t.design);
    const stops = [
      ['--score-veto', v('--score-veto'), v('--score-veto-ink')],
      ['--score-1', v('--score-1'), v('--score-ink-low')],
      ['--score-2', v('--score-2'), v('--score-ink-low')],
      ['--score-3', v('--score-3'), v('--score-ink-high')],
      ['--score-4', v('--score-4'), v('--score-ink-high')],
      ['--score-5', v('--score-5'), v('--score-ink-high')],
    ];
    for (const [label, fill, ink] of stops) {
      const ratio = contrast(ink, fill);
      if (ratio < AA_TEXT) failures.push(`${name(t)} — ${label} = ${ratio.toFixed(2)}:1`);
    }
    /* And the ramp must be ORDERED by lightness, which is what carries it for a
       colour-blind reader (T8.3 simulates deuteran/protan/tritan and relies on
       exactly this). Asserted on luminance, where the CVD simulation's own
       point is that hue may not be. */
    const ls = ['--score-1', '--score-2', '--score-3', '--score-4', '--score-5'].map((n) => luminance(v(n)));
    for (let i = 1; i < ls.length; i += 1) {
      if (ls[i] <= ls[i - 1]) failures.push(`${name(t)} — the ramp does not brighten from ${i} to ${i + 1}`);
    }
  }
  assert.deepEqual(failures, [], 'the score ramp is read by its number and by its lightness');
});

test('a design that declares a BAR ramp carries every rung on paper and on the gold row', () => {
  /* T8.2's other half (#1191), and the sheet is explicit that there are two:
     „Die Score-Rampe bleibt zweigeteilt (Pillen hell steigend mit wechselnder
     Tinte, Balken dunkler für Papier)". A pill carries its own ink and may be
     pale; a bar is drawn ON a ground and has to read against it.

     Three grounds, because a distribution column appears on all three: the
     Tafel's two paper stops and — on the WINNING row — the gold. The gold is
     the tight one and it is the reason two of the package's five stops were
     corrected; measuring only against paper would have passed both. */
  const hosts = withToken('--bar-1');
  assert.ok(hosts.length >= 1, 'no design declares a bar ramp — this test is vacuous');
  const failures = [];
  for (const t of hosts) {
    const v = (n) => token(n, t.design);
    for (const ground of ['--paper', '--paper-raised', '--gold']) {
      for (let n = 1; n <= 5; n += 1) {
        const ratio = contrast(v(`--bar-${n}`), v(ground));
        // AA_LARGE is the 3:1 bar; a bar and its axis glyph are graphical
        // objects (SC 1.4.11), not type. The numeral under them is --ink-soft
        // and is covered by the paper pairs above.
        if (ratio < AA_LARGE) failures.push(`${name(t)} — --bar-${n} on ${ground} = ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], 'a distribution bar must read on paper AND on the gold winning row');

  /* And this ramp is deliberately NOT asserted to brighten monotonically, which
     is the one difference from the pill ramp above. Its order is carried by
     each column's POSITION and HEIGHT and by an always-visible axis naming the
     rung with the voter's own mood face — so the good end can be a deep green,
     which is what lets every rung stay dark enough for the paper it sits on.
     Stated here so the omission reads as a decision rather than as a gap. */
});

test('a design that declares row TAGS carries each one\'s ink on its own fill', () => {
  /* The two markers the Tafel prints at a row's edge (#1191, T4.4): „Gespielt"
     on a finished game and the veto pill „1× gar nicht" on a vetoed one. Both
     are fills with an ink of their own — they cannot borrow --good/--danger,
     which this design tunes as the LIGHT members of their pairs for walnut,
     and these sit on paper. Text, so the 4.5:1 bar.

     Their BORDERS are not measured and must not be: each is a decorative
     hairline on a non-interactive label, so SC 1.4.11 does not bind it, and a
     rule strong enough to clear 3:1 would make the tag read as a button. */
  const hosts = withToken('--played-tag');
  assert.ok(hosts.length >= 1, 'no design declares row tags — this test is vacuous');
  const failures = [];
  for (const t of hosts) {
    const v = (n) => token(n, t.design);
    for (const [fill, ink] of [['--played-tag', '--played-tag-ink'], ['--veto-tag', '--veto-tag-ink']]) {
      const ratio = contrast(v(ink), v(fill));
      if (ratio < AA_TEXT) failures.push(`${name(t)} — ${ink} on ${fill} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], 'a row tag states a fact and has to be readable on its own fill');
});

test('a design whose gold row is a SWEEP carries one ink across both its stops', () => {
  /* Review finding A2 — „Auf Gold nur eine Tinte" — measured at both ends
     rather than at one. The winning row is a gradient from --gold-hi to --gold
     (#1191), so a single ink is only a rule if it holds on the pale stop too;
     that is the end nobody checks, because the deep one looks like the hard
     case and is not. */
  const hosts = withToken('--gold-hi');
  assert.ok(hosts.length >= 1, 'no design declares a gold sweep — this test is vacuous');
  const failures = [];
  for (const t of hosts) {
    const v = (n) => token(n, t.design);
    for (const stop of ['--gold-hi', '--gold']) {
      const ratio = contrast(v('--gold-ink'), v(stop));
      if (ratio < AA_TEXT) failures.push(`${name(t)} — --gold-ink on ${stop} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], 'the winning row has one ink, so it must hold on both stops');
});

test('a design’s gold holds as DISPLAY type on every one of its felts', () => {
  /* #1270, T4.5: each table of a split session sits on its own felt — the
     design's markers, one per table — and at the rail width the winners' names
     in its sentence are printed in --gold at 26px/800. Finding A1 limits gold on
     felt to display size, so the bar is the large-text one, measured on BOTH
     stops of all eight felts (a table can land on any of them). Ockerfilz's
     light stop is the tightest, at 3.56:1. Below the rail width the sentence is
     smaller and the names take the felt's own ink, which the marker sweep
     above already measures. */
  const hosts = withToken('--gold').filter((t) => (DESIGN_REGISTRY.find((d) => d.id === t.design.id) || {}).markers);
  assert.ok(hosts.length >= 1, 'no design declares gold and felts — this test is vacuous');
  const failures = [];
  let checked = 0;
  for (const t of hosts) {
    const gold = token('--gold', t.design);
    for (const m of DESIGN_REGISTRY.find((d) => d.id === t.design.id).markers) {
      for (const stop of [m.color, m.deep]) {
        checked++;
        const ratio = contrast(gold, rgb(stop));
        if (ratio < barFor({ px: 26, weight: 800 })) failures.push(`${name(t)} — --gold on ${m.key} ${stop} = ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.ok(checked >= 16, 'the sweep did not reach the felts');
  assert.deepEqual(failures, [], 'gold names on a table’s felt must read as large text');
});

test('a design that declares Pokale PLINTHS carries their one ink on all six stops', () => {
  /* #1196, T13.2 — review finding A5: „Dunkle Tinte #2f2109 auf allen drei
     Sockeln". The three plinths are gradients, so a stop-by-stop sweep is the
     only way the finding's "all three" is actually true: the package's own deep
     bronze stop carried that ink at 3.48:1 and is corrected in tisch.css.

     The caption is 11-12px uppercase, so the plain text bar. The rank numeral
     is large and would pass on 3:1, but it takes the same ink, so the stricter
     bar covers both. Gold is the brass plate itself (--brass-hi -> --gold-deep),
     which is why those two tokens are in the list. */
  const hosts = withToken('--plinth-ink');
  assert.ok(hosts.length >= 1, 'no design declares plinths — this test is vacuous');
  const STOPS = [
    '--brass-hi', '--gold-deep',
    '--plinth-silver-hi', '--plinth-silver',
    '--plinth-bronze-hi', '--plinth-bronze',
  ];
  const failures = [];
  for (const t of hosts) {
    const v = (n) => token(n, t.design);
    for (const stop of STOPS) {
      const ratio = contrast(v('--plinth-ink'), v(stop));
      if (ratio < AA_TEXT) failures.push(`${name(t)} — --plinth-ink on ${stop} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], 'a plinth caption has to be readable on every stop of every plinth');
});

test('every colour token a design declares is measured by one of the checks above', () => {
  /* The guard that makes #1188's move safe. A design's root block is now
     RESOLVABLE by test/support/theme.js, and test/design-layer.test.js pushes
     every colour in the file up into it — but resolvable is not measured, and a
     token nobody pairs is exactly the unmeasured colour that whole rule exists
     to prevent, one layer along.

     So: every colour token a design declares must be either one styles.css also
     declares (in which case the sweeps above already cover it, because
     `tokensFor` resolves it for this design) or named here as measured.

     A NEW token therefore fails this test until it is given a pair. That is the
     intended cost — adding one is adding a colour to the app. */
  const appCss = require('node:fs')
    .readFileSync(require('node:path').join(__dirname, '..', 'public', 'styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const inApp = new Set([...appCss.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gm)].map((m) => m[2]));

  // The design-specific tokens the three tests above put in a pair.
  const MEASURED = new Set([
    '--paper', '--paper-raised', '--paper-ink', '--paper-ink-soft',
    '--paper-edge', '--paper-faint',
    '--felt', '--felt-deep', '--felt-ink', '--felt-ink-soft', '--felt-chip-on',
    // #1189: the weave (composited over the felt's light stop), the plate's
    // light gradient stop, and the deep accent the paper kicker takes.
    '--felt-grain', '--brass-hi', '--accent-deep',
    '--score-1', '--score-2', '--score-3', '--score-4', '--score-5',
    '--score-veto', '--score-ink-low', '--score-ink-high', '--score-veto-ink',
    // #1191: T8.2's other ramp (bars, measured on paper AND on the gold row),
    // the gold sweep's pale stop, and the two row tags with their own inks.
    '--bar-1', '--bar-2', '--bar-3', '--bar-4', '--bar-5',
    '--gold-hi',
    '--played-tag', '--played-tag-ink', '--veto-tag', '--veto-tag-ink',
    // #1195: the overlay's status inks, its darkest paper ground, and the
    // destructive button's fill ink.
    '--paper-good', '--paper-danger', '--paper-danger-ink', '--paper-sunken',
    // #1196: the Pokale plinths' silver and bronze stops and their one ink
    // (gold is --brass-hi/--gold-deep, measured by the same check).
    '--plinth-silver-hi', '--plinth-silver', '--plinth-bronze-hi', '--plinth-bronze',
    '--plinth-ink',
  ]);
  /* Not colours, so not this test's business: a lift PERCENTAGE, and the four
     compositing alphas the elevation ramp is built from. The alphas are painted
     over a ground this file cannot know (a shadow falls on whatever is behind
     the card), and they can only ever DARKEN it — which is the safe direction
     for every pair already measured on that ground. */
  const NOT_A_COLOUR = /^--(member-lift|cast|cast-soft|cast-deep|brass-sheen|brass-sheen-strong)$/;
  /* A hairline on a NON-INTERACTIVE label. SC 1.4.11 binds a boundary only
     where it identifies a control, and these two identify a printed tag — so
     there is no bar to measure them against, and inventing one would push them
     to a weight that reads as a button (#1191). The plinth's hairline (#1196)
     is the same case: a plinth is a picture of a rank, not a control. Listed rather than folded into
     NOT_A_COLOUR above, because they ARE colours; what they are not is a pair. */
  /* #1195 added two more of the same kind: the destructive button's rim (the
     red FILL identifies that control, measured above) and the paper hairline
     between rows and under a head, which separates and identifies nothing. */
  const DECORATIVE_EDGE = /^--(played-tag-edge|veto-tag-edge|paper-danger-edge|paper-line|plinth-edge)$/;

  const unmeasured = [];
  for (const t of THEMES) {
    const block = DESIGN_BLOCKS.get(t.design.id);
    if (!block) continue;
    for (const m of block.all.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gm)) {
      const tok = m[2];
      if (inApp.has(tok) || MEASURED.has(tok) || NOT_A_COLOUR.test(tok)) continue;
      if (DECORATIVE_EDGE.test(tok)) continue;
      // A layout token is not a colour either — radii, sizes, fonts, durations.
      if (/^--(radius|text|w|dur|ease|font|rail|dock)/.test(tok)) continue;
      unmeasured.push(`${name(t)} -> ${tok}`);
    }
  }
  assert.deepEqual(unmeasured, [],
    'these design tokens are resolvable but no check measures them — give each one a pair above');
});
