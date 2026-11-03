'use strict';

/* „Aus Myludo importieren" (#1758): the sheet and its two entry points, driven
   under jsdom (.claude/rules/testing-views-under-jsdom.md). The provider is
   stubbed at the `api` seam — nothing reaches BGG — and the file is handed to
   the input as an object with `text()`, which is all the sheet reads of it.
   The fixture is INVENTED in the observed export shape. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, waitFor } = require('./support/dom');

const bgg = (externalId) => ({ provider: 'bgg', externalId, url: '' });
const ROUND = {
  id: 1,
  name: 'Donnerstagsrunde',
  games: [
    { id: 11, title: 'Cascadia', source: bgg('300') },
    { id: 12, title: 'Café International' },
  ],
  tags: [],
  members: [{ id: 'm1', name: 'Lea', userId: 'u1' }],
  sessions: [],
  activity: [],
};

const entry = (over) => ({ ID: 1, Titre: 'Jeu', 'Édition': 2020, Type: 'basegame', 'Joueur(s)': '2 — 4', 'Durée': 60, 'Gamme(s)': [], ...over });
const FILE = JSON.stringify([
  entry({ ID: 1, Titre: 'Azul', 'Édition': 2017 }),
  entry({ ID: 2, Titre: 'Forêt Mixte', 'Joueur(s)': '1 — 5', 'Durée': '40 — 60', 'Gamme(s)': ['Forêt Mixte'] }),
  entry({ ID: 3, Titre: 'Alpes', Type: 'extension', 'Gamme(s)': ['Forêt Mixte'] }),
  entry({ ID: 4, Titre: 'Cascadia - Landmarks', Type: 'extension', 'Joueur(s)': '1 — 6' }),
  entry({ ID: 5, Titre: 'Cafe international' }),
  // An expansion whose base ROW is already on the shelf joins that shelf game.
  entry({ ID: 8, Titre: 'Café-Bar', Type: 'extension', 'Joueur(s)': '2 — 5', 'Gamme(s)': ['Cafe international'] }),
  entry({ ID: 6, Titre: 'Orpheline', Type: 'extension' }),
  entry({ ID: 7, Titre: 'Pas choisi' }),
]);

// What BGG "answers" per title: Azul matches exactly, Forêt Mixte not at all.
const HITS = {
  Azul: [{ providerId: '230802', title: 'Azul', year: 2017 }, { providerId: '9', title: 'Azul: Summer Pavilion', year: 2019 }],
  'Pas choisi': [{ providerId: '77', title: 'Pas choisi', year: 2020 }],
};

function boot(t, { design = 'klassisch' } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (url.includes('/lookup/search')) {
      const q = decodeURIComponent(new URL(url, 'http://x').searchParams.get('q'));
      return { results: HITS[q] || [] };
    }
    if (url.includes('/lookup/cards')) {
      return { cards: [{ providerId: '230802', minPlayers: 2, maxPlayers: 4, imageUrl: 'https://cf.geekdo-images.com/azul.jpg' }] };
    }
    if (url.endsWith('/games/import')) return { imported: 3, skipped: 0, attached: 1 };
    return {};
  });
  const toasts = [];
  dom.set('toast', (m) => toasts.push(m));
  dom.set('currentUserId', () => 'u1');
  const navigations = [];
  dom.set('showRound', (rid, tab) => navigations.push(['round', rid, tab]));
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  return { dom, calls, toasts, navigations };
}

async function openWithFile(t, text = FILE, prepare = () => {}) {
  const env = boot(t);
  const { dom } = env;
  prepare(dom);
  dom.call('showMyludoImport', ROUND);
  const input = dom.document.querySelector('.myludo-import input[type="file"]');
  assert.ok(input, 'no file input');
  Object.defineProperty(input, 'files', { value: [{ text: async () => text }] });
  input.dispatchEvent(new dom.window.Event('change'));
  return env;
}

const rowTitles = (dom) => [...dom.document.querySelectorAll('.bgg-import__list .bgg-import__name')].map((e) => e.textContent);
const stateOf = (dom, title) => [...dom.document.querySelectorAll('.bgg-import__item')]
  .find((i) => i.querySelector('.bgg-import__name').textContent === title).querySelector('.bgg-import__state').textContent;

test('Klassisch: the add-game form offers the Myludo import on the Regal, never on the Wunschliste', async (t) => {
  const { dom } = boot(t);
  const opened = [];
  dom.set('showMyludoImport', (round) => opened.push(round.id));
  await dom.call('showAddGame', ROUND);
  const link = dom.document.getElementById('myludoImportFromAdd');
  assert.ok(link, 'no Myludo link in the add form');
  assert.match(link.textContent, /Aus Myludo importieren/);
  link.click();
  assert.deepEqual(opened, [1]);
  dom.run('closeSheet()');
  await dom.call('showAddGame', ROUND, { wish: true });
  assert.equal(dom.document.getElementById('myludoImportFromAdd'), null, 'a wish list is not a shelf');
});

test('Der Tisch: the search step carries the Myludo way out, without an account', async (t) => {
  const { dom } = boot(t, { design: 'tisch' });
  dom.set('canImportBgg', () => false);
  const opened = [];
  dom.set('showMyludoImport', (round) => opened.push(round.id));
  await dom.call('showAddGame', ROUND);
  const btn = dom.document.getElementById('addSearchMyludo');
  assert.ok(btn, 'no Myludo way out under Der Tisch');
  assert.match(btn.textContent, /Aus Myludo/);
  btn.click();
  assert.deepEqual(opened, [1]);
});

test('the preview: matched, unlinked, expansions under their base, present and skipped apart', async (t) => {
  const { dom } = await openWithFile(t);
  await waitFor(() => dom.document.querySelector('.bgg-import__go'), { label: 'the preview rendered' });
  assert.deepEqual(rowTitles(dom), ['Azul', 'Forêt Mixte', 'Alpes', 'Cascadia - Landmarks', 'Café-Bar', 'Pas choisi']);
  assert.match(stateOf(dom, 'Azul'), /^2–4 Spieler$/, 'a sure match needs no note');
  assert.match(stateOf(dom, 'Forêt Mixte'), /Kein BGG-Treffer/);
  assert.match(stateOf(dom, 'Alpes'), /Erweiterung zu Forêt Mixte/);
  assert.match(stateOf(dom, 'Cascadia - Landmarks'), /Erweiterung zu Cascadia/, 'a shelf game is a base');
  assert.match(stateOf(dom, 'Café-Bar'), /Erweiterung zu Café International/,
    'a base row already on the shelf hands its expansion to the shelf game');
  const sections = [...dom.document.querySelectorAll('.bgg-import__present')].map((d) => ({
    head: d.querySelector('summary').textContent,
    items: [...d.querySelectorAll('li')].map((li) => li.textContent),
  }));
  assert.deepEqual(sections, [
    { head: 'Schon im Regal', items: ['Cafe international'] },
    { head: 'Erweiterungen ohne Grundspiel (werden übersprungen)', items: ['Orpheline'] },
  ]);
  const thumb = dom.document.querySelector('.bgg-import__item .bgg-import__thumb');
  assert.match(thumb.style.backgroundImage, /cf\.geekdo-images\.com\/azul\.jpg/, "the match's cover is shown");
});

test('the request carries only the picked rows, with the cover and range the preview showed', async (t) => {
  const { dom, calls, toasts, navigations } = await openWithFile(t);
  await waitFor(() => dom.document.querySelector('.bgg-import__go'), { label: 'the preview rendered' });
  const box = (title) => [...dom.document.querySelectorAll('.bgg-import__item')]
    .find((i) => i.querySelector('.bgg-import__name').textContent === title).querySelector('input[type="checkbox"]');
  box('Pas choisi').checked = false;
  box('Pas choisi').dispatchEvent(new dom.window.Event('change'));
  dom.document.querySelector('.bgg-import__go').click();
  await waitFor(() => calls.some((c) => c.url.endsWith('/games/import')), { label: 'the import POST' });

  const post = calls.find((c) => c.url.endsWith('/games/import'));
  assert.equal(post.method, 'POST');
  // Through JSON: the body was built in the page's realm, so its prototypes are not this one's.
  assert.deepEqual(JSON.parse(JSON.stringify(post.body)), {
    games: [
      { title: 'Azul', bggId: 230802, minPlayers: 2, maxPlayers: 4, image: 'https://cf.geekdo-images.com/azul.jpg' },
      { title: 'Forêt Mixte', minPlayers: 1, maxPlayers: 5, playtime: { min: 40, max: 60 },
        expansions: [{ title: 'Alpes', minPlayers: 2, maxPlayers: 4 }] },
    ],
    attach: [
      { gameId: 11, expansions: [{ title: 'Cascadia - Landmarks', minPlayers: 1, maxPlayers: 6 }] },
      { gameId: 12, expansions: [{ title: 'Café-Bar', minPlayers: 2, maxPlayers: 5 }] },
    ],
  });
  const wire = JSON.stringify(post.body);
  for (const absent of ['Pas choisi', 'Orpheline', 'Cafe international']) {
    assert.ok(!wire.includes(absent), `${absent} reached the request`);
  }
  await waitFor(() => navigations.length, { label: 'back to the Regal' });
  assert.deepEqual(navigations, [['round', 1, 'regal']]);
  assert.ok(toasts.includes('3 Spiele importiert'), toasts.join(' | '));
});

test('changing a match re-reads its cover; unlinking sends no BGG id', async (t) => {
  const { dom, calls } = await openWithFile(t);
  await waitFor(() => dom.document.querySelector('.bgg-import__go'), { label: 'the preview rendered' });
  const sel = dom.document.querySelector('.myludo-import__match');
  assert.equal(sel.getAttribute('aria-label'), 'BoardGameGeek-Treffer für Azul');
  sel.value = '';
  sel.dispatchEvent(new dom.window.Event('change'));
  dom.document.querySelector('.bgg-import__go').click();
  await waitFor(() => calls.some((c) => c.url.endsWith('/games/import')), { label: 'the import POST' });
  const azul = calls.find((c) => c.url.endsWith('/games/import')).body.games[0];
  assert.deepEqual(JSON.parse(JSON.stringify(azul)), { title: 'Azul', minPlayers: 2, maxPlayers: 4, playtime: { min: 60, max: 60 } });
});

test('a wrong file says so and stays on the file step', async (t) => {
  for (const text of ['{"plays":[]}', 'Titre;Édition\nCatan;1995']) {
    // reportClientError posts through window.fetch, not the api seam, so it is
    // recorded directly — counting api calls here could never go red.
    const reports = [];
    const { dom } = await openWithFile(t, text, (dom) => dom.set('reportClientError', (kind) => reports.push(kind)));
    await waitFor(() => dom.document.querySelector('.myludo-import .bgg-import__msg'), { label: 'the error' });
    assert.match(dom.document.querySelector('.myludo-import .bgg-import__msg').textContent, /keine Myludo-Ludothek/);
    assert.ok(dom.document.querySelector('.myludo-import input[type="file"]'), 'the file can be chosen again');
    assert.deepEqual(reports, [], 'a wrong file is not our fault');
    dom.close();
  }
});

test('a file that cannot be READ is ours, and is reported', async (t) => {
  const reports = [];
  const env = boot(t);
  const { dom } = env;
  dom.set('reportClientError', (kind) => reports.push(kind));
  dom.call('showMyludoImport', ROUND);
  const input = dom.document.querySelector('.myludo-import input[type="file"]');
  Object.defineProperty(input, 'files', { value: [{ text: async () => { throw new Error('disk'); } }] });
  input.dispatchEvent(new dom.window.Event('change'));
  await waitFor(() => dom.document.querySelector('.myludo-import .bgg-import__msg'), { label: 'the error' });
  assert.match(dom.document.querySelector('.myludo-import .bgg-import__msg').textContent, /konnte nicht gelesen/);
  assert.deepEqual(reports, ['myludo_import_parse']);
});

// Pixels jsdom cannot see, so the rule itself is pinned. Measured in the pane
// under Der Tisch (1024px): with the state BESIDE the title as `flex: none`,
// „Forêt Mixte" rendered as „For…"; stacked, every title shows whole at 1024
// and at 375. Scoped to this sheet so the BGG and move-games rows keep theirs.
test('the state line sits UNDER the title, so a long state cannot squeeze it', () => {
  const { bodyOf, topLevel, rulesOf } = require('./support/css');
  const body = bodyOf('.myludo-import .bgg-import__row .ds-row__main', rulesOf(topLevel()));
  assert.ok(body, 'the stacking rule is gone');
  assert.match(body, /flex-direction:\s*column/);
});
