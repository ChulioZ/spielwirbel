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
  contrast, luminance, hsl, composite, evaluate, tokensFor, alphaOf, mixOklab, toHex,
} = require('./support/theme');

// Every design a round can pick — the palettes AND the worlds — required off
// the registry, so a new design is measured automatically instead of silently
// escaping these checks. (#903 replaced a regex over views-round-detail.js; the
// registry is a dependency-free module precisely so this file can require it.)
const { DESIGNS } = require('../public/js/round-designs');
const { MEMBER_COLORS } = require('../public/js/member-colors');
assert.ok(DESIGNS.length >= 11, 'expected the nine palettes plus the two worlds');

const THEMES = DESIGNS.map(tokensFor);

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

test('the stamp date clears AA-large in every score colour, on every design', () => {
  const failures = [];
  for (const t of THEMES) {
    for (const avg of SWEEP) {
      const ink = avgRgb(avg, t.dark);
      const ratio = contrast(ink, stampFill(t, ink));
      if (ratio < AA_LARGE) failures.push(`${name(t)} \u00d8${avg.toFixed(1)} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `.stamp__date is 22px/700 --sc on a tint of itself; needs ${AA_LARGE}:1`);
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
  assert.match(chip, /color:\s*var\(--brand-strong\)/,
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
     one ratio enough. Asserted as "every design agrees" rather than by reading
     the dark block, so it holds however the tokens are later expressed. */
  const ratios = new Set(THEMES.map((t) =>
    contrast(evaluate(ink[1], t.design), evaluate(fill[1], t.design)).toFixed(2)));
  assert.equal(ratios.size, 1, `the seal pair differs per design (${[...ratios].join(', ')}) — one of the two now flips`);
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

/* The Freundeskreis cover wash (#1094). Unlike every fill above it, the layer is
   an arbitrary USER-FACING IMAGE — a game cover — so there is no token to mix
   with and no average to assume. The honest worst case is the extremes: pure
   black over a light design, pure white over a dark one, which is what a very
   dark or very bright cover approaches.

   Measured at FULL alpha on purpose. The card's second line is
   `white-space: nowrap` with an ellipsis, so it spans the whole card and really
   does reach the far right where the mask is fully opaque — the fade buys the
   text nothing and must not be credited to it.

   The --accent link buttons in `.k-card__meta` are deliberately NOT here: they
   would fail at full alpha (4.03:1 on Salbei) and do not fail in fact, because
   the mask has not opened where they sit — measured at 375px they end at 46% of
   the card and see 0.0148 effective alpha. That is a LAYOUT fact, which this
   file cannot see; it is recorded in the CSS comment beside the rule with the
   threshold (~67% of the card width) at which it would stop holding. */
test('the friend card\'s cover wash keeps its text over AA, for any cover', () => {
  const decl = bodyOf('.k-card__art');
  assert.ok(decl, '.k-card__art is gone — did the wash move?');
  const m = /(^|[\s;])opacity:\s*([\d.]+)/.exec(decl);
  assert.ok(m, `.k-card__art declares no opacity: ${decl}`);
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
    `the wash paints a cover at ${(alpha * 100).toFixed(0)}% over --surface; the card's text needs `
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
