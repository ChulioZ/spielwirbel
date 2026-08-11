'use strict';

/* The three game-detail editors (tags, players, cover) present as an anchored
   popover from 860px up and as a bottom sheet below it (#422). Before this,
   they were popovers at every width and were therefore UNREACHABLE on a phone:
   focusing the input makes the browser scroll the page to reveal it, and
   `openPopover`'s own page-scroll teardown then removes the just-focused input
   from the DOM, so the keyboard never finishes opening. There was no way to tag
   a game from a phone at all.

   The *soft keyboard* half stays unobservable from Node, and the Browser pane
   can't reproduce it either (it reports `innerWidth === 0` and has no keyboard,
   see `.claude/rules/preview-pane-paint-artifacts.md`). But the routing itself
   is plain DOM, and since #602 it is tested by RENDERING the game-detail screen
   under a stubbed `matchMedia` and clicking the real triggers — so what is
   asserted is which container actually appears, not which identifier appears in
   the source. What a regression would look like: the editors quietly go back to
   popovers on phones, with every test still green.

   What stays source-matched below is what a DOM genuinely cannot see: the
   breakpoint *constant*, the `activeSheet` assignment openEditor must not make,
   and every CSS fact (jsdom applies no external stylesheet, so converting those
   would replace a working check with a vacuous one).

   Comments are stripped before matching — a regex over raw source binds inside
   a comment that merely MENTIONS the thing it's looking for
   (`.claude/rules/css-text-assertions-strip-comments.md` makes the same point
   for CSS). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { bodyOf, RULES, whole, outranks } = require('./support/css');
const { loadApp } = require('./support/dom');

const ROOT = path.join(__dirname, '..');
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const DETAIL = strip(fs.readFileSync(path.join(ROOT, 'public/js/views-round-detail.js'), 'utf8'));

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

/* ---------------- the presentation, rendered and clicked (#602) -------------

   The three editors are nested inside showGameDetail, so they are not callable
   from a spec — which is the point: the only honest way in is the one a user
   takes. Each case below renders the real screen under a stubbed matchMedia and
   clicks the real trigger, so it exercises the trigger's element type, the
   click, usesEditorSheet, openEditor and the variant class in one go. */

/* A game with players, a tag AND a cover on purpose: showGameDetail suppresses
   the dashed chips on a "sparse" game and offers the onboarding panel instead,
   so a bare fixture renders no chips at all and every selector below would miss
   for a reason that has nothing to do with what is being tested. */
const ROUND = {
  id: 1,
  name: 'Donnerstagsrunde',
  shared: false,
  games: [{
    id: 7, title: 'Catan', tagIds: [3], minPlayers: 2, maxPlayers: 4,
    image: '/uploads/catan.jpg', retired: false, completed: false,
  }],
  members: [],
  sessions: [],
  activity: [],
  tags: [{ id: 3, name: 'Strategie', icon: 'chess' }],
  providers: [],
};

/* `.gd-title` is shared with the round header (views-round.js) and the member
   screen, so an unscoped query finds the ROUND's name first on this screen. */
const GAME_TITLE = '#app h1 .gd-title';

/** The game-detail screen at a width above (`wide`) or below the breakpoint. */
async function gameDetail(t, wide) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => ROUND);
  // jsdom has no layout, so matchMedia never matches on its own; the stub is
  // what stands in for the viewport width.
  dom.run(`window.matchMedia = () => ({ matches: ${wide}, addEventListener() {}, removeEventListener() {} });`);
  await dom.call('showGameDetail', ROUND.id, 7);
  return dom;
}

// The three triggers, and the container each editor is expected to open into.
const TRIGGERS = [
  ['.tag--players', 'players', 'Personenzahl festlegen'],
  ['.tag--custom', 'tags', 'Tags vergeben'],
  ['.gd-img--edit', 'image', 'Cover hinzufügen'],
];

test('below the breakpoint every editor opens as a sheet, not a popover', async (t) => {
  // The #422 bug in one assertion: a popover here is unreachable on a phone,
  // because focusing its input scrolls the page and openPopover's own scroll
  // teardown then removes the input mid-keyboard-open.
  const dom = await gameDetail(t, false);
  for (const [selector, variant] of TRIGGERS) {
    dom.document.querySelectorAll('.sheet-backdrop, .popover').forEach((n) => n.remove());
    dom.document.querySelector(selector).click();
    assert.ok(dom.document.querySelector('.sheet-backdrop'), `the ${variant} editor did not open as a sheet on a phone (#422)`);
    assert.equal(dom.document.querySelector('.popover'), null, `the ${variant} editor opened a popover below the breakpoint (#422)`);
    assert.ok(dom.document.querySelector(`.editor--${variant}`), `the ${variant} sheet carries no .editor--${variant} — its layout rules would not apply`);
  }
});

test('above the breakpoint every editor opens as an anchored popover', async (t) => {
  // The other direction, so the test above cannot be satisfied by an editor
  // that became a sheet at every width.
  const dom = await gameDetail(t, true);
  for (const [selector, variant] of TRIGGERS) {
    dom.document.querySelectorAll('.sheet-backdrop, .popover').forEach((n) => n.remove());
    dom.document.querySelector(selector).click();
    assert.ok(dom.document.querySelector('.popover'), `the ${variant} editor did not open as a popover on a desktop`);
    assert.ok(dom.document.querySelector(`.popover--${variant}`), `the ${variant} popover carries no .popover--${variant}`);
  }
});

test('the sheet is a titled, labelled dialog', async (t) => {
  /* The title becomes the sheet's heading AND its aria-label, so a missing one
     is both a blank head and an unnamed dialog — the latter invisible to
     everything except a screen reader. Asserting the rendered German proves the
     key resolves, which a source match on `t('detail.onboard.players')` cannot:
     a typo'd key renders the key itself and matches the regex just as well. */
  const dom = await gameDetail(t, false);
  for (const [selector, variant, heading] of TRIGGERS) {
    dom.document.querySelectorAll('.sheet-backdrop').forEach((n) => n.remove());
    dom.document.querySelector(selector).click();
    const dialog = dom.document.querySelector('.sheet[role="dialog"]');
    assert.ok(dialog, `the ${variant} sheet is not a role=dialog`);
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.equal(dialog.getAttribute('aria-label'), heading, `the ${variant} sheet is unnamed or mistitled`);
    assert.equal(dialog.querySelector('.sheet__head h2').textContent, heading);
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

test('openPopover runs the attach callback only once the popover is in the document', () => {
  /* build() runs on a DETACHED node, so `input.focus()` inside it is a silent
     no-op — the editors' autofocus had never worked on any platform. The
     returned callback is what fixes it, and it is only correct AFTER the
     appendChild; running it earlier restores the original bug with no symptom
     other than "the keyboard doesn't come up".

     This used to compare two string indexes inside openPopover's source. Now it
     observes the thing itself: whether the node is in the document at each
     moment, which is the only property that decides whether focus() works. */
  const dom = loadApp();
  try {
    const seen = dom.run(`
      const anchor = document.createElement('button');
      document.body.appendChild(anchor);
      let atBuild = null, atAttach = null, focused = null;
      openPopover(anchor, (el) => {
        const input = document.createElement('input');
        el.appendChild(input);
        atBuild = document.contains(input);
        return () => { input.focus(); atAttach = document.contains(input); focused = document.activeElement === input; };
      });
      ({ atBuild, atAttach, focused });
    `);
    assert.equal(seen.atBuild, false, 'build() now runs on an attached node — the ordering this guards has changed shape');
    assert.equal(seen.atAttach, true, 'the attach callback ran before the popover was in the document — focus() is a no-op again');
    assert.equal(seen.focused, true, 'focus() inside the attach callback did not take — the editors have no autofocus');
  } finally {
    dom.close();
  }
});

test('the editors really do focus their input when opened', async (t) => {
  // The end of that chain, per editor: it used to be pinned as "the source
  // contains `return () => …focus()`", which is true of a callback that focuses
  // the wrong element, or one openEditor never invokes in the sheet path.
  const dom = await gameDetail(t, true);
  for (const [selector, variant] of [TRIGGERS[0], TRIGGERS[1]]) {
    dom.document.querySelectorAll('.popover').forEach((n) => n.remove());
    dom.document.querySelector(selector).click();
    const popover = dom.document.querySelector('.popover');
    assert.ok(popover.contains(dom.document.activeElement),
      `the ${variant} editor did not move focus into itself — a keyboard user lands nowhere`);
    assert.equal(dom.document.activeElement.tagName, 'INPUT', `the ${variant} editor focused something other than its input`);
  }
});

/* ---- #424: the four triggers that OPEN those editors are keyboard-reachable ----

   Until #424 every one of them was a click-only <span>/<div>: Tab skipped all
   four, so a keyboard user could not change a game's cover, title, player range
   or tags at all. Three are now real <button>s and the title is a
   role=button/tabindex span (it is inline text that wraps mid-line, which an
   atomic inline-block button cannot do).

   Since #602 these are rendered rather than source-matched: the element types,
   the tab stops and the Enter/Space activation are all plain DOM. What a
   regression looks like: the chips quietly go back to spans, Tab skips them
   again, and every test stays green. */

test('all four game-detail editor triggers are keyboard-focusable', async (t) => {
  const dom = await gameDetail(t, true);
  const { document } = dom;

  /* The cover and the chips are real buttons, so focusability, Enter *and*
     Space and focus restoration come from the platform. `.tag--edit` catches
     every chip at once, which is what the old "exactly four editableTag call
     sites" count was really reaching for — and unlike that count it cannot be
     satisfied by four calls that build a span. */
  assert.equal(document.querySelector('.gd-img--edit').tagName, 'BUTTON',
    'the cover is not a <button> — Tab would skip it again (#424)');
  const chips = [...document.querySelectorAll('.tag--players, .tag--custom, .tag--empty')];
  assert.ok(chips.length >= 2, `expected at least the players and tags chips, found ${chips.length}`);
  for (const chip of chips) {
    assert.equal(chip.tagName, 'BUTTON', `a chip is still a <${chip.tagName.toLowerCase()}> — it would be mouse-only (#424)`);
    assert.equal(chip.getAttribute('type'), 'button', 'a chip without type=button submits any form it lands in');
  }

  /* The title keeps its span (it is inline text that must wrap mid-line —
     `.claude/rules/native-button-vs-focusable-span.md`), so it needs both halves
     explicitly: focusable AND activatable. */
  const title = document.querySelector(GAME_TITLE);
  assert.equal(title.getAttribute('role'), 'button', 'the title span lost role=button (#424)');
  assert.equal(title.getAttribute('tabindex'), '0', 'the title span is unreachable by Tab (#424)');

  /* A tab stop with no keydown handler is a focus stop that does nothing — the
     half the source match could not tell apart from a working one. Both keys,
     because Space is the one a hand-rolled handler forgets. */
  for (const key of ['Enter', ' ']) {
    await dom.call('showGameDetail', ROUND.id, 7); // fresh screen per key
    const span = document.querySelector(GAME_TITLE);
    const ev = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    span.dispatchEvent(ev);
    assert.ok(document.querySelector('#app input.gd-title-input'),
      `pressing ${key === ' ' ? 'Space' : key} on the title did not open the editor (#424)`);
    // Space must be swallowed, or the page scrolls out from under the editor.
    if (key === ' ') assert.equal(ev.defaultPrevented, true, 'Space on the title is not preventDefault()ed — the page scrolls under the editor');
  }
});

test('Escape out of the title editor hands focus back to the trigger', async (t) => {
  // Without the focus() a keyboard user is dropped to <body> and restarts from
  // the top of the document.
  const dom = await gameDetail(t, true);
  const { document } = dom;
  document.querySelector(GAME_TITLE).click();

  const input = document.querySelector('#app input.gd-title-input');
  assert.ok(input, 'clicking the title did not open an editor');
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  const restored = document.querySelector(GAME_TITLE);
  assert.ok(restored, 'Escape did not put the title back');
  assert.equal(document.activeElement, restored, 'Escape out of the title editor left focus on <body> (#424)');
});

test('closing a popover restores focus to the control that opened it', () => {
  // The sheet presentation gets this from trapFocus (#145); the popover had no
  // equivalent, so on a desktop closing an editor dropped focus to <body>.
  const dom = loadApp();
  try {
    const seen = dom.run(`
      const opener = document.createElement('button');
      document.body.appendChild(opener);
      opener.focus();
      openPopover(opener, (el) => { const i = document.createElement('input'); el.appendChild(i); return () => i.focus(); });
      const movedIn = document.activeElement !== opener;
      closePopover();
      ({ movedIn, restored: document.activeElement === opener });
    `);
    // Anti-vacuous: focus must actually have LEFT the opener, or "restored"
    // is just "nothing ever moved".
    assert.equal(seen.movedIn, true, 'focus never entered the popover, so the restore assertion below proves nothing');
    assert.equal(seen.restored, true, 'closePopover no longer restores focus to the opener (#424)');
  } finally {
    dom.close();
  }
});

test('a popover that no longer holds focus does not steal it back', () => {
  /* The other half of the same guard, and the one an index comparison over
     `closePopover`'s source could only approximate: a user who has already
     clicked into another control must not have focus yanked away when the
     popover closes behind them. */
  const dom = loadApp();
  try {
    const seen = dom.run(`
      const opener = document.createElement('button');
      const elsewhere = document.createElement('input');
      document.body.append(opener, elsewhere);
      opener.focus();
      openPopover(opener, (el) => { const i = document.createElement('input'); el.appendChild(i); return () => i.focus(); });
      elsewhere.focus();
      closePopover();
      document.activeElement === elsewhere;
    `);
    assert.equal(seen, true, 'closePopover pulled focus back from a control the user had moved to');
  } finally {
    dom.close();
  }
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

/* The three content-heavy popovers size the FLOATING CARD, which is the one part
   deliberately NOT shared with the sheet (a sheet is already full width). #706
   widened all three, because width is the axis that has room: a wider card wraps
   its content onto fewer lines, so it shows more entries AND gets shorter — where
   raising a height cap buys rows at the cost of pushing the card past a fold that
   a page scroll cannot recover (`.claude/rules/anchored-popover-is-placed-once.md`,
   "The cap's ceiling is HALF the viewport"). Measured at 1440x900:

     .popover--expansions  360 -> 540   3 -> 4 rows of a Carcassonne tick-list
     .popover--tags        340 -> 480   5 -> 3 wrapped lines of chips
     .popover.has-covers   380 -> 520   3 -> 5 cover columns (6 -> 10 tiles)

   Floors, not exact values: a retune stays green, a revert to the old widths does
   not. */
const CARD_WIDTHS = [['popover--expansions', 480], ['popover--tags', 420], ['has-covers', 460]];

/* The rule that actually sizes the card, looked up BY ITS BODY: the one naming
   this variant class and declaring a max-width. Reading the selector back out of
   the stylesheet is what keeps the specificity test below non-vacuous — comparing
   a selector string written in this file would compare it with itself. */
const cardRule = (cls) => RULES.find(([sel, body]) => whole(`.${cls}`).test(sel) && /max-width:/.test(body));

test('the content-heavy popovers are sized for their content, not the 300px default', () => {
  for (const [cls, floor] of CARD_WIDTHS) {
    const hit = cardRule(cls);
    assert.ok(hit, `no max-width rule for .${cls} — the card falls back to .popover's 300px`);
    const px = Number((hit[1].match(/max-width:\s*(\d+)px/) || [])[1]);
    assert.ok(px >= floor, `.${cls} is ${px}px; below ${floor}px it wraps its content back onto extra lines`);
  }
});

test('the cover picker also has a FLOOR, or its max-width is a no-op', () => {
  /* A popover is absolutely positioned, i.e. shrink-to-fit: its width is the
     widest child's max-content, and the edition grid contributes a single track
     because `auto-fill` repeats once under intrinsic sizing. So the cover card
     is sized by its longest BUTTON LABEL and never reaches its cap — measured,
     it sat at 351px under a 380px cap and still sat at 351px when the cap was
     raised to 520px. The grid's min-width is what makes the card claim the room;
     without it this whole rule is a number nobody reads. */
  // Found BY ITS BODY, so the selector below is the stylesheet's own text rather
  // than a string this file could satisfy with itself.
  const hit = RULES.find(([sel, body]) => whole('.cover-picker__grid').test(sel)
    && whole('.has-covers').test(sel) && /min-width:/.test(body));
  assert.ok(hit, 'no min-width on the popover\'s edition grid — the card shrink-to-fits to its button labels and the max-width above does nothing');
  const [selector, floor] = hit;

  /* And it must stay GATED on having enough covers to fill the wider card.
     `auto-fill` keeps empty tracks by design, so an ungated floor pads a sparse
     edition list out with them — measured, a single-cover picker went from 236px
     of dead space to 416px. Most games are not Catan. */
  const gate = Number((selector.match(/:has\([^)]*nth-child\((\d+)\)/) || [])[1]);
  assert.ok(gate >= 5,
    `the floor is gated at ${gate || 'nothing'} — below 5 covers it widens the card before a full row can fill it`);

  // And the floor must stay UNDER the cap, or it overflows the card rather than
  // widening it. Both are declared here, so they are checkable against each other.
  const cols = floor.match(/min-width:\s*calc\((\d+)px \* (\d+) \+ (\d+)px \* (\d+)\)/);
  assert.ok(cols, 'the floor is no longer expressed as columns x gaps — re-derive it against the cap by hand');
  const need = Number(cols[1]) * Number(cols[2]) + Number(cols[3]) * Number(cols[4]);
  const cap = Number((bodyOf('.popover.has-covers').match(/max-width:\s*(\d+)px/) || [])[1]);
  assert.ok(need < cap - 16, `the grid floor (${need}px) does not clear the card cap (${cap}px less 16px of padding)`);
});

test('each of those widths beats .popover on SPECIFICITY, not on source order', () => {
  /* `.popover { max-width: 300px }` is (0,1,0), so a bare `.popover--tags` merely
     TIES with it and wins only because it happens to be declared later in the
     file. Moving either block would silently return the editor to 300px with
     nothing red — the failure `.claude/rules/responsive-content-width.md` records
     three times over for the rail's hides. `.popover.has-covers` was already
     compounded for exactly this reason; #706 made the other two match. */
  for (const [cls] of CARD_WIDTHS) {
    const [sel] = cardRule(cls) || [];
    assert.ok(sel && outranks(sel, '.popover'),
      `"${sel}" does not outrank .popover — its max-width is decided by block order`);
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
