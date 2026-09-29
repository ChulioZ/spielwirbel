'use strict';

/* Das Programmheft's overlays (#1378, P15a/P15b): the sheets, the three game
 * editors as popover or sheet, the confirm dialog, the toast and the „…" menu.
 *
 * The one markup branch is formSheetDesign() (sheet.js): under Das Programmheft
 * the players, owners and cover editors render the row list Der Tisch and Ocean
 * already draw. Everything else in this slice is CSS in programmheft.css.
 *
 * The Klassisch half matters most: the branch must not reach a Klassisch
 * account, so its editor DOM is pinned tag-for-tag here too — seen red by
 * making formSheetDesign() answer true for every design.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf, mediaBlocks, topLevel } = require('./support/css');
const { SUPPORTED_LOCALES } = require('../public/js/locales');

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
  dom.run(`window.__anchor = document.createElement('button'); document.body.appendChild(window.__anchor);`);
  dom.run(`${OPENERS[editor]}(window.__ctx, window.__anchor)`);
  const card = wide ? dom.document.querySelector('.popover') : dom.document.querySelector('.sheet');
  assert.ok(card, `${editor} opened no ${wide ? 'popover' : 'sheet'}`);
  const body = wide ? card : card.querySelector('.editor');
  return { dom, card, body };
}

const shape = (root) => [...root.querySelectorAll('*')].map((n) => n.tagName.toLowerCase()
  + (n.getAttribute('class') ? '.' + n.getAttribute('class').trim().split(/\s+/).join('.') : ''));

// The Klassisch editors as they render on main (same record as
// tisch-form-sheets.test.js, with this file's untagged fixture).
const KLASSISCH = {
  players: ['div.pp-row', 'input.input', 'span', 'input.input', 'button.btn.btn--primary'],
  owners: ['div.filter-chips', 'button.chip.is-on', 'span.chip__avatar.avatar', 'button.chip',
    'span.chip__avatar.avatar', 'div.pp-row', 'button.btn.btn--primary'],
  cover: ['button.btn.btn--primary', 'button.btn', 'div.cover-picker', 'button.link-btn.cover-picker__toggle',
    'i.ti.ti-photo', 'span', 'div.cover-picker__body', 'button.btn.btn--ghost', 'div.muted.popover__hint'],
};

for (const editor of Object.keys(KLASSISCH)) {
  for (const wide of [false, true]) {
    test(`Klassisch: the ${editor} editor at ${wide ? 1440 : 390} is unchanged by #1378`, (t) => {
      const { card, body } = open(t, { design: 'klassisch', wide, editor });
      assert.deepEqual(shape(body), KLASSISCH[editor]);
      if (wide) assert.equal(card.querySelector('.popover__head'), null, 'Klassisch grew a popover head');
    });
  }
}

for (const editor of Object.keys(OPENERS)) {
  test(`Das Programmheft: the ${editor} editor is rows over ONE primary at 390 and 1440`, (t) => {
    for (const wide of [false, true]) {
      const { card, body } = open(t, { design: 'programmheft', wide, editor });
      const where = wide ? '1440' : '390';
      assert.ok(body.querySelectorAll('.editor-row, .cover-picker__toggle').length >= 1, `${where}: no rows`);
      const primaries = body.querySelectorAll('.btn--primary');
      assert.equal(primaries.length, 1, `${where}: ${primaries.length} primary actions`);
      assert.ok(primaries[0].closest('.editor-actions'), `${where}: the primary is not in the action bar`);
      if (wide) {
        const head = card.firstElementChild;
        assert.ok(head.classList.contains('popover__head'), 'the popover has no title head');
        assert.ok(head.querySelector('.popover__title').textContent.trim(), 'the head names nothing');
        assert.ok(head.querySelector('button.popover__close'), 'the head has no ×');
      }
    }
  });
}

/* ---------------------------- the two native pickers keep their full set */

test('Das Programmheft: sort offers exactly its three orders, and the language picker every shipped locale', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('toast', () => {});
  dom.set('isLoggedIn', () => false);
  dom.run("applyDesign('programmheft')");
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', ROUND, ROUND.games);
  const sort = dom.app.querySelector('select.sort-select');
  assert.ok(sort, 'the Regal rendered no sort control');
  assert.deepEqual([...sort.options].map((o) => o.value), ['random', 'name', 'avg']);

  const picker = dom.document.getElementById('langPicker');
  if (!picker.options.length) dom.run('setupLangPicker()');
  assert.deepEqual([...picker.options].map((o) => o.value), SUPPORTED_LOCALES);
  assert.equal(SUPPORTED_LOCALES.length, 9);
});

/* ------------------------------------------------------------ the CSS */

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/programmheft.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const MARK = '#1378';
const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/programmheft.css'), 'utf8');
// This slice's own section: everything after its banner, comments stripped.
const MINE = RAW.slice(RAW.indexOf(`/* ===== ${MARK}`)).replace(/\/\*[\s\S]*?\*\//g, '');

test('the slice section exists and is not vacuous', () => {
  assert.ok(RAW.includes(`/* ===== ${MARK}`), 'the #1378 banner is gone');
  assert.ok(rulesOf(MINE).length >= 50, `only ${rulesOf(MINE).length} rules in the section`);
});

test('no action or heading in the overlays sets Anton below 24px', () => {
  const tokens = { '--display-1': 118, '--display-2': 84, '--display-3': 60, '--display-4': 40,
    '--display-5': 30, '--display-6': 24, '--text-2xl': 26 };
  const anton = rulesOf(MINE).filter(([, b]) => /font-family:\s*var\(--font-display\)/.test(b));
  assert.ok(anton.length >= 4, `only ${anton.length} display-face rules found`);
  const small = anton.filter(([, b]) => {
    const m = /font-size:\s*([^;]+)/.exec(b);
    if (!m) return true;
    const v = m[1].trim();
    const tok = /^var\((--[\w-]+)\)$/.exec(v);
    const px = tok ? tokens[tok[1]] : Number((/^(\d+(?:\.\d+)?)px$/.exec(v) || [])[1]);
    return !(px >= 24);
  }).map(([s]) => s);
  assert.deepEqual(small, []);
});

test('the scrim is ink at 62%, declared in the resolved colour block', () => {
  assert.match(SHEET, /--scrim:\s*color-mix\(in oklab, var\(--ink\) 62%, transparent\)/);
});

test('the grab handle exists only on a phone', () => {
  const grip = (css) => rulesOf(css).filter(([s]) => /\.sheet__head::before/.test(s));
  assert.deepEqual(grip(topLevel(MINE)).map(([s]) => s), [], 'a grip outside the phone block');
  const phone = mediaBlocks(MINE).filter(([q]) => /max-width:\s*639px/.test(q));
  assert.equal(phone.reduce((n, [, b]) => n + grip(b).length, 0), 1, 'the phone block lost its grip');
});

test('a danger FILL is spent only on the confirm dialog and the error toast', () => {
  const fills = rulesOf(MINE).filter(([, b]) => /(^|[;\s])background(-color)?:\s*var\(--danger\)/.test(b));
  assert.ok(fills.length >= 2, 'no danger fill found — the lookup is vacuous');
  const stray = fills.filter(([s]) => !/\.sheet__actions--confirm|\.toast--error/.test(s)).map(([s]) => s);
  assert.deepEqual(stray, []);
});

test('the „…" menu rules off its destructive group with the strong ink rule', () => {
  const hit = rulesOf(MINE).find(([s]) =>
    /:not\(\[data-kind="destructive"\]\)\s*\+\s*\.popover__opt\[data-kind="destructive"\]/.test(s));
  assert.ok(hit, 'no boundary rule between the ordinary and the destructive rows');
  assert.match(hit[1], /border-top:\s*var\(--rule-strong\) solid var\(--ink\)/);
});

test('the toast is a square strip, never a pill', () => {
  const toast = rulesOf(MINE).filter(([s]) => /\.toast(?![\w-])/.test(s));
  assert.ok(toast.length >= 1);
  assert.deepEqual(toast.filter(([, b]) => /radius-pill/.test(b)).map(([s]) => s), []);
  const base = toast.find(([s]) => /\.toast\s*$/.test(s));
  assert.match(base[1], /border-radius:\s*0/);
});
