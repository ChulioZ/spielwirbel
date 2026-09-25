'use strict';

/* Resolving a design's tokens the way the BROWSER resolves them.

   Until #904 every design was light, so a contrast test could lift `--ink` and
   `--surface` straight out of `:root` with one regex and be right. A dark design
   overrides eleven tokens in `:root[data-scheme="dark"]` and re-derives the rest
   through `--shade`, so "the value of --ink" is now a question you cannot answer
   without also naming the design — and the old shape would have answered it with
   the light value, confidently, for every dark page in the app.

   So this module resolves a token FOR A DESIGN: it reads the declarations out of
   `public/styles.css`, picks the dark block's value when the design is dark,
   substitutes `var()` recursively, and evaluates `color-mix(in oklab, …)` with
   the same arithmetic the engine uses (#544). Nothing here restates a percentage
   or a hex from the sheet — a retune lands in the numbers automatically, which
   is the property that makes a green run mean something.

   Two things it deliberately does NOT do:

   - It does not model `transparent`. `--page-glow` and `--scrim` are alpha
     washes, and alpha compositing happens in the device space, not in oklab —
     see `composite()` below and the note in
     `.claude/rules/color-mix-interpolation-space.md`. Their call sites read the
     alpha themselves and composite in sRGB.
   - It does not know which tokens matter. Choosing the pairs and the bars is
     `test/a11y-contrast.test.js`'s job; this file only answers "what colour is
     that, on this design". */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, bodyOf, bodyOfIn, rulesOf } = require('./css');
const { DESIGN_REGISTRY } = require('../../public/js/designs');

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

const hex = (h) => {
  const s = h.length === 4 ? '#' + [1, 2, 3].map((i) => h[i] + h[i]).join('') : h;
  return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// Mirrors the CSS hsl() avgColor emits, so the test measures what ships.
const hsl = (h, s, l) => {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
  );
};

// --- Oklab, because that is the space the stylesheet derives in (#544) -------
/* Every color-mix() in styles.css interpolates `in oklab`. This module's whole
   value is that its arithmetic is the arithmetic the BROWSER runs — so a mix
   simulated with a channel lerp would be measuring a colour the app no longer
   paints, and would keep reporting a comfortable pass over a real regression. */
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

// What `color-mix(in oklab, a <pA>%, b)` computes, on hex strings or triples.
const rgb = (c) => (Array.isArray(c) ? c : hex(c));
const mixOklab = (a, b, pA) => {
  const A = rgbToOklab(rgb(a));
  const B = rgbToOklab(rgb(b));
  return oklabToRgb(A.map((v, i) => v * pA + B[i] * (1 - pA)));
};

/* Composite `fg` over `bg` at `alpha` — what a translucent wash actually paints,
   and therefore the background the text on it is really measured against.

   This one stays a plain sRGB channel lerp and must NOT follow #544 into oklab,
   even though it is the same three lines as `mixOklab`. It models ALPHA
   COMPOSITING — a translucent layer painted over an opaque one, which the
   compositor does in the device space — not a color-mix(). The two are easy to
   conflate because the token feeding it (--page-glow) is itself written as a
   color-mix; that mix is with `transparent`, which under premultiplied alpha
   resolves to "--brand at 7% alpha" in EVERY interpolation space, so the space
   switch leaves this call site's input and its arithmetic alone. */
const composite = (fg, bg, alpha) =>
  rgb(fg).map((v, i) => Math.round(v * alpha + rgb(bg)[i] * (1 - alpha)));

// --- the token blocks -------------------------------------------------------
/* Three sources, in the browser's own order (#1188).

   Until Der Tisch every design was a `page` + an `accent` and NOTHING else, so
   `styles.css` was the whole cascade and this file read two blocks out of it.
   Tisch overrides the derived tokens themselves — walnut `--surface`, paper
   `--ink`, its own gold family — from `public/css/designs/tisch.css`, and a
   colour this resolver cannot see is a colour that ships unmeasured, which is
   the #145 regression `.claude/rules/design-stylesheets-are-shell-assets.md`
   was written to prevent. So the resolver reads that sheet too.

   PRECEDENCE, and why it is this way round: `:root[data-design="tisch"]` and
   `:root[data-scheme="dark"]` have the SAME specificity — `:root` plus one
   attribute, (0,2,0) — so nothing about the selectors decides between them.
   What decides is source order, and `design.js` appends the design's <link>
   to <head> after `styles.css`. The design block therefore wins, and this
   ordering is a fact about the loader rather than about the selectors:
   `.claude/rules/design-stylesheets-are-shell-assets.md`. */

/* id -> { root, scheme, all }. Kept apart rather than pre-joined, because which
   halves apply depends on the DESIGN: a light design must not read a
   `[data-scheme="dark"]` block. `all` is the union, for a guard that asks what a
   design declares at all rather than what resolves for it. */
const DESIGN_BLOCKS = new Map();
for (const design of DESIGN_REGISTRY) {
  if (!design.stylesheet) continue;
  const file = path.join(ROOT, 'public', design.stylesheet.replace(/^\//, ''));
  const rules = rulesOf(fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
  const root = bodyOfIn(`:root[data-design="${design.id}"]`, rules);
  /* A design may ALSO qualify a block by scheme, and Der Tisch does: until the
     flip a round still overrides --page-bg/--brand with its own palette, so an
     ungated colour block would put a dark design's paper ink on a light round's
     page. Its colours therefore live in
     `:root[data-design="<id>"][data-scheme="dark"]` while its fonts and radii
     stay unconditional — see that file's own comment for the measurement.

     Read in the browser's order, most specific first, which for the only shape
     that exists is also source order. */
  const scheme = bodyOfIn(`:root[data-design="${design.id}"][data-scheme="dark"]`, rules);
  /* The LIGHT mirror (#1210, Ocean). A light design's colours must not reach a
     dark WORLD round either, so its block is gated the other way round —
     `:not([data-scheme="dark"])`, because the light scheme is the ABSENCE of
     the attribute and there is nothing positive to key on. Read only for a light
     design, exactly as the dark block is read only for a dark one. */
  const light = bodyOfIn(`:root[data-design="${design.id}"]:not([data-scheme="dark"])`, rules);
  /* An absent block is not an empty one. `bodyOfIn` answers null for a selector
     that is not there, and falling through to :root would resolve every token
     to Klassisch's value — a complete, plausible answer to the wrong question,
     which is the failure shape in
     `.claude/rules/cssrules-walk-is-blind-under-nesting.md`. A design that ships
     a stylesheet declares at least one of these; say so loudly if it stops. */
  assert.ok(root || scheme || light,
    `${design.stylesheet} declares no :root[data-design="${design.id}"] block — has the hook moved?`);
  DESIGN_BLOCKS.set(design.id, {
    design,
    root: root || '',
    scheme: scheme || '',
    light: light || '',
    all: [scheme, light, root].filter(Boolean).join('\n'),
  });
}


const ROOT_BLOCK = bodyOf(':root');
const DARK_BLOCK = bodyOfIn(':root[data-scheme="dark"]');
assert.ok(ROOT_BLOCK, 'styles.css declares no :root block');
assert.ok(DARK_BLOCK, 'styles.css declares no :root[data-scheme="dark"] block — has the hook moved?');

/* A USER design's blocks — and only a user design's. Until #1202 retired the
   round worlds, the world `ocean` and the user design `ocean` shared an id, so
   the lookup is keyed on the STYLESHEET as well as the id: only a user design
   carries one, and a spread copy (`{ ...design, scheme }`, which a spec builds
   to ask "what would this resolve to under the other scheme") keeps it. The
   collision is gone, but the stylesheet check stays the cheaper guarantee. */
function blocksOf(design) {
  const b = design && DESIGN_BLOCKS.get(design.id);
  return b && design.stylesheet && design.stylesheet === b.design.stylesheet ? b : null;
}

/* The declared text of one custom property, for a design. The design's own
   override sheet wins, then the dark block when the design is dark, then
   :root — which is exactly the cascade the browser runs (see above).

   `design` is optional so the helper still answers the sheet-only question the
   design-token specs ask of it. */
/* The design's own blocks that APPLY, most specific first. The scheme-qualified
   one is included only for a design of that scheme — a light design reading a
   dark block would resolve a colour the browser would never paint for it. */
function designBlocks(design, dark) {
  const b = blocksOf(design);
  if (!b) return [];
  return (dark ? [b.scheme, b.root] : [b.light, b.root]).filter(Boolean);
}

function declaration(name, dark, design) {
  const re = new RegExp(`(?:^|[;{\\s])${name}:\\s*([^;]+);`);
  const blocks = designBlocks(design, dark);
  if (dark) blocks.push(DARK_BLOCK);
  blocks.push(ROOT_BLOCK);
  const m = blocks.map((b) => b.match(re)).find(Boolean);
  assert.ok(m, `${name} is declared in neither :root, the dark block nor the design sheet`);
  return m[1].trim().replace(/\s+/g, ' ');
}

// Split `a, b, c` at top level — parentheses nest, so a naive split cuts a mix open.
function topLevelArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/* Evaluate a colour expression to an rgb triple, resolving `var()` against the
   design. Handles the three shapes this sheet's tokens are written in: a hex
   literal, a `var(--token)`, and `color-mix(in oklab, A [p%], B [p%])`. */
function evaluate(expr, design) {
  const s = expr.trim();
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(s)) return hex(s);

  const v = /^var\((--[\w-]+)\)$/.exec(s);
  if (v) return token(v[1], design);

  const mix = /^color-mix\((.*)\)$/s.exec(s);
  assert.ok(mix, `cannot evaluate the colour expression ${JSON.stringify(s)}`);
  const args = topLevelArgs(mix[1]);
  assert.equal(args[0], 'in oklab', `${s} does not interpolate in oklab`);
  assert.equal(args.length, 3, `${s} is not a two-colour mix`);

  /* A side of the mix: a colour, optionally followed by its percentage. Since
     #1188 that percentage may itself be a `var(--x, <fallback>)` — memberTone()
     emits `color-mix(in oklab, <hex>, #fff var(--member-lift, 42%))` so a design
     can lift its own people further without re-tuning every other design.
     Resolved through the same block order as a colour token, so a design that
     declares it is measured at ITS value and one that does not falls back to
     the literal in the var() — which is the value that ships. */
  const percent = (raw) => {
    const lit = /^(\d+(?:\.\d+)?)%$/.exec(raw);
    if (lit) return Number(lit[1]) / 100;
    const v = /^var\((--[\w-]+)(?:,\s*(\d+(?:\.\d+)?)%)?\)$/.exec(raw);
    assert.ok(v, `cannot read ${JSON.stringify(raw)} as a percentage`);
    const dark = design && design.scheme === 'dark';
    const declared = designBlocks(design, dark)
      .concat(dark ? [DARK_BLOCK] : [], [ROOT_BLOCK])
      .map((b) => b.match(new RegExp(`(?:^|[;{\\s])${v[1]}:\\s*(\\d+(?:\\.\\d+)?)%`)))
      .find(Boolean);
    if (declared) return Number(declared[1]) / 100;
    assert.ok(v[2], `${v[1]} is declared nowhere and carries no fallback`);
    return Number(v[2]) / 100;
  };
  const part = (a) => {
    const p = /\s((?:\d+(?:\.\d+)?%)|(?:var\([^)]*\)))$/.exec(a);
    return { color: p ? a.slice(0, p.index).trim() : a, pct: p ? percent(p[1]) : null };
  };
  const A = part(args[1]);
  const B = part(args[2]);
  // Exactly one side carries the percentage everywhere in this sheet; the other
  // side takes the remainder, which is what CSS does when only one is given.
  const wA = A.pct !== null ? A.pct : 1 - B.pct;
  return mixOklab(evaluate(A.color, design), evaluate(B.color, design), wA);
}

/* One token, resolved for one design. `--page-bg` and `--brand` come from the
   design itself — paintDesign() writes them inline, so the sheet's own values
   are only Klassisch's and would silently measure the wrong page for every
   other design. Klassisch declares neither (it IS the :root default), so for it
   the sheet's value is exactly right and the lookup falls through to it. */
function token(name, design) {
  if (name === '--page-bg' && design.page) return hex(design.page);
  if (name === '--brand' && design.accent) return hex(design.accent);
  return evaluate(declaration(name, design.scheme === 'dark', design), design);
}

/* Every token a contrast check needs, resolved for one design. Named rather than
   returned lazily so a spec reads as a list of colours instead of a list of
   lookups. Add a token here when a new pair needs measuring. */
function tokensFor(design) {
  const t = (name) => token(name, design);
  return {
    design,
    dark: design.scheme === 'dark',
    page: t('--page-bg'),
    brand: t('--brand'),
    surface: t('--surface'),
    ink: t('--ink'),
    inkSoft: t('--ink-soft'),
    onAccent: t('--on-accent'),
    shade: t('--shade'),
    sunken: t('--sunken'),
    sunkenSoft: t('--sunken-soft'),
    line: t('--line'),
    controlEdge: t('--control-edge'),
    controlFill: t('--control-fill'),
    placeholder: t('--placeholder'),
    brandStrong: t('--brand-strong'),
    brandTint: t('--brand-tint'),
    brandTintSoft: t('--brand-tint-soft'),
    brandEdge: t('--brand-edge'),
    good: t('--good'),
    warn: t('--warn'),
    danger: t('--danger'),
    gold: t('--gold'),
    goldDeep: t('--gold-deep'),
    goldSoft: t('--gold-soft'),
    goldEdge: t('--gold-edge'),
    stageBg: t('--stage-bg'),
    stageInk: t('--stage-ink'),
    stageMuted: t('--stage-muted'),
    stageFaint: t('--stage-faint'),
    stageRaised: t('--stage-raised'),
    stageLine: t('--stage-line'),
  };
}

// The alpha of a `color-mix(in oklab, X <p>%, transparent)`, which is what such
// a mix resolves to under premultiplied alpha (see composite() above).
function alphaOf(expr) {
  const m = /(\d+(?:\.\d+)?)%,\s*transparent/.exec(expr);
  assert.ok(m, `${expr} is not a mix into transparent`);
  return Number(m[1]) / 100;
}

module.exports = {
  contrast, luminance, hex, toHex, hsl, mixOklab, composite, rgb,
  declaration, evaluate, token, tokensFor, alphaOf,
  ROOT_BLOCK, DARK_BLOCK, DESIGN_BLOCKS, blocksOf,
};
