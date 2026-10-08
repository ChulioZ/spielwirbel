'use strict';

/* Every Regal tile carries the two facts a game is picked by — players and
   playing time — under its title (#1580). The default card (Klassisch, Der
   Tisch, Ocean) printed them under Ocean only; Die Brücke, Das Programmheft
   and Forest print them in cards of their own. Klassisch's grid also uses the
   width now (six columns where four stood at 1440), while a phone stays two-up.

   jsdom paints nothing, so the layout half is pinned as the declared rules and
   the arithmetic they must satisfy; the screens were checked in WebKit. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, waitFor } = require('./support/dom');
const { rulesOf, declaredValue, mediaBlocks, rootPx } = require('./support/css');

const roundFixture = () => ({
  id: 'r1',
  name: 'Donnerstagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Anna' }],
  tags: [],
  sessions: [],
  games: [
    { id: 'g1', title: 'Nordlichter', minPlayers: 2, maxPlayers: 5, minPlaytime: 90, maxPlaytime: 90 },
    { id: 'g2', title: 'Moorgeister' },
  ],
  activity: [],
});

function regal(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = roundFixture();
  dom.set('api', async (method, url) => (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET' ? round : []));
  dom.set('toast', () => {});
  dom.set('isLoggedIn', () => false);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.call('renderRegalTab', round, round.games);
  return dom;
}
const card = (dom, gid) => dom.app.querySelector(`.cards [data-gid="${gid}"]`);
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

for (const design of ['klassisch', 'tisch', 'ocean']) {
  test(`${design}: a tile states players and playing time under its title`, (t) => {
    const dom = regal(t, design);
    const meta = card(dom, 'g1').querySelector('.game-card__body > .game-card__meta');
    assert.ok(meta, 'the meta line is under the title');
    assert.equal(meta.previousElementSibling.className, 'game-card__title');
    assert.match(text(meta), /2–5/);
    assert.match(text(meta), /90 Min\./);
    assert.match(text(meta.querySelector('.sr-only')), /2–5 Personen/, 'the bare digits are spelled out for a screen reader');
  });

  test(`${design}: a game carrying neither fact keeps a one-line body`, (t) => {
    const dom = regal(t, design);
    assert.equal(card(dom, 'g2').querySelector('.game-card__meta'), null);
  });
}

/* The backfill (#736) fills playing time IN PLACE after the cards are built,
   and renderGames() only reorders them — so the tile must be repainted, in
   every design, both where a line exists (players → players · time) and where
   none did (Forest drops its whole row then). */
for (const design of ['klassisch', 'tisch', 'ocean', 'programmheft', 'bruecke', 'forest']) {
  test(`${design}: playing time the backfill brings reaches the tile without a re-render`, async (t) => {
    const dom = loadApp({ locale: 'de' });
    t.after(() => dom.close());
    const bgg = (id) => ({ provider: 'bgg', id });
    const round = { ...roundFixture(), games: [
      { id: 'g3', title: 'Flussläufer', source: bgg('11'), minPlayers: 2, maxPlayers: 4 },
      { id: 'g4', title: 'Nebelturm', source: bgg('12') },
    ] };
    dom.set('api', async (method, url) => {
      if (method === 'POST' && url.endsWith('/games/provider-info')) {
        return { games: [{ id: 'g3', minPlaytime: 45, maxPlaytime: 45 }, { id: 'g4', minPlaytime: 30, maxPlaytime: 60 }] };
      }
      return /^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET' ? round : [];
    });
    dom.set('toast', () => {});
    dom.set('isLoggedIn', () => false);
    dom.run(`applyDesign(${JSON.stringify(design)})`);
    dom.call('renderRegalTab', round, round.games);
    assert.equal(card(dom, 'g4').querySelector('.game-card__meta'), null, 'nothing to say before the fill');
    const meta = await waitFor(() => /60 Min\./.test(text(card(dom, 'g4'))) && card(dom, 'g4').querySelector('.game-card__meta'),
      { label: 'the filled time on g4' });
    assert.match(text(meta), /30–60 Min\./);
    const g3 = card(dom, 'g3').querySelectorAll('.game-card__meta');
    assert.equal(g3.length, 1, 'the line is replaced, not doubled');
    assert.match(text(g3[0]), /2–4.*45 Min\./);
  });
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const K = ':root[data-design="klassisch"]';
const inMedia = (css, rx) => mediaBlocks(css).filter(([q]) => rx.test(q)).map(([, body]) => body).join('\n');
const floorOf = (body) => Number((/minmax\((\d+)px/.exec(declaredValue(body, 'grid-template-columns') || '') || [])[1]);

test('Klassisch: the meta line is styled under Klassisch only, and it wraps', () => {
  const rules = rulesOf(read('public/styles.css'));
  const meta = rules.find(([s]) => s.trim() === `${K} .game-card__meta`);
  assert.ok(meta, 'Klassisch styles the line');
  // At the 160px floor „3–7 · 120–180 Min." needs ~140px of a 131px line
  // (measured in WebKit): an ellipsis would cut off exactly the playing time.
  assert.notEqual(declaredValue(meta[1], 'white-space'), 'nowrap', 'the line may wrap');
  assert.equal(declaredValue(meta[1], 'text-overflow'), null, 'nothing is ellipsised away');
  // Die Brücke, Das Programmheft and Forest embed the same element in their own
  // cards, so an unscoped rule would restyle it there.
  assert.equal(rules.find(([s]) => s.trim() === '.game-card__meta'), undefined, 'no unscoped .game-card__meta rule');
});

test('Klassisch: a denser grid from 521px, the phone two-up untouched', () => {
  const css = read('public/styles.css');
  const wide = rulesOf(inMedia(css, /min-width:\s*521px/)).find(([s]) => s.trim() === `${K} .cards`);
  assert.ok(wide, 'Klassisch lowers the floor from 521px');
  assert.equal(floorOf(wide[1]), 160);
  const phone = rulesOf(inMedia(css, /max-width:\s*520px/)).find(([s]) => s.trim() === '.cards');
  assert.equal(floorOf(phone[1]), 150, 'the phone keeps its two-up floor');
  // 1440 beside the rail is a ~1080px pane: the old 220px floor fit four.
  const cols = (w, floor, gap) => Math.floor((w + gap) / (floor + gap));
  assert.equal(cols(1080, 220, 16), 4);
  assert.ok(cols(1080, floorOf(wide[1]), 16) >= 6, 'six columns where four stood');
});

test('Der Tisch: the pinned row still holds two title lines plus the meta line', () => {
  /* Its shelf rows are a fixed pitch (the planks are drawn under them), so the
     body budget must hold the padding, two clamped title lines, the gap and the
     meta line — one line on the normal shelf, two on the dense 40+-game one,
     where an 87px track cannot hold „3–7 · 120–180 Min." (113px, measured).
     Every input is read from the sheets, so retuning any one of them is
     re-checked here rather than silently eating the dense row's slack. */
  const T = ':root[data-design="tisch"][data-scheme="dark"]';
  const DENSE = `${T} .cards:has(> a.game-card:nth-of-type(40))`;
  const rules = rulesOf(read('public/css/designs/tisch.css'));
  const prop = (sel, p) => declaredValue((rules.find(([s]) => s.trim() === sel) || [])[1] || '', p);
  const px = (v) => (/^var\((--[\w-]+)\)$/.test(v) ? rootPx(/^var\((--[\w-]+)\)$/.exec(v)[1]) : parseFloat(v));
  const padTop = parseFloat(prop(`${T} .game-card__body`, 'padding').split(/\s+/)[0]);
  const gap = parseFloat(prop(`${T} .game-card__body`, 'gap'));
  const titleLh = parseFloat(prop(`${T} .game-card__title`, 'line-height'));
  const pageLh = parseFloat(declaredValue(rulesOf(read('public/styles.css')).find(([s]) => s.trim() === 'body')[1], 'line-height'));
  for (const v of [padTop, gap, titleLh, pageLh]) assert.ok(Number.isFinite(v), 'an input did not parse');
  const metaLine = px(prop(`${T} .game-card__meta`, 'font-size')) * pageLh;
  const fits = (titleSize, metaLines, shelfBody) => {
    const need = padTop + 2 * titleSize * titleLh + gap + metaLines * metaLine;
    assert.ok(need <= shelfBody, `needs ${need.toFixed(1)}px, the row gives ${shelfBody}px`);
  };
  fits(px(prop(`${T} .game-card__title`, 'font-size')), 1, parseFloat(prop(`${T} .cards`, '--shelf-body')));
  fits(px(prop(`${DENSE} .game-card__title`, 'font-size')), 2, parseFloat(prop(DENSE, '--shelf-body')));
  // …and the dense line really does wrap, capped at the two the budget holds.
  assert.equal(prop(`${DENSE} .game-card__meta`, 'white-space'), 'normal');
  assert.equal(parseFloat(prop(`${DENSE} .game-card__meta`, 'max-height')), 2 * pageLh, 'two lines, in em');
});
