'use strict';

/* Die Brücke (#1237): the design's token set, faces and component layer,
   pinned against its package.

   docs/design/bruecke/Bruecke-B1-Komponenten.dc.html („1 · Tokens") is the one
   token source for B2-B16 and Bruecke-B8-Farben.dc.html measures it, so every
   value bruecke.css declares is compared to the value B1 draws — a retune in
   either place fails here by name. Where the stylesheet deliberately DIFFERS
   from B1 a measurement said so, and that is pinned as a correction next to
   the B1 value it replaces. Contrast lives in test/a11y-contrast.test.js; this
   file pins identity. It is Ocean's section of test/design-tokens.test.js for
   a second design, kept in its own file so neither crosses the 700-line
   budget (test/token-budget.test.js). */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CSS, ROOT: SUPPORT_ROOT } = require('./support/css');
const { designById } = require('../public/js/designs');
const { MEMBER_COLORS } = require('../public/js/member-colors');
const { blocksOf } = require('./support/theme');
const { loadApp } = require('./support/dom');

const BRUECKE = designById('bruecke');
const SHEET_RAW = fs.readFileSync(path.join(SUPPORT_ROOT, 'public/css/designs/bruecke.css'), 'utf8');
const SHEET = SHEET_RAW.replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = () => {
  const b = blocksOf(BRUECKE);
  assert.ok(b && b.scheme, 'bruecke.css has no :root[data-design="bruecke"][data-scheme="dark"] colour block');
  return `${b.scheme}\n${b.root}`;
};
const decl = (name) => {
  const m = new RegExp(`(?:^|[;{\\s])${name}:\\s*([^;]+);`).exec(blocks());
  return m ? m[1].trim() : null;
};

test('Die Brücke is registered, dark, and NOT yet enabled (its flip is #1249)', () => {
  assert.ok(BRUECKE, 'no design with id "bruecke" in public/js/designs.js');
  assert.equal(BRUECKE.enabled, false, 'the go-live is #1249, not this slice');
  assert.equal(BRUECKE.scheme, 'dark');
  assert.equal(BRUECKE.page, '#070b14', 'B1 „page" — the gradient’s dark stop');
  assert.equal(BRUECKE.accent, '#35e0ff', 'B1 „accent"');
  assert.equal(BRUECKE.stylesheet, '/css/designs/bruecke.css');
});

test('Die Brücke declares every B1 token at B1’s value', () => {
  const B1 = {
    '--page-hi': '#10203a',        // page gradient, light stop
    '--surface': '#0e1626',        // surface
    '--surface-raised': '#141d30', // surface-raised
    '--bar': '#0b1220',            // bar
    '--line': '#24324a',           // line
    '--hairline': '#1c2740',       // hairline
    '--ink': '#dfe7f5',            // ink
    '--ink-2': '#b8c2d6',          // ink-2
    '--ink-soft': '#9aa8c0',       // ink-muted
    '--ink-dim': '#5d6a82',        // ink-dim — non-text only
    '--action': '#ffb020',         // action
    '--action-hover': '#ffc451',   // B1 „5 · Zustände", Überfahren
    '--action-press': '#e09710',   // Gedrückt
    '--good': '#4ade80',           // ok
    '--danger': '#ff6b85',         // alert
    '--on-accent': '#070b14',      // every chipInk on a fill
    '--radius-sm': '0', '--radius-md': '0', '--radius-lg': '0', '--radius-xl': '0', '--radius-pill': '0',
  };
  const wrong = Object.entries(B1).filter(([n, v]) => decl(n) !== v).map(([n, v]) => `${n}: ${decl(n)} (B1 ${v})`);
  assert.deepEqual(wrong, [], 'bruecke.css drifted from Bruecke-B1-Komponenten.dc.html');
});

test('Die Brücke’s measured correction to B1 stays a correction', () => {
  /* B1 draws every secondary control as a wire in #24324a — 1.40:1 on the plate,
     under SC 1.4.11's 3:1 for the edge that identifies a control. The edge is
     B1's own non-text tone instead (3.31 on the panel, 3.08 on a raised control). */
  assert.equal(decl('--control-edge'), '#5d6a82', '--control-edge: B1 „ink-dim", not the 1.40:1 wire');
  assert.equal(decl('--line'), '#24324a', 'the PANEL edge stays B1’s wire — it identifies no control');
});

test('the B8.2 ramp and the B8 score bands are B1’s own five colours', () => {
  const ramp = ['#ff6b85', '#ffb020', '#9aa8c0', '#4ade80', '#35e0ff'];
  ramp.forEach((hex, i) => assert.equal(decl(`--thrust-${i + 1}`), hex, `--thrust-${i + 1} (B8.2 face ${i + 1})`));
  assert.deepEqual(['--band-top', '--band-good', '--band-low', '--band-new'].map(decl),
    ['#35e0ff', '#4ade80', '#ffb020', '#9aa8c0'], 'B8 „Score-Farbe an der Zahl"');
});

test('the markers ARE B8.1’s lightened person row, the sheet declares the same eight, and they convert when drawn', () => {
  /* Three places hold the row and each is read by a different consumer: the
     registry's markers (the marker picker, and designPersonTone() in design.js),
     bruecke.css's --person-lit-* (the contrast suite), and B8.1 itself. */
  const B8 = ['#f08a5d', '#3fbf95', '#a49cf0', '#e0a03c', '#f08aa8', '#6bb3e0', '#9cc44a', '#e07a9a'];
  assert.equal(BRUECKE.markers.length, 8);
  assert.deepEqual(BRUECKE.markers.map((m) => m.color), B8, 'markers drifted from B8.1');
  B8.forEach((hex, i) => assert.equal(decl(`--person-lit-${i + 1}`), hex, `--person-lit-${i + 1}`));
  assert.equal(BRUECKE.personTone, 'marker');
  assert.equal(BRUECKE.markerInk, '#070b14', 'on a person colour the text is the night');
});

const APP = loadApp();
after(() => APP.close());

test('memberTone() paints a stored colour as its lightened twin on Die Brücke — and the stored value never moves', () => {
  /* Asked of the real functions (design.js designPersonTone, core.js memberTone)
     with the design worn, per .claude/rules/assert-the-decision-not-its-ingredients.md. */
  assert.equal(APP.run("applyDesign('bruecke')"), 'bruecke');
  try {
    const painted = MEMBER_COLORS.map((c) => APP.run(`memberTone(${JSON.stringify(c)})`));
    assert.deepEqual(painted, BRUECKE.markers.map((m) => m.color), 'each index paints as B8.1’s colour at that index');
    assert.equal(APP.run("designPersonTone('#123456')"), null, 'a colour outside the eight is not converted');
  } finally {
    APP.run("applyDesign('klassisch')");
  }
  assert.equal(APP.run('designPersonTone(MEMBER_COLORS[0])'), null, 'no other design converts');
});

test('the four target sizes are tokens at B1’s values, and the components read each one', () => {
  const targets = { '--target-min': '24px', '--target-key': '44px', '--target-field': '44px', '--target-foot': '32px' };
  for (const [name, px] of Object.entries(targets)) {
    assert.equal(decl(name), px, `${name} must be ${px} (B1 „Raster und Kante")`);
    assert.match(SHEET, new RegExp(`min-height:\\s*var\\(${name}\\)`),
      `nothing in bruecke.css sizes a target with ${name} — the token is dead`);
  }
});

test('--ink-dim is never a text colour', () => {
  /* B1: „nur Gesperrt und leere Rasterzellen, nie Fließtext" — 3.3:1 on the
     plate. The review found it once as body text (A4). So `color:` may read it
     only on a DISABLED control, which WCAG exempts; any other rule that sets a
     text colour from it — or a token re-pointed at it — fails here by name. */
  const rules = [...SHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  assert.ok(rules.length > 30, `only ${rules.length} rules parsed out of bruecke.css`);
  const aliases = new Set(['--ink-dim']);
  for (const [, body] of rules) {
    for (const m of body.matchAll(/(--[\w-]+):\s*var\(--ink-dim\)/g)) aliases.add(m[1]);
  }
  const bad = [];
  for (const [sel, body] of rules) {
    for (const a of aliases) {
      if (new RegExp(`(^|[;\\s])(color|-webkit-text-fill-color|--ink|--ink-soft|--ink-2|--sc-ink|--on-accent):\\s*var\\(${a}\\)`).test(body)
        && !/:disabled|\[disabled\]|\[aria-disabled="true"\]/.test(sel)) bad.push(`${sel} -> ${a}`);
    }
  }
  assert.deepEqual(bad, [], '--ink-dim painted as text outside a disabled control');
  // Anti-vacuous: the one sanctioned use exists, so the scan above can see a match.
  assert.ok(rules.some(([sel, body]) => /:disabled/.test(sel) && /color:\s*var\(--ink-dim\)/.test(body)),
    'the disabled button no longer reads --ink-dim — is the scan still looking at the right thing?');
});

/* ---- The three faces ---- */

const fontFaces = (family) => [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)]
  .map((m) => m[1])
  .filter((b) => new RegExp(`font-family:\\s*'${family}'`).test(b))
  .map((b) => ({ weight: /font-weight:\s*([^;]+);/.exec(b)[1].trim(), url: /url\('([^']+)'\)/.exec(b)[1] }));

test('the three faces are self-hosted, declared weight by weight, precached and licensed', () => {
  const sw = fs.readFileSync(path.join(SUPPORT_ROOT, 'public/sw.js'), 'utf8');
  const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  const expect = {
    'Chakra Petch': ['600', '700'],
    'IBM Plex Sans': ['400', '500', '600'],
    'IBM Plex Mono': ['400', '500', '600'],
  };
  for (const [family, weights] of Object.entries(expect)) {
    const faces = fontFaces(family);
    assert.deepEqual(faces.map((f) => f.weight), weights, `${family}: declared weights`);
    for (const f of faces) {
      const file = path.join(SUPPORT_ROOT, 'public', f.url);
      assert.ok(fs.existsSync(file), `${f.url} is not on disk`);
      assert.equal(fs.readFileSync(file).subarray(0, 4).toString('latin1'), 'wOF2', `${f.url} is not a woff2`);
      assert.ok(shell.includes(`'/${f.url}'`), `${f.url} is not in sw.js SHELL`);
    }
  }
  assert.ok(shell.includes("'/css/designs/bruecke.css'"), 'bruecke.css is not in sw.js SHELL');
  for (const lic of ['LICENSE-chakra-petch.txt', 'LICENSE-ibm-plex-sans.txt', 'LICENSE-ibm-plex-mono.txt']) {
    const txt = fs.readFileSync(path.join(SUPPORT_ROOT, 'public/fonts', lic), 'utf8');
    assert.match(txt, /SIL OPEN FONT LICENSE/i, `${lic} is not the OFL`);
  }
  assert.match(decl('--font'), /^"IBM Plex Sans",/);
  assert.match(decl('--font-display'), /^"Chakra Petch",/);
  assert.match(decl('--font-mono'), /^"IBM Plex Mono",/);
});

test('no rule asks a Brücke face for a weight it does not ship — nothing is faux-bolded', () => {
  /* Chakra Petch ships 600/700 and Plex 400-600, so a request for 700+ on a
     Plex face, or under 600 on Chakra Petch, would be synthesised or fall to the
     wrong file. bruecke.css states weights only on rules whose face it knows. */
  const bad = [];
  for (const m of SHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2];
    const w = /font-weight:\s*(\d+)/.exec(body);
    if (!w) continue;
    const weight = Number(w[1]);
    if (/font-family:\s*var\(--font-mono\)/.test(body) && weight > 600) bad.push(`${m[1].trim()} mono ${weight}`);
    if (/font-family:\s*var\(--font\)/.test(body) && weight > 600) bad.push(`${m[1].trim()} sans ${weight}`);
    if (/font-family:\s*var\(--font-display\)/.test(body) && weight < 600) bad.push(`${m[1].trim()} display ${weight}`);
  }
  assert.deepEqual(bad, []);
});

test('the toast keeps its #858 shape on Die Brücke, and the right angle reaches the literal radii', () => {
  assert.doesNotMatch(SHEET, /\.toast[^{]*\{[^}]*border-radius:\s*var\(--radius-pill\)/, 'the toast pill is #858');
  for (const cls of ['.btn', '.card', '.sheet', '.popover', '.chip', '.input', '.toast', '.avatar', '.score-pill']) {
    assert.match(SHEET, new RegExp(`:is\\([^)]*\\${cls}\\b[^)]*\\)\\s*\\{\\s*border-radius:\\s*0;`),
      `${cls} keeps a styles.css literal radius on a right-angled design`);
  }
});
