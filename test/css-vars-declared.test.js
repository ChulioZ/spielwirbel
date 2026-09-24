'use strict';

/* Every `var(--x)` the stylesheets read without a fallback names a custom
 * property something actually declares.
 *
 * An undeclared one fails silently: the declaration is invalid at computed-value
 * time, so `color` falls back to inherited and the line renders in full ink.
 * Eight Klassisch hub rules read `var(--muted)` from #1185 until #1262/#1263,
 * which no stylesheet of the app ever declared — secondary text that was never
 * muted, in every design, with nothing red.
 *
 * "Declared" is deliberately broad, because a custom property has three
 * legitimate writers here: a stylesheet (`--x:`), an inline style written by
 * view code (`style="--sc:…"`, `setProperty('--page-bg', …)`), and the design
 * registry's token maps. So the declared set is every `--name` that occurs in
 * the CSS as a declaration, or standing alone anywhere in public/js/ or
 * index.html. That
 * makes this guard unable to catch a typo that also appears in JS — accepted:
 * the failure it exists for is a name nothing writes at all.
 *
 * Comments are stripped before scanning the USES, or a comment documenting this
 * very trap (tisch.css names `var(--muted)`) would fail the guard
 * (.claude/rules/css-text-assertions-strip-comments.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (ext.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const CSS_FILES = [path.join(PUBLIC, 'styles.css'), ...walk(path.join(PUBLIC, 'css'), ['.css'])];
// index.html only: it is the one page that loads these stylesheets. The
// standalone pages (admin, login, kontakt) carry their own <style>, and a name
// admin.html declares for itself — it has its own --muted — is exactly what
// must NOT count as declared for styles.css.
const WRITERS = [...walk(path.join(PUBLIC, 'js'), ['.js']), path.join(PUBLIC, 'index.html')];

const declared = new Set();
for (const f of CSS_FILES) {
  for (const m of stripComments(fs.readFileSync(f, 'utf8')).matchAll(/(?<![\w-])(--[a-zA-Z0-9_-]+)\s*:/g)) declared.add(m[1]);
}
for (const f of WRITERS) {
  // Not preceded by a word character or a hyphen: `stamp--muted` is a BEM
  // modifier in a class name, not a custom property, and matching it is how
  // this guard first missed the very bug it was written for.
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?<![\w-])(--[a-zA-Z][a-zA-Z0-9_-]*)/g)) declared.add(m[1]);
}

test('every var() read without a fallback names a declared custom property', () => {
  const missing = [];
  let reads = 0;
  for (const f of CSS_FILES) {
    const css = stripComments(fs.readFileSync(f, 'utf8'));
    // `var(--x)` with no comma = no fallback. A fallback makes the read safe by
    // construction, so it is not this guard's business.
    for (const m of css.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g)) {
      reads++;
      if (!declared.has(m[1])) missing.push(`${path.relative(ROOT, f)}: ${m[1]}`);
    }
  }
  // Anti-vacuous: counts reads the pattern MATCHED, so a broken regex that
  // matches nothing cannot pass (.claude/rules/source-scanning-guards-enumerate-shapes.md).
  assert.ok(reads > 500, `only ${reads} var() reads matched — the scan is not seeing the stylesheets`);
  assert.deepEqual([...new Set(missing)], [], 'these custom properties are read but nothing declares them');
});
