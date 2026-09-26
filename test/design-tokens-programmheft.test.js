'use strict';

/* Das Programmheft's token and component layer (#1371, P1 + P8) — the pins the
   issue asks for, kept out of design-tokens.test.js and a11y-contrast.test.js
   because both are near their budget and a second design layer is being built
   beside this one. The generic sweeps in those two files already loop the whole
   registry, so they measure this design too; this file adds what only this
   design has:

   - the P1.1 token set, the eight markers, the ramp and the four target tokens;
   - the two faces, self-hosted, precached and licensed, Anton as `400 800`;
   - the derived „Anton nie unter 24 px" guard;
   - the contrast pairs of the tokens no other design declares (the box, the
     vermilion, the ramp, the gold-tint, the focus rings);
   - the accent guard: vermilion is never a text colour below 24px, and the two
     no-text tones (--hair, --hatch) are never a text colour at all.

   Parsing goes through test/support/css.js (comments stripped first); colours
   resolve through test/support/theme.js, which reads the design's gated light
   block exactly as the browser does. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CSS, RULES, bodyOf, rulesOf, ROOT: REPO } = require('./support/css');
const { contrast, luminance, token, blocksOf } = require('./support/theme');
const { designById, markerInkOf, isSelectableDesign } = require('../public/js/designs');
const { LOCALES } = require('../public/js/locales');

const PH = designById('programmheft');
const SHEET_FILE = path.join(REPO, 'public/css/designs/programmheft.css');
const SHEET = fs.readFileSync(SHEET_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SHEET_RULES = rulesOf(SHEET);
const ROOT_TOKENS = bodyOf(':root');
const AA_TEXT = 4.5;
const AA_LARGE = 3;

const decl = (name) => {
  const b = blocksOf(PH);
  const m = [b.light, b.root].map((x) => new RegExp(`(?:^|[;{\\s])${name}:\\s*([^;]+);`).exec(x)).find(Boolean);
  return m ? m[1].trim() : null;
};
const v = (name) => token(name, PH);

test('the registry row exists, is gated off, and every locale names it', () => {
  assert.ok(PH, 'no programmheft row in public/js/designs.js');
  assert.equal(PH.enabled, false, 'the flip is #1383, not this layer');
  assert.equal(isSelectableDesign('programmheft', { production: true }), false,
    'a disabled design must not be selectable in production');
  assert.equal(PH.stylesheet, '/css/designs/programmheft.css');
  assert.equal(PH.page, '#fbfaf6', 'P1.1 „Papier"');
  // --brand is TEXT (every .link-btn), so the registry carries P1's accent-ink,
  // never the vermilion — see the accent guard below.
  assert.equal(PH.accent, '#b8330f', 'P1.1 „Akzent-Tinte"');
  assert.ok(PH.scheme !== 'dark', 'Das Programmheft is a light design');
  const keys = ['design.programmheft.name', 'design.programmheft.desc',
    'design.programmheft.tagline', 'design.programmheft.short',
    ...PH.markers.map((m) => m.labelKey)];
  for (const { code } of LOCALES) {
    const src = fs.readFileSync(path.join(REPO, `public/js/lang/${code}.js`), 'utf8');
    const missing = keys.filter((k) => !src.includes(`'${k}':`));
    assert.deepEqual(missing, [], `${code}.js lacks these Programmheft keys`);
  }
});

/* P1.1's values, as the stylesheet must carry them. */
const P1_TOKENS = {
  '--surface': '#ffffff', '--control-fill': '#ffffff',
  '--ink': '#141414', '--ink-2': '#2b2925',
  // P1 draws --ink-soft #6f6b66; that reads 4.1-4.4:1 on the app's tints
  // (gold-soft, brand-tint, the score washes), so it is one step darker here.
  '--ink-soft': '#5f5b56',
  '--hair': '#b8b4ad', '--hatch': '#efece4', '--control-edge': '#141414',
  '--box': '#141414', '--box-ink': '#fbfaf6', '--box-ink-soft': '#cfccc5',
  '--vermilion': '#e8451c', '--on-vermilion': '#141414',
  '--good': '#2d6a3e', '--warn': '#8a5a00', '--danger': '#a3241a',
  '--gold': '#d9a72a', '--gold-ink': '#141414', '--gold-soft': '#f6e7b9',
  '--ramp-1': '#e8451c', '--ramp-2': '#b23d1c', '--ramp-3': '#7a4a3a',
  '--ramp-4': '#4a3f3a', '--ramp-5': '#141414',
  '--ramp-ink-1': '#141414', '--ramp-ink-2': '#fbfaf6', '--ramp-ink-3': '#fbfaf6',
  '--ramp-ink-4': '#fbfaf6', '--ramp-ink-5': '#fbfaf6',
  '--veto-fill': '#fbfaf6', '--veto-edge': '#e8451c', '--veto-ink': '#b8330f',
};

test('Das Programmheft declares every P1.1 token at P1’s value', () => {
  const wrong = [];
  for (const [name, value] of Object.entries(P1_TOKENS)) {
    const got = decl(name);
    if (got !== value) wrong.push(`${name}: expected ${value}, declared ${got}`);
  }
  assert.deepEqual(wrong, [], 'programmheft.css drifted from Programmheft-P1-Komponenten.dc.html');
  // Radius zero, every step — „Ecken: keine".
  for (const r of ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-pill']) {
    assert.equal(decl(r), '0px', `${r} must be 0`);
  }
});

test('the eight markers are P8’s, each with the ink P8 prints on it', () => {
  const P8 = [
    ['zinnober', '#e8451c', '#141414'], ['preussischblau', '#1f4e8c', '#fbfaf6'],
    ['tannengruen', '#2e6b3f', '#fbfaf6'], ['ocker', '#a8761a', '#141414'],
    ['pflaume', '#6e3a6b', '#fbfaf6'], ['graphit', '#4a4a48', '#fbfaf6'],
    ['petrol', '#1c6b72', '#fbfaf6'], ['fuchsie', '#9c2f6e', '#fbfaf6'],
  ];
  assert.equal(PH.markers.length, 8);
  PH.markers.forEach((m, i) => {
    const [key, color, ink] = P8[i];
    assert.equal(m.key, key);
    assert.equal(m.color, color, `${key}: P8.2's colour`);
    assert.equal(markerInkOf('programmheft', m), ink, `${key}: the ink P8 prints on it`);
    assert.match(m.deep, /^#[0-9a-f]{6}$/);
    assert.notEqual(m.deep, m.color, `${key}: the deep stop must differ from the colour`);
  });
});

test('the ramp darkens from 1 to 5 and every step carries its own ink', () => {
  /* P1.9: vermilion to ink, the print getting heavier as the score rises — the
     inverse of the --score-* family's brightening contract, which is why it has
     its own names. Ordered by lightness, which is what carries it for a
     colour-blind reader. */
  const ls = [1, 2, 3, 4, 5].map((n) => luminance(v(`--ramp-${n}`)));
  for (let i = 1; i < ls.length; i += 1) {
    assert.ok(ls[i] < ls[i - 1], `the ramp does not darken from ${i} to ${i + 1}`);
  }
  const fails = [];
  for (let n = 1; n <= 5; n += 1) {
    const r = contrast(v(`--ramp-ink-${n}`), v(`--ramp-${n}`));
    if (!(r >= AA_TEXT)) fails.push(`step ${n}: ${r.toFixed(2)}:1`);
  }
  assert.deepEqual(fails, [], 'a score digit must read on its own step');
  // The veto stamp: accent-ink on paper, framed in vermilion.
  assert.ok(contrast(v('--veto-ink'), v('--veto-fill')) >= AA_TEXT, 'the veto word');
  assert.ok(contrast(v('--veto-edge'), v('--veto-fill')) >= AA_LARGE, 'the veto edge (SC 1.4.11)');
  // And the component reads them by data-stop, so fill and ink come from one rung.
  for (const stop of ['veto', '1', '2', '3', '4', '5']) {
    const hit = SHEET_RULES.find(([sel]) => sel.endsWith(`.score-pill[data-stop="${stop}"]`));
    assert.ok(hit, `no score-pill rule for data-stop="${stop}"`);
    assert.match(hit[1], /--sc-fill:\s*var\(--(ramp|veto)-/);
    assert.match(hit[1], /--sc-ink:\s*var\(--(ramp-ink|veto-ink)/);
  }
});

test('the box, the masthead, the gold-tint and the focus rings clear their bars', () => {
  const pairs = [
    // [label, ink, ground, bar]
    ['--ink-2 on the page', v('--ink-2'), v('--page-bg'), AA_TEXT],
    ['--ink-2 on raised', v('--ink-2'), v('--surface'), AA_TEXT],
    ['--ink-soft on the page', v('--ink-soft'), v('--page-bg'), AA_TEXT],
    ['--ink-soft on raised', v('--ink-soft'), v('--surface'), AA_TEXT],
    ['paper on the box', v('--box-ink'), v('--box'), AA_TEXT],
    ['--box-ink-soft on the box', v('--box-ink-soft'), v('--box'), AA_TEXT],
    ['ink on the masthead', v('--on-vermilion'), v('--vermilion'), AA_TEXT],
    ['ink on the gold-tint', v('--gold-ink'), v('--gold-soft'), AA_TEXT],
    ['accent-ink on the gold-tint', v('--brand'), v('--gold-soft'), AA_TEXT],
    ['ink on gold', v('--gold-ink'), v('--gold'), AA_TEXT],
    ['paper on the danger hover', v('--box-ink'), v('--danger'), AA_TEXT],
    ['the accent (link text) on the page', v('--brand'), v('--page-bg'), AA_TEXT],
    ['white on the accent', v('--on-accent'), v('--brand'), AA_TEXT],
    ['a field edge on white', v('--control-edge'), v('--control-fill'), AA_LARGE],
    ['the focus ring on the page', v('--brand-ring'), v('--page-bg'), AA_LARGE],
    ['the focus ring on raised', v('--brand-ring'), v('--surface'), AA_LARGE],
    ['the box ring against the box', v('--ring-on-box'), v('--box'), AA_LARGE],
    ['the box ring on the page', v('--ring-on-box'), v('--page-bg'), AA_LARGE],
    // Vermilion is DISPLAY type: the large-text bar, and see the guard below.
    ['vermilion display type on the page', v('--vermilion'), v('--page-bg'), AA_LARGE],
    ['vermilion display type on raised', v('--vermilion'), v('--surface'), AA_LARGE],
  ];
  const fails = pairs
    .map(([label, ink, ground, bar]) => [label, contrast(ink, ground), bar])
    .filter(([, r, bar]) => !(r >= bar))
    .map(([label, r, bar]) => `${label}: ${r.toFixed(2)}:1 (bar ${bar})`);
  assert.deepEqual(fails, [], 'these Programmheft pairs are below their bar');
});

/* ---- The accent guard (the issue's fifth criterion). ---- */

/* Every `color:` a sheet declares that resolves, under this design, to one of
   the given tones. Read from BOTH sheets, because a styles.css rule painting
   `color: var(--line)` would put the hair on text just as surely as one written
   here. Only a plain `var(--x)` (with or without fallback) is resolved; a mix is
   not one of these tones by construction. */
function colourUses(tones) {
  const hex = new Set(tones.map((t) => t.toLowerCase()));
  const out = [];
  for (const [file, rules] of [['styles.css', RULES], ['programmheft.css', SHEET_RULES]]) {
    for (const [sel, body] of rules) {
      for (const m of body.matchAll(/(?:^|[;\s])(color|-webkit-text-fill-color):\s*var\((--[a-z0-9-]+)/g)) {
        let resolved;
        try { resolved = token(m[2], PH); } catch { continue; }
        if (!Array.isArray(resolved)) continue;
        const h = '#' + resolved.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
        if (hex.has(h)) out.push({ file, sel, body, tok: m[2] });
      }
    }
  }
  return out;
}

const sizePx = (body) => {
  const s = (/font-size:\s*([^;]+)/.exec(body) || [])[1];
  if (!s) return null;
  const lit = /^(\d+(?:\.\d+)?)px$/.exec(s.trim());
  if (lit) return Number(lit[1]);
  const tok = /^var\((--[a-z0-9-]+)\)$/.exec(s.trim());
  if (!tok) return null;
  const own = decl(tok[1]) || (new RegExp(`${tok[1]}:\\s*(\\d+)px`).exec(ROOT_TOKENS) || [])[0];
  const n = /(\d+(?:\.\d+)?)px/.exec(own || '');
  return n ? Number(n[1]) : null;
};

test('vermilion is never a text colour below 24px', () => {
  /* P1: „Zinnober nur ab 24 px Anton, als Fläche und als Unterstrich". It is
     3.79:1 on the page, so anything smaller printed in it fails AA. A rule may
     paint vermilion text only while it also sets a size of 24px or more. */
  const hits = colourUses([PH.markers[0].color, '#e8451c']);
  const small = hits.filter((h) => !(sizePx(h.body) >= 24))
    .map((h) => `${h.file}: ${h.sel} (color: var(${h.tok}))`);
  assert.deepEqual(small, [], 'these rules print vermilion under 24px — use --brand (accent-ink) instead');
  // The accent that DOES reach text app-wide is the registry's, and it is not
  // the vermilion — the other half of the same guarantee.
  assert.notEqual(PH.accent.toLowerCase(), '#e8451c');
});

test('the hair and the hatch are never a text colour', () => {
  const hits = colourUses([P1_TOKENS['--hair'], P1_TOKENS['--hatch']])
    .map((h) => `${h.file}: ${h.sel} (color: var(${h.tok}))`);
  assert.deepEqual(hits, [], 'P1 marks --hair and --hatch „kein Text"');
});

test('the colour guards can see a violation (control)', () => {
  /* Both guards above assert an EMPTY list, which is also what a resolver that
     matched nothing would return. So feed the scanner a rule it must catch. */
  const fake = rulesOf('.x { color: var(--hair); } .y { color: var(--vermilion); font-size: 14px; } .z { color: var(--vermilion); font-size: var(--display-6); }');
  const found = [];
  for (const [sel, body] of fake) {
    const m = /color:\s*var\((--[a-z0-9-]+)/.exec(body);
    const h = '#' + token(m[1], PH).map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
    found.push([sel, h, sizePx(body)]);
  }
  assert.deepEqual(found, [['.x', '#b8b4ad', null], ['.y', '#e8451c', 14], ['.z', '#e8451c', 24]]);
});

/* ---- Targets ---- */

test('the four target tokens are P1’s, and the components read them', () => {
  const targets = { '--target-min': '24px', '--target-foot': '32px', '--target-key': '44px', '--target-field': '44px' };
  for (const [name, px] of Object.entries(targets)) {
    assert.equal(decl(name), px, `${name} must be ${px} (P1 „Trefferflächen")`);
    assert.match(SHEET, new RegExp(`min-(height|width):\\s*var\\(${name}\\)`),
      `nothing in programmheft.css sizes a target with ${name} — the token is dead`);
  }
});

/* ---- Faces ---- */

const fontFaces = (family) => [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)]
  .map((m) => m[1])
  .filter((b) => new RegExp(`font-family:\\s*'${family}'`).test(b))
  .map((b) => ({ weight: /font-weight:\s*([^;]+);/.exec(b)[1].trim(), url: /url\('([^']+)'\)/.exec(b)[1] }));

test('Anton and Archivo are self-hosted, precached, licensed — and Anton is never synthesised bold', () => {
  const sw = fs.readFileSync(path.join(REPO, 'public/sw.js'), 'utf8');
  const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  /* Anton ships ONE weight; declared as the range `400 800` it IS the bold, so
     a heading asking for 700 is not synthesised (single-weight-display-faces.md
     §1). Archivo declares exactly the weights P1 uses. */
  const expect = { Anton: ['400 800'], Archivo: ['400', '600', '700'] };
  for (const [family, weights] of Object.entries(expect)) {
    const faces = fontFaces(family);
    assert.deepEqual(faces.map((f) => f.weight), weights, `${family}: declared weights`);
    for (const f of faces) {
      const file = path.join(REPO, 'public', f.url);
      assert.ok(fs.existsSync(file), `${f.url} is not on disk`);
      assert.equal(fs.readFileSync(file).subarray(0, 4).toString('latin1'), 'wOF2', `${f.url} is not a woff2`);
      assert.ok(shell.includes(`'/${f.url}'`), `${f.url} is not in sw.js SHELL`);
    }
  }
  assert.ok(shell.includes("'/css/designs/programmheft.css'"), 'the stylesheet is not in sw.js SHELL');
  for (const lic of ['LICENSE-anton.txt', 'LICENSE-archivo.txt']) {
    const text = fs.readFileSync(path.join(REPO, 'public/fonts', lic), 'utf8');
    assert.match(text, /SIL OPEN FONT LICENSE/i, `${lic} must be the OFL`);
  }
  assert.match(decl('--font'), /^"Archivo",/);
  assert.match(decl('--font-display'), /^"Anton",/);
});

test('Anton is never set under 24px — every small display-face rule is moved to Archivo', () => {
  /* „Anton ab 24 px". DERIVED from styles.css — every rule that asks for the
     display face, or sizes a heading/title and names no face, at a size that
     resolves under 24px — so a new small display-face rule fails here until
     programmheft.css lists it. The same scan as Ocean's 17px guard in
     design-tokens.test.js, at this design's floor. */
  const px = (size) => {
    const tok = /^var\((--text-[a-z0-9]+)\)$/.exec(size);
    if (tok) {
      const own = decl(tok[1]);
      const val = own || (ROOT_TOKENS.match(new RegExp(`${tok[1]}:\\s*(\\d+)px`)) || [])[1];
      return Number(String(val).replace('px', ''));
    }
    const lit = /^(\d+(?:\.\d+)?)px$/.exec(size);
    return lit ? Number(lit[1]) : null;
  };
  const reset = /:root\[data-design="programmheft"\] :is\(([\s\S]*?)\)\s*\{\s*font-family:\s*var\(--font\);/.exec(SHEET);
  assert.ok(reset, 'programmheft.css has no font-family: var(--font) reset list');
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
    return out.map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
  };
  const listed = new Set(splitSel(reset[1]));
  // `__h` is this sheet's BEM name for a section heading (.konto-section__h,
  // .k-band__h): an h2 that takes the display face from the tag rule.
  const TITLE = /(title|heading|__head$|__h$|__name|__names|(^|[\s(,:])h[1-6]\b)/;
  const small = [];
  let seen = 0;
  for (const [sel, body] of RULES) {
    const size = (body.match(/font-size:\s*([^;]+)/) || [])[1];
    const n = size ? px(size.trim()) : null;
    if (n === null) continue;
    const display = /font-family:\s*var\(--font-display\)/.test(body);
    if (display) seen += 1;
    if (n >= 24) continue;
    for (const s of splitSel(sel)) {
      const last = s.replace(/:is\(([^)]*)\)/g, (m, inner) => inner.replace(/\s+/g, '')).split(' ').pop();
      const titled = !/font-family/.test(body) && TITLE.test(last);
      if ((display || titled) && !listed.has(s)) small.push(`${s} (${size.trim()} = ${n}px)`);
    }
  }
  assert.ok(seen >= 40, `only ${seen} display-face rules resolved a size — did the parse break?`);
  assert.ok(listed.size >= 40, `the reset list holds only ${listed.size} selectors — did it get truncated?`);
  assert.deepEqual(small, [], 'these rules would set Anton under 24px on Das Programmheft — add them to the reset list');
});
