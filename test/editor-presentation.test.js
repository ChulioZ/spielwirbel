'use strict';

/* The three game-detail editors (tags, players, cover) present as an anchored
   popover from 860px up and as a bottom sheet below it (#422). Before this,
   they were popovers at every width and were therefore UNREACHABLE on a phone:
   focusing the input makes the browser scroll the page to reveal it, and
   `openPopover`'s own page-scroll teardown then removes the just-focused input
   from the DOM, so the keyboard never finishes opening. There was no way to tag
   a game from a phone at all.

   None of that is observable from Node — there is no layout, no soft keyboard,
   and the DOM is built correctly in both presentations — and the Browser pane
   can't reproduce it either (it reports `innerWidth === 0` and has no keyboard,
   see `.claude/rules/preview-pane-paint-artifacts.md`). So the routing is
   pinned here as source text, the way `dock-footer-clearance.test.js` pins its
   own silent-visual invariant. What a regression would look like: the editors
   quietly go back to popovers on phones, with every test still green.

   Comments are stripped before matching — a regex over raw source binds inside
   a comment that merely MENTIONS the thing it's looking for
   (`.claude/rules/css-text-assertions-strip-comments.md` makes the same point
   for CSS). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { bodyOf } = require('./support/css');

const ROOT = path.join(__dirname, '..');
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const DETAIL = strip(fs.readFileSync(path.join(ROOT, 'public/js/views-round-detail.js'), 'utf8'));
const CORE = strip(fs.readFileSync(path.join(ROOT, 'public/js/core.js'), 'utf8'));

// A function's body, brace-matched from its declaration.
function bodyOfFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const EDITORS = ['openPlayersPopover', 'openTagsPopover', 'openImagePopover'];

test('all three game-detail editors route through openEditor, never openPopover directly', () => {
  for (const name of EDITORS) {
    const body = bodyOfFn(DETAIL, name);
    assert.match(body, /openEditor\(/, `${name} no longer goes through openEditor — it would be a popover on phones again (#422)`);
    assert.doesNotMatch(body, /openPopover\(/, `${name} calls openPopover directly, bypassing the sheet presentation (#422)`);
  }
});

test('each editor passes a variant and a translated title to openEditor', () => {
  // The title becomes the sheet's heading AND its aria-label, so a missing one
  // is both a blank head and an unnamed dialog. They reuse the onboarding
  // button labels, which already exist in both languages — no parity risk.
  const expected = {
    openPlayersPopover: ['players', 'detail.onboard.players'],
    openTagsPopover: ['tags', 'detail.onboard.tags'],
    openImagePopover: ['image', 'detail.onboard.cover'],
  };
  for (const [name, [variant, key]] of Object.entries(expected)) {
    const body = bodyOfFn(DETAIL, name);
    assert.match(body, new RegExp(`openEditor\\(\\s*anchor,\\s*'${variant}',\\s*t\\('${key}'\\)`),
      `${name} does not pass ('${variant}', t('${key}')) to openEditor`);
  }
});

test('the sheet presentation goes through openSheet/closeSheet', () => {
  // Not a style preference: openSheet installs the focus trap (#145) and pushes
  // the history marker that makes Back dismiss the sheet (#333). Assigning
  // activeSheet directly gets neither, silently — which is exactly why
  // `.claude/rules/accessibility-contrast-and-modals.md` §2 requires the call.
  const body = bodyOfFn(DETAIL, 'openEditor');
  assert.match(body, /openSheet\(backdrop, onKey\)/, 'openEditor does not register its sheet via openSheet');
  assert.match(body, /closeSheet\(\)/, 'openEditor never closes through closeSheet');
  assert.doesNotMatch(body, /activeSheet\s*=/, 'openEditor assigns activeSheet directly — it would miss the focus trap and Back-dismissal');
});

test('openEditor does not open its sheet behind a leading closeSheet()', () => {
  // The #333 trap: a leading closeSheet() queues an async history.back() that
  // lands AFTER the new sheet is up and dismisses it. openSheet tears down an
  // already-open sheet itself, synchronously.
  const body = bodyOfFn(DETAIL, 'openEditor');
  const firstClose = body.indexOf('closeSheet(');
  const build = body.indexOf('build(body');
  assert.ok(firstClose === -1 || firstClose > build,
    'openEditor calls closeSheet() before building its sheet (see .claude/rules/sheet-history-back-dismissal.md)');
});

test('the presentation switches at 860px — the existing dock/strip breakpoint', () => {
  // Reused deliberately rather than invented, so the editors change shape at
  // the same width as the navigation (.claude/rules/responsive-hub-tabs.md).
  assert.match(DETAIL, /const EDITOR_SHEET_BELOW = 860;/,
    'the editor breakpoint is no longer 860px — it must stay the dock/strip breakpoint');
  const body = bodyOfFn(DETAIL, 'usesEditorSheet');
  assert.match(body, /matchMedia\(`\(min-width: \$\{EDITOR_SHEET_BELOW\}px\)`\)\.matches/,
    'usesEditorSheet no longer derives from EDITOR_SHEET_BELOW');
  // Below the breakpoint means SHEET. An inverted test would strand phones on
  // the popover while every other assertion here still passed.
  assert.match(body, /return !window\.matchMedia/, 'usesEditorSheet is inverted — phones would get the popover');
});

test('openPopover runs the build callback only once the popover is in the document', () => {
  // build() runs on a DETACHED node, so `input.focus()` inside it is a silent
  // no-op — the editors' autofocus had never worked on any platform. The
  // returned callback is what fixes it, and it is only correct AFTER the
  // appendChild; running it earlier restores the original bug with no symptom
  // other than "the keyboard doesn't come up".
  const body = bodyOfFn(CORE, 'openPopover');
  const append = body.indexOf('document.body.appendChild(el)');
  const invoke = body.search(/if \(typeof attached === 'function'\) attached\(\)/);
  assert.notEqual(append, -1, 'openPopover no longer appends the popover');
  assert.notEqual(invoke, -1, 'openPopover no longer invokes the callback returned by build()');
  assert.ok(invoke > append, 'openPopover runs the attach callback before the element is in the document — focus() would be a no-op again');
});

test('the editors focus via the attach callback, not inline in build()', () => {
  for (const name of ['openPlayersPopover', 'openTagsPopover']) {
    const body = bodyOfFn(DETAIL, name);
    assert.match(body, /return \(\) => .*focus\(\)/s, `${name} does not return an attach callback that focuses its input`);
  }
});

test('the editors\' inner layout rules are shared by both presentations', () => {
  // One builder, two containers: a rule scoped to `.popover--tags` alone leaves
  // the sheet unstyled (and vice versa). `:is()` keeps the original (0,2,0)
  // specificity, so nothing else in the cascade shifts.
  for (const sel of [
    ':is(.popover--players, .editor--players) .pp-row',
    ':is(.popover--players, .editor--players) .pp-row .input',
    ':is(.popover--tags, .editor--tags) .pp-row',
    ':is(.popover--tags, .editor--tags) .pp-row .input',
    ':is(.popover--tags, .editor--tags) .filter-chips',
  ]) {
    assert.ok(bodyOf(sel), `${sel} not found — one presentation is missing this layout rule`);
  }
  // The sheet body must stack its rows the way `.popover` does; without it the
  // cover editor's two buttons sit on one line and the tag rows lose their gap.
  const editor = bodyOf('.editor');
  assert.ok(editor, '.editor rule not found in styles.css');
  assert.match(editor, /display:\s*flex/);
  assert.match(editor, /flex-direction:\s*column/);
});
