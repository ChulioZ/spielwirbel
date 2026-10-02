'use strict';

/* Die Brücke's overlays (#1244, B15a/B15b): the sheets and their popover twins,
 * the confirm dialog, the toast and the „…" menu.
 *
 * The one markup branch is formSheetDesign() (sheet.js), which now names Die
 * Brücke: the popover's title head and the three form editors' row lists.
 * Everything else is CSS in the #1244 section of bruecke.css, and what can be
 * pinned of it is pinned below — the claims whose regression still renders
 * plausibly (a wire where the dialog's verb should be filled, a pill toast, a grip on the desktop popover, a
 * sticky bar painting the night across the plate).
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
  test(`Die Brücke: the ${editor} editor is rows over ONE primary at 390 and 1440`, (t) => {
    for (const wide of [false, true]) {
      const { card, body } = open(t, { design: 'bruecke', wide, editor });
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
}

test('Die Brücke: Escape and Back both close the phone sheet, and focus goes back to the trigger', async (t) => {
  // Escape, dispatched from the focused element — the Browser pane never
  // delivers the key (.claude/rules/escape-keypresses-never-reach-the-preview-pane.md),
  // so this is also how the PR's in-browser check drove it.
  const a = open(t, { design: 'bruecke', wide: false, editor: 'players' });
  a.dom.document.activeElement.dispatchEvent(new a.dom.window.KeyboardEvent('keydown',
    { key: 'Escape', bubbles: true, cancelable: true }));
  await flush();
  assert.equal(a.dom.document.querySelector('.sheet'), null, 'Escape left the sheet open');
  assert.equal(a.dom.document.activeElement, a.dom.window.__anchor, 'focus did not return to the trigger');

  const b = open(t, { design: 'bruecke', wide: false, editor: 'owners' });
  assert.equal(b.dom.run('handleSheetPop()'), true, 'Back was not taken by the sheet layer');
  await flush();
  assert.equal(b.dom.document.querySelector('.sheet'), null, 'Back left the sheet open');
  assert.equal(b.dom.document.activeElement, b.dom.window.__anchor, 'focus did not return to the trigger');
});

test('Die Brücke: sort offers exactly the app\'s three orders, and the language picker every shipped locale', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('toast', () => {});
  dom.set('isLoggedIn', () => false);
  dom.run("applyDesign('bruecke')");
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', ROUND, ROUND.games);
  const sort = dom.app.querySelector('select.sort-select');
  assert.ok(sort, 'the Regal rendered no sort control');
  assert.deepEqual([...sort.options].map((o) => o.value), ['random', 'name', 'avg']);

  const picker = dom.document.getElementById('langPicker');
  if (!picker.options.length) dom.run('setupLangPicker()');
  assert.deepEqual([...picker.options].map((o) => o.value), SUPPORTED_LOCALES);
  for (const code of ['fi', 'ko']) assert.ok(SUPPORTED_LOCALES.includes(code), `${code} is not shipped`);
});

/* ------------------------------------------------------------- the CSS */

const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/bruecke.css'), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
// This slice's own section, up to the NEXT slice's banner: sibling Brücke
// slices own their own sections and may paint a button red on purpose.
const START = RAW.indexOf('/* ===== #1244');
const NEXT = RAW.indexOf('/* ===== #', START + 1);
const MINE = strip(RAW.slice(START, NEXT === -1 ? undefined : NEXT));
const RULES = rulesOf(MINE).map(([s, b]) => [s.replace(/\s+/g, ' ').trim(), b]);
const B = ':root[data-design="bruecke"]';
const G = ':root[data-design="bruecke"][data-scheme="dark"]';
const bodiesNaming = (needle) => RULES.filter(([s]) => s.includes(needle)).map(([, b]) => b).join(';');

test('the #1244 section exists and is not vacuous', () => {
  assert.ok(START !== -1, 'the #1244 banner is gone');
  assert.ok(RULES.length >= 60, `only ${RULES.length} rules in the section`);
});

test('every rule in the section that reads a colour token is gated on the dark scheme', () => {
  const COLOUR = /var\(--(brand|ink|surface|line|hairline|danger|good|warn|control-edge|on-accent|page-bg)\b/;
  const ungated = RULES.filter(([s, b]) => COLOUR.test(b) && !s.includes('[data-scheme="dark"]'))
    // The form rows are ungated geometry on purpose: their app-token fallbacks
    // keep them drawn if the gate ever failed (design-colour-blocks-are-scheme-gated.md).
    .filter(([, b]) => !/var\(--(hairline|control-edge), var\(--line\)\)/.test(b))
    .map(([s]) => s);
  assert.deepEqual(ungated, []);
});

test('a destructive DIALOG verb is red-FILLED with night ink, at rest and under the pointer', () => {
  // Operator decision in the #1482 review: filled like Ocean and Das
  // Programmheft, overruling B15b's wire. The night on --danger is 7.2:1.
  const fill = RULES.find(([s]) => s.includes(`${G} .sheet__actions--confirm .btn--danger:hover:not(:disabled)`));
  assert.ok(fill, 'the dialog does not restate its verb under the pointer');
  assert.ok(fill[0].includes(`${G} .sheet__actions--confirm .btn--danger,`), 'the fill is not the resting state too');
  assert.match(fill[1], /background:\s*var\(--danger\)/);
  assert.match(fill[1], /color:\s*var\(--on-accent\)/);
  // Only in the dialog: no OTHER rule of the section fills a button red.
  const elsewhere = RULES.filter(([s, b]) => /(^|[;\s])background(-color)?:\s*var\(--danger\)/.test(b)
    && !s.includes('.sheet__actions--confirm .btn--danger')).map(([s]) => s);
  assert.deepEqual(elsewhere, [], 'a red fill outside the confirm dialog');
  assert.match(bodiesNaming('[role="alertdialog"]:has(.sheet__actions--confirm .btn--danger)'), /border-color:\s*var\(--danger\)/,
    'a destructive dialog is not framed in red');
});

test('the sheet re-points the ground its sticky bars paint from, and wears the cyan top edge', () => {
  const own = RULES.filter(([s]) => s === `${G} .sheet`).map(([, b]) => b).join(';');
  assert.ok(own, 'no gated .sheet rule');
  assert.match(own, /--page-bg:\s*var\(--surface-raised\)/);
  assert.match(own, /border-top:\s*2px solid var\(--brand\)/);
});

test('the grip exists on a phone only, and Die Brücke keeps the app\'s 85 % sheet ceiling', () => {
  const phone = mediaBlocks(MINE).filter(([q]) => /max-width:\s*639px/.test(q)).map(([, css]) => css).join('\n');
  assert.match(phone, /\.sheet__head::before\s*\{[^}]*width:\s*44px/, 'no grip on the phone sheet');
  const outside = rulesOf(topLevel(MINE)).map(([s]) => s).join('\n');
  assert.doesNotMatch(outside, /sheet__head::before/, 'a grip escaped the phone block');
  // Operator decision in the #1482 review: B15a's 70 % cap is not built. Any
  // max-height on a sheet in this section — at any width — overrides styles.css's
  // min(85dvh, 100%) and shortens every long sheet on a phone.
  const capped = RULES.filter(([s, b]) => /\.sheet\b/.test(s) && !/\.sheet[_-]/.test(s.split(' ').pop()) && /max-height/.test(b))
    .map(([s]) => s);
  assert.deepEqual(capped, [], 'Die Brücke overrides the app\'s sheet ceiling');
});

test('the scrim is the night at 72 %, declared where the harness resolves it', () => {
  const b = blocksOf(designById('bruecke'));
  assert.ok(b && b.scheme, 'no Brücke colour block');
  assert.match(b.scheme, /--scrim:\s*rgba\(7, 11, 20, 0\.72\);/);
});

test('the „…" menu paints by KIND: cyan glyph, amber for undoable, red glyph and word for destructive', () => {
  assert.match(bodiesNaming('.popover--menu .popover__opt .ti'), /color:\s*var\(--brand\)/);
  assert.match(bodiesNaming('.popover__opt[data-kind="undoable"] .ti'), /color:\s*var\(--warn\)/);
  const red = RULES.find(([s]) => s.includes('.popover__opt[data-kind="destructive"],'));
  assert.ok(red, 'no rule paints the destructive word and glyph together');
  assert.match(red[1], /color:\s*var\(--danger\)/);
});

test('every tone of the toast is the same raised plate — tone by bar and glyph, never a pill', () => {
  const plate = RULES.find(([s]) => s.includes(`${G} .toast:is(.toast--success, .toast--error)`));
  assert.ok(plate, 'the success/error tones are not brought onto the plate');
  assert.match(plate[1], /background:\s*var\(--surface-raised\)/);
  assert.match(plate[1], /border-inline-start:\s*4px solid var\(--brand\)/);
  assert.match(bodiesNaming('.toast.toast--success'), /border-inline-start-color:\s*var\(--good\)/);
  assert.match(bodiesNaming('.toast.toast--error'), /border-inline-start-color:\s*var\(--danger\)/);
  for (const [s, b] of RULES.filter(([sel]) => /\.toast\b/.test(sel))) {
    assert.doesNotMatch(b, /radius-pill/, `„${s}" is a pill again (#858)`);
  }
  // Bottom LEFT, without the app's centring transform (B15b „unten links").
  const base = RULES.find(([s]) => s === `${B} .toast`);
  assert.match(base[1], /transform:\s*none/);
  assert.match(base[1], /left:\s*var\(--space-gutter\)/);
});

test('every overlay control meets its target token', () => {
  const minH = (sel) => (/min-height:\s*([^;]+);/.exec(RULES.filter(([s]) => s === sel).map(([, b]) => b).join(';')) || [])[1];
  assert.equal(minH(`${B} .popover__close`), 'var(--target-key)', 'the popover ×');
  assert.equal(minH(`${B} .editor-row`), 'var(--target-key)', 'an editor row');
  assert.equal(minH(`${B} .popover--menu .popover__opt`), 'var(--target-key)', 'a menu row');
  assert.equal(minH(`${B} .sheet .ds-row`), 'var(--target-key)', 'a list row in a sheet');
  assert.equal(minH(`${B} .fpanel__body :is(.chip, .tag-mode__opt)`), 'var(--target-key)', 'a filter chip or mode toggle (B15a.1)');
  assert.equal(minH(`${B} .toast__action`), 'var(--target-foot)', 'the toast action (B15b: 32px)');
  assert.equal(minH(`${B} .toast__close`), 'var(--target-foot)', 'the toast ×');
  assert.equal(minH(`${B} .sheet__actions--confirm .btn`), '48px', 'a dialog button');
});

test('the #1482 sweep fixes: a flex action bar, an input with a floor beside its button, the one-row editors\' primary', () => {
  // The design chooser builds `.sheet__actions` without `.toolbar`, so without
  // this its two buttons were a block and stacked ragged.
  const bar = RULES.find(([s]) => s === `${B} .sheet__actions`);
  assert.ok(bar, 'no flex rule on the sheet action bar');
  assert.match(bar[1], /display:\s*flex/);
  assert.match(bar[1], /flex-wrap:\s*wrap/);
  // „Neuer Tag" was squeezed to „Neue" by the app's ≤639px `.toolbar .btn` grow.
  const input = RULES.find(([s]) => s.includes('.toolbar:not(.sheet__actions):has(> .input) > .input'));
  assert.ok(input, 'the input beside its button has no floor');
  assert.match(input[1], /flex:\s*1 1 140px/);
  assert.match(input[1], /min-width:\s*0/);
  const btn = RULES.find(([s]) => s.includes('.pp-row) > .btn:not(.btn--primary, .btn--danger)'));
  assert.ok(btn, 'the secondary beside an input is not a notation wire');
  assert.match(btn[1], /flex:\s*0 1 auto/);
  // Add-member and tags: the primary is the full-width amber plate under the row.
  const primary = RULES.find(([s]) => s.includes('.editor--tags) .pp-row > .btn--primary'));
  assert.ok(primary && primary[0].includes('.editor--add-member'), 'the one-row editors\' primary rule is gone');
  assert.match(primary[1], /flex:\s*1 1 100%/);
  assert.match(primary[1], /min-height:\s*52px/);
});
