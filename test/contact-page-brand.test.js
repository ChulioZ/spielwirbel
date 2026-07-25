'use strict';

/* The standalone contact page (#391) styles itself from a COPY of the app's
   design tokens. It cannot share the real thing: linking public/styles.css would
   pull the whole SPA stylesheet — including its own `body`, `.card` and `.input`
   rules — onto a page that has no round context and must render logged-out.

   A hand-copied constant across two files is precisely the drift that
   .claude/rules/shared-constants-across-the-stack.md exists about, and there the
   one duplicate deemed acceptable (TAG_ICONS) is acceptable *because* a test
   asserts the two copies are identical. This is that test: retune --brand in
   styles.css alone and the contact page silently keeps the old orange. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Comments are brace-free text, so a :root matcher happily runs straight through
// one — see .claude/rules/css-text-assertions-strip-comments.md.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = strip(fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8'));
const PAGE = strip(fs.readFileSync(path.join(ROOT, 'public/kontakt.html'), 'utf8'));

// Custom properties declared in the first :root block of a stylesheet.
function rootVars(css) {
  const block = css.match(/:root\s*{([^}]*)}/);
  assert.ok(block, 'expected a :root block');
  const vars = new Map();
  for (const [, name, value] of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(name, value.trim().replace(/\s+/g, ' '));
  }
  return vars;
}

test('every design token the contact page copies still matches public/styles.css', () => {
  const app = rootVars(CSS);
  const page = rootVars(PAGE);

  assert.ok(page.size >= 10, `expected the page to declare its tokens, got ${page.size}`);

  for (const [name, value] of page) {
    assert.ok(app.has(name), `${name} is declared in kontakt.html but no longer in styles.css`);
    assert.equal(
      value, app.get(name),
      `${name} has drifted: kontakt.html says "${value}", styles.css says "${app.get(name)}"`,
    );
  }
});

test('the contact page only @font-faces weights the app self-hosts', () => {
  const faces = [...PAGE.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
  assert.ok(faces.length > 0, 'expected the page to declare its own @font-face rules');

  for (const face of faces) {
    const src = face.match(/url\('([^']+)'\)/);
    assert.ok(src, `@font-face with no url(): ${face}`);
    // Root-absolute so it resolves the same from any route depth, and a real
    // file so the browser doesn't silently fall back to system-ui. The build
    // copies fonts through unhashed, so this path holds in dist/ too.
    assert.match(src[1], /^\/fonts\//, `font src must be root-absolute: ${src[1]}`);
    assert.ok(
      fs.existsSync(path.join(ROOT, 'public', src[1])),
      `${src[1]} does not exist — the contact page would fall back to system-ui`,
    );
    // The same file the SPA loads, not a second copy of the typeface.
    assert.ok(
      CSS.includes(src[1].replace(/^\//, '')),
      `${src[1]} is not among the fonts public/styles.css declares`,
    );
  }
});
