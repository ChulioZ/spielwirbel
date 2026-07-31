'use strict';

/* `.ds-row` is the app's click-target component: it declares `cursor: pointer`
   plus a `:hover` lift. Six rows across the Freundeskreis, the inbox and the
   Tags screen reused it for its LAYOUT while having no row-level handler at all
   — only the buttons at their right edge respond — so they promised an
   interaction that does not exist (#557). On the Freundeskreis that was every
   row on the screen.

   Nothing fails when this regresses: no error, no other failing test, no visual
   breakage, and the controls that DO work are all present. It is purely a
   promise the UI does not keep, which is how it survived from #325 until #557 —
   so pin it, the way settled-tiles.test.js and dock-footer-clearance.test.js
   pin their own silent visual invariants. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Shared parser: strips comments + tokenizes into [selector, body], so a regex
// can't bind inside a comment that merely mentions a class. See
// `.claude/rules/css-text-assertions-strip-comments.md`.
const { ROOT, bodyOf } = require('./support/css');

/* Every `.ds-row` CONSTRUCTION site in the frontend, as { file, el, cls }.
   Matching `ds-row` as a whole class keeps the `__main`/`__meta`/`__date`
   children out (`_` is a word character, so the guard rejects them) while still
   catching the conditional `class="ds-row${…}"` form. A class attribute here may
   hold a template interpolation but never a double quote, so `[^"]*` is safe. */
function rowSites() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js')) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/<(div|a|button|label)\s+class="(ds-row(?![\w-])[^"]*)"/g)) {
          out.push({ file: path.relative(ROOT, p), el: m[1], cls: m[2] });
        }
      }
    }
  };
  walk(path.join(ROOT, 'public/js'));
  return out;
}

const optsOut = (cls) => /ds-row--static(?![\w-])/.test(cls);

test('every .ds-row is either a native click target or opts out of the affordance', () => {
  const sites = rowSites();
  /* Anti-vacuous: with a renamed component or a broken regex the scan returns
     nothing and every assertion below passes over an empty list. */
  assert.ok(sites.length >= 12, `expected the frontend to build >= 12 .ds-rows, found ${sites.length}`);

  for (const { file, el, cls } of sites) {
    if (el === 'div') {
      /* A <div> has no native activation, so only a row-level click handler
         could make it interactive — and none of these rows has one (the
         conditional inbox item interpolates the modifier for its read state).
         A row that genuinely becomes clickable should become an <a>/<button>
         rather than keep the affordance on a div:
         `.claude/rules/native-button-vs-focusable-span.md`. */
      assert.ok(optsOut(cls),
        `${file}: <div class="${cls}"> has no row-level handler but keeps the .ds-row click affordance — add ds-row--static`);
    } else {
      /* The half that stops the first from being satisfied by spraying the
         modifier over every row: <a>, <button> and <label> rows are real click
         targets (navigation, an action, a checkbox) and must keep it. */
      assert.ok(!optsOut(cls),
        `${file}: <${el} class="${cls}"> is a real click target and must not opt out of the affordance`);
    }
  }
});

test('the ds-row--static opt-out neutralizes both halves of the affordance', () => {
  // Preconditions — without these the opt-out would have nothing to override,
  // and the assertions below would pass against a component that no longer
  // offers a false affordance in the first place.
  assert.match(bodyOf('.ds-row') || '', /cursor:\s*pointer/, '.ds-row is no longer the click-target component');
  assert.match(bodyOf('.ds-row:hover') || '', /box-shadow:/, '.ds-row no longer lifts on hover');

  assert.match(bodyOf('.ds-row.ds-row--static') || '', /cursor:\s*default/);
  assert.match(bodyOf('.ds-row.ds-row--static:hover') || '', /box-shadow:\s*none/);
});

test('the opt-out wins on specificity, not source order', () => {
  /* A bare `.ds-row--static` ties with `.ds-row` at (0,1,0), and
     `.ds-row--static:hover` ties with `.ds-row:hover` at (0,1,1) — so both
     would be decided by which block sits later in the file and would silently
     stop working if either moved. The compound form outranks its base outright.
     Same lesson as `.claude/rules/label-rows-lose-to-field-label.md`. */
  for (const sel of ['.ds-row.ds-row--static', '.ds-row.ds-row--static:hover']) {
    assert.ok(bodyOf(sel), `${sel} not found — the opt-out must be compounded, not bare`);
  }
  assert.equal(bodyOf('.ds-row--static'), null,
    'a bare .ds-row--static ties with .ds-row and would win on source order alone');
  assert.equal(bodyOf('.ds-row--static:hover'), null,
    'a bare .ds-row--static:hover ties with .ds-row:hover and would win on source order alone');
});
