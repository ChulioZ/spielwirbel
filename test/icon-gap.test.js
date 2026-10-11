'use strict';

/* One glyph-to-label gap on every icon-led button and link (#1640).

   About twenty controls per design rendered their Tabler glyph flush against
   the label: many templates write `</i>${label}` with no space, `.btn` was not
   a flex box (so `.rail__cta`'s `gap` was dead), and Der Tisch makes every
   `.link-btn` inline-flex, which drops even a space that IS in the markup.

   The pixels are a browser measurement — jsdom applies no stylesheet — so this
   pins the mechanism: the shared rule, the weight it must NOT have, and the
   design-sheet rules that would otherwise glue the glyph back on. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, CSS, rulesOf, topLevel, specificity, declaredValue } = require('./support/css');

const TISCH = fs.readFileSync(path.join(ROOT, 'public/css/designs/tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const members = (sel) => sel.split(/,(?![^(]*\))/).map((s) => s.trim());

const shared = () => {
  const hits = rulesOf(topLevel()).filter(([sel]) => sel.includes(':has(> .ti:first-child)'));
  assert.equal(hits.length, 1, `expected one shared icon-gap rule, found ${hits.length}`);
  return hits[0];
};

test('an icon-led .btn / .link-btn is a centred flex row with the shared gap', () => {
  const [, body] = shared();
  assert.equal(declaredValue(body, 'display'), 'inline-flex');
  assert.equal(declaredValue(body, 'align-items'), 'center');
  assert.equal(declaredValue(body, 'gap'), 'var(--icon-gap)');
});

test('the gap is one token on :root, sized in em so it follows each control', () => {
  const root = rulesOf(topLevel()).find(([sel]) => sel === ':root');
  assert.ok(root, ':root block not found');
  assert.match(declaredValue(root[1], '--icon-gap') || '', /^[\d.]+em$/);
});

/* The rule replaces the UA's inline-block, and nothing more. Any component that
   chose its own display (a rail hide, a flex CTA) or its own gap must still win,
   which zero weight guarantees and source order would not. */
test('the shared rule outranks nothing but the UA sheet and a.btn', () => {
  const [sel] = shared();
  const parts = members(sel);
  const bare = parts.filter((s) => !s.startsWith('a.btn'));
  const anchor = parts.filter((s) => s.startsWith('a.btn'));
  assert.ok(bare.length >= 1 && anchor.length === 1, `unexpected members: ${parts.join(' | ')}`);
  for (const s of bare) assert.deepEqual(specificity(s), [0, 0, 0], `${s} carries weight`);
  assert.deepEqual(specificity(anchor[0]), specificity('a.btn'), `${anchor[0]} must weigh exactly a.btn`);
  // ...and follow it, so it wins that tie and only that tie.
  const at = (s) => CSS.indexOf(s);
  assert.ok(at('a.btn {') >= 0 && at('a.btn {') < at(anchor[0]), 'the shared rule must come after a.btn');
});

test('a hidden control and an icon-only control are left alone', () => {
  for (const s of members(shared()[0])) {
    assert.match(s, /:not\(\[hidden\], \[aria-label\]\)/, `${s} must exclude [hidden] and [aria-label]`);
  }
});

/* The exclusion above leans on a convention: an icon-only control names itself
   with aria-label. Hold the convention, for the template-literal spelling every
   such control uses today (a control built with createElement is not seen). */
test('every icon-only .btn / .link-btn in the templates carries an aria-label', () => {
  const dir = path.join(ROOT, 'public/js');
  const iconOnly = /<(button|a)\b([^>]*\bclass="[^"]*\b(?:btn|link-btn)\b[^"]*"[^>]*)>\s*<i class="ti [^"]*"[^>]*><\/i>\s*<\/\1>/g;
  let seen = 0;
  const missing = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(iconOnly)) {
      seen += 1;
      if (!/\baria-label=/.test(m[2])) missing.push(`${f}: ${m[0].slice(0, 80)}`);
    }
  }
  assert.ok(seen >= 5, `only ${seen} icon-only controls matched — the scan has stopped seeing them`);
  assert.deepEqual(missing, []);
});

test('the rail CTA no longer declares a gap of its own', () => {
  const rail = rulesOf(CSS).filter(([sel]) => members(sel).includes('.rail__cta'));
  assert.ok(rail.length >= 1, '.rail__cta rule not found');
  for (const [, body] of rail) assert.equal(declaredValue(body, 'gap'), null);
});

test('Der Tisch: its inline-flex links and the phone „Neue Runde" card take the shared gap', () => {
  const rules = rulesOf(TISCH);
  const linkFlex = rules.find(([sel, body]) => members(sel).includes(':root[data-design="tisch"] .link-btn')
    && declaredValue(body, 'display') === 'inline-flex');
  assert.ok(linkFlex, "Der Tisch's .link-btn inline-flex rule not found");
  assert.equal(declaredValue(linkFlex[1], 'gap'), 'var(--icon-gap)');

  const newCard = rules.find(([sel]) => sel === ':root[data-design="tisch"][data-scheme="dark"] .round-card--new');
  assert.ok(newCard, 'the Tisch .round-card--new rule not found');
  assert.equal(declaredValue(newCard[1], 'gap'), 'var(--icon-gap)');

  // The old phone-only `gap: 6px` patch on the section-tools chips is gone.
  const literal = rules.filter(([sel, body]) => /\.link-btn(?![\w-])/.test(sel)
    && /^\d/.test(declaredValue(body, 'gap') || ''));
  assert.deepEqual(literal.map(([sel]) => sel), []);
});
