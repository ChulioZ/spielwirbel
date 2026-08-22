'use strict';

/* Every Tabler icon the app asks for is actually declared (#282, #796).

   `public/fonts/tabler-icons.css` is a curated SUBSET: the woff2 holds ~5000
   glyphs but only the `.ti-X::before` lines somebody remembered to add exist. An
   `<i class="ti ti-foo">` whose rule is missing renders **nothing at all** — no
   tofu, no console warning, no lint error, no failing test. It occupies near-zero
   width and the label beside it still reads fine, so the UI looks merely plain
   rather than broken.

   #282 found eight already-invisible icons that way, two of them shipped for a
   year. #796 added three more (`ti-layout-grid`, `ti-alert-triangle`,
   `ti-arrow-down`) and they were caught only because a screenshot happened to
   show a blank thumbnail. `.claude/rules/tabler-icon-codepoints.md` prescribed a
   grep; this is that grep, mechanised — the remedy for a rule that was right and
   got skipped anyway.

   What it CANNOT see is a wrong-but-present codepoint, which renders a plausible
   other icon. That still needs the cmap check and a look at the rendered glyph;
   the rule has both. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Every source file that can name an icon: the shared-scope frontend scripts,
// the standalone page scripts, the two HTML documents and the server-rendered
// pages (lib/faq.js and lib/legal.js build markup in template literals).
function sources() {
  const out = [];
  const walk = (dir, filter) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel, filter);
      else if (filter(entry.name)) out.push([rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')]);
    }
  };
  walk('public', (n) => n.endsWith('.js') || n.endsWith('.html'));
  walk('lib', (n) => n.endsWith('.js'));
  return out;
}

/* The two ways this codebase names an icon, and only those two — a bare
   `grep 'ti-[a-z-]*'` also matches prose ("multi-table", "arrows-split" in a
   comment) and would report false misses that nobody could act on.

   1. `class="ti ti-foo"` — the literal element.
   2. `iconText('ti-foo', …)` — core.js's builder, which interpolates the name
      into exactly that markup. */
const PATTERNS = [
  /class="ti (ti-[a-z0-9-]+)"/g,
  /iconText\('(ti-[a-z0-9-]+)'/g,
];

test('every Tabler icon class the app renders is declared in the subset', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/fonts/tabler-icons.css'), 'utf8');
  const declared = new Set([...css.matchAll(/^\.(ti-[a-z0-9-]+)::before/gm)].map((m) => m[1]));
  // Anti-vacuous: a regex that silently stopped matching would assert nothing.
  assert.ok(declared.size >= 80, `parsed ${declared.size} declared icons, expected the full subset`);

  const used = new Map(); // name -> where it was first seen
  for (const [rel, text] of sources()) {
    for (const re of PATTERNS) {
      for (const m of text.matchAll(re)) if (!used.has(m[1])) used.set(m[1], rel);
    }
  }
  assert.ok(used.size >= 40, `found ${used.size} icon uses, expected many more`);

  const missing = [...used].filter(([name]) => !declared.has(name)).sort();
  assert.deepEqual(
    missing.map(([name, rel]) => `${name} (${rel})`),
    [],
    'these classes render NOTHING — add a line to public/fonts/tabler-icons.css'
      + ' with the codepoint read from that woff2\'s own cmap'
      + ' (.claude/rules/tabler-icon-codepoints.md), never from tabler.io'
  );
});
