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

/* ---- #424: the four triggers that OPEN those editors are keyboard-reachable ----

   Until #424 every one of them was a click-only <span>/<div>: Tab skipped all
   four, so a keyboard user could not change a game's cover, title, player range
   or tags at all. Three are now real <button>s and the title is a
   role=button/tabindex span (it is inline text that wraps mid-line, which an
   atomic inline-block button cannot do).

   As above, none of this is observable from Node — it is DOM built by a view
   function that cannot be required (requiring a view file sinks the coverage
   gate, .claude/rules/frontend-helper-modules-and-coverage.md). So the markup is
   pinned as source text and the un-button-ing CSS via the stylesheet. What a
   regression looks like: the chips quietly go back to spans, Tab skips them
   again, and every test stays green. */

test('all four game-detail editor triggers are keyboard-focusable', () => {
  const body = bodyOfFn(DETAIL, 'showGameDetail');

  // The cover and the chips: real buttons, so Enter *and* Space and focus
  // restoration come from the platform rather than a hand-rolled keydown.
  assert.match(body, /<button type="button" class="gd-img gd-img--edit"/,
    'the cover is not a <button> — Tab would skip it again (#424)');
  const chip = bodyOfFn(DETAIL, 'editableTag');
  assert.match(chip, /<button type="button" class="tag tag--edit/,
    'editableTag no longer builds a <button> — every chip loses keyboard access at once (#424)');

  // The title keeps its span, so it needs both halves explicitly: focusable AND
  // activatable. A tabindex with no keydown is a focus stop that does nothing.
  assert.match(body, /class="gd-title" role="button" tabindex="0"/,
    'the title span lost role=button/tabindex — it is unreachable by Tab (#424)');
  assert.match(body, /e\.key === 'Enter' \|\| e\.key === ' '/,
    'the title has no Enter/Space handler — Tab reaches a control that cannot be activated');
});

test('every editable chip goes through the one editableTag chokepoint', () => {
  // Four variants (players/tags × filled/empty) and one builder: a call site
  // that hand-rolls its own chip is how one of them silently stays a span.
  const body = bodyOfFn(DETAIL, 'showGameDetail');
  // The declaration lives inside showGameDetail too, hence the lookbehind.
  assert.equal((body.match(/(?<!function )editableTag\(/g) || []).length, 4,
    'expected exactly four editableTag() call sites (players/tags × filled/empty)');
  assert.doesNotMatch(body, /<span class="tag tag--(players|custom)/,
    'a chip is still built as a plain <span> — it would be mouse-only (#424)');
});

test('the title cancel path hands focus back to the trigger', () => {
  // Escape puts the span back; without the focus() a keyboard user is dropped to
  // <body> and restarts from the top of the document.
  const body = bodyOfFn(DETAIL, 'startTitleEdit');
  assert.match(body, /Escape'\s*\)\s*\{[^}]*replaceWith\(spanEl\);\s*spanEl\.focus\(\)/,
    'Escape out of the title editor no longer restores focus to the title (#424)');
});

test('closing a popover restores focus to the control that opened it', () => {
  // The sheet presentation gets this from trapFocus (#145); the popover had no
  // equivalent, so on a desktop closing an editor dropped focus to <body>.
  const open = bodyOfFn(CORE, 'openPopover');
  const close = bodyOfFn(CORE, 'closePopover');
  assert.match(open, /const restoreTo = document\.activeElement;\s*closePopover\(\)/,
    'openPopover must capture its restore target BEFORE the replace-close, or it captures the previous popover\'s opener');
  assert.match(close, /restoreTo\.focus\(\)/, 'closePopover no longer restores focus (#424)');
  // Read while the popover is still in the document: el.remove() moves focus to
  // <body> on its own, so a check made afterwards is always true.
  const held = close.indexOf('el.contains(document.activeElement)');
  const remove = close.indexOf('el.remove()');
  assert.notEqual(held, -1, 'closePopover no longer checks whether it still holds focus before stealing it back');
  assert.ok(held < remove, 'closePopover reads the focus-held check after el.remove(), which always reports body');
});

test('the button triggers keep their pill/frame look, and .tag--empty keeps its dashed border', () => {
  const edit = bodyOf('.tag--edit');
  assert.ok(edit, '.tag--edit rule not found');
  // font-family only — a `font` shorthand would reset .tag's 13px/700 to the
  // inherited 26px of the <h1> the chips live in.
  assert.match(edit, /font-family:\s*inherit/, '.tag--edit does not inherit the font — chips would render in the UA button font');
  assert.doesNotMatch(edit, /font:\s/, '.tag--edit uses the `font` shorthand — it would blow away .tag\'s font-size/weight');
  assert.match(edit, /line-height:\s*inherit/, '.tag--edit does not inherit line-height — the pill is ~4px shorter than as a span');
  assert.doesNotMatch(edit, /(^|;)\s*color:/, '.tag--edit sets color — it would override .tag--players/--custom/--empty on source order');

  // Scoped with :not() on purpose: an unscoped `border: 0` ties with
  // .tag--empty's dashed border on specificity and wins or loses purely on where
  // the blocks sit in the file.
  assert.ok(bodyOf('.tag--edit:not(.tag--empty)'), '.tag--edit:not(.tag--empty) not found — the border reset now competes with .tag--empty');
  assert.match(bodyOf('.tag--edit:not(.tag--empty)'), /border:\s*0/);
  assert.match(bodyOf('.tag--empty'), /border:\s*1px dashed/, '.tag--empty lost its dashed border');

  const img = bodyOf('.gd-img--edit');
  assert.ok(img, '.gd-img--edit rule not found');
  for (const decl of [/border:\s*0/, /padding:\s*0/, /font-family:\s*inherit/, /text-align:\s*inherit/]) {
    assert.match(img, decl, `.gd-img--edit is missing ${decl} — the UA button chrome shows through`);
  }
  assert.doesNotMatch(img, /font:\s/, '.gd-img--edit uses the `font` shorthand — it would override .gd-img\'s 64px placeholder glyph');

  // A focus indicator on each of the three; the cover additionally reveals its
  // existing overlay, which was written for a focusable frame before one existed.
  const ring = bodyOf('.tag--edit:focus-visible,\n.gd-title:focus-visible,\n.gd-img--edit:focus-visible');
  assert.ok(ring, 'the shared :focus-visible ring for the three triggers is gone');
  assert.match(ring, /outline:\s*2px solid var\(--brand\)/);
  assert.ok(bodyOf('.gd-img--edit:hover .gd-img__edit,\n.gd-img--edit:focus-visible .gd-img__edit'),
    'the cover overlay no longer reveals on focus');
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
