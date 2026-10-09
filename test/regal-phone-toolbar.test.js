'use strict';

/* The Regal's phone toolbar (#1577): search, then ONE row — sort · ⓘ · Filter ·
 * „…" — with „Auswählen" and the BGG import folded into the „…". Das
 * Programmheft (P6.2) and Forest (F6.2) already had it; Klassisch, Ocean and Die
 * Brücke adopt it. Der Tisch keeps T6.2's row (a glyph chip for „Auswählen", the
 * import in the add sheet), so it gets no „…" holding a single item.
 *
 * Both copies of each folded action are rendered and CSS shows one per width,
 * so the DOM half is asserted here and the CSS half below. Klassisch's filter
 * trigger is the one thing that MOVES: into the row on a phone, back beside its
 * applied chips from 860px, through reflowAt (hub-reflow.js). jsdom has no
 * matchMedia, so the phone arrangement is what renders unless a spec stubs it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush, waitFor } = require('./support/dom');
const { specificity, outranks, mediaBlocks, rulesOf, CSS } = require('./support/css');

const RID = 'r1';
const round = (games) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [{ id: 't1', name: 'Kurz' }],
  members: [{ id: 'm1', name: 'Anna' }],
  games,
  sessions: [],
});
const shelf = () => round([
  { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: ['t1'] },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4, tagIds: [] },
]);

// `media`: null for no matchMedia (the phone arrangement), or a controllable
// stub whose `wide` flag answers the 860px query and whose listeners fire on
// `cross(wide)`.
async function renderRegal(t, design, { payload = shelf(), media = null, api } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (media) {
    dom.context.__media = media;
    dom.run(`window.matchMedia = (q) => {
      const mq = { matches: /min-width: 860px/.test(q) && __media.wide,
        addEventListener: (_, fn) => __media.listeners.push(fn), removeEventListener() {} };
      return mq;
    };`);
  }
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', api || (async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return payload;
    return {};
  }));
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  await dom.call('showRound', RID, 'regal');
  return dom;
}
const mediaStub = (wide) => ({ wide, listeners: [], cross(w) { this.wide = w; this.listeners.forEach((fn) => fn({ matches: w })); } });

const tools = (dom) => dom.app.querySelector('.section-head .section-tools');
const regalSection = (dom) => dom.app.querySelector('.regal-filter').closest('.section');
const importBtn = (dom) => tools(dom).querySelector('.ti-download')?.closest('button') || null;
const selectBtn = (dom) => tools(dom).querySelector('.ti-checkbox')?.closest('button') || null;

for (const design of [null, 'ocean', 'bruecke', 'forest', 'programmheft']) {
  const name = design || 'klassisch';
  test(`${name}: „Auswählen" and the import carry the wide mark, and the „…" follows them`, async (t) => {
    const dom = await renderRegal(t, design);
    const more = tools(dom).querySelectorAll('.regal-more');
    assert.equal(more.length, 1, 'one „…" in the row');
    assert.ok(selectBtn(dom).classList.contains('regal-tool--wide'), '„Auswählen" folds into the „…" on a phone');
    assert.ok(importBtn(dom).classList.contains('regal-tool--wide'), 'the BGG import folds into the „…" on a phone');
    const row = [...tools(dom).children];
    assert.ok(row.indexOf(more[0]) > row.indexOf(selectBtn(dom)), 'the „…" comes after the controls it carries');
    assert.ok(row.indexOf(more[0]) > row.indexOf(tools(dom).querySelector('.score-info')), 'the „…" closes the sort · ⓘ · Filter row');
  });
}

test('tisch: no „…" — T6.2 already fits one row, and „Auswählen" is not folded', async (t) => {
  const dom = await renderRegal(t, 'tisch');
  assert.equal(dom.app.querySelector('.regal-more'), null);
  assert.equal(dom.app.querySelector('.regal-tool--wide'), null);
});

test('klassisch: on a phone the filter trigger sits in the row, between the ⓘ and „Auswählen"', async (t) => {
  const dom = await renderRegal(t, null);
  const row = [...tools(dom).children];
  const trigger = tools(dom).querySelector(':scope > .fbar__trigger');
  assert.ok(trigger, 'the trigger was lifted into the toolbar');
  assert.ok(row.indexOf(trigger) > row.indexOf(tools(dom).querySelector('.score-info')));
  assert.ok(row.indexOf(trigger) < row.indexOf(selectBtn(dom)));
  assert.equal(regalSection(dom).querySelectorAll('.fbar__trigger').length, 1, 'moved, not copied');
  assert.equal(dom.app.querySelector('.fbar__count'), null, 'Klassisch keeps the trigger without a count badge');
});

test('klassisch: from 860px the trigger stays beside its applied chips, as before #1577', async (t) => {
  const dom = await renderRegal(t, null, { media: mediaStub(true) });
  assert.equal(tools(dom).querySelector('.fbar__trigger'), null);
  assert.ok(dom.app.querySelector('.regal-filter .fbar > .fbar__trigger:first-child'));
});

test('klassisch: crossing 860px moves the trigger both ways, and it still opens the panel', async (t) => {
  const media = mediaStub(false);
  const dom = await renderRegal(t, null, { media });
  assert.ok(tools(dom).querySelector(':scope > .fbar__trigger'), 'phone: in the row');
  media.cross(true);
  assert.ok(dom.app.querySelector('.regal-filter .fbar > .fbar__trigger:first-child'), 'wide: back beside the chips');
  assert.equal(tools(dom).querySelector('.fbar__trigger'), null);
  media.cross(false);
  const trigger = tools(dom).querySelector(':scope > .fbar__trigger');
  assert.ok(trigger, 'phone again: in the row');
  trigger.click();
  assert.ok(dom.document.querySelector('.fpanel__body'), 'the moved trigger keeps its own listener');
});

test('klassisch: the backfill remount leaves exactly one trigger in the row', async (t) => {
  // A BGG game missing its metadata makes the Regal ask for it (#736); the
  // answer remounts the filter panel, which must take the old lifted trigger
  // out of the row rather than add a second.
  const payload = round([
    { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: ['t1'], source: { provider: 'bgg', id: '13' } },
  ]);
  let posted = false;
  const dom = await renderRegal(t, null, {
    payload,
    api: async (method, url) => {
      if (/\/activities$/.test(url)) return [];
      if (/\/provider-info$/.test(url)) { posted = true; return { games: [{ id: 'g1', minPlaytime: 60, maxPlaytime: 90 }] }; }
      if (/^\/api\/rounds\/[^/]+$/.test(url)) return payload;
      return {};
    },
  });
  await waitFor(() => posted, { label: 'the provider-info backfill' });
  await flush();
  assert.equal(regalSection(dom).querySelectorAll('.fbar__trigger').length, 1);
  assert.equal(tools(dom).querySelectorAll('.fbar__trigger').length, 1);
});

test('the „…" offers „Auswählen" and the import, and says „Fertig" while selecting', async (t) => {
  const dom = await renderRegal(t, null);
  const more = tools(dom).querySelector('.regal-more');
  const open = () => { more.click(); return [...dom.document.querySelectorAll('.popover button')]; };
  let items = open();
  assert.deepEqual(items.map((b) => b.textContent.trim()), ['Auswählen', 'Von BGG übernehmen']);
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  items[0].click();
  assert.ok(dom.app.querySelector('.is-selecting'), 'the item runs the real toggle');
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  items = open();
  assert.equal(items[0].textContent.trim(), 'Fertig', 'the way out of selection is named as one');
  items[0].click();
  assert.equal(dom.app.querySelector('.is-selecting'), null);
});

// ------------------------------------------------------------------- CSS

const SHEETS = path.join(__dirname, '..', 'public', 'css', 'designs');
const sheet = (id) => fs.readFileSync(path.join(SHEETS, `${id}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = (css, query) => mediaBlocks(css).filter(([q]) => q.includes(query)).map(([, body]) => body).join('\n');
// Every selector of every rule, grouped lists split into their members.
const membersIn = (css) => rulesOf(css).flatMap(([sel]) => sel.split(/,\s*(?![^()]*\))/).map((m) => m.trim()));
const selectorsIn = (css) => rulesOf(css).map(([sel]) => sel.trim());
const findSel = (sels, re) => sels.find((s) => re.test(s));

test('css: below 860px the wide pair hides and the row takes the whole width', () => {
  const phone = block(CSS, 'max-width: 859px');
  const sels = selectorsIn(phone);
  const hide = findSel(sels, /^\.section-tools:has\(> \.regal-more\) > \.regal-tool--wide/);
  assert.ok(hide, 'the phone hide exists');
  assert.match(rulesOf(phone).find(([s]) => s.trim() === hide)[1], /display:\s*none/);
  // Ocean gives every `.link-btn` a display and loads after styles.css.
  const oceanLink = findSel(selectorsIn(sheet('ocean')), /^:root\[data-design="ocean"\] :is\(\.link-btn,/);
  assert.ok(oceanLink, 'the Ocean rule this hide has to beat still exists');
  assert.ok(outranks(hide, oceanLink), `${hide} ${specificity(hide)} must outrank ${oceanLink} ${specificity(oceanLink)}`);
  assert.ok(findSel(sels, /^\.section-tools:has\(> \.regal-more\) > \.search-pill$/), 'search takes a row of its own');
});

test('css: from 860px the „…" is hidden', () => {
  const wide = block(CSS, 'min-width: 860px');
  assert.match(rulesOf(wide).find(([s]) => s.trim() === '.section-tools .regal-more')[1], /display:\s*none/);
});

test('css: Die Brücke outranks its own toolbar display rule, in both directions', () => {
  const css = sheet('bruecke');
  const toolbar = findSel(membersIn(css), /^:root\[data-design="bruecke"\] \.bruecke-regal \.regal-head \.section-tools :is\(\.link-btn, \.fbar__trigger, \.regal-more/);
  assert.ok(toolbar, 'the toolbar rule names the „…"');
  const hide = findSel(selectorsIn(block(css, 'max-width: 859px')), /\.regal-tool--wide\.regal-tool--wide$/);
  const deskHide = findSel(selectorsIn(block(css, 'min-width: 860px')), /\.regal-more\.regal-more$/);
  assert.ok(hide && outranks(hide, toolbar), 'the phone hide of the wide pair beats the toolbar display');
  assert.ok(deskHide && outranks(deskHide, toolbar), 'the desktop hide of the „…" beats the toolbar display');
});

test('css: an empty filter bar whose trigger was lifted costs nothing', () => {
  assert.ok(rulesOf(CSS).some(([s, b]) => s.trim() === '.regal-filter:not(:has(.fbar__trigger)):has(.fbar__chips[hidden])'
    && /display:\s*none/.test(b)));
});
