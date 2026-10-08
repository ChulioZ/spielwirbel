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

const { loadApp } = require('./support/dom');
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

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const K = ':root[data-design="klassisch"]';
const inMedia = (css, rx) => mediaBlocks(css).filter(([q]) => rx.test(q)).map(([, body]) => body).join('\n');
const floorOf = (body) => Number((/minmax\((\d+)px/.exec(declaredValue(body, 'grid-template-columns') || '') || [])[1]);

test('Klassisch: the meta line is styled under Klassisch only, as one ellipsised line', () => {
  const rules = rulesOf(read('public/styles.css'));
  const meta = rules.find(([s]) => s.trim() === `${K} .game-card__meta`);
  assert.ok(meta, 'Klassisch styles the line');
  assert.equal(declaredValue(meta[1], 'white-space'), 'nowrap');
  assert.equal(declaredValue(meta[1], 'text-overflow'), 'ellipsis');
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
     meta line — on the normal shelf and on the dense 40+-game one. */
  const T = ':root[data-design="tisch"][data-scheme="dark"]';
  const rules = rulesOf(read('public/css/designs/tisch.css'));
  const prop = (sel, p) => declaredValue((rules.find(([s]) => s.trim() === sel) || [])[1] || '', p);
  const px = (v) => (/^var\((--[\w-]+)\)$/.test(v) ? rootPx(/^var\((--[\w-]+)\)$/.exec(v)[1]) : parseFloat(v));
  const metaLine = px(prop(`${T} .game-card__meta`, 'font-size')) * 1.5; // body line-height
  assert.ok(metaLine > 0, 'Der Tisch styles the meta line');
  const body = (titleSize, shelfBody) => {
    const need = 9 + 2 * titleSize * 1.3 + 3 + metaLine;
    assert.ok(need <= shelfBody, `needs ${need.toFixed(1)}px, the row gives ${shelfBody}px`);
  };
  body(px(prop(`${T} .game-card__title`, 'font-size')), parseFloat(prop(`${T} .cards`, '--shelf-body')));
  body(px(prop(`${T} .cards:has(> a.game-card:nth-of-type(40)) .game-card__title`, 'font-size')),
    parseFloat(prop(`${T} .cards:has(> a.game-card:nth-of-type(40))`, '--shelf-body')));
});
