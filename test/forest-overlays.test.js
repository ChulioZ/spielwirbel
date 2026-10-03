'use strict';

/* Forest's overlays (#1472, F15a/F15b): the sheets and their popover twins, the
 * confirm dialog, the toast and the „…" menu.
 *
 * The one markup branch is formSheetDesign() (sheet.js), which now names
 * Forest: the popover's title head and the three form editors' row lists.
 * Everything else is CSS in the #1472 section of forest.css, and what can be
 * pinned of it is pinned below — the claims whose regression still renders
 * plausibly (an outlined verb where the dialog's should be filled, the firefly
 * on the red error toast, a pill toast, a grip on the desktop popover, Young
 * Serif on a button).
 *
 * Named for what it covers: `popover`, `sheet` and `confirm-dialog` are taken
 * (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf, mediaBlocks, topLevel } = require('./support/css');
const { SUPPORTED_LOCALES } = require('../public/js/locales');
const { blocksOf } = require('./support/theme');
const { designById } = require('../public/js/designs');

const ROUND = {
  id: 1, name: 'Donnerstagsrunde', shared: false, sessions: [], activity: [], providers: [],
  members: [{ id: 'm1', name: 'Lea', userId: 'u1' }, { id: 'm2', name: 'Jonas' }],
  games: [{ id: 7, title: 'Catan', tagIds: [], ownerIds: ['m1'], minPlayers: 2, maxPlayers: 4,
    image: '/uploads/catan.jpg', source: { provider: 'bgg', externalId: '13', url: '' },
    retired: false, completed: false }],
  tags: [],
};
const OPENERS = { players: 'openPlayersPopover', owners: 'openOwnersPopover', cover: 'openImagePopover' };

function open(t, { design, wide, editor }) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run(`window.matchMedia = () => ({ matches: ${wide}, addEventListener() {}, removeEventListener() {} });`);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  assert.equal(dom.run(`designIs(${JSON.stringify(design)})`), true, `${design} is not worn — the harness read is vacuous`);
  dom.run(`window.__ctx = { rid: 1, round: ${JSON.stringify(ROUND)}, game: ${JSON.stringify(ROUND.games[0])},
    updateGame() {}, refresh() {} };`);
  dom.run('window.__anchor = document.createElement(\'button\'); document.body.appendChild(window.__anchor); window.__anchor.focus();');
  dom.run(`${OPENERS[editor]}(window.__ctx, window.__anchor)`);
  const card = wide ? dom.document.querySelector('.popover') : dom.document.querySelector('.sheet');
  assert.ok(card, `${editor} opened no ${wide ? 'popover' : 'sheet'}`);
  return { dom, card, body: wide ? card : card.querySelector('.editor') };
}

/* ------------------------------------------------------------- the markup */

for (const editor of Object.keys(OPENERS)) {
  test(`Forest: the ${editor} editor is rows over ONE primary at 390 and 1440`, (t) => {
    for (const wide of [false, true]) {
      const { card, body } = open(t, { design: 'forest', wide, editor });
      const where = wide ? '1440' : '390';
      assert.ok(body.querySelectorAll('.editor-row, .cover-picker__toggle').length >= 1, `${where}: no rows`);
      const primaries = body.querySelectorAll('.btn--primary');
      assert.equal(primaries.length, 1, `${where}: ${primaries.length} primary actions`);
      assert.ok(primaries[0].closest('.editor-actions'), `${where}: the primary is not under the rows`);
      if (wide) {
        const head = card.firstElementChild;
        assert.ok(head.classList.contains('popover__head--editor'), 'the popover has no title head');
        assert.ok(head.querySelector('.popover__title').textContent.trim(), 'the head names nothing');
        assert.ok(head.querySelector('button.popover__close'), 'the head has no ×');
      } else {
        assert.ok(card.closest('.sheet-backdrop--editor'), 'the phone sheet cannot be docked');
      }
    }
  });

  test(`Klassisch: the ${editor} editor keeps its own markup — no Forest rows, no titled popover head`, (t) => {
    // The Klassisch-DOM criterion: the branch is ONE predicate, so a Klassisch
    // render must carry none of what it builds. Seen red by making
    // formSheetDesign() answer true for every design.
    for (const wide of [false, true]) {
      const { card, body } = open(t, { design: 'klassisch', wide, editor });
      const where = wide ? '1440' : '390';
      assert.equal(body.querySelectorAll('.editor-row, .editor-rows, .editor-actions').length, 0, `${where}: Klassisch grew row lists`);
      if (wide) assert.equal(card.querySelector('.popover__head--editor'), null, 'Klassisch grew the titled head');
    }
  });
}

test('Forest: Escape and Back both close the phone sheet, and focus goes back to the trigger', async (t) => {
  // Escape, dispatched from the focused element — the Browser pane never
  // delivers the key (.claude/rules/escape-keypresses-never-reach-the-preview-pane.md),
  // so this is also how the PR's in-browser check drove it.
  const a = open(t, { design: 'forest', wide: false, editor: 'players' });
  a.dom.document.activeElement.dispatchEvent(new a.dom.window.KeyboardEvent('keydown',
    { key: 'Escape', bubbles: true, cancelable: true }));
  await flush();
  assert.equal(a.dom.document.querySelector('.sheet'), null, 'Escape left the sheet open');
  assert.equal(a.dom.document.activeElement, a.dom.window.__anchor, 'focus did not return to the trigger');

  const b = open(t, { design: 'forest', wide: false, editor: 'owners' });
  assert.equal(b.dom.run('handleSheetPop()'), true, 'Back was not taken by the sheet layer');
  await flush();
  assert.equal(b.dom.document.querySelector('.sheet'), null, 'Back left the sheet open');
  assert.equal(b.dom.document.activeElement, b.dom.window.__anchor, 'focus did not return to the trigger');
});

test('Forest: sort offers exactly the app\'s three orders, and the language picker every shipped locale', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('toast', () => {});
  dom.set('isLoggedIn', () => false);
  dom.run("applyDesign('forest')");
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', ROUND, ROUND.games);
  const sort = dom.app.querySelector('select.sort-select');
  assert.ok(sort, 'the Regal rendered no sort control');
  assert.deepEqual([...sort.options].map((o) => o.value), ['random', 'name', 'avg']);

  const picker = dom.document.getElementById('langPicker');
  if (!picker.options.length) dom.run('setupLangPicker()');
  assert.deepEqual([...picker.options].map((o) => o.value), SUPPORTED_LOCALES);
  assert.equal(SUPPORTED_LOCALES.length, 9, 'F15a draws nine locales');
});

/* ------------------------------------------------------------- the CSS */

const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/forest.css'), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
// This slice's own section, up to the NEXT slice's banner: sibling Forest
// slices own their own sections.
const START = RAW.indexOf('/* ===== #1472');
const NEXT = RAW.indexOf('/* ===== #', START + 1);
const MINE = strip(RAW.slice(START, NEXT === -1 ? undefined : NEXT));
const RULES = rulesOf(MINE).map(([s, b]) => [s.replace(/\s+/g, ' ').trim(), b]);
const F = ':root[data-design="forest"]';
const G = ':root[data-design="forest"]:not([data-scheme="dark"])';
const bodiesNaming = (needle) => RULES.filter(([s]) => s.includes(needle)).map(([, b]) => b).join(';');

test('the #1472 section exists and is not vacuous', () => {
  assert.ok(START !== -1, 'the #1472 banner is gone');
  assert.ok(RULES.length >= 60, `only ${RULES.length} rules in the section`);
});

test('every rule in the section that reads a colour token is gated on the light scheme', () => {
  const COLOUR = /var\(--(brand|ink|ink-soft|surface|raised|line|moss|moss-hover|band|danger|good|dusk|dusk-soft|firefly|on-dusk|on-accent|control-edge|page-bg)\b/;
  const ungated = RULES.filter(([s, b]) => COLOUR.test(b) && !s.includes(':not([data-scheme="dark"])'))
    // The form rows are ungated geometry on purpose: their app-token fallbacks
    // keep them drawn if the gate ever failed (design-colour-blocks-are-scheme-gated.md).
    .filter(([, b]) => !/var\(--(control-edge|raised), var\(--(line|surface)\)\)/.test(b))
    .map(([s]) => s);
  assert.deepEqual(ungated, []);
});

test('Young Serif sits only on titles of 19px and up, and never on a button', () => {
  const display = RULES.filter(([, b]) => /font-family:\s*var\(--font-display\)/.test(b));
  assert.ok(display.length >= 2, 'the sheet and popover titles no longer ask for Young Serif');
  for (const [s, b] of display) {
    assert.doesNotMatch(s, /\.btn|button|__close|__action|__opt/, `„${s}" puts Young Serif on a control`);
    const px = Number((/font-size:\s*(\d+)px/.exec(b) || [])[1]);
    assert.ok(px >= 19, `„${s}" sets Young Serif at ${px || 'an unstated size'}`);
  }
  // And no rule here hands a button the display face indirectly.
  const btnDisplay = RULES.filter(([s, b]) => /\.btn/.test(s) && /--font-display/.test(b)).map(([s]) => s);
  assert.deepEqual(btnDisplay, []);
});

test('a destructive DIALOG verb is red-FILLED with the light print; the band follows the verb', () => {
  const fill = RULES.find(([s]) => s.includes(`${G} .sheet__actions--confirm .btn--danger:hover:not(:disabled)`));
  assert.ok(fill, 'the dialog does not restate its verb under the pointer');
  assert.ok(fill[0].includes(`${G} .sheet__actions--confirm .btn--danger,`), 'the fill is not the resting state too');
  assert.match(fill[1], /background:\s*var\(--danger\)/);
  assert.match(fill[1], /color:\s*var\(--on-accent\)/);
  const elsewhere = RULES.filter(([s, b]) => /(^|[;\s])background(-color)?:\s*var\(--danger\)/.test(b)
    && !s.includes('.sheet__actions--confirm .btn--danger') && !s.includes('.toast--error')).map(([s]) => s);
  assert.deepEqual(elsewhere, [], 'a red fill outside the confirm dialog and the error toast');
  assert.match(bodiesNaming('[role="alertdialog"]:has(.sheet__actions--confirm .btn--danger)'), /--dialog-band:\s*var\(--danger\)/,
    'a destructive dialog does not carry the danger band');
  assert.match(bodiesNaming(`${G} .sheet.sheet--dialog[role="alertdialog"]`), /--dialog-band:\s*var\(--brand\)/);
  assert.match(bodiesNaming(`${G} .sheet[role="alertdialog"] .sheet__head`), /linear-gradient\(var\(--dialog-band\) 0 8px/,
    'the 8px band is not painted');
});

test('the sheet re-points the ground its sticky bars paint from', () => {
  const own = RULES.filter(([s]) => s === `${G} .sheet`).map(([, b]) => b).join(';');
  assert.match(own, /--page-bg:\s*var\(--raised\)/);
});

test('the grip exists on a phone only, and Forest keeps the app\'s sheet ceiling', () => {
  const phone = mediaBlocks(MINE).filter(([q]) => /max-width:\s*639px/.test(q)).map(([, css]) => css).join('\n');
  assert.match(phone, /\.sheet__head::before\s*\{[^}]*width:\s*44px/, 'no grip on the phone sheet');
  assert.match(phone, /\.sheet__head::before\s*\{[^}]*height:\s*5px/, 'the grip is not F15a\'s 44 × 5');
  const outside = rulesOf(topLevel(MINE)).map(([s]) => s).join('\n');
  assert.doesNotMatch(outside, /sheet__head::before/, 'a grip escaped the phone block');
  const capped = RULES.filter(([s, b]) => /\.sheet\b/.test(s) && !/\.sheet[_-]/.test(s.split(' ').pop()) && /max-height/.test(b))
    .map(([s]) => s);
  assert.deepEqual(capped, [], 'Forest overrides the app\'s sheet ceiling');
});

test('the scrim is ink at 55 %, declared where the harness resolves it', () => {
  const b = blocksOf(designById('forest'));
  assert.ok(b && b.light, 'no Forest colour block');
  assert.match(b.light, /--scrim:\s*rgba\(27, 42, 24, 0\.55\);/);
});

test('the „…" menu paints the destructive group red, under one hairline', () => {
  assert.match(bodiesNaming('.popover__opt[data-kind="destructive"]'), /color:\s*var\(--danger\)/);
  const rule = RULES.find(([s]) => s.includes(':not([data-kind="destructive"]) + .popover__opt[data-kind="destructive"]'));
  assert.ok(rule, 'no boundary rule above the destructive group');
  assert.match(rule[1], /border-top:\s*1\.5px solid var\(--line\)/);
});

test('the toast: success on the dusk, error on danger — the firefly never on the red, never a pill', () => {
  assert.match(bodiesNaming(`${G} .toast.toast--success`), /background:\s*var\(--dusk\)/);
  assert.match(bodiesNaming(`${G} .toast.toast--success`), /color:\s*var\(--on-dusk\)/);
  const err = bodiesNaming(`${G} .toast.toast--error`);
  assert.match(err, /background:\s*var\(--danger\)/);
  for (const [s, b] of RULES.filter(([, body]) => /var\(--firefly\)/.test(body))) {
    assert.ok(s.includes('.toast:not(.toast--error)'), `„${s}" paints the firefly where the error toast can reach it`);
    assert.ok(b);
  }
  assert.ok(RULES.some(([s, b]) => s.includes('.toast:not(.toast--error) .toast__action') && /color:\s*var\(--firefly\)/.test(b)),
    'the toast action is not the firefly');
  for (const [s, b] of RULES.filter(([sel]) => /\.toast\b/.test(sel))) {
    assert.doesNotMatch(b, /radius-pill|border-radius:\s*999/, `„${s}" is a pill again (#858)`);
  }
});

test('every overlay control meets its target token', () => {
  const minH = (sel) => (/min-height:\s*([^;]+);/.exec(RULES.filter(([s]) => s === sel).map(([, b]) => b).join(';')) || [])[1];
  assert.equal(minH(`${F} .popover__close`), 'var(--target-key)', 'the popover ×');
  assert.equal(minH(`${F} .editor-row`), 'var(--target-key)', 'an editor row');
  assert.equal(minH(`${F} .popover--menu .popover__opt`), 'var(--target-key)', 'a menu row');
  assert.equal(minH(`${F} .sheet .ds-row`), 'var(--target-key)', 'a list row in a sheet');
  assert.equal(minH(`${F} .fpanel__body :is(.chip, .tag-mode__opt)`), 'var(--target-foot)', 'a filter chip (F15a: 32px)');
  assert.equal(minH(`${F} .sheet__actions--confirm .btn`), '48px', 'a dialog button');
  assert.equal(minH(`${F} .sheet__actions:not(.sheet__actions--confirm) .btn.btn--primary`), '52px', 'a sheet\'s primary (F15a: 52px)');
  const close = RULES.filter(([s]) => s === `${F} .sheet__close`).map(([, b]) => b).join(';');
  assert.match(close, /width:\s*var\(--target-key\)/);
  assert.match(close, /height:\s*var\(--target-key\)/);
});

test('under reduced motion nothing slides: the 180ms rise lives only in a no-preference block', () => {
  const motion = mediaBlocks(MINE).filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q)).map(([, css]) => css).join('\n');
  assert.match(motion, /animation:\s*forest-overlay-in 180ms/);
  assert.match(motion, /translateY\(12px\)/);
  assert.doesNotMatch(topLevel(MINE), /forest-overlay-in/, 'the rise escaped the no-preference block');
});
