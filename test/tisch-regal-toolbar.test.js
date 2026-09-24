'use strict';

/* Der Tisch's Regal head and toolbar (#1278) — T3.3 (desktop) and T6.2 (phone).
 *
 * Under Der Tisch the Regal is headed by a display title „Regal" with the
 * count beside it, then ONE row of controls in the sheet's order — search,
 * sort, ⓘ, the filter trigger (lifted out of the panel below the head, with a
 * count badge), „Auswählen", „Nicht im Regal" — closed by the gold „Spiel
 * hinzufügen". On a phone that button is a second copy UNDER the shelf, sticky
 * above the dock; CSS shows one per width, which is what keeps DOM order equal
 * to visual order. The BGG import leaves the row: the add sheet carries it.
 *
 * Klassisch must render exactly what it rendered before, so the first test pins
 * its structure — seen red by breaking the design branch on purpose.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');

const RID = 'r1';

const roundWith = (games) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [{ id: 't1', name: 'Kurz' }],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games,
  sessions: [],
});

const shelf = roundWith([
  { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: ['t1'] },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4, tagIds: [] },
]);

async function renderRegal(t, design, payload = shelf, setup) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return payload;
    return {};
  });
  // canImportBgg() is accountsActive(): the import is offered, so its absence
  // from the Tisch row is a decision rather than a gate that happened to be shut.
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  if (setup) setup(dom);
  await dom.call('showRound', RID, 'regal');
  return dom;
}

const section = (dom) => dom.app.querySelector('.section-head').parentElement;
const tools = (dom) => dom.app.querySelector('.section-head .section-tools');
// A compact signature of one tools child: its tag and the classes that say
// which control it is.
const sig = (el) => {
  const keep = ['link-btn', 'search-pill', 'sort-select', 'score-info', 'rail-owned', 'fbar__trigger', 'regal-add', 'regal-add--bar'];
  const cls = [...el.classList].filter((c) => keep.includes(c));
  return `${el.tagName.toLowerCase()}${cls.length ? '.' + cls.join('.') : ''}`;
};

// ------------------------------------------------------------- Klassisch

test('Klassisch: the Regal head, tools row and grid are exactly as before', async (t) => {
  const dom = await renderRegal(t, null);
  const head = dom.app.querySelector('.section-head');
  assert.equal(head.className, 'section-head');
  assert.equal(head.children.length, 2);
  assert.equal(head.children[0].tagName, 'H1');
  assert.equal(head.children[0].textContent, 'Spiele (2)');
  assert.equal(head.querySelector('.regal-title'), null);

  const row = [...tools(dom).children];
  assert.deepEqual(row.map((el) => el.tagName.toLowerCase()), ['button', 'label', 'select', 'button', 'button', 'button']);
  // The BGG import leads the row, and the off-shelf control is rail-owned.
  assert.ok(row[0].querySelector('.ti-download'), 'the import button leads the Klassisch row');
  assert.ok(row[1].classList.contains('search-pill'));
  assert.ok(row[5].classList.contains('rail-owned'));
  assert.equal(tools(dom).querySelector('.fbar__trigger'), null, 'the filter trigger stays in its panel');
  assert.ok(dom.app.querySelector('.regal-filter .fbar > .fbar__trigger'));
  assert.equal(dom.app.querySelector('.fbar__count'), null);
  assert.equal(dom.app.querySelector('.regal-select'), null);

  // The dashed add tile closes the grid; no gold button anywhere.
  const grid = dom.app.querySelector('.cards');
  assert.ok(grid.lastElementChild.classList.contains('add-tile'));
  assert.equal(dom.app.querySelector('.regal-add'), null);
});

test('Klassisch: an empty shelf still offers the add tile and the import tile', async (t) => {
  const dom = await renderRegal(t, null, roundWith([]));
  const tiles = [...dom.app.querySelectorAll('.cards .add-tile')];
  assert.equal(tiles.length, 2);
  assert.equal(dom.app.querySelector('.regal-add'), null);
});

// ------------------------------------------------------------- Der Tisch

test('Tisch: a display title „Regal" with the count beside it', async (t) => {
  const dom = await renderRegal(t, 'tisch');
  const title = dom.app.querySelector('.section-head.regal-head > .regal-title');
  assert.ok(title, 'the head carries the titled group');
  assert.equal(title.querySelector('h1').textContent, 'Regal');
  assert.equal(title.querySelector('.regal-title__count').textContent, '2 Spiele');
});

test('Tisch: the count is plural-aware', async (t) => {
  const dom = await renderRegal(t, 'tisch', roundWith([{ id: 'g1', title: 'Catan', tagIds: [] }]));
  assert.equal(dom.app.querySelector('.regal-title__count').textContent, '1 Spiel');
});

test('Tisch: ONE row in the sheet order, closed by the gold add button, no import', async (t) => {
  const dom = await renderRegal(t, 'tisch');
  const row = [...tools(dom).children].map(sig);
  assert.deepEqual(row, [
    'label.search-pill',
    'select.sort-select',
    'button.score-info',
    'button.fbar__trigger',
    'button.link-btn',
    'button.link-btn',
    'button.regal-add.regal-add--bar',
  ]);
  assert.equal(tools(dom).querySelector('.ti-download'), null, 'the BGG import left the row');
  // „Auswählen" carries the phone row's glyph-chip hook, and keeps its word
  // in the DOM (the CSS clips it visually; it is still the button's name).
  const select = tools(dom).children[4];
  assert.ok(select.classList.contains('regal-select'));
  assert.equal(select.textContent.trim(), 'Auswählen');
  // „Nicht im Regal" is not rail-owned under Der Tisch (#1262): no rail group.
  assert.ok(tools(dom).children[5].querySelector('.ti-archive'));
});

test('Tisch: the phone copy of the add button follows the grid, and the dashed tile is gone', async (t) => {
  const dom = await renderRegal(t, 'tisch');
  const sec = section(dom);
  const grid = sec.querySelector('.cards');
  const dock = sec.querySelector('.regal-add--dock');
  assert.ok(dock, 'the phone copy exists');
  assert.equal(sec.lastElementChild, dock, 'it is the section’s last child, after the grid');
  assert.ok(grid.compareDocumentPosition(dock) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(grid.querySelector('.add-tile'), null);
  assert.equal(dom.app.querySelectorAll('.regal-add').length, 2);
});

test('Tisch: both add buttons open the add sheet, whose import row carries the BGG import', async (t) => {
  for (const where of ['bar', 'dock']) {
    const dom = await renderRegal(t, 'tisch');
    dom.app.querySelector(`.regal-add--${where}`).click();
    await new Promise((r) => setImmediate(r));
    const sheet = dom.document.querySelector('.sheet');
    assert.ok(sheet, `the ${where} button opened a sheet`);
    assert.ok(sheet.querySelector('#addSearchImport'), 'the import is reachable from the add sheet');
  }
});

test('Tisch: the lifted filter trigger shows how many filters are on', async (t) => {
  const idle = await renderRegal(t, 'tisch');
  const badge = tools(idle).querySelector('.fbar__trigger .fbar__count');
  assert.ok(badge, 'the trigger carries a count badge');
  assert.equal(badge.hidden, true, 'no badge while nothing is filtered');

  const dom = await renderRegal(t, 'tisch', shelf, (d) => d.run(`regalFiltersRid = ${JSON.stringify(RID)}; gamesSort = 'avg'; regalFilters.tags.set('t1', 'include');`));
  const on = tools(dom).querySelector('.fbar__trigger .fbar__count');
  assert.equal(on.hidden, false);
  assert.equal(on.textContent, '1');
  // The applied chips stay below the head, in the panel the trigger left.
  assert.equal(dom.app.querySelectorAll('.regal-filter .fbar__chips .fchip').length, 1);
  assert.equal(dom.app.querySelector('.regal-filter .fbar__trigger'), null);
});

test('Tisch: an empty shelf keeps its import tile, drops the dashed add tile, and still has the gold button', async (t) => {
  const dom = await renderRegal(t, 'tisch', roundWith([]));
  const tiles = [...dom.app.querySelectorAll('.cards .add-tile')];
  assert.equal(tiles.length, 1);
  assert.ok(tiles[0].querySelector('.ti-download'), 'the remaining tile is the BGG import');
  assert.ok(tools(dom).querySelector('.regal-add--bar'));
  assert.ok(section(dom).querySelector('.regal-add--dock'));
});

// ------------------------------------------------------------- the stylesheet

const SHEET = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('CSS: on a phone the bar copy hides and the dock copy sticks above the dock', () => {
  // The phone block this slice added: the one that hides the bar copy.
  const at = SHEET.indexOf(':root[data-design="tisch"] .regal-add--bar { display: none; }');
  assert.ok(at > 0, 'the bar copy is hidden somewhere');
  const open = SHEET.lastIndexOf('@media', at);
  assert.equal(SHEET.slice(open, SHEET.indexOf('{', open)).trim(), '@media (max-width: 859px)');
  const phone = SHEET.slice(at);
  const dock = phone.match(/:root\[data-design="tisch"\] \.regal-add--dock \{([^}]*)\}/);
  assert.ok(dock, 'the phone rule for the dock copy exists');
  assert.match(dock[1], /position: sticky;/);
  assert.match(dock[1], /bottom: calc\(var\(--dock-clearance\)/);
  // Outside the phone block the dock copy is hidden, so a desktop never shows two.
  assert.match(SHEET, /\n:root\[data-design="tisch"\] \.regal-add--dock \{ display: none; \}/);
});

test('contrast: every new foreground/background pair clears its bar', () => {
  /* Each pair as the rules above paint it, resolved from the design's own
     tokens (never read off the sheet). The gold plate is a gradient, so its ink
     is measured on BOTH stops. */
  const { contrast, token } = require('./support/theme');
  const { designById } = require('../public/js/designs');
  const TISCH = designById('tisch');
  const v = (n) => token(n, TISCH);
  const AA_TEXT = 4.5;
  const AA_LARGE = 3;
  const pairs = [
    ['title --ink on the page', v('--ink'), v('--page-bg'), AA_TEXT],
    ['count --ink-soft on the page', v('--ink-soft'), v('--page-bg'), AA_TEXT],
    ['add label --on-accent on --brass-hi', v('--on-accent'), v('--brass-hi'), AA_TEXT],
    ['add label --on-accent on --gold-deep', v('--on-accent'), v('--gold-deep'), AA_TEXT],
    ['add rim --gold-edge on the page', v('--gold-edge'), v('--page-bg'), AA_LARGE],
    ['filter label --ink on --control-fill', v('--ink'), v('--control-fill'), AA_TEXT],
    ['filter label --ink on --gold-soft (hover/open)', v('--ink'), v('--gold-soft'), AA_TEXT],
    ['filter glyph --gold on --control-fill', v('--gold'), v('--control-fill'), AA_LARGE],
    ['filter count --on-accent on --gold', v('--on-accent'), v('--gold'), AA_TEXT],
  ];
  const failures = pairs
    .map(([label, fg, bg, bar]) => [label, contrast(fg, bg), bar])
    .filter(([, ratio, bar]) => !(ratio >= bar))
    .map(([label, ratio, bar]) => `${label} = ${ratio.toFixed(2)}:1 (bar ${bar})`);
  assert.deepEqual(failures, []);
});

test('CSS: the toolbar no longer reorders anything (DOM order is the drawn order)', () => {
  assert.doesNotMatch(SHEET, /\.section-tools \.search-pill \{ order:/);
  assert.doesNotMatch(SHEET, /\.section-tools:has\(\.search-pill\)/);
});
