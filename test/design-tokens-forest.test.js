'use strict';

/* Forest's token and component layer (#1465, F1 + F8) — the pins the issue asks
   for, kept out of design-tokens.test.js and a11y-contrast.test.js because both
   are past their budget. The generic sweeps in those two files already loop the
   whole registry, so they measure this design too (the --score-* ramp, the
   markers, the poster, the member tones, the hover edges); this file adds what
   only this design has:

   - the F1.1 token set, the eight markers, the leaf radii, the leadings and the
     four target tokens — with each deliberate deviation pinned as one;
   - the two faces, self-hosted, precached and licensed, Young Serif as `400 800`;
   - the derived „Young Serif nie unter 19 px, nie auf Knöpfen" guard;
   - the contrast pairs of the tokens no other design declares (the moss, the
     band, the dusk and its three inks, the danger tint, the gold family);
   - the firefly guard (it carries meaning only on the dusk), and the no-text
     guard for the hairline, the hatch and the motif colours.

   Parsing goes through test/support/css.js (comments stripped first); colours
   resolve through test/support/theme.js, which reads the design's gated light
   block exactly as the browser does. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CSS, RULES, rulesOf, bodyOf, ROOT: REPO } = require('./support/css');
const { contrast, luminance, token, blocksOf, rgb } = require('./support/theme');
const { designById, markerInkOf, isSelectableDesign } = require('../public/js/designs');
const { LOCALES } = require('../public/js/locales');

const FOREST = designById('forest');
const SHEET_FILE = path.join(REPO, 'public/css/designs/forest.css');
const SHEET = fs.readFileSync(SHEET_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SHEET_RULES = rulesOf(SHEET);
const ROOT_TOKENS = bodyOf(':root');
const AA_TEXT = 4.5;
const AA_LARGE = 3;

const decl = (name) => {
  const b = blocksOf(FOREST);
  const m = [b.light, b.root].map((x) => new RegExp(`(?:^|[;{\\s])${name}:\\s*([^;]+);`).exec(x)).find(Boolean);
  return m ? m[1].trim() : null;
};
const v = (name) => token(name, FOREST);
const hexOf = (rgb) => '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

test('the registry row exists, is live in production, and every locale names it', () => {
  assert.ok(FOREST, 'no forest row in public/js/designs.js');
  assert.equal(FOREST.enabled, true, 'live since its go-live (#1478)');
  assert.equal(isSelectableDesign('forest', { production: true }), true, 'production offers it in the chooser and on Konto');
  assert.equal(isSelectableDesign('forest', { production: false }), true, 'and so does every other instance');
  assert.equal(FOREST.stylesheet, '/css/designs/forest.css');
  assert.equal(FOREST.page, '#ecf1e4', 'F1.1 „page"');
  assert.equal(FOREST.accent, '#356427', 'F1.1 „accent" — text at any size');
  assert.equal(FOREST.scheme, 'light');
  // Operator decision 2026-10-01: the LIGHT poster, not F5's dusk bill.
  assert.deepEqual(FOREST.poster, { ground: ['#ecf1e4', '#d6e4c6'], ink: '#356427', sub: '#1b2a18' });
  // F1: a person colour is a ring, never type — a name prints in the ink.
  assert.equal(FOREST.personInk, 'ink');
  const keys = ['design.forest.name', 'design.forest.desc', 'design.forest.tagline', 'design.forest.short',
    ...FOREST.markers.map((m) => m.labelKey)];
  for (const { code } of LOCALES) {
    const src = fs.readFileSync(path.join(REPO, `public/js/lang/${code}.js`), 'utf8');
    const missing = keys.filter((k) => !src.includes(`'${k}':`));
    assert.deepEqual(missing, [], `${code}.js lacks these Forest keys`);
  }
});

/* F1.1's values, as the stylesheet must carry them. The app names a few of them
   differently: F1's accent-deep is --brand-strong, its gold-ink (gold TEXT) is
   --gold-deep, its gold-tint is --gold-soft, its edge --control-edge. */
const F1_TOKENS = {
  '--surface': '#f9fbf4', '--raised': '#ffffff', '--control-fill': '#ffffff', '--band': '#f3f6ec',
  '--moss': '#d6e4c6', '--moss-hover': '#c9d9b6',
  '--dusk': '#24331f', '--dusk-soft': '#c9d6bd', '--firefly': '#fff3a8', '--on-dusk': '#f4f8ec',
  '--ink': '#1b2a18', '--ink-soft': '#4b5c45',
  '--brand-strong': '#284d1d',
  '--gold': '#a86d14', '--gold-deep': '#85570f', '--gold-soft': '#f3e6b0', '--gold-edge': '#a86d14',
  '--good': '#356427', '--warn': '#8a5300', '--danger': '#a3392b', '--danger-tint': '#f8e4df',
  '--control-edge': '#6f7f66', '--hatch': '#e9f0df',
  '--brand-ring': '#1b2a18', '--ring-on-dusk': '#fff3a8',
  '--bark': '#5a3d24', '--bark-light': '#8a6240', '--wood': '#dcbf92', '--wood-ring': '#c9a06f', '--wood-edge': '#b8905f',
  '--leaf-1': '#446b39', '--leaf-2': '#4f7d40', '--leaf-3': '#6b9a55', '--leaf-4': '#7fae66',
  '--score-1': '#3d5273', '--score-2': '#3b6f6c', '--score-3': '#9cc38a', '--score-4': '#c2dc86', '--score-5': '#f1e58c',
  '--score-veto': '#5b1e3a', '--score-ink-low': '#f4f8ec', '--score-ink-high': '#1b2a18', '--score-veto-ink': '#f4f8ec',
};

/* The three values that are NOT F1's, each with the measurement that forced it
   (the comment beside each in forest.css carries the reasoning). Pinned here as
   deviations so a later "restore the package value" shows up as a decision. */
const DEVIATIONS = {
  '--on-accent': ['#ffffff', 'F1 #f4f8ec put six member tones and the mid avgColor ramp at 4.2:1'],
  '--line': ['#d3dbc8', 'F1 #d5ddca is 1.34:1 on the card, under the app’s 1.36 hairline floor'],
  '--gold-ink': ['#1b2a18', 'the app’s --gold-ink is the glyph ON gold, not F1’s gold text (that is --gold-deep)'],
};

test('Forest declares every F1.1 token at F1’s value', () => {
  const wrong = [];
  for (const [name, value] of Object.entries(F1_TOKENS)) {
    const got = decl(name);
    if (got !== value) wrong.push(`${name}: expected ${value}, declared ${got}`);
  }
  assert.deepEqual(wrong, [], 'forest.css drifted from Forest-F1-Komponenten.dc.html');
  for (const [name, [value, why]] of Object.entries(DEVIATIONS)) {
    assert.equal(decl(name), value, `${name} is a measured deviation from F1 (${why})`);
  }
});

test('the voice: leaf radii, leadings, spacing and the focus geometry are F1’s', () => {
  const voice = {
    '--radius-md': '12px', '--radius-lg': '18px', '--radius-xl': '24px',
    '--radius-leaf-s': '14px 4px 14px 4px', '--radius-leaf-l': '22px 7px 22px 7px',
    '--leading-display': '1.05', '--leading-title': '1.1', '--leading-text': '1.45', '--kicker-gap': '6px',
    '--space-1': '4px', '--space-7': '48px', '--ring-width': '3px', '--ring-offset': '2px',
  };
  for (const [name, value] of Object.entries(voice)) assert.equal(decl(name), value, name);
  // The leaf shapes are applied, not merely declared.
  assert.match(SHEET, /\.btn--primary\s*\{[^}]*border-radius:\s*var\(--radius-leaf-l\)/);
  assert.match(SHEET, /\.chip\s*\{[^}]*border-radius:\s*var\(--radius-leaf-s\)/);
});

test('the eight markers are F8.2’s, in order, Tanne first, each carrying the light ink at AA', () => {
  // Fingerhut and Ginster are nudged (operator decision, #1465): the package's
  // #a2569b and #a07a12 read 4.49 and 3.69/3.80:1 under either ink.
  const F8 = [
    ['tanne', '#356427'], ['fingerhut', '#a05599'], ['heidelbeere', '#3e4f8f'], ['fliegenpilz', '#b3342a'],
    ['kiefer', '#7a4a2a'], ['moorsee', '#2f6f78'], ['ginster', '#8d6b10'], ['schlehe', '#5a3a6e'],
  ];
  assert.equal(FOREST.markers.length, 8);
  FOREST.markers.forEach((m, i) => {
    const [key, color] = F8[i];
    assert.equal(m.key, key);
    assert.equal(m.color, color, `${key}: F8.2's colour`);
    assert.equal(m.labelKey, `marker.forest.${key}`);
    assert.equal(markerInkOf('forest', m), '#f4f8ec', `${key}: F8.2's „hell" ink`);
    assert.match(m.deep, /^#[0-9a-f]{6}$/);
    assert.ok(luminance(rgb(m.deep)) < luminance(rgb(m.color)), `${key}: the deep stop must be darker`);
    // A marker is a graphic: its band against the card clears 3:1 (F8.2).
    assert.ok(contrast(rgb(m.color), v('--surface')) >= AA_LARGE, `${key}: band against the card`);
  });
});

test('the score ramp brightens from 1 to 5 — Schatten to Sonne — and the veto is darkest', () => {
  const ls = ['--score-veto', '--score-1', '--score-2', '--score-3', '--score-4', '--score-5'].map((n) => luminance(v(n)));
  for (let i = 1; i < ls.length; i += 1) {
    assert.ok(ls[i] > ls[i - 1], `the ramp does not brighten at step ${i}`);
  }
  // And the pill reads it by data-stop, so fill and ink come from one rung.
  for (const stop of ['veto', '1', '2', '3', '4', '5']) {
    const hit = SHEET_RULES.find(([sel]) => sel.endsWith(`.score-pill[data-stop="${stop}"]`));
    assert.ok(hit, `no score-pill rule for data-stop="${stop}"`);
    assert.match(hit[1], /--sc-fill:\s*var\(--score-/);
    assert.match(hit[1], /--sc-ink:\s*var\(--score-(ink|veto-ink)/);
  }
});

test('the moss, the band, the dusk, the danger tint and the gold family clear their bars', () => {
  const pairs = [
    // [label, ink, ground, bar]
    ['ink on moss', v('--ink'), v('--moss'), AA_TEXT],
    ['soft ink on moss', v('--ink-soft'), v('--moss'), AA_TEXT],
    ['soft ink on moss-hover', v('--ink-soft'), v('--moss-hover'), AA_TEXT],
    ['soft ink on the band', v('--ink-soft'), v('--band'), AA_TEXT],
    ['soft ink on the page', v('--ink-soft'), v('--page-bg'), AA_TEXT],
    ['soft ink on raised', v('--ink-soft'), v('--raised'), AA_TEXT],
    ['soft ink on the hatch', v('--ink-soft'), v('--hatch'), AA_TEXT],
    ['soft ink on the gold-tint', v('--ink-soft'), v('--gold-soft'), AA_TEXT],
    ['ink on the gold-tint', v('--ink'), v('--gold-soft'), AA_TEXT],
    ['the accent (link text) on the page', v('--brand'), v('--page-bg'), AA_TEXT],
    ['the accent on the band', v('--brand'), v('--band'), AA_TEXT],
    ['the accent on moss (a ghost button’s hover)', v('--brand'), v('--moss'), AA_TEXT],
    ['the accent on the gold-tint', v('--brand'), v('--gold-soft'), AA_TEXT],
    ['white on the accent', v('--on-accent'), v('--brand'), AA_TEXT],
    ['white on accent-deep', v('--on-accent'), v('--brand-strong'), AA_TEXT],
    ['light print on the dusk', v('--on-dusk'), v('--dusk'), AA_TEXT],
    ['soft print on the dusk', v('--dusk-soft'), v('--dusk'), AA_TEXT],
    ['the firefly on the dusk', v('--firefly'), v('--dusk'), AA_TEXT],
    ['the dusk ring against the dusk', v('--ring-on-dusk'), v('--dusk'), AA_LARGE],
    ['the focus ring on the page', v('--brand-ring'), v('--page-bg'), AA_LARGE],
    ['the focus ring on the card', v('--brand-ring'), v('--surface'), AA_LARGE],
    ['danger on its tint', v('--danger'), v('--danger-tint'), AA_TEXT],
    ['danger on the card', v('--danger'), v('--surface'), AA_TEXT],
    ['gold text on the gold-tint', v('--gold-deep'), v('--gold-soft'), AA_TEXT],
    ['gold text on the card', v('--gold-deep'), v('--surface'), AA_TEXT],
    ['the crown (gold graphic) on the card', v('--gold'), v('--surface'), AA_LARGE],
    ['the control edge on moss', v('--control-edge'), v('--moss'), AA_LARGE],
  ];
  const fails = pairs
    .map(([label, ink, ground, bar]) => [label, contrast(ink, ground), bar])
    .filter(([, r, bar]) => !(r >= bar))
    .map(([label, r, bar]) => `${label}: ${r.toFixed(2)}:1 (bar ${bar})`);
  assert.deepEqual(fails, [], 'these Forest pairs are below their bar');
});

/* ---- The colour guards (the issue's fifth criterion). ---- */

/* Every declaration in BOTH sheets whose value is a plain var() resolving, under
   this design, to one of the given tones — for the listed properties. Read from
   styles.css too, because a rule there painting `color: var(--line)` puts the
   hairline on text just as surely as one written here. */
function uses(tones, props, rules = [['styles.css', RULES], ['forest.css', SHEET_RULES]]) {
  const hex = new Set(tones.map((t) => t.toLowerCase()));
  const re = new RegExp(`(?:^|[;\\s])(${props.join('|')}):\\s*var\\((--[a-z0-9-]+)`, 'g');
  const out = [];
  for (const [file, list] of rules) {
    for (const [sel, body] of list) {
      for (const m of body.matchAll(re)) {
        let resolved;
        try { resolved = token(m[2], FOREST); } catch { continue; }
        if (!Array.isArray(resolved)) continue;
        if (hex.has(hexOf(resolved))) out.push({ file, sel, body, prop: m[1], tok: m[2] });
      }
    }
  }
  return out;
}
const TEXT_PROPS = ['color', '-webkit-text-fill-color'];
const MOTIF = ['--bark', '--bark-light', '--wood', '--wood-ring', '--wood-edge', '--leaf-1', '--leaf-2', '--leaf-3', '--leaf-4'];

test('the firefly is never a colour on a light surface — only on the dusk', () => {
  /* E4: the fireflies carry meaning only on #24331f; on a light ground the
     firefly is 1.1:1, decoration at best. A rule may paint with it (as text, a
     fill, a ring) only where it ALSO stands on the dusk: its own body sets the
     dusk ground, or its selector sits inside a dusk surface. The toast is the
     only dusk surface the component layer has; the hand-over and the hidden
     cards join with their screens — the demo's „Gefällt dir das?" band did
     (#1471, F7.6). The finale's stage (#1468) is the dusk too: forest.css
     re-points its --stage-* tokens at --dusk and --on-dusk. The pass-device
     blind (#1469) is the dusk edge to edge, so „Los geht's" may be the firefly
     with ink on it. */
  const DUSK_SURFACES = ['.toast', '.hub-card--demo-invite', '.stage', '.handover--forest'];
  const hits = uses([F1_TOKENS['--firefly']], ['color', 'background', 'background-color', 'outline-color', 'border-color', 'fill', 'stroke', 'box-shadow']);
  const light = hits.filter((h) => !/background(?:-color)?:\s*var\(--dusk\)/.test(h.body)
    && !DUSK_SURFACES.some((s) => h.sel.includes(s)));
  assert.deepEqual(light.map((h) => `${h.file}: ${h.sel} (${h.prop}: var(${h.tok}))`), [],
    'the firefly is painted off the dusk');
  // Anti-vacuous: the one sanctioned use today is the toast's focus ring.
  assert.ok(hits.some((h) => h.sel.includes('.toast')), 'the dusk ring on the toast is gone — has the lookup drifted?');
  /* `uses()` reads a declaration whose value STARTS with var(), so a firefly
     painted inside a gradient — the hidden cards' glint (#1468) — never reached
     it. Those rules must lay the dusk under it in the same body. */
  const offDusk = fireflyGradientsOffDusk(SHEET_RULES);
  assert.deepEqual(offDusk, [], 'a gradient paints the firefly off the dusk');
  assert.ok(SHEET_RULES.some(([, body]) => /gradient\([^;]*var\(--firefly\)/.test(body)),
    'no gradient carries the firefly any more — has the hidden-card rule moved?');
});

function fireflyGradientsOffDusk(rules) {
  return rules
    .filter(([, body]) => /gradient\([^;]*var\(--firefly\)/.test(body))
    .filter(([sel, body]) => !/var\(--dusk\)/.test(body) && !['.toast', '.stage'].some((s) => sel.includes(s)))
    .map(([sel]) => sel);
}

test('the hairline, the hatch and the motif colours are never a text colour', () => {
  const tones = [DEVIATIONS['--line'][0], F1_TOKENS['--hatch'], ...MOTIF.map((n) => F1_TOKENS[n])];
  const hits = uses(tones, TEXT_PROPS).map((h) => `${h.file}: ${h.sel} (color: var(${h.tok}))`);
  assert.deepEqual(hits, [], 'F1: --line „nie Text", the hatch and the motif carry no text');
});

test('the colour guards can see a violation (control)', () => {
  /* Both guards above assert an EMPTY list, which is also what a resolver that
     matched nothing would return. So feed the scanner rules it must catch. */
  const fake = [['fake', rulesOf('.x { color: var(--line); } .y { color: var(--leaf-2); } .z { background: var(--firefly); } .t { color: var(--firefly); background: var(--dusk); }')]];
  const text = uses([DEVIATIONS['--line'][0], F1_TOKENS['--leaf-2']], TEXT_PROPS, fake).map((h) => h.sel);
  assert.deepEqual(text, ['.x', '.y']);
  const ff = uses([F1_TOKENS['--firefly']], ['color', 'background'], fake).map((h) => h.sel);
  assert.deepEqual(ff, ['.z', '.t'], 'both firefly uses are found; the guard then excuses only the dusk one');
  const grad = rulesOf('.g { background: radial-gradient(circle, var(--firefly) 0 2px, transparent 3px), var(--surface); } .h { background: radial-gradient(circle, var(--firefly) 0 2px, transparent 3px), var(--dusk); }');
  assert.deepEqual(fireflyGradientsOffDusk(grad), ['.g'], 'a gradient firefly off the dusk is caught, one on it is not');
});

/* ---- Targets ---- */

test('the four target tokens are F1’s, and the components read them — in height AND width', () => {
  const targets = { '--target-min': '24px', '--target-foot': '32px', '--target-key': '44px', '--target-field': '44px' };
  for (const [name, px] of Object.entries(targets)) {
    assert.equal(decl(name), px, `${name} must be ${px} (F1 „Trefferflächen")`);
    assert.match(SHEET, new RegExp(`min-(height|width):\\s*var\\(${name}\\)`),
      `nothing in forest.css sizes a target with ${name} — the token is dead`);
  }
  // Review U9: the footer's „FAQ" drew 23px wide — the link takes a min-width.
  const foot = SHEET_RULES.find(([sel]) => sel.endsWith(' .site-footer a'));
  assert.ok(foot, 'no footer-link rule');
  assert.match(foot[1], /min-width:\s*var\(--target-foot\)/);
  assert.match(foot[1], /min-height:\s*var\(--target-foot\)/);
});

/* ---- Faces ---- */

const fontFaces = (family) => [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)]
  .map((m) => m[1])
  .filter((b) => new RegExp(`font-family:\\s*'${family}'`).test(b))
  .map((b) => ({ weight: /font-weight:\s*([^;]+);/.exec(b)[1].trim(), url: /url\('([^']+)'\)/.exec(b)[1] }));

test('Young Serif and Alegreya Sans are self-hosted, precached, licensed — and Young Serif is never synthesised bold', () => {
  const sw = fs.readFileSync(path.join(REPO, 'public/sw.js'), 'utf8');
  const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  /* Young Serif ships ONE weight; declared as the range `400 800` it IS the
     bold, so a heading asking for 700 is not synthesised
     (single-weight-display-faces.md §1). Alegreya Sans declares F1's three. */
  const expect = { 'Young Serif': ['400 800'], 'Alegreya Sans': ['400', '700', '800'] };
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
  assert.ok(shell.includes("'/css/designs/forest.css'"), 'the stylesheet is not in sw.js SHELL');
  for (const lic of ['LICENSE-young-serif.txt', 'LICENSE-alegreya-sans.txt']) {
    const text = fs.readFileSync(path.join(REPO, 'public/fonts', lic), 'utf8');
    assert.match(text, /SIL OPEN FONT LICENSE/i, `${lic} must be the OFL`);
  }
  assert.match(decl('--font'), /^"Alegreya Sans",/);
  assert.match(decl('--font-display'), /^"Young Serif",/);
});

test('Young Serif is never set under 19px nor on a button — every such rule is moved to Alegreya Sans', () => {
  /* F1.2: „nie unter 19 px, nie auf Knöpfen". DERIVED from styles.css — every
     rule that asks for the display face, or sizes a heading/title/name and names
     no face, at a size that resolves under 19px — so a new small display-face
     rule fails here until forest.css lists it. The same scan as Das
     Programmheft's 24px guard, at this design's floor, plus every button. */
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
  const reset = /:root\[data-design="forest"\] :is\(([\s\S]*?)\)\s*\{\s*font-family:\s*var\(--font\);/.exec(SHEET);
  assert.ok(reset, 'forest.css has no font-family: var(--font) reset list');
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
  assert.ok(listed.has('.btn'), 'Young Serif never sits on a button (F1.3) — .btn must be in the reset list');
  const TITLE = /(title|heading|__head$|__h$|__name|__names|(^|[\s(,:])h[1-6]\b)/;
  const small = [];
  let seen = 0;
  for (const [sel, body] of RULES) {
    const size = (body.match(/font-size:\s*([^;]+)/) || [])[1];
    const n = size ? px(size.trim()) : null;
    if (n === null) continue;
    const display = /font-family:\s*var\(--font-display\)/.test(body);
    if (display) seen += 1;
    if (n >= 19) continue;
    for (const s of splitSel(sel)) {
      // A rule scoped to ANOTHER design can never match here (#1574 added the
      // first Klassisch-scoped heading size to styles.css).
      if (/\[data-design="(?!forest")[\w-]+"\]/.test(s)) continue;
      const last = s.replace(/:is\(([^)]*)\)/g, (m, inner) => inner.replace(/\s+/g, '')).split(' ').pop();
      const titled = !/font-family/.test(body) && TITLE.test(last);
      if ((display || titled) && !listed.has(s)) small.push(`${s} (${size.trim()} = ${n}px)`);
    }
  }
  assert.ok(seen >= 40, `only ${seen} display-face rules resolved a size — did the parse break?`);
  assert.ok(listed.size >= 40, `the reset list holds only ${listed.size} selectors — did it get truncated?`);
  assert.deepEqual(small, [], 'these rules would set Young Serif under 19px on Forest — add them to the reset list');
});

test('the toast is the dusk: light print, and the firefly ring for its controls', () => {
  const toast = SHEET_RULES.find(([sel]) => /\.toast:not\(\.toast--success\):not\(\.toast--error\)$/.test(sel));
  assert.ok(toast, 'no neutral-toast rule');
  assert.match(toast[1], /background:\s*var\(--dusk\)/);
  assert.match(toast[1], /color:\s*var\(--on-dusk\)/);
  // Ink would vanish on the dusk (1.1:1), so the ring there is the firefly.
  assert.ok(contrast(v('--brand-ring'), v('--dusk')) < AA_LARGE, 'precondition: the ink ring does not read on the dusk');
  const ring = SHEET_RULES.find(([sel, body]) => sel.includes('.toast') && /:focus-visible/.test(sel) && /outline-color:\s*var\(--ring-on-dusk\)/.test(body));
  assert.ok(ring, 'a control on the toast keeps the ink ring');
});
