'use strict';

/* Das Programmheft's Regal, Spielepass and add-game step (#1373, P3.3–P3.5,
   P6.2–P6.4, P7.8) — what the markup branch renders under the design. That
   Klassisch is untouched by the same branch is test/programmheft-klassisch-golden.test.js;
   the layout itself is CSS (public/css/designs/programmheft.css), which jsdom
   cannot apply, so this spec pins the structure the stylesheet is written against. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./support/dom');
const { ROOT, mediaBlocks, rulesOf } = require('./support/css');

const RID = 'r1';
const flush = () => new Promise((r) => setImmediate(r));

function roundFixture() {
  return {
    id: RID,
    name: 'Donnerstagsrunde',
    tags: [{ id: 't1', name: 'Kooperativ', icon: 'users' }],
    providers: [],
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
    games: [
      {
        id: 'g1', title: 'Nordlichter', minPlayers: 2, maxPlayers: 5, minPlaytime: 90, maxPlaytime: 90,
        weight: 2.4, tagIds: [], ownerIds: ['m1'],
      },
      { id: 'g2', title: 'Moorgeister', tagIds: ['t1'] },
      { id: 'g3', title: 'Salzwiesen', retired: true, tagIds: [] },
    ],
    sessions: [
      {
        id: 's1', createdAt: '2026-06-01T19:00:00.000Z', finished: true,
        gameIds: ['g1'], chosenGameId: 'g1', winnerIds: ['m1'], memberIds: ['m1', 'm2'],
        votes: { m1: { g1: { rating: 5 } }, m2: { g1: { rating: 4 } } },
      },
    ],
    activity: [],
  };
}

function boot(t, design = 'programmheft') {
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
  dom.set('canImportBgg', () => true);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  return { dom, round };
}

function renderRegal(dom, round) {
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', round, round.games.filter((g) => !g.retired && !g.completed && !g.wish));
}

test('Regal: every card is a printed entry — number, title, owner and a ramp-toned score', (t) => {
  const { dom, round } = boot(t);
  renderRegal(dom, round);
  const t_ = dom.get('t');
  assert.ok(dom.app.querySelector('.section.ph-regal'), 'the shelf is not marked as Programmheft\'s');
  const cards = [...dom.app.querySelectorAll('.cards > .ph-card')];
  assert.equal(cards.length, 2);
  // Numbered in the order on the page, not by id.
  cards.forEach((c, i) => {
    assert.equal(c.querySelector('.ph-card__nr').textContent, t_('regal.cardNo', { n: i + 1 }));
  });
  const nord = cards.find((c) => c.querySelector('.game-card__title').textContent === 'Nordlichter');
  const score = nord.querySelector('.ph-card__score');
  assert.ok(score.dataset.stop, 'a scored game carries its ramp stop');
  assert.ok(!score.classList.contains('ph-card__score--none'));
  assert.match(nord.querySelector('.ph-card__owner').textContent, /Anna/);
  // The score is print ABOUT the cover — no pill on the image.
  assert.equal(nord.querySelector('.game-card__img .score-pill'), null);
  const moor = cards.find((c) => c !== nord);
  assert.ok(moor.querySelector('.ph-card__score').classList.contains('ph-card__score--none'));
  assert.equal(moor.querySelector('.ph-card__score').dataset.stop, undefined);
});

test('Regal: the toolbar carries the black add and the wide tools, the phone gets the „…" menu', (t) => {
  const { dom, round } = boot(t);
  renderRegal(dom, round);
  const t_ = dom.get('t');
  const tools = dom.app.querySelector('.regal-head .section-tools');
  assert.ok(tools.querySelector('.regal-add--bar.btn--primary'), 'no black „Spiel hinzufügen" in the toolbar');
  // The dashed tile stays in the grid for the phone; CSS drops one per width.
  assert.ok(dom.app.querySelector('.cards > .add-tile'));
  assert.ok(tools.querySelectorAll('.regal-tool--wide').length >= 2, 'the import and select tools are not marked wide');
  const more = tools.querySelector('.regal-more');
  assert.ok(more, 'no „…" button for the phone');
  more.click();
  const labels = [...dom.document.querySelectorAll('.popover button')].map((b) => b.textContent.trim());
  assert.ok(labels.includes(t_('bulk.select')), `„…" lacks the select action: ${labels}`);
  assert.ok(labels.includes(t_('bggImport.tile')), `„…" lacks the BGG import: ${labels}`);
  assert.equal(more.getAttribute('aria-expanded'), 'true');
});

test('Regal: the toolbar\'s „Nicht im Regal" yields to the rail from 1280px (three entries were one too many)', (t) => {
  const { dom, round } = boot(t);
  renderRegal(dom, round);
  const btn = dom.app.querySelector('.regal-head .section-tools .ti-archive').closest('button');
  // Wide (860–1279, no rail) and hidden ≥1280, where the rail's group and the
  // end-of-shelf list already carry the four. Not `rail-owned`: the design's
  // `:is(.link-btn, .back-link)` display rule outranks `.app .rail-owned`.
  assert.ok(btn.classList.contains('regal-tool--wide'), 'the toolbar button is not a desktop tool');
  assert.ok(btn.classList.contains('regal-tool--offshelf'), 'the toolbar button is not marked as the off-shelf tool');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/designs/programmheft.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const hides = mediaBlocks(css).some(([q, body]) => /min-width:\s*1280px/.test(q) && !/max-width/.test(q)
    && rulesOf(body).some(([sel, decl]) => /\.ph-regal \.regal-tool--offshelf\s*$/.test(sel.trim()) && /display:\s*none/.test(decl)));
  assert.ok(hides, 'the toolbar button still shows beside the rail\'s „Nicht im Regal" group from 1280px');
  assert.ok(dom.app.querySelector('nav.ph-offshelf'), 'the end-of-shelf list must stay');
});

test('Regal: „Nicht im Regal" closes the shelf as a labelled list of links', (t) => {
  const { dom, round } = boot(t);
  renderRegal(dom, round);
  const nav = dom.app.querySelector('nav.ph-offshelf');
  assert.ok(nav, 'no off-shelf list');
  assert.equal(nav.getAttribute('aria-labelledby'), 'phOffShelfLabel');
  const links = [...nav.querySelectorAll('.ph-offshelf__list > li > a.ph-offshelf__link')];
  assert.ok(links.length >= 3, `expected the off-shelf destinations, got ${links.length}`);
  for (const a of links) assert.match(a.getAttribute('href'), /^\/round\/r1\//);
});

test('Regal: an EMPTY shelf takes no toolbar add — its tile is the only one', (t) => {
  const { dom, round } = boot(t);
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', round, []);
  assert.equal(dom.app.querySelector('.regal-add--bar'), null);
});

test('Spielepass: cover | the game and its history | the score box, the action and the rest', async (t) => {
  const { dom } = boot(t);
  await dom.call('showGameDetail', RID, 'g1');
  await flush();
  const pass = dom.app.querySelector('.pass.ph-pass');
  assert.ok(pass, 'no Programmheft Spielepass');
  const cols = [...pass.children].map((c) => c.className);
  assert.deepEqual(cols, ['pass__game', 'pass__story', 'pass__table']);
  assert.ok(pass.querySelector('.pass__game .gd-cover'), 'the cover is not in the left column');
  const story = pass.querySelector('.pass__story');
  assert.ok(story.querySelector('.gd-head .gd-info h1'), 'the title is not in the middle column');
  assert.ok(story.querySelector('.gd-facts'), 'the facts left the middle column');
  const table = pass.querySelector('.pass__table');
  const box = table.firstElementChild;
  assert.ok(box.classList.contains('gd-bignum'), 'the score box does not head the right column');
  assert.ok(box.dataset.stop, 'the scored game\'s box carries its ramp stop');
  assert.ok(table.querySelector('.gd-bar'), 'the one action is not in the right column');
  assert.ok(table.querySelector('.gd-actions .gd-act'), 'the actions list is not in the right column');
  // The score is stated once, in the box — not also on the cover.
  assert.equal(pass.querySelector('.gd-cover .score-pill'), null);
});

test('Spielepass: an unrated game states „neu" in the box, with no stop', async (t) => {
  const { dom } = boot(t);
  await dom.call('showGameDetail', RID, 'g2');
  await flush();
  const box = dom.app.querySelector('.ph-pass .pass__table .gd-bignum');
  assert.ok(box, 'a tagged-but-unrated game (not sparse) has no score box');
  assert.equal(box.dataset.stop, undefined);
});

test('add game: Das Programmheft opens the search-first step, not the form', (t) => {
  const { dom, round } = boot(t);
  dom.call('showAddGame', round, {});
  const sheet = dom.document.querySelector('.sheet.add-search');
  assert.ok(sheet, 'the lookup did not route to the search-first sheet');
  assert.ok(sheet.querySelector('#addSearchQ'));
  assert.ok(sheet.querySelector('#addSearchImport'), 'the import way is missing');
  assert.ok(sheet.querySelector('#addSearchSelf'), 'the self-entry way is missing');
});

test('control: Klassisch keeps the form and none of the Programmheft hooks', async (t) => {
  const { dom, round } = boot(t, 'klassisch');
  renderRegal(dom, round);
  assert.equal(dom.app.querySelector('.ph-regal, .ph-card, .ph-offshelf, .regal-more'), null);
  dom.call('showAddGame', round, {});
  assert.equal(dom.document.querySelector('.sheet.add-search'), null);
});
