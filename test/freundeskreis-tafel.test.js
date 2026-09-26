'use strict';

/* The Freundeskreis's character pass (#1137): die Tafel under the roster, and a
 * cover-forward feed tile.
 *
 * Two halves, because the change has two kinds of claim:
 *
 *   - CSS, read as text (`test/support/css.js`). jsdom applies no external
 *     stylesheet, so the plate, the 3:2 band and the column arithmetic can only
 *     be pinned from the sheet. The column counts are ARITHMETIC over the
 *     declared numbers — the plate's padding, its border, the track minimums and
 *     the shell widths — never a restated count, so a retune of any one term is
 *     measured rather than assumed.
 *   - The DOM, through the jsdom harness: a cover-less event must bring the
 *     shelf's placeholder into the band, or the tile collapses to a grey box.
 *
 * The contrast half (the ink on the plate) lives with every other contrast
 * sweep, in test/a11y-contrast.test.js.
 *
 * Named for the screen and the slice: `friends`, `feed-*` and `kreis-screen`
 * are all taken (.claude/rules/test-file-names-collide-silently.md).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, bodyOf, mediaBlocks, rulesOf, topLevel, gridSpec, rootPx } = require('./support/css');
const { loadApp } = require('./support/dom');

const RAW = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
const OCEAN = fs.readFileSync(path.join(ROOT, 'public/css/designs/ocean.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const px = (body, prop) => {
  const m = new RegExp(`(?:^|[\\s;])${prop}:\\s*(\\d+)px`).exec(body || '');
  return m ? Number(m[1]) : null;
};

/* ------------------------------ die Tafel -------------------------------- */

test('the roster sits on one plate in the accent, in tokens only', () => {
  const body = rulesOf(topLevel()).find(([s]) => s === '.k-tiles');
  assert.ok(body, 'the unconditional .k-tiles rule is gone');
  const b = body[1];
  assert.match(b, /background:\s*linear-gradient\(\s*180deg,\s*var\(--brand-tint\),\s*var\(--brand-tint-soft\)\s*\)/,
    'the plate is the prepared --brand-tint -> --brand-tint-soft pair, top to bottom');
  assert.match(b, /border:\s*1px solid var\(--brand-edge\)/, 'the plate carries a --brand-edge hairline');
  assert.match(b, /border-radius:\s*var\(--radius-lg\)/);
  assert.ok(px(b, 'padding') > 0, 'a plate needs padding, or the tiles sit on its edge');
  assert.doesNotMatch(b, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i,
    'a colour literal on the plate (.claude/rules/theme-derived-colors.md)');
});

test('the people are laid on the plate — a shadow, never a tilt — and the „＋" seat stays empty', () => {
  const card = bodyOf('.k-tiles > .k-tile:not(.k-tile--add):not(.k-tile--adding)');
  assert.ok(card, 'the place-card rule is gone');
  assert.match(card, /box-shadow:\s*var\(--shadow-1\)/);

  const add = bodyOf('.k-tile--add');
  assert.match(add, /border-style:\s*dashed/, 'the seat keeps its dashed edge');
  assert.match(add, /background:\s*transparent/, 'the seat has no fill, so the plate shows through');

  // Straight: a tilt was prototyped and rejected (2026-09-15). A prefix match,
  // so a transform on any .k-tile* part is seen, not only on the tile itself.
  const tilted = rulesOf(RAW.replace(/\/\*[\s\S]*?\*\//g, ''))
    .filter(([s, body]) => /\.k-tile[\w-]*/.test(s) && /rotate/.test(body))
    .map(([s]) => s);
  assert.deepEqual(tilted, [], 'a roster tile is rotated');
});

/* #1136 measured these counts with a bare 168px grid; the plate must not cost a
   column at any of the five widths the issue names. The reference is COMPUTED
   from #1136's numbers, not typed, so the assertion is the equality. */
const SHELL = { content: rootPx('--w-content'), shell: rootPx('--w-shell') };
// The SIDE padding: the second value of `.app`'s `padding` shorthand.
const sidePad = (body) => {
  const m = /padding:\s*\d+px\s+(\d+)px/.exec(body || '');
  return m ? Number(m[1]) : null;
};
const APP_PAD = sidePad(bodyOf('.app'));
const PHONE_PAD = (() => {
  // The sheet has several 520px blocks; the one that re-pads `.app` is the one.
  const app = mediaBlocks().filter(([q]) => /max-width:\s*520px/.test(q))
    .map(([, css]) => rulesOf(css).find(([s]) => s === '.app')).find(Boolean);
  return app ? sidePad(app[1]) : null;
})();

/* The friends screen renders no rail, so the pane is `.app` itself: capped at
   --w-content below 1280 and --w-shell from it, minus its own side padding. */
function contentWidth(vw) {
  const cap = vw >= 1280 ? SHELL.shell : SHELL.content;
  const pad = vw <= 520 ? PHONE_PAD : APP_PAD;
  return Math.min(vw, cap) - 2 * pad;
}

function plateColumns(vw) {
  const base = rulesOf(topLevel()).find(([s]) => s === '.k-tiles')[1];
  let { floor, gap } = gridSpec(base);
  for (const [q, css] of mediaBlocks()) {
    const min = /^\s*\(min-width:\s*(\d+)px\)\s*$/.exec(q);
    const rule = min && rulesOf(css).find(([s]) => s === '.k-tiles');
    if (rule && vw >= Number(min[1])) ({ floor } = gridSpec(rule[1]));
  }
  const inset = 2 * px(base, 'padding') + 2 * Number(/border:\s*(\d+)px/.exec(base)[1]);
  const room = contentWidth(vw) - inset;
  return Math.max(1, Math.floor((room + gap) / (floor + gap)));
}

const bare1136 = (vw) => Math.max(1, Math.floor((contentWidth(vw) + 10) / (168 + 10)));

test('the plate costs no column #1136 measured — at 390, 768, 1280, 1470 and 2560', () => {
  assert.ok(SHELL.content && SHELL.shell && APP_PAD && PHONE_PAD, 'a shell width or .app padding is unreadable');
  // Anti-vacuous: the widths the issue names really do span one to nine columns.
  assert.deepEqual([390, 768, 1280, 1470, 2560].map(bare1136), [2, 4, 7, 8, 9]);
  for (const vw of [390, 768, 1280, 1470, 2560]) {
    assert.equal(plateColumns(vw), bare1136(vw), `${vw}px: the plate changed the roster's column count`);
  }
});

test('the roster never LOSES a column as the window widens', () => {
  // Two minimums means a step between them; it must not be a step down.
  let prev = 0;
  for (let vw = 320; vw <= 2560; vw += 1) {
    const n = plateColumns(vw);
    assert.ok(n >= prev, `${vw}px: ${n} columns after ${prev} one pixel narrower`);
    prev = n;
  }
});

test('Ocean undoes the plate — its roster is rows inside the band\'s own card', () => {
  const plate = rulesOf(OCEAN).filter(([s]) => /\.friends-screen \.k-tiles$/.test(s.trim()))
    .map(([, b]) => b).join(';');
  assert.match(plate, /padding:\s*0/);
  assert.match(plate, /border:\s*0/);
  assert.match(plate, /background:\s*none/);
  const shadow = rulesOf(OCEAN).find(([s]) => /\.friends-screen \.k-tiles > \.k-tile$/.test(s.trim()));
  assert.ok(shadow && /box-shadow:\s*none/.test(shadow[1]), 'Ocean\'s rows keep the plate\'s place-card shadow');
});

/* ------------------------- the cover-forward tile ------------------------- */

test('the feed tile\'s cover is a full-width 3:2 band, words below it', () => {
  const tile = bodyOf('.e-tile');
  assert.match(tile, /padding:\s*0/, 'the tile keeps padding around the band');
  assert.match(tile, /overflow:\s*hidden/, 'nothing rounds the band\'s top corners with the tile');

  const img = bodyOf('.e-tile__img');
  assert.match(img, /(^|[\s;])width:\s*100%/);
  assert.match(img, /max-width:\s*100%/, 'an aspect-ratio box needs max-width: 100%');
  assert.match(img, /aspect-ratio:\s*3\s*\/\s*2/);
  assert.match(img, /flex:\s*none/, 'a tall text area could squeeze the band below 3:2');
  assert.match(img, /position:\s*relative/, 'nothing anchors the .cover-ph layer (#256)');
  assert.doesNotMatch(img, /border-radius/, 'the band rounds with the tile, not on its own');

  assert.match(bodyOf('.e-tile__title'), /padding:/, 'the title sits flush against the tile edge');
  assert.match(bodyOf('.e-tile__meta'), /padding:/, 'the meta row sits flush against the tile edge');
});

test('the report button brings its own ground onto the cover', () => {
  // The corner it rides is art now, so --ink-soft needs a surface under it.
  assert.match(bodyOf('.e-tile__report'), /background:\s*var\(--surface\)/);
});

test('why there are no day bands is written down, with the measurement', () => {
  assert.match(RAW, /DAY BANDS[\s\S]{0,700}1144px[\s\S]{0,40}463/,
    'the CSS comment recording 1144 vs 463 is gone — day bands will be re-attempted');
});

/* ------------------------------- the DOM ---------------------------------- */

const dom = loadApp({ locale: 'de' });
after(() => dom.close());

const ev = (over) => ({ type: 'session_played', username: 'dora', title: 'Azul', at: '2026-09-20T18:00:00Z', ...over });

test('a cover-less event gets the shelf\'s placeholder in its band', () => {
  const tile = dom.call('renderFeedTile', ev(), { noReport: true });
  const ph = tile.querySelector('.e-tile__img > .cover-ph');
  assert.ok(ph, 'a cover-less tile shows a bare glyph on a flat box');
  // Deterministic, so the same game looks the same here as on its shelf.
  const again = dom.call('renderFeedTile', ev(), { noReport: true });
  assert.equal(again.querySelector('.cover-ph').getAttribute('style'), ph.getAttribute('style'));
});

test('an event with a cover draws no placeholder over it', () => {
  const tile = dom.call('renderFeedTile', ev({ coverUrl: 'https://cf.geekdo-images.com/x.jpg' }), { noReport: true });
  assert.equal(tile.querySelector('.cover-ph'), null);
  assert.match(tile.querySelector('.e-tile__img').getAttribute('style'), /background-image/);
});

test('the ROW form keeps its bare glyph — a 46px thumb is not a wall', () => {
  const row = dom.call('renderFeedEvent', ev());
  assert.equal(row.querySelector('.cover-ph'), null);
  assert.ok(row.querySelector('.feed-item__img .ti-cards'));
});
