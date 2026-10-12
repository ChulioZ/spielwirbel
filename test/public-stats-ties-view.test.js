'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

/*
 * Shared places on Discover (#1648), on the client: a row draws the place the
 * PAYLOAD gives it, never its index, so a tie reads 1, 1, 3. The server decides
 * ties (lib/public-stats.js, test/public-stats-ties.test.js) and the client
 * only draws them — re-deriving the rule here would be a second copy of it.
 *
 * A payload WITHOUT ranks (one built before #1648, served for the seconds a
 * deploy overlaps) still numbers by position: test/public-stats-list-view.test.js
 * keeps that fixture and asserts 2, 3.
 *
 * RUN, never `require`d (.claude/rules/testing-views-under-jsdom.md).
 */

const TIED = {
  generatedAt: '2026-10-14T12:00:00.000Z',
  games: {
    mostOwned: [
      { title: 'Cascadia', image: null, url: null, shelves: 7, rank: 1 },
      { title: 'Azul', image: null, url: null, shelves: 7, rank: 1 },
      { title: 'Catan', image: null, url: null, shelves: 5, rank: 3 },
      { title: 'Heat', image: null, url: null, shelves: 5, rank: 3 },
    ],
    playedWeek: [
      { title: 'Ark Nova', image: null, url: null, plays: 4, rank: 1 },
      { title: 'Heat', image: null, url: null, plays: 4, rank: 1 },
      { title: 'Azul', image: null, url: null, plays: 2, rank: 3 },
    ],
  },
  names: {
    favDesigner: [
      { name: 'Uwe Rosenberg', score: 4.3, games: 1, rank: 1, list: [{ title: 'Rosenberg-Spiel', image: null, url: null, score: 4.3 }] },
      { name: 'Reiner Knizia', score: 4.3, games: 1, rank: 1, list: [{ title: 'Knizia-Spiel', image: null, url: null, score: 4.3 }] },
    ],
  },
};

function boot(t, design) {
  const dom = loadApp({ locale: 'de', ...(design ? { design } : {}) });
  t.after(() => dom.close());
  // jsdom implements no matchMedia; a phone width, so the games open as a sheet.
  dom.run('window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });');
  dom.set('fetch', async (url) => {
    if (String(url).startsWith('/api/stats/public')) return { ok: true, json: async () => TIED };
    if (String(url).startsWith('/api/config')) return { ok: true, json: async () => ({}) };
    throw new Error(`unexpected fetch: ${url}`);
  });
  dom.set('accountsActive', () => true);
  // Logged out, like the landing page — except under a design, which only an
  // account wears (test/public-stats-list-view.test.js does the same).
  dom.set('isLoggedIn', () => !!design);
  return dom;
}

const card = (dom, label) => [...dom.document.querySelectorAll('.stats-card')]
  .find((c) => c.querySelector('.stats-card__label').textContent.includes(label));

test('the rows draw the payload place, and the list numbering agrees with it', async (t) => {
  const dom = boot(t);
  await dom.call('showEntdecken');

  const rows = [...card(dom, 'Regal').querySelectorAll('ol.stats-card__more > li')];
  assert.deepEqual(rows.map((r) => r.querySelector('.stats-card__rank').textContent), ['1', '3', '3'],
    'a shared first place, then the next value at 3 — not 2, 3, 4');
  // Assistive tech reads the <ol>'s own numbering, so it must say the same.
  assert.deepEqual(rows.map((r) => r.value), [1, 3, 3]);
  // The leader stays the leader: one big card, whoever shares its place.
  assert.equal(card(dom, 'Regal').querySelector('.stats-card__title').textContent, 'Cascadia');
});

test('a favourite row still opens ITS games — the button keeps an index, not the place', async (t) => {
  const dom = boot(t);
  await dom.call('showEntdecken');

  const btn = card(dom, 'Lieblingsautor').querySelector('.stats-card__more .stats-card__games');
  assert.equal(btn.dataset.statsIndex, '1', 'Knizia is entry 1 although he shares place 1');
  btn.click();
  const sheet = dom.document.querySelector('.sheet .stats-games');
  assert.ok(sheet, 'the games sheet opened');
  assert.ok(sheet.textContent.includes('Knizia-Spiel'), 'it lists Knizia’s game');
  assert.ok(!sheet.textContent.includes('Rosenberg-Spiel'), 'not the place-1 leader’s');
});

test('Das Programmheft’s bars draw the payload place too', async (t) => {
  const dom = boot(t, 'programmheft');
  await dom.call('showEntdecken');

  const rows = [...card(dom, 'Woche').querySelectorAll('.stats-card__bars > li')];
  assert.deepEqual(rows.map((r) => r.querySelector('.stats-card__rank').textContent), ['1', '1', '3']);
  assert.deepEqual(rows.map((r) => r.value), [1, 1, 3]);
});
