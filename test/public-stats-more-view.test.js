'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

/*
 * Discover's „Mehr anzeigen" and „Frühere Sieger" (#1732): which cards get
 * which control, on which surface, and what the popup lists. RUN, never
 * `require`d (.claude/rules/testing-views-under-jsdom.md).
 */

const MAIN = {
  generatedAt: '2026-11-14T12:00:00.000Z',
  games: {
    mostOwned: [{ title: 'Catan', image: null, url: null, shelves: 9, rank: 1 }],
    playedWeek: [{ title: 'Azul', image: null, url: null, plays: 4, rank: 1 }],
    playedMonth: [{ title: 'Azul', image: null, url: null, plays: 9, period: '2026-11', rank: 1 }],
    bestRated: [{ title: 'Wingspan', image: null, url: null, score: 4.6, ratings: 8, plays: 0, rank: 1 }],
  },
  names: { favDesigner: [{ name: 'Uwe Rosenberg', score: 4.3, games: 3, rank: 1 }] },
};

const MORE = {
  generatedAt: '2026-11-14T12:00:00.000Z',
  games: {
    mostOwned: [
      { title: 'Catan', image: null, url: 'https://boardgamegeek.com/boardgame/13', shelves: 9, rank: 1 },
      { title: 'Carcassonne', image: null, url: null, shelves: 7, rank: 2 },
      { title: 'Codenames', image: null, url: null, shelves: 7, rank: 2 },
      { title: 'Dixit', image: null, url: null, shelves: 3, rank: 4 },
    ],
  },
  names: {
    favDesigner: [
      { name: 'Uwe Rosenberg', score: 4.3, games: 3, rank: 1 },
      { name: 'Reiner Knizia', score: 4.1, games: 5, rank: 2 },
    ],
  },
  pastWinners: {
    week: [
      { period: '2026-11-02', games: [{ title: 'Azul', image: null, url: null }, { title: 'Ra', image: null, url: null }] },
      { period: '2026-10-26', games: [{ title: 'Kanagawa', image: null, url: null }] },
    ],
  },
};

function boot(t, { more = MORE } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run('window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });');
  const asked = [];
  dom.set('fetch', async (url) => {
    asked.push(String(url));
    if (String(url) === '/api/stats/public/more') {
      return more ? { ok: true, json: async () => more } : { ok: false, status: 404, json: async () => ({}) };
    }
    if (String(url) === '/api/stats/public') return { ok: true, json: async () => MAIN };
    return { ok: true, json: async () => ({}) };
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  return { dom, asked };
}

const card = (dom, label) => [...dom.document.querySelectorAll('.stats-card')]
  .find((c) => c.querySelector('.stats-card__label').textContent.includes(label));
const control = (c) => c.querySelector('.stats-card__expand');

test('on /entdecken each card gets the control its longer list supports, and no other', async (t) => {
  const { dom } = boot(t);
  await dom.call('showEntdecken');
  assert.equal(control(card(dom, 'im Regal')).textContent, 'Mehr anzeigen');
  assert.equal(control(card(dom, 'Lieblingsautor')).textContent, 'Mehr anzeigen');
  assert.equal(control(card(dom, 'diese Woche')).textContent, 'Frühere Sieger');
  // No month history in the payload, no top ten for best-rated: no button.
  assert.equal(control(card(dom, 'im November')), null);
  assert.equal(control(card(dom, 'bewertet')), null);
  assert.equal(dom.document.querySelectorAll('.stats-card__expand').length, 3);
});

test('a 404 from the longer lists renders the cards exactly as before', async (t) => {
  const { dom } = boot(t, { more: null });
  await dom.call('showEntdecken');
  assert.ok(card(dom, 'im Regal'));
  assert.equal(dom.document.querySelectorAll('.stats-card__expand').length, 0);
});

test('the landing page and the home tile never ask for the longer lists', async (t) => {
  const { dom, asked } = boot(t);
  const host = dom.document.createElement('div');
  dom.document.body.appendChild(host);
  await dom.call('mountLandingStats', host);
  const home = dom.document.createElement('div');
  dom.document.body.appendChild(home);
  await dom.call('mountHomeStatsPanel', home);
  assert.ok(host.querySelector('.stats-card'), 'the landing block rendered');
  assert.equal(dom.document.querySelectorAll('.stats-card__expand').length, 0);
  assert.equal(asked.includes('/api/stats/public/more'), false);
});

test('„Mehr anzeigen" lists the places with shared ranks and each card\'s own value line', async (t) => {
  const { dom } = boot(t);
  await dom.call('showEntdecken');
  const btn = control(card(dom, 'im Regal'));
  btn.focus();
  btn.click();
  const sheet = dom.document.querySelector('.sheet');
  assert.ok(sheet);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  const rows = [...sheet.querySelectorAll('.stats-games__row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.stats-games__rank').textContent), ['1', '2', '2', '4']);
  assert.deepEqual(rows.map((r) => r.querySelector('.stats-games__name').textContent),
    ['Catan', 'Carcassonne', 'Codenames', 'Dixit']);
  assert.equal(rows[0].querySelector('.stats-games__score').textContent, 'in 9 Regalen');
  assert.equal(rows[0].querySelector('a.stats-games__name').getAttribute('href'), 'https://boardgamegeek.com/boardgame/13');
  dom.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(dom.document.querySelector('.sheet'), null);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(dom.document.activeElement, btn, 'focus returns to the control');
});

test('„Frühere Sieger" names each past week by its date range, every tied game, no count', async (t) => {
  const { dom } = boot(t);
  await dom.call('showEntdecken');
  control(card(dom, 'diese Woche')).click();
  const rows = [...dom.document.querySelectorAll('.sheet .stats-games__row')];
  assert.equal(rows.length, 2);
  const label = rows[0].querySelector('.stats-games__score').textContent;
  assert.match(label, /2\.\s*[–-]\s*8\. Nov\. 2026/, `the week reads as its range, got "${label}"`);
  assert.deepEqual([...rows[0].querySelectorAll('.stats-games__name')].map((n) => n.textContent), ['Azul', 'Ra']);
  assert.doesNotMatch(rows[0].textContent, /Session|Partie|\d+ ×/, 'no session count');
});
