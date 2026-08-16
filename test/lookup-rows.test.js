'use strict';

/* One row per BGG hit (#790). Games that share a name with another BGG entry
   used to collapse into a single row, so only one of them was reachable — with
   no "show more" and no way to enter an id, the others could not be linked at
   all. These specs drive the real `attachLookup` under jsdom, because the
   defect lives in what the menu RENDERS, not in any pure helper. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

// Two genuinely distinct BGG games that share the exact title, plus one whose
// year BGG does not know — the three cases a row has to render.
const SCOUT_HITS = [
  { providerId: '291453', title: 'Scout', thumbnail: null, year: 2019 },
  { providerId: '9226', title: 'Scout', thumbnail: null, year: 1991 },
  { providerId: '40000', title: 'Scout', thumbnail: null, year: null },
];

// Let the promise chain in runSearch() settle: searchProvider resolves, the
// per-provider .then pushes the hits, and the trailing .then renders.
const settle = () => new Promise((r) => setTimeout(r, 0));

async function openLookup(t, results) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => ({ results }));
  dom.run(`
    window.__picked = [];
    window.__input = document.createElement('input');
    window.__menu = document.createElement('div');
    document.body.append(window.__input, window.__menu);
    window.__lookup = attachLookup({ id: 1 }, window.__input, window.__menu,
      (hit) => window.__picked.push(hit));
  `);
  dom.run('window.__lookup.search("scout")');
  await settle();
  await settle();
  return dom;
}

test('every BGG hit gets its own row, even when the titles are identical', async (t) => {
  const dom = await openLookup(t, SCOUT_HITS);
  const opts = dom.run('window.__menu.querySelectorAll(".lookup__opt").length');
  assert.equal(opts, 3, 'three hits must produce three rows, not one per title');
  const titles = dom.run(`Array.from(window.__menu.querySelectorAll('.lookup__title')).map((e) => e.textContent)`);
  assert.deepEqual([...titles], ['Scout', 'Scout', 'Scout']);
});

test('each row picks its own BGG id', async (t) => {
  const dom = await openLookup(t, SCOUT_HITS);
  dom.run(`
    window.__menu.querySelectorAll('.lookup__pick').forEach((b) => b.dispatchEvent(
      new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })));
  `);
  const picked = dom.run('window.__picked.map((h) => h.providerId)');
  assert.deepEqual([...picked], ['291453', '9226', '40000'],
    'picking the second and third rows must link those ids, not the first hit again');
});

test('the year disambiguates a row, and a yearless hit renders the title alone', async (t) => {
  const dom = await openLookup(t, SCOUT_HITS);
  const years = dom.run(`Array.from(window.__menu.querySelectorAll('.lookup__opt'))
    .map((row) => { const y = row.querySelector('.lookup__year'); return y ? y.textContent : null; })`);
  assert.deepEqual([...years], ['(2019)', '(1991)', null]);
});

// Moved here from test/lookup-score.test.js with #790: the ordering claim used
// to be asserted against groupLookupHits, and now that the sort lives in
// render() the menu itself is the only honest place to make it.
test('a well-matching hit takes the top row over unrelated ones (#317)', async (t) => {
  const q = 'Die Quacksalber Von Quedlinburg - Megabox';
  const title = 'Die Quacksalber von Quedlinburg: Die Megabox';
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // Unrelated titles first, so a sort that does nothing leaves them on top.
  dom.set('api', async () => ({ results: [
    { providerId: '1', title: 'Perlen von Atlantis', thumbnail: null, year: 2005 },
    { providerId: '2', title: 'Die magische Wippe', thumbnail: null, year: 2011 },
    { providerId: '3', title, thumbnail: null, year: 2022 },
  ] }));
  dom.run(`
    window.__input = document.createElement('input');
    window.__menu = document.createElement('div');
    document.body.append(window.__input, window.__menu);
    attachLookup({ id: 1 }, window.__input, window.__menu, () => {}).search(${JSON.stringify(q)});
  `);
  await settle();
  await settle();
  const first = dom.run('window.__menu.querySelector(".lookup__title").textContent');
  assert.equal(first, title);
});

test('the option list has one keyboard stop per hit', async (t) => {
  // The badges used to add extra stops for a merged row's further providers.
  // With one row per hit the list is exactly the rows, so ArrowDown walks the
  // hits and nothing else.
  const dom = await openLookup(t, SCOUT_HITS);
  const stops = dom.run(`
    window.__input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    window.__menu.querySelectorAll('[role="option"]').length;
  `);
  assert.equal(stops, 3);
  const active = dom.run('window.__menu.querySelector(".is-active").textContent');
  assert.match(active, /Scout/);
});
