'use strict';

/* Der Tisch's SEARCH-FIRST add-game step (#1264, T3.5 desktop / T6.4 phone).

   Under Der Tisch, „Spiel hinzufügen" opens on a query field and lists the
   lookup's hits as rows, each carrying its own state: „Steht schon im Regal"
   (no add button), „Auf der Wunschliste", „Im Archiv dieser Runde", or nothing
   — plus two ways out, the BGG import and „Selbst eintragen", which is today's
   form. Klassisch must not notice any of it: every entry point still lands on
   the form, with the same fields in the same order.

   Driven under jsdom (.claude/rules/testing-views-under-jsdom.md), because
   every claim here is about what the sheet RENDERS and what its buttons send.
   The provider is stubbed at the `api` seam; nothing reaches BGG. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush } = require('./support/dom');

// One hit per state a row can be in. The round's games carry the provider link
// the state is read from (game.source) — a title alone decides nothing.
const HITS = [
  { providerId: '101', title: 'Nordlichter', thumbnail: null, year: 2026 },
  { providerId: '202', title: 'Nordland', thumbnail: null, year: 2019 },
  { providerId: '303', title: 'Nordlicht-Expedition', thumbnail: null, year: 2024 },
  { providerId: '404', title: 'Nordwind', thumbnail: null, year: null },
];
const bgg = (externalId) => ({ provider: 'bgg', externalId, url: '' });
const ROUND = {
  id: 1,
  name: 'Donnerstagsrunde',
  games: [
    { id: 11, title: 'Nordlichter', source: bgg('101') },
    { id: 12, title: 'Nordland', wish: true, source: bgg('202') },
    { id: 14, title: 'Nordwind', retired: true, source: bgg('404') },
    // Same title as a hit, no provider link: must NOT hold the row (#790's
    // „Scout" — several distinct BGG games share one name).
    { id: 15, title: 'Nordlicht-Expedition' },
  ],
  tags: [],
  members: [{ id: 'm1', name: 'Lea', userId: 'u1' }],
  sessions: [],
  activity: [],
};

/** Boot the shell with an api stub that records every call. */
function boot(t, { design = 'klassisch', detail = {} } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (url.includes('/lookup/search')) return { results: HITS };
    if (url.includes('/lookup/game')) return Object.assign({ title: 'Primary Name', url: 'https://boardgamegeek.com/boardgame/303' }, detail);
    if (method === 'POST' && url.endsWith('/games')) return { id: 99, title: body.get('title') };
    return {};
  });
  const toasts = [];
  dom.set('toast', (m) => toasts.push(m));
  dom.set('currentUserId', () => 'u1');
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  return { dom, calls, toasts };
}

const sheetOf = (dom) => dom.document.querySelector('.sheet');

/** Open the Tisch search step and search for "nord" (Enter searches at once). */
async function searched(t, opts = {}) {
  const env = boot(t, Object.assign({ design: 'tisch' }, opts));
  const { dom } = env;
  await dom.call('showAddGame', ROUND, opts.wish ? { wish: true } : {});
  const input = dom.document.getElementById('addSearchQ');
  input.value = 'nord';
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await flush();
  await flush();
  const row = (title) => [...dom.document.querySelectorAll('.add-search__row')]
    .find((r) => r.querySelector('.add-search__title').textContent === title);
  return Object.assign(env, { input, row });
}

/* ---------------------------- Klassisch: unchanged --------------------------- */

// The form's controls, in document order, exactly as they stood before #1264.
// An id list rather than a markup snapshot so it names what went missing.
const KLASSISCH_FORM_IDS = [
  'title', 'lookupMenu', 'dupHint', 'minPlayers', 'maxPlayers', 'tagSeg', 'newTag',
  'addTagBtn', 'pasteZone', 'pasteBtn', 'clearImg', 'coverPickerSlot', 'save', 'saveMore',
];

test('Klassisch: „Spiel hinzufügen" still opens the form, field for field', async (t) => {
  const { dom } = boot(t);
  await dom.call('showAddGame', ROUND);
  const sheet = sheetOf(dom);
  assert.ok(sheet, 'no sheet opened');
  assert.equal(sheet.querySelector('.add-search__list'), null, 'Klassisch rendered the Tisch search step');
  const ids = [...sheet.querySelectorAll('[id]')].map((e) => e.id).filter((id) => KLASSISCH_FORM_IDS.includes(id));
  assert.deepEqual(ids, KLASSISCH_FORM_IDS);
  assert.ok(sheet.querySelector('#ownerField'), 'the owner field is gone for a round with a member');
  assert.equal(dom.document.activeElement.id, 'title', 'the title field must still take focus on open');
});

test('Klassisch: the wish variant is the form too', async (t) => {
  const { dom } = boot(t);
  await dom.call('showAddGame', ROUND, { wish: true });
  const sheet = sheetOf(dom);
  assert.equal(sheet.querySelector('.add-search__list'), null);
  assert.ok(sheet.querySelector('#title'), 'the wish form lost its title field');
});

/* ------------------------------ Tisch: the search ------------------------------ */

test('Tisch: the sheet opens on the query field, not on the form', async (t) => {
  const { dom } = boot(t, { design: 'tisch' });
  await dom.call('showAddGame', ROUND);
  const sheet = sheetOf(dom);
  assert.ok(sheet.classList.contains('add-search'), 'Tisch did not open the search step');
  assert.equal(sheet.querySelector('#title'), null, 'the form rendered under the search step');
  const input = sheet.querySelector('#addSearchQ');
  assert.equal(dom.document.activeElement, input, 'the query field must take focus');
  assert.equal(input.getAttribute('aria-label'), 'Spiel suchen');
  // A plain result list, not a combobox: no listbox semantics to manage.
  assert.equal(input.hasAttribute('role'), false);
  assert.equal(sheet.querySelector('.add-search__list').tagName, 'UL');
  assert.equal(sheet.querySelector('#addSearchMsg').textContent, 'Tippen für Vorschläge.');
});

test('Tisch: each row carries its own state, read from the provider link', async (t) => {
  const { dom, row } = await searched(t);
  assert.equal(dom.document.getElementById('addSearchCount').textContent, '4 Treffer bei BGG');

  const shelf = row('Nordlichter');
  assert.ok(shelf.classList.contains('is-held'));
  assert.equal(shelf.querySelector('.add-search__state').textContent, 'Steht schon im Regal');
  assert.equal(shelf.querySelector('.add-search__add'), null, 'a game on the shelf must not offer „Hinzufügen"');
  assert.match(shelf.querySelector('.add-search__held').textContent, /Im Regal/);

  const wish = row('Nordland');
  assert.equal(wish.querySelector('.add-search__state').textContent, 'Auf der Wunschliste');
  assert.ok(wish.querySelector('.add-search__shelve'), 'a wished game is moved onto the shelf, not added again');

  const archived = row('Nordwind');
  assert.equal(archived.querySelector('.add-search__state').textContent, 'Im Archiv dieser Runde');
  assert.ok(archived.querySelector('.add-search__add'));

  const fresh = row('Nordlicht-Expedition');
  assert.equal(fresh.querySelector('.add-search__state'), null,
    'a title match without a provider link must not claim the game is already here');
  const add = fresh.querySelector('.add-search__add');
  assert.equal(add.getAttribute('aria-label'), 'Hinzufügen: Nordlicht-Expedition');
  assert.equal(row('Nordlicht-Expedition').querySelector('.add-search__meta').textContent, '2024 · BGG');
});

test('Tisch wish variant: on the list and on the shelf are both held', async (t) => {
  const { row } = await searched(t, { wish: true });
  assert.equal(row('Nordland').querySelector('.add-search__add'), null, 'a wish cannot be wished twice');
  assert.match(row('Nordland').querySelector('.add-search__held').textContent, /Gelistet/);
  assert.equal(row('Nordlichter').querySelector('.add-search__add'), null);
  assert.ok(row('Nordlicht-Expedition').querySelector('.add-search__add'));
});

test('Tisch: „Hinzufügen" opens the form prefilled with the hit, as a lookup pick would', async (t) => {
  // Operator decision 2026-09-24: a hit is a starting point, not a save — the
  // form opens filled (title, players, provider link, cover) so tags, owners
  // and the edition can be set before anything is stored.
  const { dom, calls, row } = await searched(t, { detail: { minPlayers: 1, maxPlayers: 5, imageUrl: 'https://cf.geekdo-images.com/x.jpg' } });
  row('Nordlicht-Expedition').querySelector('.add-search__add').click();
  await flush();
  await flush();
  const sheet = sheetOf(dom);
  assert.equal(dom.document.querySelectorAll('.sheet').length, 1, 'the form must REPLACE the search step');
  assert.equal(sheet.querySelector('.add-search__list'), null);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'opening the form stores nothing');
  // BGG's search title wins over the detail's primary name (pickedTitle, #117).
  assert.equal(sheet.querySelector('#title').value, 'Nordlicht-Expedition');
  assert.equal(sheet.querySelector('#minPlayers').value, '1');
  assert.equal(sheet.querySelector('#maxPlayers').value, '5');

  sheet.querySelector('#save').click();
  await flush();
  await flush();
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'Speichern posted nothing');
  assert.equal(post.url, '/api/rounds/1/games');
  assert.equal(post.body.get('sourceProvider'), 'bgg');
  assert.equal(post.body.get('sourceExternalId'), '303');
  assert.equal(post.body.get('wish'), null);
});

test('Tisch wish variant: the prefilled form still files a wish', async (t) => {
  const { dom, calls, row } = await searched(t, { wish: true });
  row('Nordlicht-Expedition').querySelector('.add-search__add').click();
  await flush();
  await flush();
  sheetOf(dom).querySelector('#save').click();
  await flush();
  await flush();
  const fd = calls.find((c) => c.method === 'POST' && c.url.endsWith('/games')).body;
  assert.equal(fd.get('wish'), 'true');
  assert.equal(fd.get('sourceExternalId'), '303');
});

test('Tisch: a wished hit offers „Ins Regal" and moves THAT game, not a copy', async (t) => {
  // Operator decision 2026-09-24: the wish moves onto the shelf with the
  // wishlist's own action, so the round never ends up with the game twice.
  const { dom, calls, row, toasts } = await searched(t);
  const btn = row('Nordland').querySelector('.add-search__shelve');
  assert.ok(btn, 'a wished hit must offer „Ins Regal"');
  assert.equal(row('Nordland').querySelector('.add-search__add'), null, 'and not a second „Hinzufügen"');
  assert.equal(btn.getAttribute('aria-label'), 'Ins Regal: Nordland');
  btn.click();
  await flush();
  await flush();
  assert.deepEqual(calls.filter((c) => c.method === 'POST').map((c) => [c.url, JSON.stringify(c.body)]),
    [['/api/rounds/1/games/12/wish', '{"wish":false}']]);
  assert.equal(toasts.length, 1);
  const moved = row('Nordland');
  assert.ok(moved.classList.contains('is-held'), 'the row now reads as on the shelf');
  assert.equal(moved.querySelector('.add-search__state').textContent, 'Steht schon im Regal');
  assert.equal(dom.document.querySelectorAll('.sheet').length, 1, 'the search step stays open for the next one');
});

test('Tisch: „Selbst eintragen" reaches the whole form with the query handed over', async (t) => {
  const { dom, input } = await searched(t);
  input.value = 'Mein Eigenbau';
  dom.document.getElementById('addSearchSelf').click();
  const sheet = sheetOf(dom);
  assert.equal(sheet.querySelector('.add-search__list'), null, 'the search step stayed open');
  assert.equal(dom.document.querySelectorAll('.sheet').length, 1, 'the form must REPLACE the search step');
  const ids = [...sheet.querySelectorAll('[id]')].map((e) => e.id).filter((id) => KLASSISCH_FORM_IDS.includes(id));
  assert.deepEqual(ids, KLASSISCH_FORM_IDS, 'the form reached from the search step lost a field');
  assert.equal(sheet.querySelector('#title').value, 'Mein Eigenbau');
});

test('Tisch: „Von BoardGameGeek übernehmen" reaches the BGG import', async (t) => {
  const { dom } = boot(t, { design: 'tisch' });
  dom.set('canImportBgg', () => true);
  const opened = [];
  dom.set('showBggImport', (round, status) => opened.push(status));
  await dom.call('showAddGame', ROUND);
  const btn = dom.document.getElementById('addSearchImport');
  assert.ok(btn, 'the import way is missing with accounts on');
  assert.match(btn.textContent, /Von BGG übernehmen/);
  btn.click();
  assert.deepEqual(opened, ['own']);
});

test('Tisch: Escape dismisses the sheet — there is no dropdown to close first', async (t) => {
  const { dom } = boot(t, { design: 'tisch' });
  await dom.call('showAddGame', ROUND);
  dom.document.getElementById('addSearchQ').dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(sheetOf(dom), null);
});
