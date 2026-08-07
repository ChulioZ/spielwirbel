'use strict';

/* Sheets and dialogs are sized to the viewport, not to a magic px number (#678).

   `.sheet` was capped at `min(85vh, 660px)` and `.sheet--dialog` at
   `min(80vh, 560px)`. Above a ~776px-tall window the `vh` term stops binding
   and the px term takes over, so the overlay stopped growing while the viewport
   kept growing: measured at 1440x1000, the add-game sheet wanted 884px, got
   660px, hid 226px of its own content behind an inner scroll — and left 340px
   of bare backdrop doing nothing. At 1300px tall the wasted space nearly
   doubled while the amount to scroll did not move at all.

   The ceiling is now derived from the room the backdrop actually offers. The
   assertions below therefore care about the MECHANISM, not about the presence
   of a declaration: "`.sheet` has a max-height" is exactly as true of the
   broken version, and so is "it mentions a viewport unit". What separates the
   two is arithmetic — how the declared expression responds when the viewport
   grows — so that is what most of this file computes.

   There is no layout engine here (jsdom applies no external stylesheet,
   `.claude/rules/testing-views-under-jsdom.md`), so these are CSS-TEXT
   assertions over `public/styles.css` plus real arithmetic over the declared
   numbers. The browser pass is the proof and is recorded in the PR. Parsing
   traps (stripped comments, whole-class matching) live in test/support/css.js —
   `.claude/rules/css-text-assertions-strip-comments.md`. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ROOT, RULES, rulesOf, bodyOf, mediaBlocks, whole, outranks,
} = require('./support/css');

/* The >=640px block, found by CONTENT — it is the one that turns the backdrop
   into a padded, centered box. Never by position in the file. */
const wideBlock = mediaBlocks().find(([q, css]) =>
  /min-width:\s*640px/.test(q)
  && rulesOf(css).some(([sel]) => sel.trim() === '.sheet-backdrop'));

const WIDE = wideBlock ? rulesOf(wideBlock[1]) : [];

/* `max(<floor>px, <ceiling>)` — the shape every cap here is required to have.
   Parsed rather than matched, so the assertions can do arithmetic with it and
   so the floor can be told apart from a cap wearing a floor's clothes. */
function capSpec(body) {
  if (!body) return null;
  const m = body.match(/max-height:\s*max\(\s*(\d+)px\s*,\s*(.+?)\s*\)\s*;/);
  if (!m) return null;
  return { floor: Number(m[1]), ceiling: m[2] };
}

const baseCap = capSpec(bodyOf('.sheet'));
const WIDE_CAP_SEL = '.sheet-backdrop .sheet';
const wideCap = capSpec(bodyOf(WIDE_CAP_SEL, WIDE));

// `min(<pct><unit>, 100%)` out of the base ceiling.
function phoneCeiling() {
  if (!baseCap) return null;
  const m = baseCap.ceiling.match(/^min\(\s*(\d+)(dvh|svh|vh)\s*,\s*100%\s*\)$/);
  return m ? { pct: Number(m[1]), unit: m[2] } : null;
}

/* The gutter the backdrop itself declares at >=640px, read off the backdrop
   rather than restated here — restating it is the CSS spelling of the bug in
   `.claude/rules/shared-constants-across-the-stack.md`, and it is precisely
   what the `100%` term exists to avoid. */
function wideGutter() {
  const body = bodyOf('.sheet-backdrop', WIDE);
  const m = body && body.match(/padding:\s*(\d+)px/);
  return m ? Number(m[1]) * 2 : null;
}

test('the base cap is a floored, viewport-derived expression', () => {
  assert.ok(baseCap, '.sheet declares no `max-height: max(<floor>px, …)`');
  assert.ok(phoneCeiling(), `.sheet's ceiling is not min(<n>dvh, 100%): ${baseCap.ceiling}`);
});

test('the desktop cap wins on SPECIFICITY, not on source order', () => {
  /* A bare `.sheet` in the media block ties the base rule and wins only because
     it happens to sit lower in the file. Losing that tie is silent — the sheet
     just comes out ~15% short of the room it has — so the override is
     compounded (.claude/rules/responsive-content-width.md). */
  assert.ok(wideCap, `${WIDE_CAP_SEL} declares no floored cap inside the >=640px block`);
  assert.ok(outranks(WIDE_CAP_SEL, '.sheet'),
    `${WIDE_CAP_SEL} does not outrank .sheet — the desktop cap would ride on source order`);
});

test('NO absolute px survives in either ceiling — only in the floor', () => {
  // The whole defect was a px term inside the cap. A px floor is the opposite
  // thing (it stops a degenerate viewport collapsing the sheet to nothing) and
  // is checked for size below, so the two must not be conflated.
  assert.ok(baseCap && !/\d+px/.test(baseCap.ceiling),
    `base ceiling still carries an absolute px term: ${baseCap && baseCap.ceiling}`);
  assert.ok(wideCap && !/\d+px/.test(wideCap.ceiling),
    `>=640px ceiling still carries an absolute px term: ${wideCap && wideCap.ceiling}`);
});

test('.sheet--dialog restates no cap of its own', () => {
  const body = bodyOf('.sheet--dialog');
  assert.ok(body, '.sheet--dialog rule is gone');
  assert.ok(!/max-height/.test(body),
    '.sheet--dialog declares its own max-height again — `.sheet`\'s already fits the backdrop');
});

test('no rule anywhere re-pins a px height cap on a sheet', () => {
  // The regression would not have to come back in the two rules above; a fresh
  // `.sheet--foo { max-height: min(70vh, 520px) }` is the same bug.
  const offenders = RULES
    .filter(([sel]) => whole('.sheet').test(sel))
    .filter(([, body]) => /max-height:[^;]*min\([^;]*\d+px/.test(body));
  assert.deepEqual(offenders.map(([sel]) => sel), []);
});

test('the cap TRACKS the viewport instead of flattening out', () => {
  // The assertion the old cap fails: `min(85vh, 660px)` answers 660 at both
  // heights, so the sheet stops growing while the window keeps going.
  const gutter = wideGutter();
  assert.equal(gutter, 48, 'the >=640px backdrop no longer declares `padding: 24px`');

  const capAt = (vh) => Math.max(wideCap.floor, vh - gutter);
  assert.equal(capAt(1000), 952);
  assert.equal(capAt(1300), 1252);
  assert.equal(capAt(1300) - capAt(1000), 300,
    'the desktop cap does not grow 1:1 with the viewport');
});

test('the floor can never bind on a viewport the app supports', () => {
  /* A "floor" large enough to bind is a cap in disguise — and it would look
     completely correct in every selector assertion above. 600px tall is the
     shortest viewport the suite exercises anywhere (vote-card-viewport-fit). */
  const { pct } = phoneCeiling();
  const shortest = 600;
  assert.ok(baseCap.floor < shortest * pct / 100,
    `floor ${baseCap.floor}px binds at ${shortest}px tall — that is a cap, not a floor`);
  assert.ok(wideCap.floor < shortest - wideGutter(),
    `>=640px floor ${wideCap.floor}px binds at ${shortest}px tall`);
});

test('below 640px the sheet stays docked, and still clears the --center bias', () => {
  const { pct } = phoneCeiling();
  // The backdrop's own bottom bias, which keeps the link-provider suggestion
  // dropdown on screen. Read off the rule, not restated.
  const centerBias = Number(bodyOf('.sheet-backdrop--center').match(/padding-bottom:\s*(\d+)px/)[1]);
  assert.equal(centerBias, 120);

  const capAt = (vh, gutter) =>
    Math.max(baseCap.floor, Math.min(Math.round(vh * pct / 100), vh - gutter));

  // Plain backdrop (no padding): a docked surface, never a full-screen takeover.
  assert.equal(capAt(640, 0), 544);
  assert.ok(capAt(640, 0) < 640, 'the phone sheet fills the whole viewport');

  /* --center backdrop: the `100%` term is what keeps the sheet inside the
     padded box. Without it an 85dvh sheet overruns the 120px bias and the card
     centres in the full viewport instead of sitting above the dropdown. */
  assert.ok(capAt(640, centerBias) <= 640 - centerBias,
    'the phone sheet overruns the --center backdrop\'s bottom bias');
  assert.equal(capAt(640, centerBias), 520);
});

test('.sheet--list widens the list dialogs and outranks .sheet--dialog', () => {
  const listSel = '.sheet--dialog.sheet--list';
  const body = bodyOf(listSel);
  assert.ok(body, `${listSel} is not declared`);
  assert.ok(outranks(listSel, '.sheet--dialog'),
    'the list modifier ties `.sheet--dialog` and would win only on source order');

  const widthOf = (sel) => Number(bodyOf(sel).match(/max-width:\s*(\d+)px/)[1]);
  assert.ok(widthOf(listSel) > widthOf('.sheet--dialog'),
    'the list modifier does not actually widen anything');
  assert.equal(widthOf('.sheet--dialog'), 460, 'the short-form dialogs must keep 460px');
});

/* The three dialogs whose body is a scanning list, keyed by a marker inside
   their own markup rather than by a line number. The second half of this — that
   nothing ELSE carries the modifier — is what stops the first half being
   satisfied by spraying `sheet--list` over every sheet, the same shape as
   `test/ds-row-affordance.test.js`. */
const LIST_DIALOGS = [
  ['public/js/views-round-lookup.js', 'class="bgg-import"', 'BGG collection import'],
  ['public/js/views-round-actions.js', 'class="move-picker"', 'Spiele verschieben'],
  ['public/js/views-archive.js', 'class="ds-list wish-pick"', 'Grundspiel wählen'],
];

// Every `<div class="sheet …">` opening tag in a file, with the markup it opens.
function sheetBlocks(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const starts = [...src.matchAll(/<div class="sheet ([^"]*)"/g)];
  return starts.map((m, i) => ({
    classes: m[1],
    markup: src.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : m.index + 2000),
  }));
}

test('exactly the three list dialogs carry .sheet--list', () => {
  const files = [...new Set(LIST_DIALOGS.map(([f]) => f))];
  const matched = [];

  for (const file of files) {
    for (const block of sheetBlocks(file)) {
      const hit = LIST_DIALOGS.find(([f, marker]) => f === file && block.markup.includes(marker));
      const isList = whole('sheet--list').test(block.classes);
      if (hit) {
        assert.ok(isList, `${hit[2]} (${file}) lost its sheet--list modifier`);
        matched.push(hit[2]);
      } else {
        assert.ok(!isList,
          `a sheet in ${file} carries sheet--list but is not one of the list dialogs: ${block.classes}`);
      }
    }
  }
  assert.deepEqual(matched.sort(), LIST_DIALOGS.map(([, , label]) => label).sort());
});

test('the short-form dialogs stay narrow', () => {
  // Confirmations, invite, link-provider and the support sheet read worse wide.
  for (const file of ['public/js/views-account.js', 'public/js/support.js',
    'public/js/views-round-detail.js']) {
    for (const block of sheetBlocks(file)) {
      assert.ok(!whole('sheet--list').test(block.classes),
        `${file} widened a short form: ${block.classes}`);
    }
  }
});
