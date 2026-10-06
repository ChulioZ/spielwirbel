'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

/*
 * Discover's ranked lists (#1424) on the client: each card draws its leader as
 * before and places 2–3 as compact rows, and Das Programmheft draws the
 * „Meistgespielt" cards as bars. Its own spec beside
 * test/public-stats-view.test.js, which covers the surfaces and keeps the
 * pre-#1424 single-entry payload as its fixture — so that file is also what
 * proves an old cached payload still renders during a deploy.
 *
 * RUN, never `require`d (.claude/rules/testing-views-under-jsdom.md).
 */

const LIST = {
  generatedAt: '2026-10-06T12:00:00.000Z',
  games: {
    mostOwned: [
      { title: 'Cascadia', image: 'https://cf.geekdo-images.com/x.png', url: 'https://boardgamegeek.com/boardgame/1', shelves: 42 },
      { title: 'Azul', image: null, url: 'https://boardgamegeek.com/boardgame/2', shelves: 30 },
      { title: 'Catan', image: null, url: null, shelves: 1 },
    ],
    playedWeek: [
      { title: 'Ark Nova', image: null, url: null, plays: 8 },
      { title: 'Heat', image: null, url: null, plays: 4 },
    ],
    bestRated: [{ title: 'Wingspan', image: null, url: null, score: 4.6, ratings: 88 }],
  },
  names: {
    favDesigner: [
      { name: 'Uwe Rosenberg', score: 4.3, games: 5 },
      { name: 'Reiner Knizia', score: 4.1, games: 1 },
    ],
  },
};

function boot(t, design) {
  const dom = loadApp({ locale: 'de', ...(design ? { design } : {}) });
  t.after(() => dom.close());
  dom.set('fetch', async (url) => {
    if (String(url).startsWith('/api/stats/public')) return { ok: true, json: async () => LIST };
    if (String(url).startsWith('/api/config')) return { ok: true, json: async () => ({}) };
    throw new Error(`unexpected fetch: ${url}`);
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  return dom;
}

const card = (dom, label) => [...dom.document.querySelectorAll('.stats-card')]
  .find((c) => c.querySelector('.stats-card__label').textContent.includes(label));
const text = (el, sel) => [...el.querySelectorAll(sel)].map((n) => n.textContent.trim());

test('a card draws its leader as before, then places 2 and 3 as ranked rows', async (t) => {
  const dom = boot(t);
  await dom.call('showEntdecken');

  // One card per metric still — a list is not three cards.
  assert.equal(dom.document.querySelectorAll('.stats-card').length, 4);
  // The leader keeps the old markup, so every design's rules for it still apply.
  assert.deepEqual(text(dom.document, '.stats-card__title'), ['Cascadia', 'Ark Nova', 'Wingspan', 'Uwe Rosenberg']);

  const owned = card(dom, 'Regal');
  const more = owned.querySelector('ol.stats-card__more');
  assert.ok(more, 'places 2–3 are an ordered list');
  assert.deepEqual(text(more, '.stats-card__rank'), ['2', '3']);
  assert.deepEqual(text(more, '.stats-card__row-title'), ['Azul', 'Catan']);
  assert.deepEqual(text(more, '.stats-card__row-value'), ['in 30 Regalen', 'in 1 Regal']);
  // A linked entry links out like the leader; an unlinked one stays text.
  const [azul, catan] = more.querySelectorAll('.stats-card__row-title');
  assert.equal(azul.tagName, 'A');
  assert.equal(azul.getAttribute('href'), 'https://boardgamegeek.com/boardgame/2');
  assert.equal(azul.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(catan.tagName, 'SPAN');
});

test('a one-entry list draws no empty row list, and names list like games do', async (t) => {
  const dom = boot(t);
  await dom.call('showEntdecken');

  assert.equal(card(dom, 'bewertet').querySelector('.stats-card__more'), null);
  const fav = card(dom, 'Lieblingsautor');
  assert.deepEqual(text(fav, '.stats-card__row-title'), ['Reiner Knizia']);
  assert.equal(fav.querySelector('.stats-card__row-title').tagName, 'SPAN', 'a name links nowhere');
  assert.deepEqual(text(fav, '.stats-card__row-value'), ['Score 4,1 — aus 1 Spiel']);
  // Still one score ⓘ per screen, however many rows carry a score.
  assert.equal(dom.document.querySelectorAll('[data-info-topic="score"]').length, 1);
});

test('Klassisch draws no bars, even on a „Meistgespielt" card', async (t) => {
  const dom = boot(t);
  await dom.call('showEntdecken');
  assert.equal(dom.document.querySelector('.stats-card--bars, .stats-card__bar'), null);
});

test('Das Programmheft draws „Meistgespielt" as bars sized by plays, and only that', async (t) => {
  const dom = boot(t, 'programmheft');
  dom.set('isLoggedIn', () => true);
  await dom.call('showEntdecken');

  const week = card(dom, 'Woche');
  assert.ok(week.classList.contains('stats-card--bars'), 'the play card is a bar list');
  const rows = [...week.querySelectorAll('.stats-card__bars > li')];
  assert.deepEqual(rows.map((r) => r.querySelector('.stats-card__rank').textContent), ['1', '2']);
  assert.deepEqual(rows.map((r) => r.querySelector('.stats-card__row-title').textContent), ['Ark Nova', 'Heat']);
  // The leader's bar is full; every other bar is its share of the leader's plays.
  assert.deepEqual(rows.map((r) => r.style.getPropertyValue('--stats-share')), ['1', '0.5']);
  assert.ok(rows.every((r) => r.querySelector('.stats-card__bar[aria-hidden="true"]')), 'the bar is decoration');
  assert.equal(week.querySelector('.stats-card__cover'), null, 'the sheet draws no cover on a bar list');

  // The shelf and score cards keep the ordinary layout under the same design.
  assert.equal(card(dom, 'Regal').classList.contains('stats-card--bars'), false);
  assert.ok(card(dom, 'Regal').querySelector('.stats-card__more'));
});

/* --------------------- the widened column (≥1280px) --------------------- */

/* Once every card holds a list, the 900px reading measure left a 1920px
   Discover page 1250–1680px tall beside 510px of empty margin on either side
   (measured per design, #1424). From 1280px the whole screen takes
   `--w-detail`; Die Brücke and Das Programmheft, which pin their own column
   count, go from two to three. CSS text, because jsdom applies no stylesheet. */
const fs = require('node:fs');
const path = require('node:path');
const { CSS, rulesOf, mediaBlocks, specificity } = require('./support/css');

const rulesAt = (css, query) => mediaBlocks(css)
  .filter(([q]) => q.includes(query)).flatMap(([, body]) => rulesOf(body));

test('from 1280px every child of the Discover screen leaves the reading measure together', () => {
  const hits = rulesAt(CSS, 'min-width: 1280px')
    .filter(([sel, body]) => sel.includes(':has(> .stats-block)') && /max-width:\s*var\(--w-detail\)/.test(body));
  assert.equal(hits.length, 1, 'nothing widens the Discover column from 1280px');
  const [sel] = hits[0];
  // Every child, so the head, the CTA and Die Brücke's up link share the
  // block's edges; a named list would leave a new sibling at 900.
  assert.match(sel, /> \*:not\(\.rail\):not\(\.dock\)$/);
  // The cap is (0,3,0); a tie would be decided by source order.
  assert.ok(specificity(sel)[1] > 3, `"${sel}" does not out-rank the reading-measure cap`);
});

test('Die Brücke and Das Programmheft draw three columns in the widened column', () => {
  for (const id of ['bruecke', 'programmheft']) {
    const sheet = fs.readFileSync(path.join(__dirname, '..', `public/css/designs/${id}.css`), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const three = rulesAt(sheet, 'min-width: 1280px').some(([sel, body]) =>
      /\.stats-cards$/.test(sel) && /repeat\(3, minmax\(0, 1fr\)\)/.test(body));
    assert.ok(three, `${id}: the Discover cards stay two across in a 1400px column`);
  }
});
