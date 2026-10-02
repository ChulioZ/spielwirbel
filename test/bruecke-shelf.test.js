'use strict';

/* Die Brücke's Regal, Spielepass and add-game lookup (#1239: B3.2, B2.6,
 * B13.4, B6.3, B6.4).
 *
 * The pixels were judged in a browser at 390 and 1440 over a seeded 42-game
 * round; what is pinned here is what regresses silently —
 *
 *   - text creeping back onto a cover (the score badge was the old shape);
 *   - the sort losing its „Sortiert:" statement, or offering anything but the
 *     app's three sortings;
 *   - a long shelf rendering in batches again: B16.2's letter jump and 28-game
 *     batches were dropped by operator decision (#1497), so every game is on
 *     the page, as in every other design;
 *   - the B16.4 step-down for a title of 22 characters or more;
 *   - the Spielepass's figures disagreeing with the score they sit beside;
 *   - the Brücke rules that read a colour without the scheme gate, and the two
 *     `display: none` rules that only work if they outrank the toolbar's.
 *
 * Every Brücke branch is also asserted absent under Klassisch, whose DOM is the
 * default path and must not move.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf, specificity } = require('./support/css');

const RID = 'r1';
const MEMBERS = [{ id: 'm1', name: 'Aylin' }, { id: 'm2', name: 'Ben' }];
const game = (id, title) => ({ id, title, minPlayers: 2, maxPlayers: 4, tagIds: [] });
// Four rated games, one unrated, one with a long title: under the 30-game line.
const SMALL = [
  game('g1', 'Azul'),
  game('g2', 'Carcassonne'),
  game('g3', 'Kartographen des Nordens'), // 24 characters
  game('g4', 'Zug um Zug Europa 1912'), //   22 characters
  game('g5', 'Wingspan Ozeanien Erw'), //    21 characters
  game('g6', 'Ödland'),
];
const rated = {
  id: 's1', createdAt: '2026-08-01T20:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1', 'm2'],
  votes: { m1: { g1: { rating: 5 }, g2: { rating: 1 } }, m2: { g1: { rating: 4 }, g2: { rating: 3 } } },
  votedIds: ['m1', 'm2'], finished: true, cancelled: false, done: true,
  winnerIds: ['m1'], chosenGameId: 'g1', events: [],
};
// 42 games, as B16.2 draws them: every letter of a German shelf plus a digit.
const BIG = Array.from({ length: 42 }, (_, i) => game(`b${i}`,
  i === 41 ? '7 Wonders' : `${'ABCDEFGHIKLMNOPRSTWZ'[i % 20]}spiel ${String(i).padStart(2, '0')}`));

const roundWith = (games, sessions = []) => ({
  id: RID, name: 'Donnerstagsrunde', background: null, tags: [], providers: [],
  members: MEMBERS, games, sessions,
});

function boot(t, design, round) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/recommendations/.test(url)) return { recommendations: [] };
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  dom.set('canImportBgg', () => false);
  return dom;
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const onPage = (dom) => [...dom.app.querySelectorAll('.cards > .game-card')];
const titles = (dom) => onPage(dom).map((c) => text(c.querySelector('.game-card__title')));

// --- the Regal (B3.2/B2.6) --------------------------------------------------

test('a Brücke card carries nothing on its cover; title, meta and score sit on the band', async (t) => {
  const dom = boot(t, 'bruecke', roundWith(SMALL, [rated]));
  await dom.call('showRound', RID, 'regal');
  const cards = dom.app.querySelectorAll('.bruecke-regal .cards > .bruecke-card');
  assert.equal(cards.length, SMALL.length);
  for (const card of cards) {
    const cover = card.querySelector('.game-card__img');
    assert.equal(cover.querySelector('.score-pill, .game-card__badges, .game-card__title, .exp-pill'), null,
      'something is printed on the cover again');
    assert.ok(card.querySelector('.game-card__body .bruecke-card__score'), 'the score left the band');
  }
  const azul = [...cards].find((c) => text(c.querySelector('.game-card__title')) === 'Azul');
  const score = azul.querySelector('.bruecke-card__score');
  assert.equal(score.dataset.stop, dom.run(`scoreStop(gameStats(${JSON.stringify(roundWith(SMALL, [rated]))}, 'g1').score)`),
    'the score is not toned by the shelf score\'s own rung');
  const unrated = [...cards].find((c) => text(c.querySelector('.game-card__title')) === 'Ödland');
  assert.ok(unrated.querySelector('.bruecke-card__score.is-new'), 'an unplayed game does not say „neu"');
});

test('a title of 22 characters steps down one level; 21 does not (B16.4)', async (t) => {
  const dom = boot(t, 'bruecke', roundWith(SMALL));
  await dom.call('showRound', RID, 'regal');
  const long = [...dom.app.querySelectorAll('.game-card__title.is-long')].map(text).sort();
  assert.deepEqual(long, ['Kartographen des Nordens', 'Zug um Zug Europa 1912']);
});

test('the sort is a „Sortiert:" statement over exactly the app\'s three sortings', async (t) => {
  const dom = boot(t, 'bruecke', roundWith(SMALL));
  await dom.call('showRound', RID, 'regal');
  const wrap = dom.app.querySelector('.bruecke-regal .regal-head .regal-sort');
  assert.ok(wrap, 'the sort is a bare <select> again');
  assert.equal(text(wrap.querySelector('.regal-sort__prefix')), dom.run("t('games.sortedBy')"));
  assert.deepEqual([...wrap.querySelectorAll('option')].map((o) => o.value), ['random', 'name', 'avg']);
  assert.equal(wrap.querySelector('select').selectedOptions[0].textContent, dom.run("t('games.sort.rating')"));
});

test('the Brücke shelf adds from the toolbar and under the grid, never from a dashed tile', async (t) => {
  const dom = boot(t, 'bruecke', roundWith(SMALL));
  await dom.call('showRound', RID, 'regal');
  const sec = dom.app.querySelector('.bruecke-regal');
  assert.equal(sec.querySelector('.add-tile'), null, 'the dashed tile is back in the grid');
  assert.ok(sec.querySelector('.regal-head .section-tools .bruecke-add--bar'), 'no add button in the toolbar');
  const dock = sec.querySelector(':scope > .bruecke-add--dock');
  assert.ok(dock, 'no full-width add under the grid');
  assert.ok(sec.querySelector('.cards').compareDocumentPosition(dock) & 4, 'the phone add sits above the grid');
  // The way to the lists is the scope strip over the section (#1500) — not a
  // toolbar button (C3) and not a line closing the shelf (B2.6) any more.
  assert.equal(dom.app.querySelector('.bruecke-offshelf, .regal-head .ti-archive'), null);
  const links = [...dom.app.querySelectorAll('nav.offshelf-seg a')];
  assert.deepEqual(links.map((a) => a.getAttribute('href')),
    ['regal', 'wishlist', 'retired', 'completed', 'recommendations'].map((s) => `/round/${RID}/${s}`));
  assert.equal(dom.app.querySelector('nav.offshelf-seg').nextElementSibling, sec, 'the strip does not head the shelf');
});

// --- the whole shelf (#1497) -------------------------------------------------

test('a 42-game Brücke shelf renders all 42 cards, with no letter row and no batch foot', async (t) => {
  const dom = boot(t, 'bruecke', roundWith(BIG));
  await dom.call('showRound', RID, 'regal');
  assert.equal(onPage(dom).length, 42, 'the shelf stopped short of the whole round');
  assert.equal(dom.app.querySelector('.bruecke-letters, .bruecke-batch'), null, 'a density control is back');
  // A sort and a search work over the whole shelf, not over a first batch.
  const sort = dom.app.querySelector('.sort-select');
  sort.value = 'name';
  sort.dispatchEvent(new dom.window.Event('change'));
  assert.equal(onPage(dom).length, 42);
  assert.equal(titles(dom).at(-1), 'Zspiel 39', 'the name sort did not reach the end of the shelf');
  const input = dom.app.querySelector('.bruecke-regal .search-pill input');
  input.value = 'Zspiel';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.deepEqual(titles(dom), ['Zspiel 19', 'Zspiel 39']);
});

test('Klassisch keeps its shelf: the dashed tile, no Brücke card, no density controls', async (t) => {
  const dom = boot(t, 'klassisch', roundWith(BIG));
  await dom.call('showRound', RID, 'regal');
  assert.equal(dom.app.querySelector('.bruecke-regal, .bruecke-card, .bruecke-letters, .bruecke-batch, .bruecke-offshelf, .bruecke-add'), null);
  assert.ok(dom.app.querySelector('.cards > .add-tile'), 'Klassisch lost its dashed tile');
  assert.equal(onPage(dom).length, 42, 'Klassisch started batching');
});

// --- the Spielepass (B13.4/B6.3) ----------------------------------------------

test('the Brücke Spielepass states the score, plays and „kein Schub" from the game\'s own stats', async (t) => {
  const round = roundWith(SMALL, [rated]);
  const dom = boot(t, 'bruecke', round);
  await dom.call('showGameDetail', RID, 'g2');
  const st = JSON.parse(dom.run(`JSON.stringify(gameStats(${JSON.stringify(round)}, 'g2'))`));
  const tiles = [...dom.app.querySelectorAll('.bruecke-stats .bruecke-stat__n')].map(text);
  assert.deepEqual(tiles, [dom.run(`fmtAvg(displayScore(${st.score}))`), String(st.plays), String(st.vetoes)]);
  assert.equal(st.vetoes, 1, 'the fixture lost its one „kein Schub"');
  // The distribution is the histogram the score is computed from, rating 1 to 5.
  const counts = [...dom.app.querySelectorAll('.bruecke-dist__col .bruecke-dist__n')].map(text);
  assert.deepEqual(counts, st.tiles.slice(1).map(String));
  assert.ok(dom.app.querySelector('.gd-titleline .gd-bignum'), 'the phone numeral beside the title is gone');
  // Nothing on the cover.
  assert.equal(dom.app.querySelector('.gd-cover .gd-score, .gd-cover .score-pill'), null);
});

test('the Spielepass carries its action twice, one per width, and keeps the „…" menu', async (t) => {
  const dom = boot(t, 'bruecke', roundWith(SMALL, [rated]));
  await dom.call('showGameDetail', RID, 'g1');
  const side = dom.app.querySelector('.pass__game > .gd-bar--side');
  const foot = dom.app.querySelector('.pass__table > .gd-bar--foot');
  assert.ok(side && foot, 'the action is not in both places');
  assert.equal(text(side), text(foot));
  assert.equal(dom.app.querySelector('.gd-actions'), null, 'Brücke grew Der Tisch\'s Aktionen panel');
  assert.ok(dom.app.querySelector('.gd-menu'), 'the „…" menu is gone');
});

test('a Brücke wish or a sparse game shows no figures', async (t) => {
  const dom = boot(t, 'bruecke', roundWith([...SMALL, { ...game('w1', 'Wunsch'), wish: true }]));
  await dom.call('showGameDetail', RID, 'w1');
  assert.equal(dom.app.querySelector('.bruecke-stats, .bruecke-dist'), null);
});

test('Klassisch\'s Spielepass draws no Brücke figures and one action bar', async (t) => {
  const dom = boot(t, 'klassisch', roundWith(SMALL, [rated]));
  await dom.call('showGameDetail', RID, 'g1');
  assert.equal(dom.app.querySelector('.bruecke-stats, .bruecke-dist, .gd-bar--side, .gd-bar--foot'), null);
  assert.equal(dom.app.querySelectorAll('.gd-bar').length, 1);
});

// --- the lookup (B6.4) --------------------------------------------------------

test('Brücke adds through the search-first sheet, which closes on the BGG badge', async (t) => {
  const dom = boot(t, 'bruecke', roundWith(SMALL));
  dom.run(`showAddGame(${JSON.stringify(roundWith(SMALL))})`);
  const sheet = dom.window.document.querySelector('.sheet.add-search');
  assert.ok(sheet, 'Brücke went straight to the form');
  const badge = sheet.querySelector('.add-search__bgg');
  assert.ok(badge, 'no „Powered by BGG" badge');
  assert.equal(badge.getAttribute('alt'), 'Powered by BGG');
});

test('Der Tisch\'s search sheet does not gain the badge', async (t) => {
  const dom = boot(t, 'tisch', roundWith(SMALL));
  dom.run(`showAddGame(${JSON.stringify(roundWith(SMALL))})`);
  const sheet = dom.window.document.querySelector('.sheet.add-search');
  assert.ok(sheet);
  assert.equal(sheet.querySelector('.add-search__bgg'), null);
});

// --- the stylesheet ---------------------------------------------------------

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/bruecke.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => {
    if (c.includes('===== #1239')) return '/*#1239*/';
    return c.startsWith('/* ===== #') ? '/*§*/' : '';
  });
const AFTER = SHEET.slice(SHEET.indexOf('/*#1239*/') + '/*#1239*/'.length);
const SECTION = AFTER.includes('/*§*/') ? AFTER.slice(0, AFTER.indexOf('/*§*/')) : AFTER;
const FLAT = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
const GATE = ':root[data-design="bruecke"][data-scheme="dark"]';

test('every #1239 rule that reads a colour token is gated on the dark scheme', () => {
  assert.ok(SHEET.includes('/*#1239*/'), 'the section header moved — re-read this test');
  assert.ok(FLAT.length > 40, `the scan found implausibly few rules (${FLAT.length})`);
  const coloured = FLAT.filter(([, body]) => /(^|;)\s*(color|background[\w-]*|border[\w-]*|outline[\w-]*|box-shadow)\s*:[^;]*var\(--/.test(body));
  assert.ok(coloured.length > 20, `the scan found implausibly few colour rules (${coloured.length})`);
  for (const [selector] of coloured) {
    for (const part of selector.split(/,(?![^(]*\))/).map((p) => p.trim())) {
      assert.ok(part.startsWith(GATE), `${part} reads a colour token without the gate`);
    }
  }
});

test('the shelf\'s search field is a --target-field, not the mock\'s 36px', () => {
  const rule = FLAT.find(([sel]) => sel.endsWith('.regal-head .search-pill'));
  assert.ok(rule, 'the search-pill rule is gone');
  assert.match(rule[1], /min-height:\s*var\(--target-field\)/);
});

test('both hides of the toolbar\'s add button outrank the rule that displays it', () => {
  const shown = FLAT.find(([sel, body]) => sel.includes('.bruecke-add--bar)') && /display:\s*inline-flex/.test(body));
  assert.ok(shown, 'the toolbar display rule is gone');
  const weight = (sel) => specificity(sel).reduce((acc, n) => acc * 100 + n, 0);
  const shownWeight = Math.max(...shown[0].split(/,(?![^(]*\))/).map((p) => weight(p.trim())));
  const hides = FLAT.filter(([sel, body]) => /display:\s*none/.test(body) && /\.bruecke-add--bar/.test(sel));
  assert.equal(hides.length, 2, 'expected the phone hide and the selection hide');
  for (const [sel] of hides) {
    const part = sel.split(/,(?![^(]*\))/).map((p) => p.trim()).find((p) => p.includes('bruecke-add--bar'));
    assert.ok(weight(part) > shownWeight, `${part} loses to the toolbar's display rule`);
  }
});
