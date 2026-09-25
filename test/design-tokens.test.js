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
  '.podium__avatar', '.podium__col--multi .podium__avatar',
  '.podium--single .podium__col--multi .podium__avatar',
  '.member-avatar', '.handover__avatar',
  '.spotlight__seat .avatar',
  '.konto-avatar__preview', '.feed-item__who',
  // placeholder glyphs centred in a cover / thumb / tile box
  // The medallion is one rule shared by .lobby-cta and .empty (#869), so the
  // exemption has to name the whole selector text — these are matched exactly.
  '.ticket__img', '.session-card__img', '.round-card__emblem', '.lobby-cta__icon,\n.empty__icon',
  '.landing-claim__icon', '.landing-step__num', '.feed-item__img', '.trow__img', '.tisch__box',
  // the feed's TILE form (#1132): the same cover box and the same author face,
  // one component over.
  '.e-tile__img', '.e-tile__who .avatar',
  // …and the same box shrunk while the winner picker is open (#1139).
  '.tisch[data-state="picking"] .tisch__box',
  '.friends-invite__icon',
  /* The Tischkarte's initials watermark (#1075) — a letterform used as
     furniture in the card's text-free corner, sized to the card rather than to
     the type scale, and `aria-hidden` because the name it draws is already the
     <h1> beside it. Two rules: the base size and its phone step-down. */
  '.member-card__mark',
  '.pool-thumb', '.pool-thumb .ti', '.pool-tile__img', '.game-card__img', '.vote__img',
  '.gd-img', '.lookup__thumb--none .ti', '.archive-row__img .ti', '.rec-card__img .ti',
  '.spotlight__img .ti', 
  '.spotlight--table .spotlight__img .ti',
  '.recap-fav__cover .ti', '.pokale-card__thumb .ti',
  // a glyph or number sized to its own small box
  '.trow__bars .bar-axis .ti',
  '.stage__voter-check .ti', '.stage__seal > .ti', '.mood .ti',
  // the same five moods on the Spielepass's „Wer wie gewertet hat" tile (#1190),
  // sized to the tile rather than to the type scale, exactly like `.mood .ti`
  '.rater__face',
  '.fchip__x',
  // the young round's leader block (#1318): initials and crown sized to the
  // 44px seat, exactly as Der Tisch's copy of the same two rules
  '.pokale-young__avatar', '.pokale-young__crown',
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
   box-shadow LAYER is either a ramp token or one of the shapes that is NOT
   elevation. The exemptions are deliberate and narrow:
     - `0 0 0 <n>px` — a ring, not a shadow. The focus rings live here and must
       never be restyled for looks (accessibility floor, U-R04).
     - `<x> <y> 0 …`  — a zero-blur HARD EDGE. It casts no penumbra, so it is not
       depth at all: it is the SIDE of a thing rather than the space under it
       (#1041 stands the game cover as a box this way). The ramp is three blurs
       and has nothing to offer it.
     - `inset …`     — .ticket--live's accent edge.
     - `none`        — a reset.

   Checked per LAYER rather than per declaration, which is strictly stronger than
   the whole-value form this replaced: that one could only ever be satisfied by a
   single-layer value, so the first composite to be written would have had to be
   exempted wholesale — soft layer included. */
const RING = /^0 0 0 \d+px/;
const HARD = /^-?[\d.]+px\s+-?[\d.]+px\s+0(px)?(\s|$)/;
const isElevation = (v) => v !== 'none' && !v.includes('inset') && !RING.test(v) && !HARD.test(v);

// Top-level commas only — `color-mix(in oklab, …)` inside a layer is not a split.
function layers(value) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') depth--;
    else if (value[i] === ',' && depth === 0) { out.push(value.slice(start, i).trim()); start = i + 1; }
  }
  out.push(value.slice(start).trim());
  return out;
}

test('every elevation box-shadow comes from the 3-step ramp', () => {
  const offenders = decls('box-shadow')
    .flatMap(layers)
    .filter(isElevation)
    .filter((v) => !/^var\(--shadow-[123]\)$/.test(v));

  assert.deepEqual(offenders, [], `ad-hoc box-shadow values (use --shadow-1/2/3): ${offenders.join(' | ')}`);
});

/* One ring recipe per meaning (2026-08-07 audit): "currently selected on a
   picker" drifted to 2px on `.cover-pick.is-current` while the member swatch,
   avatar hover and focus rings all say 3px of --brand-edge. The inset chosen-row
   ring (`.trow.is-chosen`) is a different treatment on purpose and stays
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
  assert.match(body, /background:\s*var\(--scrim\)/,
    'the backdrop paints --scrim; a literal rgba() copy goes stale when --ink is retuned');
  /* --scrim went through a token in #904 rather than staying an inline mix on
     --ink, because a dark design takes --ink to near-white and a white scrim is
     not a dimmer. The DERIVATION is still the point on a light design, so the
     :root value must keep deriving — a hand-written rgba() there would go stale
     the next time --ink is retuned, which is what this test has always been for. */
  assert.match(ROOT, /--scrim:\s*color-mix\([^)]*var\(--ink\)/,
    ':root must derive --scrim from --ink');
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

/* `color-scheme` follows the DESIGN, not the OS. Dark is a design here — per
   round since #904 and per USER since #1184, which is why the dark block is
   keyed on data-scheme rather than on either registry — so without an explicit
   declaration a dark round on a light OS
   renders its native <select> popup, scrollbars and form-control defaults
   light — measured on the Sci-Fi world with computed `color-scheme: normal`
   (2026-09-06 UI audit). The light value on :root is the other half: a light
   round on a dark OS must not inherit the OS's dark controls either. */
test('color-scheme is declared per design: light on :root, dark on the dark block', () => {
  assert.match(ROOT, /(^|;)\s*color-scheme:\s*light\s*;/m, ':root must pin color-scheme: light');
  const dark = RULES.find(([sel]) => sel.includes(':root[data-scheme="dark"]'));
  assert.ok(dark, 'the dark-design block is gone');
  assert.match(dark[1], /(^|;)\s*color-scheme:\s*dark\s*;/m, 'the dark block must flip color-scheme');
});

/* ---------------------------------------------------------------------------
   Ocean (#1210): the design's token set, pinned against its package.

   docs/design/ocean/Ocean-O1-Komponenten.dc.html („O1.1 Tokens") is the one
   token source for O2-O15, so every value the stylesheet declares is compared
   to the value O1 draws — a retune in either place fails here by name. Where
   the stylesheet deliberately DIFFERS from O1 it is because a measurement said
   so, and those are pinned as corrections next to the O1 value they replace,
   so the next reader cannot "fix" one back to the sheet. Contrast lives in
   test/a11y-contrast.test.js; this file pins identity.
   --------------------------------------------------------------------------- */

const { designById } = require('../public/js/designs');
const { MEMBER_COLORS } = require('../public/js/member-colors');
const { blocksOf } = require('./support/theme');

const OCEAN = designById('ocean');
const OCEAN_SHEET = fs.readFileSync(path.join(SUPPORT_ROOT, 'public/css/designs/ocean.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const oceanBlocks = () => {
  const b = blocksOf(OCEAN);
  assert.ok(b && b.light, 'ocean.css has no :root[data-design="ocean"]:not([data-scheme="dark"]) colour block');
  return `${b.light}\n${b.root}`;
};
const oceanDecl = (name) => {
  const m = new RegExp(`(?:^|[;{\\s])${name}:\\s*([^;]+);`).exec(oceanBlocks());
  return m ? m[1].trim() : null;
};

test('Ocean is registered, light, and still behind its go-live (#1222)', () => {
  assert.ok(OCEAN, 'no design with id "ocean" in public/js/designs.js');
  assert.equal(OCEAN.enabled, false, 'Ocean goes live in #1222, not in its token issue');
  assert.notEqual(OCEAN.scheme, 'dark');
  assert.equal(OCEAN.page, '#e4f1f5', 'O1 „Seite"');
  assert.equal(OCEAN.accent, '#0e6690', 'O1 „Akzent"');
  assert.equal(OCEAN.stylesheet, '/css/designs/ocean.css');
});

/* O1.1's named values, as the stylesheet must carry them — grouped the way O1
   groups them, so a failure points at the section of the sheet. */
const O1_TOKENS = {
  // Flächen
  '--surface': '#f7fbfc', '--control-fill': '#ffffff', '--sunken': '#cfe6ef',
  '--sunken-soft': '#d7e9f0', '--line-soft': '#dfebf1',
  // Schrift & Akzent
  '--ink': '#10283a', '--ink-soft': '#3f5a6b', '--brand-strong': '#0a4f70', '--accent-edge': '#083d57',
  // Zustände
  '--good': '#1a6b4a', '--danger': '#a3392b', '--danger-strong': '#8a2f23',
  '--gold': '#f2e394', '--gold-ink': '#10283a', '--gold-edge': '#ddcd78',
  '--toast-action': '#9ed4ee',
  // Wasserverlauf, top to bottom, and the deep states
  '--water-foam': '#eef7fa', '--water-shallows': '#e2f0f5', '--water-surf': '#dcecf2',
  '--water-flat': '#cfe3ec', '--water-coast': '#a9c9d8',
  '--waterline': '#8fc0da', '--waterline-deep': '#4f8fbb',
  '--deep': '#1c4a66', '--deep-bottom': '#123a52', '--deep-ground': '#0d2b3e', '--deep-ink': '#f7fbfc',
  '--whale': '#2f6d94', '--whale-deep': '#163a55',
  // Sand, Wellenpapier, Blase
  '--sand-light': '#f7efe2', '--sand': '#f3ebdd', '--sand-deep': '#e2d2b8', '--sand-deep-soft': '#e8dac2',
  '--shell-edge': '#d8c6a6', '--wave-paper': '#eaf4f8', '--wave-paper-deep': '#dfedf3',
  '--bubble-hi': '#ffffff', '--bubble-1': '#f3f9fb', '--bubble-2': '#d7e9f0', '--bubble-3': '#b9d4e0',
  '--bubble-rim': '#a9c4d1',
  // Deaktiviert
  '--disabled-fill': '#d3e2e8', '--disabled-ink': '#6b8494', '--disabled-edge': '#c2d5de',
  // Score-Rampe, Tiefsee -> Sonnenlicht, with its FIXED inks (O1.9)
  '--score-1': '#23305c', '--score-2': '#35609a', '--score-3': '#6a9fd0', '--score-4': '#b7d4ee',
  '--score-5': '#f2e394', '--score-veto': '#4a1942',
  '--score-ink-low': '#f7fbfc', '--score-ink-high': '#10283a', '--score-veto-ink': '#f7fbfc',
};

test('Ocean declares every O1.1 token at O1’s value', () => {
  const wrong = [];
  for (const [name, value] of Object.entries(O1_TOKENS)) {
    const got = oceanDecl(name);
    if (got !== value) wrong.push(`${name}: expected ${value}, declared ${got}`);
  }
  assert.deepEqual(wrong, [], 'ocean.css drifted from Ocean-O1-Komponenten.dc.html');
});

test('Ocean declares the ten values the review found undeclared (R1)', () => {
  /* docs/design/pruefung-ocean-2026-09-20.md R1: six deep-water tones, the soft
     danger surface and three darkened person colours that O2-O15 use and O1
     never named. Each must be a named token now, so no screen issue re-derives
     it from a sheet. */
  const R1 = ['#1f4f72', '#7fb4d3', '#9ec2d4', '#1a4360', '#dbe9ef', '#f4faf7',
    '#f0dcd8', '#4a4396', '#8a3418', '#6f440a'];
  const block = oceanBlocks();
  const missing = R1.filter((hex) => !new RegExp(`--[a-z0-9-]+:\\s*${hex};`, 'i').test(block));
  assert.deepEqual(missing, [], 'these R1 values are still not declared as Ocean tokens');
});

test('Ocean’s measured corrections to O1 stay corrections', () => {
  /* Each is an O1 value that failed its own bar once recomputed — the review's
     point 1, „Kontrast, nachgerechnet statt geglaubt". Pinned beside the value
     it replaces, so none of them is quietly reverted to the sheet. */
  const CORRECTIONS = [
    ['--control-edge', '#728c98', '#a9c4d1', 'O1 „Umriss" is 1.75:1 on --surface, not the 3.1:1 the sheet states'],
    ['--warn', '#866607', '#8a6a10', 'O1 „Warnung" is 4.39:1 on the page, below AA'],
    ['--line', '#c6dae3', '#c9dde6', 'O1 „Linie" is 1.35:1 on --surface, under the light hairline floor'],
  ];
  for (const [name, value, o1, why] of CORRECTIONS) {
    assert.notEqual(value, o1);
    assert.equal(oceanDecl(name), value, `${name}: ${why}`);
  }
});

test('Ocean’s markers are the eight person colours, and the darkened row has all eight', () => {
  /* O14.1 paints a round's marker with the person colours; R1 asks for the
     darkened row for ALL eight rather than the three O8.1 draws. Three places
     hold them and all three must agree: member-colors.js (the colours, global
     and never forked), the registry's `deep` (read by the marker code and by
     personNameInk), and ocean.css's --person-deep-* (read by the stylesheet). */
  assert.equal(OCEAN.markers.length, 8);
  assert.deepEqual(OCEAN.markers.map((m) => m.color), MEMBER_COLORS,
    'a marker must be the member colour at the same index');
  const deep = OCEAN.markers.map((m) => m.deep);
  for (let i = 0; i < 8; i += 1) {
    assert.equal(oceanDecl(`--person-deep-${i + 1}`), deep[i],
      `--person-deep-${i + 1} and the registry's marker ${OCEAN.markers[i].key} disagree`);
  }
  // O8.1's three, verbatim — the other five are derived from these.
  assert.equal(deep[0], '#8a3418', 'Koralle, O8.1');
  assert.equal(deep[2], '#4a4396', 'Seeigel, O8.1');
  assert.equal(deep[3], '#6f440a', 'Bernstein, O8.1');
  assert.equal(new Set(deep).size, 8, 'two darkened colours collapsed onto one');
  assert.equal(OCEAN.personInk, 'deep', 'a name must print in the darkened row (design.js personNameInk)');
});

test('Ocean’s target sizes are tokens, and the components read them', () => {
  const targets = {
    '--target-button': '44px', '--target-control': '40px',
    '--target-footer': '32px', '--target-text': '24px',
  };
  for (const [name, px] of Object.entries(targets)) {
    assert.equal(oceanDecl(name), px, `${name} must be ${px} (O1 „Trefferflächen")`);
    assert.match(OCEAN_SHEET, new RegExp(`min-height:\\s*var\\(${name}\\)`),
      `nothing in ocean.css sizes a target with ${name} — the token is dead`);
  }
});

/* ---- Ocean's faces ---- */

const fontFaces = (family) => [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)]
  .map((m) => m[1])
  .filter((b) => new RegExp(`font-family:\\s*'${family}'`).test(b))
  .map((b) => ({
    weight: /font-weight:\s*([^;]+);/.exec(b)[1].trim(),
    url: /url\('([^']+)'\)/.exec(b)[1],
  }));

test('Ocean’s two faces are self-hosted, declared weight by weight, and precached', () => {
  const sw = fs.readFileSync(path.join(SUPPORT_ROOT, 'public/sw.js'), 'utf8');
  const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  const expect = { Comfortaa: ['700'], Figtree: ['400', '500', '600', '700'] };
  for (const [family, weights] of Object.entries(expect)) {
    const faces = fontFaces(family);
    /* EXACTLY these weights. A range (`400 800`) would be the single-weight
       trick #905 uses for Creepster — right for a face that has no bold, wrong
       here — and a missing weight would let the browser synthesise one. */
    assert.deepEqual(faces.map((f) => f.weight), weights, `${family}: declared weights`);
    for (const f of faces) {
      assert.ok(fs.existsSync(path.join(SUPPORT_ROOT, 'public', f.url)), `${f.url} is not on disk`);
      assert.ok(shell.includes(`'/${f.url}'`), `${f.url} is not in sw.js SHELL`);
    }
  }
  for (const lic of ['LICENSE-figtree.txt', 'LICENSE-comfortaa.txt']) {
    assert.ok(fs.existsSync(path.join(SUPPORT_ROOT, 'public/fonts', lic)), `${lic} is missing — both faces ship under OFL`);
  }
  assert.match(oceanDecl('--font'), /^"Figtree",/);
  assert.match(oceanDecl('--font-display'), /^"Comfortaa",/);
});

test('Ocean never sets Comfortaa under 17px — every small display-face rule is moved to Figtree', () => {
  /* O1.2: Comfortaa is „nie unter 17 px, nie für Fließtext". The app gives
     --font-display to buttons, pills and small labels too, so ocean.css hands
     those back to --font. DERIVED from styles.css — every rule that asks for
     the display face at a size that resolves under 17px on this design — so a
     new small display-face rule fails here until ocean.css lists it. */
  const px = (size) => {
    const tok = /^var\((--text-[a-z0-9]+)\)$/.exec(size);
    if (tok) {
      const own = oceanDecl(tok[1]);
      const v = own || (ROOT.match(new RegExp(`${tok[1]}:\\s*(\\d+)px`)) || [])[1];
      return Number(String(v).replace('px', ''));
    }
    const lit = /^(\d+(?:\.\d+)?)px$/.exec(size);
    return lit ? Number(lit[1]) : null;
  };
  const reset = /:root\[data-design="ocean"\] :is\(([\s\S]*?)\)\s*\{\s*font-family:\s*var\(--font\);/.exec(OCEAN_SHEET);
  assert.ok(reset, 'ocean.css has no font-family: var(--font) reset list');
  // Top-level commas only: a listed selector may itself hold `:is(h1, h2, h3)`.
  const splitSel = (text) => {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of text) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ')).filter(Boolean);
  };
  const listed = new Set(splitSel(reset[1]));

  /* Two ways a rule puts the display face on small text, and the second is the
     one a browser walk found and the first scan could not see: the rule names
     --font-display itself, OR it sizes a heading or a TITLE (an h1-h6, or a
     `title`/`head`/`name` class) and names no face at all — such an element is
     usually an h2/h3, which takes --font-display from the global heading rule.
     Listing a title that is not a heading costs nothing: it is Figtree either
     way. Measured: the Regal's „Spiele (9)" section label, an h1 at 16px, is
     how the second half was found. */
  const TITLE = /(title|heading|__head$|__name|__names|(^|[\s(,:])h[1-6]\b)/;
  const small = [];
  let seen = 0;
  for (const [sel, body] of RULES) {
    const size = (body.match(/font-size:\s*([^;]+)/) || [])[1];
    const n = size ? px(size.trim()) : null;
    if (n === null) continue;
    const display = /font-family:\s*var\(--font-display\)/.test(body);
    if (display) seen += 1;
    if (n >= 17) continue;
    for (const s of splitSel(sel)) {
      const last = s.replace(/:is\(([^)]*)\)/g, (m, inner) => inner.replace(/\s+/g, '')).split(' ').pop();
      const titled = !/font-family/.test(body) && TITLE.test(last);
      if ((display || titled) && !listed.has(s)) small.push(`${s} (${size.trim()} = ${n}px)`);
    }
  }
  // Anti-vacuous: the scan must have resolved the display-face rules it walks.
  assert.ok(seen >= 40, `only ${seen} display-face rules resolved a size — did the parse break?`);
  assert.deepEqual(small, [], 'these rules would set Comfortaa under 17px on Ocean — add them to the reset list');
});

test('the three Ocean glyphs are declared at the codepoints this woff2 maps them to', () => {
  /* Read from public/fonts/tabler-icons.woff2's own cmap (fontTools), per
     .claude/rules/tabler-icon-codepoints.md — `ti-shell` is absent from it,
     which is why the mark is the sine wave. A test cannot read the cmap
     without a font parser, so the numbers are pinned as measured. */
  const icons = fs.readFileSync(path.join(SUPPORT_ROOT, 'public/fonts/tabler-icons.css'), 'utf8');
  for (const [cls, cp] of [['wave-sine', 'ecd4'], ['droplet', 'ea97'], ['anchor', 'eb76']]) {
    assert.ok(icons.includes(`.ti-${cls}::before { content: "\\${cp}"; }`), `ti-${cls} must be \\${cp}`);
  }
  assert.ok(!icons.includes('.ti-shell::before'), 'ti-shell has no glyph in this font');
});
