'use strict';

/* Der Tisch's gold (winning) Tafel row paints every cell in --gold-ink through a
 * DERIVED sweep (`.trow *`, review finding A2). The sweep also reached the
 * coverless thumbnail's glyph, which sits on the cover's own walnut ground, so
 * row 1's whirl went dark-on-dark while rows 2+ kept the light ink (#1641).
 *
 * The fix has two halves and this pins both:
 * - styles.css's `.cover-ph` carries its ink as a NAMED property, --cover-ink,
 *   in the fallback and in the `@supports` relative-colour form alike, and
 *   paints `color` from it. The sweep only sets `color`, so the property
 *   survives on the element.
 * - tisch.css hands it back on the gold row — box and glyph, both of which the
 *   `*` reaches — with a rule that outranks the sweep. A design sheet may only
 *   read var() (test/design-layer.test.js), which is why the ink is a property
 *   rather than a restated formula.
 *
 * Text assertions (.claude/rules/css-text-assertions-strip-comments.md): jsdom
 * applies no external stylesheet, so the cascade question is answered by
 * specificity, which is what decides it in a browser too. Existence lookups go
 * through topLevel() (.claude/rules/css-rule-lookup-answers-with-the-media-reset.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CSS, rulesOf, topLevel, bodyOfIn, declaredValue, outranks } = require('./support/css');

const TISCH = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const GOLD = ':root[data-design="tisch"][data-scheme="dark"] .tafel .tafel-top .trow';
const SWEEP = `${GOLD} *`;
const PH = `${GOLD} .cover-ph`;
const GLYPH = `${GOLD} .cover-ph .ti`;

const SUPPORTS = '@supports (color: oklch(from red l c h))';

// The rules inside every `@supports (color: oklch(from …))` block of a sheet.
function supportsRules(css) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(SUPPORTS, from);
    if (at < 0) return out;
    const open = css.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    for (; depth && i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    out.push(...rulesOf(css.slice(open + 1, i - 1)));
    from = i;
  }
}

// Unconditional rules only: no @media (topLevel), no @supports.
const unconditional = (css) => {
  const inner = new Set(supportsRules(css).map(([s, b]) => s + b));
  return rulesOf(topLevel(css)).filter(([s, b]) => !inner.has(s + b));
};

test('the gold-row sweep is still there and still derived', () => {
  assert.equal(declaredValue(bodyOfIn(SWEEP, rulesOf(topLevel(TISCH))), 'color'), 'var(--gold-ink)',
    'the A2 single-ink sweep must stay intact — the exemption narrows nothing');
});

test('.cover-ph paints its glyph from a named --cover-ink, in both colour forms', () => {
  const base = bodyOfIn('.cover-ph', unconditional(CSS));
  assert.equal(declaredValue(base, 'color'), 'var(--cover-ink)', '.cover-ph must paint color from --cover-ink');
  assert.ok(declaredValue(base, '--cover-ink'), '.cover-ph must declare the fallback --cover-ink');
  const rel = bodyOfIn('.cover-ph', supportsRules(CSS));
  assert.match(declaredValue(rel, '--cover-ink') || '', /^oklch\(from var\(--brand\)/,
    'the @supports form must set --cover-ink, not color — a color there would win over the var() and the hand-back would restore only the fallback');
  assert.equal(declaredValue(rel, 'color'), null);
});

test('the placeholder and its glyph on the gold row take --cover-ink back, outranking the sweep', () => {
  for (const sel of [PH, GLYPH]) {
    assert.equal(declaredValue(bodyOfIn(sel, rulesOf(topLevel(TISCH))) || '', 'color'), 'var(--cover-ink)',
      `${sel} must hand the placeholder's own ink back`);
    assert.ok(outranks(sel, SWEEP), `${sel} must outrank the sweep`);
  }
});
