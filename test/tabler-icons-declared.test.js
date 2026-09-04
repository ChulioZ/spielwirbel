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

/* The three ways this codebase names an icon, and only those three — a bare
   `grep 'ti-[a-z-]*'` also matches prose ("multi-table", "arrows-split" in a
   comment) and would report false misses that nobody could act on.

   1. `class="ti ti-foo"` — the literal element, with any number of further
      classes after the icon name.
   2. `iconText('ti-foo', …)` — core.js's builder, which interpolates the name
      into exactly that markup.
   3. a bare quoted `'ti-foo'` — a name held in a variable or an array and
      interpolated into the markup later. The five mood faces in
      `public/js/rating-faces.js` are the case that forced it (#890): they have
      only ever been reached as `MOODS[n - 1]`, so neither shape above ever saw
      them, and five of the app's most-pressed glyphs sat outside this scan
      while it read as covering the whole app. Measured to add no false
      positive today — every quoted `'ti-…'` in `public/` and `lib/` is a real
      icon name, not prose.

   The first pattern used to require the closing quote IMMEDIATELY after the
   icon name (`class="ti (ti-[a-z0-9-]+)"`), which made every element carrying a
   second class invisible to the scan — six live sites across five icons
   (`ti-crown podium__crown`, `ti-chevron-down icon-picker__caret`,
   `ti-chevron-right round-card__chev`, `ti-copy import-card__icon`,
   `ti-sparkles gd-onboard__icon`). Measured: with `.ti-crown::before` deleted
   from the subset, the old pattern left this test GREEN, so the podium crown
   would have rendered nothing in production under a passing suite — the exact
   failure this file exists to prevent.

   `(?=[ "])` is what fixes it: the name must end at a space or the closing
   quote, so `ti-crown podium__crown` matches on `ti-crown` while a longer name
   is still never truncated to a shorter one. See
   .claude/rules/source-scanning-guards-enumerate-shapes.md — a source scan's
   coverage is the set of CALL SHAPES its regex happens to accept, and the shape
   it misses is invisible from a green run. */
const PATTERNS = [
  /class="ti (ti-[a-z0-9-]+)(?=[ "])/g,
  /iconText\('(ti-[a-z0-9-]+)'/g,
  /'(ti-[a-z0-9-]+)'/g,
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
