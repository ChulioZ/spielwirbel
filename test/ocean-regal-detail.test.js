'use strict';

/* Ocean's Regal, Spieldetail and add-game lookup (#1212 — O3.3–O3.5, O6.2–O6.4,
   O6.7).

   A design owns its layout, so the view code branches on designIs('ocean') and
   builds the sheets' composition; Klassisch must not notice any of it. Each
   Ocean claim below is paired with the Klassisch control that proves the branch
   is Ocean's alone. Driven under jsdom (.claude/rules/testing-views-under-jsdom.md)
   — the layout itself is CSS, which jsdom does not apply, so the last block
   asserts the stylesheet's text for the two geometry claims the issue makes. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');

const RID = 'r1';

function roundFixture() {
  return {
    id: RID,
    name: 'Donnerstagsrunde',
    tags: [],
    providers: [],
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
    games: [
      { id: 'g1', title: 'Nordlichter', minPlayers: 2, maxPlayers: 5, minPlaytime: 90, maxPlaytime: 90, tagIds: [], weight: 2.4 },
      { id: 'g2', title: 'Moorgeister', tagIds: [] },
      { id: 'g3', title: 'Salzwiesen', retired: true, tagIds: [] },
    ],
    sessions: [
      {
        id: 's1', createdAt: '2026-06-01T19:00:00.000Z', finished: true,
        gameIds: ['g1', 'g2'], chosenGameId: 'g1', winnerIds: ['m1'],
        memberIds: ['m1', 'm2'],
        votes: { m1: { g1: { rating: 5 } }, m2: { g1: { rating: 2 } } },
      },
    ],
    activity: [],
  };
}

function boot(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = roundFixture();
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    return {};
  });
  dom.set('toast', () => {});
  dom.set('isLoggedIn', () => false);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  return { dom, round };
}

const regal = (dom, round) => {
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', round, round.games.filter((g) => !g.retired && !g.completed && !g.wish));
};

/* ------------------------------------ Regal ------------------------------------ */

test('Ocean: the Regal brings its own way to „Nicht im Regal", at every width', (t) => {
  const { dom, round } = boot(t, 'ocean');
  regal(dom, round);
  const toolBtn = [...dom.app.querySelectorAll('.section-tools .link-btn')]
    .find((b) => b.querySelector('.ti-archive'));
  assert.ok(toolBtn, 'the toolbar lost its „Nicht im Regal" button');
  // Ocean's Reling carries only the five tabs (#1211), so a rail-owned button
  // would leave the desktop with no way off the shelf at all.
  assert.equal(toolBtn.classList.contains('rail-owned'), false, 'rail-owned hides it from 1280px up');

  const band = dom.app.querySelector('.regal-offshelf');
  assert.ok(band, 'the end-of-shelf band is missing');
  const cards = [...band.querySelectorAll('a.regal-offshelf__card')];
  assert.equal(cards.length, 4, 'one card per off-shelf destination');
  const hrefs = cards.map((a) => a.getAttribute('href'));
  for (const sub of ['retired', 'completed', 'wishlist', 'recommendations']) {
    assert.ok(hrefs.some((h) => h.endsWith(`/${sub}`)), `no real link to /${sub}: ${hrefs.join(' ')}`);
  }
  // The counted label is off-shelf.js's own, so the band cannot disagree with
  // the rail or the sheet about how many games are aussortiert.
  assert.match(cards[0].textContent, /Aussortiert \(1\)/);

  // The phone's single row opens the same list as a sheet.
  band.querySelector('.regal-offshelf__row').click();
  assert.ok(dom.document.querySelector('.sheet .off-shelf'), 'the row did not open the off-shelf sheet');
});

test('Ocean: the sort reads „Sortiert: Bewertung" and keeps the select\'s own name', (t) => {
  const { dom, round } = boot(t, 'ocean');
  regal(dom, round);
  const wrap = dom.app.querySelector('.regal-sort');
  assert.ok(wrap, 'no sort pill');
  assert.equal(wrap.querySelector('.regal-sort__prefix').textContent, 'Sortiert:');
  assert.equal(wrap.querySelector('.regal-sort__prefix').getAttribute('aria-hidden'), 'true',
    'the visible prefix must not become a second accessible name');
  const sel = wrap.querySelector('select.sort-select');
  assert.equal(sel.getAttribute('aria-label'), 'Sortierung');
  assert.equal(sel.options[sel.selectedIndex].textContent, 'Bewertung');
  // The composed head and the lifted filter trigger, as Der Tisch has them.
  assert.ok(dom.app.querySelector('.regal-head .regal-title h1'), 'the composed title is missing');
});

test('Ocean: title and meta sit under the cover, with the player range spelled out for a reader', (t) => {
  const { dom, round } = boot(t, 'ocean');
  regal(dom, round);
  const card = [...dom.app.querySelectorAll('.game-card')]
    .find((c) => c.querySelector('.game-card__title').textContent === 'Nordlichter');
  const meta = card.querySelector('.game-card__body .game-card__meta');
  assert.ok(meta, 'no meta line under the title');
  assert.equal(card.querySelector('.game-card__img .game-card__meta'), null, 'meta must never sit on the cover');
  assert.match(meta.querySelector('[aria-hidden="true"]').textContent, /2–5/);
  assert.equal(meta.querySelector('.sr-only').textContent, '2–5 Personen');
  assert.match(meta.textContent, /90 Min\./);
  // A game carrying neither keeps a one-line body.
  const bare = [...dom.app.querySelectorAll('.game-card')]
    .find((c) => c.querySelector('.game-card__title').textContent === 'Moorgeister');
  assert.equal(bare.querySelector('.game-card__meta'), null);
});

test('Ocean: „Spiel hinzufügen" exists once per width — tile, toolbar pill and plus bubble', (t) => {
  const { dom, round } = boot(t, 'ocean');
  regal(dom, round);
  assert.ok(dom.app.querySelector('.cards > .add-tile'), 'the dashed tile (desktop) is gone');
  assert.ok(dom.app.querySelector('.section-tools .regal-add--bar'), 'the tablet pill is missing');
  const fab = dom.app.querySelector('.regal-fab');
  assert.ok(fab, 'the phone bubble is missing');
  assert.equal(fab.getAttribute('aria-label'), 'Spiel hinzufügen', 'an icon-only button needs its name');
});

test('Klassisch: the Regal is exactly as it was', (t) => {
  const { dom, round } = boot(t, 'klassisch');
  regal(dom, round);
  for (const sel of ['.regal-offshelf', '.regal-sort', '.regal-fab', '.regal-add', '.game-card__meta', '.regal-head']) {
    assert.equal(dom.app.querySelector(sel), null, `${sel} leaked into Klassisch`);
  }
  const toolBtn = [...dom.app.querySelectorAll('.section-tools .link-btn')]
    .find((b) => b.querySelector('.ti-archive'));
  assert.ok(toolBtn.classList.contains('rail-owned'), 'Klassisch\'s rail owns „Nicht im Regal" from 1280px');
  assert.ok(dom.app.querySelector('.section-tools > select.sort-select'), 'the bare select moved');
});

/* --------------------------------- Spieldetail --------------------------------- */

test('Ocean: the detail is three columns — the cover over its facts, the story, the actions', async (t) => {
  const { dom } = boot(t, 'ocean');
  await dom.call('showGameDetail', RID, 'g1');
  const pass = dom.app.querySelector('.pass');
  assert.deepEqual([...pass.children].map((c) => c.className), ['pass__game', 'pass__story', 'pass__table']);
  const [game, story, table] = pass.children;

  assert.deepEqual([...game.children].map((c) => c.className), ['gd-cover', 'gd-factcol']);
  assert.ok(game.querySelector('.gd-factcol .gd-facts'), 'the glance facts are not in the facts column');
  // No text on a cover: the score stands beside the title, not on the image.
  assert.equal(game.querySelector('.gd-cover .gd-score'), null, 'the score is still on the cover');
  assert.ok(story.querySelector('.gd-head .gd-titleline h1 + .gd-score .score-pill--lg'),
    'the score pill is not beside the title');

  // The one action right under the title (O6.3), then the round's story.
  const order = [...story.children].map((c) => c.classList[c.classList.length - 1]);
  assert.deepEqual(order, ['gd-head', 'gd-bar', 'gd-raters', 'gd-history']);
  assert.ok(story.querySelector('ul.gd-plays > li.gd-play'), 'the sessions are not the dated list');

  // The page menu's items are a panel, so „…" goes (as under Der Tisch).
  assert.ok(table.querySelector('.gd-actions .gd-act'), 'the actions panel is missing');
  assert.equal(dom.app.querySelector('.gd-menu'), null, 'the „…" menu duplicates the panel');
});

test('Ocean: each rater\'s average is a bubble on the scale\'s rung', async (t) => {
  const { dom } = boot(t, 'ocean');
  await dom.call('showGameDetail', RID, 'g1');
  const ns = [...dom.app.querySelectorAll('.rater__n')];
  assert.equal(ns.length, 2);
  const rungs = ns.map((n) => [n.textContent, n.dataset.stop]).sort();
  // Anna gave a 5, Ben a 2 — the rung is rampStop's, so it cannot disagree with
  // the score pill's own ramp.
  assert.deepEqual(rungs, [['2,0', '2'], ['5,0', '5']]);
});

test('Klassisch: the detail keeps the spread, the cover pill and the stamps', async (t) => {
  const { dom } = boot(t, 'klassisch');
  await dom.call('showGameDetail', RID, 'g1');
  const pass = dom.app.querySelector('.pass');
  assert.deepEqual([...pass.children].map((c) => c.className), ['pass__game', 'pass__table']);
  assert.ok(dom.app.querySelector('.gd-cover .gd-score'), 'the pill left the cover under Klassisch');
  assert.ok(dom.app.querySelector('.stamps .stamp'), 'the stamps are gone');
  assert.equal(dom.app.querySelector('.gd-factcol, .gd-titleline, .gd-actions'), null);
  assert.ok(dom.app.querySelector('.gd-menu'), 'the „…" menu is gone');
});

/* ---------------------------------- Lookup ---------------------------------- */

test('Ocean: „Spiel hinzufügen" opens the search-first step; Klassisch the form', async (t) => {
  const o = boot(t, 'ocean');
  await o.dom.call('showAddGame', o.round);
  const sheet = o.dom.document.querySelector('.sheet');
  assert.ok(sheet.classList.contains('add-search'), 'Ocean did not open the search step');
  assert.ok(sheet.querySelector('#addSearchSelf'), 'the „by hand" way out is missing');

  const k = boot(t, 'klassisch');
  await k.dom.call('showAddGame', k.round);
  const form = k.dom.document.querySelector('.sheet');
  assert.equal(form.classList.contains('add-search'), false, 'Klassisch opened the search step');
  assert.ok(form.querySelector('#title'), 'Klassisch lost its form');
});

/* --------------------------------- ocean.css --------------------------------- */

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'ocean.css'), 'utf8');
const section = CSS.slice(CSS.indexOf('/* ===== #1212'));

test('ocean.css: the slice is one section, and covers crop into the 4:3 box', () => {
  assert.equal(CSS.split('/* ===== #1212 — Regal, Spieldetail, Spiel suchen ===== */').length, 2,
    'the #1212 section header must appear exactly once');
  const body = section.replace(/\/\*[\s\S]*?\*\//g, '');
  // Crop, never letterbox — on the shelf and on the detail's cover.
  for (const sel of ['.game-card__img::after', '.pass__game .gd-img::after']) {
    const rx = new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*background-size:\\s*cover`);
    assert.match(body, rx, `${sel} does not crop`);
  }
  // Four columns on a tablet (O6.7), two on a phone (O6.2).
  assert.match(body, /min-width:\s*600px\)\s*and\s*\(max-width:\s*1279px\)\s*\{[^@]*\.cards\s*\{\s*grid-template-columns:\s*repeat\(4,/);
  assert.match(body, /max-width:\s*599px\)\s*\{[^@]*\.cards\s*\{\s*grid-template-columns:\s*repeat\(2,/);
});
