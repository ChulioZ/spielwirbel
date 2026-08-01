'use strict';

/* The pages outside the SPA — the contact page (#391), the shared-password login
   page (#595) and the server-rendered FAQ (#489) — style themselves from a COPY
   of the app's design tokens. They cannot share the real thing: linking
   public/styles.css would pull the whole SPA stylesheet — including its own
   `body`, `.card` and `.input` rules — onto pages that have no round context and
   must render logged-out.

   The FAQ is a `lib/` module rather than a file under `public/`, and it is
   covered by exactly the same three assertions: they read the file as TEXT and
   pull the declarations out of its `<style>` block, so whether that block sits
   in an .html document or in a template literal makes no difference. It does
   impose one constraint on lib/faq.js — the CSS must be written inline in the
   template, never hoisted into a `const` the tag interpolates, or the third
   assertion below scans an interpolation instead of rules and passes vacuously.
   That constraint is written down at its end of the wire too.

   A hand-copied constant across two files is precisely the drift that
   .claude/rules/shared-constants-across-the-stack.md exists about, and there the
   one duplicate deemed acceptable (TAG_ICONS) is acceptable *because* a test
   asserts the two copies are identical. This is that test: retune --brand in
   styles.css alone and these pages silently keep the old orange.

   Covering a third standalone page is one entry in PAGES below — deliberately
   one parameterized file rather than a near-identical second one. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Comments are brace-free text, so a :root matcher happily runs straight through
// one — see .claude/rules/css-text-assertions-strip-comments.md.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (rel) => strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const CSS = read('public/styles.css');
const PAGES = ['public/kontakt.html', 'public/login.html', 'lib/faq.js'];

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

for (const rel of PAGES) {
  const PAGE = read(rel);

  test(`every design token ${rel} copies still matches public/styles.css`, () => {
    const app = rootVars(CSS);
    const page = rootVars(PAGE);

    // Per page, never over the union: a well-populated page would otherwise
    // satisfy the floor for one that declares nothing and passes vacuously.
    assert.ok(page.size >= 10, `expected ${rel} to declare its tokens, got ${page.size}`);

    for (const [name, value] of page) {
      assert.ok(app.has(name), `${name} is declared in ${rel} but no longer in styles.css`);
      assert.equal(
        value, app.get(name),
        `${name} has drifted: ${rel} says "${value}", styles.css says "${app.get(name)}"`,
      );
    }
  });

  test(`${rel} only @font-faces weights the app self-hosts`, () => {
    const faces = [...PAGE.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
    assert.ok(faces.length > 0, `expected ${rel} to declare its own @font-face rules`);

    for (const face of faces) {
      const src = face.match(/url\('([^']+)'\)/);
      assert.ok(src, `@font-face with no url(): ${face}`);
      // Root-absolute so it resolves the same from any route depth, and a real
      // file so the browser doesn't silently fall back to system-ui. The build
      // copies fonts through unhashed, so this path holds in dist/ too.
      assert.match(src[1], /^\/fonts\//, `font src must be root-absolute: ${src[1]}`);
      assert.ok(
        fs.existsSync(path.join(ROOT, 'public', src[1])),
        `${src[1]} does not exist — ${rel} would fall back to system-ui`,
      );
      // The same file the SPA loads, not a second copy of the typeface.
      assert.ok(
        CSS.includes(src[1].replace(/^\//, '')),
        `${src[1]} is not among the fonts public/styles.css declares`,
      );
    }
  });

  test(`${rel} declares no palette hex outside its :root token copy`, () => {
    const style = PAGE.match(/<style>([\s\S]*?)<\/style>/);
    assert.ok(style, `expected ${rel} to carry an inline <style>`);
    // Everything after the :root block: the page's own rules, which must resolve
    // their colours through the tokens above rather than restating a palette
    // value (.claude/rules/theme-derived-colors.md) — that is how login.html
    // came to render in a blue-violet nobody could retune from styles.css.
    // #fff/#000 stay allowed: they are the two non-palette absolutes the app's
    // own rules use inline (button ink, shadow stops).
    const rules = style[1].slice(style[1].indexOf('}', style[1].indexOf(':root')) + 1);
    const stray = [...rules.matchAll(/#[0-9a-f]{3,8}\b/gi)]
      .map((m) => m[0])
      .filter((hex) => !/^#(fff|ffffff|000|000000)$/i.test(hex));
    assert.deepEqual(stray, [], `${rel} hardcodes ${stray.join(', ')} outside its :root copy`);
  });
}
