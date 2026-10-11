'use strict';

/* The composed vote header's progress marks (#1637).
 *
 * Every composed design (Der Tisch, Ocean, Die Brücke, Das Programmheft, Forest)
 * prints one mark per game in the header. A mark is 11–28px wide, so a long
 * session pushed them past the edge of a phone, or — in a header whose name
 * column was `minmax(0, 1fr)` / `flex: 1` — squeezed „Julian wertet" to one word
 * per line. So past VOTE_MARKS_MAX games the header draws ONE band in the
 * design's own style instead, filled to the current game; the count line still
 * carries the exact numbers and the marks stay aria-hidden.
 *
 * The CSS half pins what the browser measurement found (Forest's stacked phone
 * header, a flex-basis on the three flex headers' name column, a band rule in
 * every composed sheet). jsdom applies no stylesheet, so the pixels themselves
 * are a hand measurement — the numbers are in forest.css's comment.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf, mediaBlocks, topLevel } = require('./support/css');

const sheet = (id) => fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', `${id}.css`), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const COMPOSED = ['tisch', 'ocean', 'bruecke', 'programmheft', 'forest'];

const header = (dom, gameN, gameTotal) => dom.call('composedVoteCard', {
  person: { id: 'm1', name: 'Anna' },
  count: `Spiel ${gameN} von ${gameTotal}`,
  roundName: '',
  gameN,
  gameTotal,
  secret: false,
  game: { id: 'g1', title: 'Azul' },
  meta: '',
  handoff: '',
}).querySelector('.vote-felt');

test('up to VOTE_MARKS_MAX games the header prints one mark per game', () => {
  const dom = loadApp({ locale: 'de' });
  const max = dom.get('VOTE_MARKS_MAX');
  assert.equal(max, 10, 'the threshold every design was measured against at 320px');
  const head = header(dom, 2, max);
  const dots = head.querySelector('.vote-felt__dots');
  assert.equal(dots.getAttribute('aria-hidden'), 'true');
  assert.equal(dots.querySelectorAll('.vote-felt__dot').length, max);
  assert.equal(head.querySelector('.vote-felt__band'), null);
  assert.deepEqual([...dots.children].slice(0, 3).map((d) => d.className),
    ['vote-felt__dot is-done', 'vote-felt__dot is-current', 'vote-felt__dot']);
});

test('past VOTE_MARKS_MAX games the header draws one band filled to the current game', () => {
  const dom = loadApp({ locale: 'de' });
  const total = dom.get('VOTE_MARKS_MAX') + 1;
  const head = header(dom, 3, total);
  const dots = head.querySelector('.vote-felt__dots');
  assert.equal(dots.getAttribute('aria-hidden'), 'true', 'the band is decoration: the count says it');
  assert.ok(dots.classList.contains('vote-felt__dots--band'));
  assert.equal(dots.querySelectorAll('.vote-felt__dot').length, 0, 'no per-game marks once they would not fit');
  const band = dots.querySelector('.vote-felt__band');
  assert.ok(band, 'one band');
  assert.equal(band.style.getPropertyValue('--at'), `${(3 / total * 100).toFixed(2)}%`);
  assert.equal(header(dom, total, total).querySelector('.vote-felt__band').style.getPropertyValue('--at'), '100.00%');
});

test('Forest stacks its phone header and restates the row at 1100px', () => {
  const css = sheet('forest');
  const felt = /\.vote--forest \.vote-felt$/;
  const base = rulesOf(topLevel(css)).filter(([sel]) => felt.test(sel.trim()));
  assert.ok(base.length >= 1, 'the base .vote-felt rule moved');
  const areas = base.map(([, body]) => (body.match(/grid-template-areas:\s*([^;]+);/) || [])[1]).filter(Boolean);
  assert.deepEqual(areas, ['"back . dots" "who who who" "secret secret secret"'],
    'below 1100px the name has the whole width under the back key and the leaves');
  const wide = mediaBlocks(css).filter(([query]) => /min-width:\s*1100px/.test(query));
  const restated = wide.flatMap(([, body]) => rulesOf(body)).filter(([sel, body]) => felt.test(sel.trim()) && /grid-template-areas/.test(body));
  assert.equal(restated.length, 1, 'the wide header restates its areas instead of inheriting them');
  assert.match(restated[0][1], /grid-template-areas:\s*"back who dots" "secret secret secret"/);
});

test('the three flex headers give the name a real basis, so the marks wrap before the name squeezes', () => {
  for (const id of ['tisch', 'ocean', 'bruecke']) {
    const who = rulesOf(topLevel(sheet(id))).filter(([sel]) => /\.vote-felt__who$/.test(sel.trim()));
    assert.equal(who.length, 1, `${id}: one .vote-felt__who rule`);
    const flex = (who[0][1].match(/flex:\s*([^;]+);/) || [])[1];
    assert.match(flex || '', /^1 1 \d+(?:\.\d+)?rem$/, `${id}: \`flex: 1\` has a 0 basis and never lets the marks wrap (got ${flex})`);
  }
});

test('every composed design paints the band', () => {
  for (const id of COMPOSED) {
    const band = rulesOf(sheet(id)).filter(([sel]) => /\.vote-felt__band(?![\w-])/.test(sel));
    assert.ok(band.length >= 2, `${id}: no .vote-felt__band rules (track and position mark)`);
    assert.ok(band.some(([, body]) => /var\(--at\)/.test(body)), `${id}: the band never reads --at`);
  }
});
