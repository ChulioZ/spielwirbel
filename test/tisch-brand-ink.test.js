'use strict';

/* The brand's TEXT ink inside Der Tisch's overlays (#1260).

   A Tisch overlay is paper, and the brand is brass: light on paper exactly as
   on wood, so brand-coloured TEXT in a sheet read at ~2:1. --brand itself
   cannot be re-pointed there — it is also the active chip's FILL, which must
   stay brass — so the text uses read `var(--brand-ink, var(--brand))` (or
   `…, var(--brand-strong))`) and only the Tisch overlay rule declares
   --brand-ink. Everywhere else the fallback applies, i.e. what shipped before.

   What is pinned here, and why each half is a separate test:

     1. the sweep — every `color` in styles.css that reads the brand reads it
        through --brand-ink, and fails naming the selector that does not. There
        is no static way to know which rules can render inside an overlay, so
        the sweep claims all of them; the two exceptions are listed with why.
     2. Klassisch — nothing declares --brand-ink outside the Tisch overlay rule.
        A `:root { --brand-ink: var(--brand) }` alias looks equivalent and is
        not: it is substituted ONCE at :root, so a home round card that
        re-declares --brand inline (views-home.js) would paint its "geteilt"
        label in the page's brand instead of its own.
     3. the ink — whatever the overlay maps --brand-ink to is AA on every ground
        brand text can sit on inside an overlay, resolved rather than restated.

   Named for what it covers (.claude/rules/test-file-names-collide-silently.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CSS, rulesOf } = require('./support/css');
const { token, contrast, mixOklab } = require('./support/theme');
const { DESIGN_REGISTRY } = require('../public/js/designs');

const ROOT = path.join(__dirname, '..');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const TISCH = strip(fs.readFileSync(path.join(ROOT, 'public/css/designs/tisch.css'), 'utf8'));
const GATE = ':root[data-design="tisch"][data-scheme="dark"]';
const OVERLAYS = ['.sheet', '.dialog', '.popover', '.menu'];
const AA_TEXT = 4.5;

// The TEXT property only: `border-color`, `outline-color`, `text-decoration-color`
// are not text, and the lookbehind keeps them out.
const colorDecls = (body) => [...body.matchAll(/(?<![-\w])color\s*:\s*([^;]+)/g)].map((m) => m[1].trim());
// Every reference to the brand in a value, and whether it is --brand-ink's fallback.
const BRAND_REF = /var\(--brand(?:-strong)?\)/g;
const unmapped = (value) => [...value.matchAll(BRAND_REF)]
  .filter((m) => !value.slice(0, m.index).endsWith('var(--brand-ink, '));

/* A glyph on its OWN brand-derived ground is not text on the overlay's paper:
   `.cover-ph` paints its gradient from --brand and its glyph from the same hue,
   and Der Tisch repaints the whole placeholder in wood anyway
   (.claude/rules/cover-ph-owns-the-coverless-game-glyph.md). */
const EXEMPT = new Set(['.cover-ph']);

test('every brand-coloured TEXT rule in styles.css reads the brand through --brand-ink', () => {
  const failures = [];
  let mapped = 0;
  for (const [selector, body] of rulesOf(CSS)) {
    for (const value of colorDecls(body)) {
      if (!BRAND_REF.test(value)) continue;
      BRAND_REF.lastIndex = 0;
      if (EXEMPT.has(selector)) continue;
      if (unmapped(value).length) failures.push(`${selector} { color: ${value} }`);
      else mapped++;
    }
  }
  assert.deepEqual(failures, [],
    'brand text that would paint brass on a Tisch overlay\'s paper — wrap it as var(--brand-ink, var(--brand…)):\n  '
    + failures.join('\n  '));
  // A floor that counts HITS, not attempts: a sweep whose pattern broke would
  // match nothing and pass (.claude/rules/source-scanning-guards-enumerate-shapes.md).
  assert.ok(mapped >= 70, `only ${mapped} brand text rules found — the sweep has stopped seeing them`);
});

test('no Tisch rule scoped to an overlay paints text from the raw brand', () => {
  const failures = [];
  for (const [selector, body] of rulesOf(TISCH)) {
    if (!OVERLAYS.some((o) => new RegExp(`\\${o}(?![\\w-])`).test(selector))) continue;
    for (const value of colorDecls(body)) {
      if (unmapped(value).length) failures.push(`${selector} { color: ${value} }`);
    }
  }
  assert.deepEqual(failures, []);
});

test('Klassisch: nothing outside the Tisch overlay rule declares --brand-ink, so every use falls back to the brand', () => {
  const declaring = (css) => rulesOf(css).filter(([, body]) => /(?:^|[;{\s])--brand-ink\s*:/.test(body)).map(([s]) => s);
  assert.deepEqual(declaring(CSS), [],
    'styles.css declares --brand-ink — a :root alias is substituted once and breaks a round card\'s own --brand');
  const inTisch = declaring(TISCH);
  assert.ok(inTisch.length >= 1, 'the Tisch overlay rule no longer declares --brand-ink');
  for (const selector of inTisch) {
    for (const part of selector.split(',').map((s) => s.trim())) {
      assert.ok(OVERLAYS.some((o) => part === `${GATE} ${o}`),
        `--brand-ink is declared on ${part}, which is not one of the scheme-gated overlay selectors`);
    }
  }
  // And the other designs' sheets: none of them may declare it either.
  const dir = path.join(ROOT, 'public/css/designs');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.css') && n !== 'tisch.css')) {
    assert.deepEqual(declaring(strip(fs.readFileSync(path.join(dir, f), 'utf8'))), [], `${f} declares --brand-ink`);
  }
});

test('the ink the overlay gives --brand-ink is AA on every ground brand text sits on in a Tisch overlay', () => {
  const tisch = DESIGN_REGISTRY.find((d) => d.id === 'tisch');
  assert.ok(tisch, 'no tisch design');
  // The overlay rule's own mapping, read rather than restated.
  const overlayBody = rulesOf(TISCH)
    .filter(([s, b]) => s.includes(`${GATE} .sheet`) && /--brand-ink\s*:/.test(b))
    .map(([, b]) => b).join(';');
  const mapsTo = (name) => {
    const m = new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*var\\((--[\\w-]+)\\)`).exec(overlayBody);
    return m && m[1];
  };
  const ink = mapsTo('--brand-ink');
  assert.ok(ink, 'the overlay rule does not map --brand-ink to a token');
  const v = (n) => token(n, tisch);
  const paper = v('--paper');
  const grounds = [
    ['--paper', paper],
    ['--paper-raised', v('--paper-raised')],
    ['--paper-sunken', v('--paper-sunken')],
    // The brand tints as the same rule re-points them (`.tag--custom`,
    // `.tables-seat.is-held`, a hovered menu row).
    ...['--brand-tint', '--brand-tint-soft'].map((t) => {
      const target = mapsTo(t) || null;
      assert.ok(target, `the overlay rule no longer re-points ${t}`);
      return [`${t} (→ ${target})`, v(target)];
    }),
    // `.design-card__badge` — the design chooser is a sheet.
    ['brand 12% on paper', mixOklab(v('--brand'), paper, 0.12)],
  ];
  const failures = grounds
    .map(([name, g]) => [name, contrast(v(ink), g)])
    .filter(([, r]) => r < AA_TEXT)
    .map(([name, r]) => `${ink} on ${name}: ${r.toFixed(2)}:1`);
  assert.deepEqual(failures, []);
  // And the defect this fixes is real: the raw brand on paper fails.
  assert.ok(contrast(v('--brand'), paper) < 3, 'brass on paper passes — the premise of #1260 moved');
});
