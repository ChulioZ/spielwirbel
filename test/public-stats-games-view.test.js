'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

/*
 * The games behind a favourite name (#1560): on Discover's three favourite
 * cards the count line is a button that opens every game the average was
 * computed from. Its own spec beside test/public-stats-list-view.test.js,
 * whose fixture carries no `list` — which is what proves a payload from before
 * this change still renders the count as plain text.
 *
 * RUN, never `require`d (.claude/rules/testing-views-under-jsdom.md).
 */

const LIST = {
  generatedAt: '2026-10-06T12:00:00.000Z',
  games: {
    bestRated: [{ title: 'Wingspan', image: null, url: null, score: 4.6, ratings: 88 }],
  },
  names: {
    favDesigner: [
      {
        name: 'Uwe Rosenberg', score: 4.3, games: 2,
        list: [
          { title: 'Agricola', image: 'https://cf.geekdo-images.com/a.jpg', url: 'https://boardgamegeek.com/boardgame/31260', score: 4.8 },
          { title: 'Caverna', image: null, url: 'https://boardgamegeek.com/boardgame/102794', score: 3.8 },
        ],
      },
      // No list: the trigger must fall back to the plain line.
      { name: 'Reiner Knizia', score: 4.1, games: 1 },
    ],
    favMechanic: [
      { name: 'Worker Placement', score: 4, games: 1, list: [{ title: 'Lords', image: null, url: null, score: 4 }] },
    ],
  },
};

// `wide` pins usesEditorSheet(): jsdom implements no matchMedia at all.
function boot(t, { wide = false } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run(`window.matchMedia = (q) => ({ matches: ${wide} && /min-width/.test(q), addEventListener() {}, removeEventListener() {} });`);
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

test('a favourite with a list makes its count a button; without one it stays text', async (t) => {
  const dom = boot(t);
  await dom.call('showEntdecken');

  const fav = card(dom, 'Lieblingsautor');
  const trigger = fav.querySelector('.stats-card__value');
  assert.equal(trigger.tagName, 'BUTTON');
  assert.equal(trigger.getAttribute('type'), 'button');
  assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(trigger.textContent.trim(), 'Score 4,3 — aus 2 Spielen');
  assert.equal(fav.querySelector('.stats-card__row-value').tagName, 'SPAN', 'Knizia carries no list');
  // A game podium never becomes a trigger, list or not.
  assert.equal(card(dom, 'bewertet').querySelector('.stats-card__value').tagName, 'SPAN');
});

test('the button opens the games behind the name, best first, and Escape gives focus back', async (t) => {
  const dom = boot(t);
  await dom.call('showEntdecken');
  const trigger = card(dom, 'Lieblingsautor').querySelector('.stats-card__value');
  trigger.focus();
  trigger.click();

  const sheet = dom.document.querySelector('.sheet');
  assert.ok(sheet, 'a sheet below 860px');
  assert.equal(sheet.getAttribute('aria-label'), 'Lieblingsautor:in · Uwe Rosenberg');
  const rows = [...sheet.querySelectorAll('.stats-games__row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.stats-games__name').textContent), ['Agricola', 'Caverna']);
  assert.deepEqual(rows.map((r) => r.querySelector('.stats-games__score').textContent), ['Score 4,8', 'Score 3,8']);
  const link = rows[0].querySelector('a.stats-games__name');
  assert.equal(link.getAttribute('href'), 'https://boardgamegeek.com/boardgame/31260');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(rows[0].querySelector('img.stats-games__cover').getAttribute('alt'), '', 'the cover is decorative');
  assert.ok(rows[1].querySelector('.stats-games__cover--none'), 'a coverless game keeps the row’s shape');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');

  dom.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(dom.document.querySelector('.sheet'), null);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(dom.document.activeElement, trigger, 'focus returns to the count');
});

test('from 860px it is an anchored popover that names itself', async (t) => {
  const dom = boot(t, { wide: true });
  await dom.call('showEntdecken');
  card(dom, 'Lieblingsmechanik').querySelector('.stats-card__value').click();

  const pop = dom.document.querySelector('.popover--stats-games');
  assert.ok(pop);
  assert.equal(pop.getAttribute('role'), 'dialog');
  assert.equal(pop.getAttribute('aria-label'), 'Lieblingsmechanik · Worker Placement');
  assert.equal(pop.querySelector('.stats-games__title').textContent, 'Lieblingsmechanik · Worker Placement');
  // An unlinked game is text, never an empty link.
  assert.equal(pop.querySelector('.stats-games__name').tagName, 'SPAN');
});

test('a place-2 entry with a list is a trigger too, and opens its own games', async (t) => {
  const payload = JSON.parse(JSON.stringify(LIST));
  payload.names.favDesigner[1].list = [{ title: 'Ra', image: null, url: null, score: 4.1 }];
  const dom = boot(t);
  dom.set('fetch', async (url) => {
    if (String(url).startsWith('/api/stats/public')) return { ok: true, json: async () => payload };
    return { ok: true, json: async () => ({}) };
  });
  await dom.call('showEntdecken');
  const row = card(dom, 'Lieblingsautor').querySelector('.stats-card__row-value');
  assert.equal(row.tagName, 'BUTTON');
  row.click();
  assert.deepEqual([...dom.document.querySelectorAll('.stats-games__name')].map((n) => n.textContent), ['Ra']);
});

test('the home panel wires the same trigger', async (t) => {
  const dom = boot(t);
  const host = dom.document.createElement('div');
  dom.document.body.appendChild(host);
  await dom.call('mountHomeStatsPanel', host);
  const trigger = host.querySelector('[data-stats-fav="favDesigner"]');
  assert.ok(trigger, 'the favourite is among the home panel’s cards');
  trigger.click();
  assert.ok(dom.document.querySelector('.stats-games__row'));
});

/* On a phone the popup docks to the bottom edge in EVERY design (#1560) —
   Klassisch's editors are otherwise centred dialogs below 860px, and this one
   alone is scoped off that, so no other Klassisch editor moves. CSS text,
   because jsdom applies no stylesheet. */
const { CSS, rulesOf, mediaBlocks, declaredValue } = require('./support/css');

test('below 640px the games popup is a bottom sheet, and only that editor moves', () => {
  const phone = mediaBlocks(CSS).filter(([q]) => q.includes('max-width: 639px')).flatMap(([, b]) => rulesOf(b));
  const dock = phone.find(([sel]) => /^\.sheet-backdrop--editor:has\(\.editor--stats-games\)$/.test(sel.trim()));
  assert.ok(dock, 'no phone rule docks the games popup');
  assert.equal(declaredValue(dock[1], 'align-items'), 'flex-end');
  const sheet = phone.find(([sel]) => /^\.sheet-backdrop--editor:has\(\.editor--stats-games\) > \.sheet$/.test(sel.trim()));
  assert.ok(sheet, 'the docked sheet keeps the dialog’s width and corners');
  assert.equal(declaredValue(sheet[1], 'max-width'), 'none');
  // No unscoped editor docking in the base sheet: Klassisch's other editors stay dialogs.
  assert.equal(phone.some(([sel]) => sel.trim() === '.sheet-backdrop--editor'), false);
});
