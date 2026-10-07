'use strict';

/* „Neue Runde gründen" is the round grid's last TILE in Klassisch and Die
   Brücke too (#1585), as it already was in Der Tisch, Ocean, the Programmheft
   and Forest.

   The markup was never the problem: renderLobbyList() has always appended the
   dashed `.round-card--new` as the grid's last child. What made it read as a
   separate box under the grid was the ROW: with the demo's three rounds the
   tile wraps onto a row of its own, and an `auto` row is only as tall as the
   tile's one line of text (67px under 187px cards in Klassisch at 1440, 61px
   under 119px in Die Brücke). `grid-auto-rows: 1fr` makes every row as tall as
   the tallest, so the tile is a card-sized cell wherever it lands.

   Scoped per design: Klassisch and Die Brücke take both halves, Ocean (added
   in review) only the equal rows, since its tile already centres. Desktop only (>= 860px, where the grid has columns):
   on a phone the list is one column, every design keeps the tile a short row
   there, and stretching each card to the tallest one would cost the phone
   height for nothing.

   The zero-rounds state renders no grid at all (#358) and is pinned by
   test/home-empty-cta.test.js. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CSS, rulesOf, mediaBlocks } = require('./support/css');
const { loadApp } = require('./support/dom');

const sheet = (name) => fs.readFileSync(path.join(__dirname, '..', `public/css/designs/${name}.css`), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const BRUECKE = sheet('bruecke');
const OCEAN = sheet('ocean');

/** The declarations of `selector` inside the sheet's >= 860px blocks. */
function desktopRule(css, selector) {
  const blocks = mediaBlocks(css).filter(([q]) => /min-width:\s*860px/.test(q));
  assert.ok(blocks.length > 0, 'no (min-width: 860px) block found — the lookup is vacuous');
  const hit = blocks.flatMap(([, body]) => rulesOf(body)).find(([sel]) => sel === selector);
  return hit ? hit[1] : null;
}

/* Ocean joined in review: its tile already centres at every width (ocean.css,
   „its label centred"), but with three columns at 1280 it wrapped alone onto a
   107px row under 378px cards — the same short box, one design over. So only
   the row half applies to it. */
test('ocean: from 860px up every lobby row is as tall as the tallest card', () => {
  const body = desktopRule(OCEAN, ':root[data-design="ocean"] .lobby-list');
  assert.ok(body, 'no desktop .lobby-list rule for ocean');
  assert.match(body, /grid-auto-rows:\s*1fr\s*(;|$)/,
    "ocean's lobby rows are not equalised, so the tile on its own row stays a short box");
});

for (const [design, css] of [['klassisch', CSS], ['bruecke', BRUECKE]]) {
  test(`${design}: from 860px up every lobby row is as tall as the tallest card`, () => {
    const body = desktopRule(css, `:root[data-design="${design}"] .lobby-list`);
    assert.ok(body, `no desktop .lobby-list rule for ${design} — the new-round tile is a short box again`);
    assert.match(body, /grid-auto-rows:\s*1fr\s*(;|$)/,
      `${design}'s lobby rows are not equalised, so the tile on its own row stays one text line tall`);
  });

  test(`${design}: from 860px up the tile centres its label in the card-sized cell`, () => {
    /* `.round-card` is `align-items: flex-start` (titles line up across a row),
       so a stretched tile without its own centring keeps „+ Neue Runde
       gründen" pinned to the top edge of a 187px box. Measured before this
       rule: label at the cell's top, ~120px of dashed nothing below it. */
    const body = desktopRule(css, `:root[data-design="${design}"] .lobby-list .round-card--new`);
    assert.ok(body, `no desktop rule for ${design}'s new-round tile`);
    assert.match(body, /flex-direction:\s*column/, 'the icon is not stacked over the label');
    assert.match(body, /align-items:\s*center/, 'the label is not centred across the tile');
    assert.match(body, /justify-content:\s*center/, 'the label is not centred down the tile');
  });

  test(`${design}: the new-round tile is the grid's last cell`, async (t) => {
    const dom = loadApp({ locale: 'de', design });
    t.after(() => dom.close());
    const round = (id, name) => ({ id, name, members: [{ id: 'm1', name: 'Aylin' }], gameCount: 2, playedCount: 1 });
    dom.set('api', async () => [round('r1', 'Freitag'), round('r2', 'Sonntag'), round('r3', 'Urlaub')]);
    await dom.call('showHome');
    const cells = [...dom.document.querySelectorAll('.lobby-list > *')];
    assert.equal(cells.length, 4, 'three rounds plus the tile');
    assert.ok(cells.at(-1).classList.contains('round-card--new'), 'the last cell is not the new-round tile');
    assert.equal(cells.at(-1).getAttribute('href'), '/round/new');
    assert.equal(dom.document.querySelectorAll('.round-card--new').length, 1, 'a second new-round control rendered');
  });
}
