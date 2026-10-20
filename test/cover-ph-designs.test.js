'use strict';

/* #1642: every design varies its no-cover placeholder per game. #256 gave
   Klassisch a per-title gradient, and each design sheet then replaced
   `.cover-ph` with ONE uniform tile — so in five of six designs every coverless
   game looked the same, the landing hero's demo pot included. Each design now
   reads the per-title `--cover-h` that coverPlaceholder() writes.

   jsdom applies no stylesheet, so the CSS half is asserted as text; the look
   itself was judged in a browser (the PR has the screenshots). */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { rulesOf } = require('./support/css');

const ROOT = path.join(__dirname, '..');
const sheet = (id) => fs.readFileSync(path.join(ROOT, 'public', 'css', 'designs', `${id}.css`), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// Each design's scheme gate (.claude/rules/design-colour-blocks-are-scheme-gated.md,
// light-design-gate-and-shared-design-ids.md).
const DESIGNS = {
  tisch: '[data-scheme="dark"]',
  ocean: ':not([data-scheme="dark"])',
  bruecke: '[data-scheme="dark"]',
  programmheft: ':not([data-scheme="dark"])',
  forest: ':not([data-scheme="dark"])',
};

const placeholderBodies = (id) => {
  const selector = `:root[data-design="${id}"]${DESIGNS[id]} .cover-ph`;
  return rulesOf(sheet(id)).filter(([sel]) => sel === selector).map(([, body]) => body);
};

// The `oklch(from …)` calls in a body, each with its balanced arguments.
function relativeColours(body) {
  const out = [];
  let at = body.indexOf('oklch(');
  while (at !== -1) {
    let depth = 0;
    let i = at + 5;
    for (; i < body.length; i += 1) {
      if (body[i] === '(') depth += 1;
      else if (body[i] === ')' && --depth === 0) break;
    }
    out.push(body.slice(at, i + 1));
    at = body.indexOf('oklch(', i);
  }
  return out;
}

test('the list of designs is the registry\'s list of design sheets', () => {
  // A new design with a sheet must answer the question too, so the list here
  // cannot silently stop covering one.
  const onDisk = fs.readdirSync(path.join(ROOT, 'public', 'css', 'designs'))
    .filter((f) => f.endsWith('.css')).map((f) => f.replace(/\.css$/, '')).sort();
  assert.deepEqual(Object.keys(DESIGNS).sort(), onDisk);
});

for (const id of Object.keys(DESIGNS)) {
  test(`${id}: the scheme-gated .cover-ph rule varies per game by reading --cover-h`, () => {
    const bodies = placeholderBodies(id);
    assert.ok(bodies.length >= 1, `${id}.css has no scheme-gated .cover-ph rule`);
    assert.ok(bodies.some((b) => b.includes('var(--cover-h')),
      `${id}.css paints one uniform placeholder — no .cover-ph rule reads --cover-h`);
  });

  test(`${id}: --cover-h never carries a unit inside a hue channel`, () => {
    /* .claude/rules/deterministic-cover-placeholders.md §1: inside oklch(from …)
       `h` is a NUMBER of degrees, so a `deg` there invalidates the whole
       background — computed `none`, a flat box, no console error. An angle or a
       length may multiply --cover-h by a unit; a relative colour may not. */
    for (const body of placeholderBodies(id)) {
      for (const d of relativeColours(body)) {
        assert.doesNotMatch(d, /deg/, `${id}.css: a unit inside a relative colour drops the background — ${d}`);
        /* The shift usually arrives through a property declared in the same
           rule (--wood-dh, --sea-dh, --panel-dh), so a `deg` written THERE
           reaches the channel without appearing in the oklch() text. Follow
           each one; the source token and --cover-h are declared elsewhere. */
        for (const [, name] of d.matchAll(/var\((--[a-z0-9-]+)/g)) {
          const decl = new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;]+)`).exec(body);
          if (decl) {
            assert.doesNotMatch(decl[1], /deg/,
              `${id}.css: ${name} feeds a relative colour and carries a unit — ${decl[1].trim()}`);
          }
        }
      }
    }
  });
}

test('Forest\'s Regal placeholder carries the same per-title --cover-h as coverPlaceholder()', () => {
  /* forestNoCover() replaces coverPlaceholder() on Forest's shelf card and
     used to take no argument, so the hatch had nothing to vary on. */
  const ctx = vm.createContext({ esc: (s) => String(s), t: (k) => k });
  for (const f of ['cover.js', 'forest-shelf.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'), ctx, { filename: f });
  }
  const html = vm.runInContext('forestNoCover({ title: "Catan" })', ctx);
  const hue = vm.runInContext('gameHue("Catan")', ctx);
  assert.match(html, new RegExp(`style="--cover-h:${hue}"`));
  assert.notEqual(vm.runInContext('forestNoCover({ title: "Azul" })', ctx), html,
    'two titles must not draw the same placeholder');
});
