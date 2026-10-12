'use strict';

/*
 * The BGG links on the client (#1638): the shared module's URL builder, resolve
 * cache and DOM helper (required — it is a small dependency-free file), then the
 * three surfaces RENDERED through the jsdom harness (never required, per
 * .claude/rules/testing-views-under-jsdom.md): game detail „Mehr zum Spiel",
 * the Regal-Steckbrief panels and the Entdecken favourites — plus the vote
 * sheet, which must stay unlinked.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const links = require('../public/js/bgg-links');
const { loadApp, flush } = require('./support/dom');

/* ------------------------------ the module -------------------------------- */

test('bggLinkUrl builds the page from a known type and a positive integer id only', () => {
  assert.equal(links.bggLinkUrl('category', 1021), 'https://boardgamegeek.com/boardgamecategory/1021');
  assert.equal(links.bggLinkUrl('mechanic', '2041'), 'https://boardgamegeek.com/boardgamemechanic/2041');
  assert.equal(links.bggLinkUrl('designer', 9216), 'https://boardgamegeek.com/boardgamedesigner/9216');
  for (const [type, id] of [['family', 1], ['__proto__', 1], ['category', 0], ['category', -3],
    ['category', 1.5], ['category', 'javascript:alert(1)'], ['category', null], [undefined, 1]]) {
    assert.equal(links.bggLinkUrl(type, id), null, `${type} / ${id}`);
  }
});

test('bggLinkedNames links each name with an id and keeps the rest plain, comma-separated', (t) => {
  const { window } = new JSDOM('');
  global.document = window.document;
  t.after(() => { delete global.document; });
  const host = window.document.createElement('span');
  host.appendChild(links.bggLinkedNames('category', ['Economic', 'Unknown', 'Animals'], { Economic: 1021, Animals: 1089 }));
  assert.equal(host.textContent, 'Economic, Unknown, Animals');
  const anchors = [...host.querySelectorAll('a')];
  assert.deepEqual(anchors.map((a) => [a.textContent, a.getAttribute('href')]), [
    ['Economic', 'https://boardgamegeek.com/boardgamecategory/1021'],
    ['Animals', 'https://boardgamegeek.com/boardgamecategory/1089'],
  ]);
  for (const a of anchors) {
    assert.equal(a.className, 'bgg-link');
    assert.equal(a.target, '_blank');
    assert.equal(a.rel, 'noopener noreferrer');
  }
});

test('a BGG name carrying markup is TEXT — no element is ever built from it', (t) => {
  const { window } = new JSDOM('');
  global.document = window.document;
  t.after(() => { delete global.document; });
  const evil = '<img src=x onerror="alert(1)">';
  const host = window.document.createElement('span');
  host.appendChild(links.bggLinkedNames('designer', [evil, 'Plain'], { [evil]: 7 }));
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.querySelector('a').textContent, evil);
  assert.equal(host.querySelector('a').getAttribute('href'), 'https://boardgamegeek.com/boardgamedesigner/7');
});

test('resolveBggLinks asks only for names it has not seen, remembers misses, and chunks at the cap', async () => {
  links.bggLinkCache.clear();
  const asked = [];
  const ask = async (body) => {
    asked.push(body);
    const out = { category: {}, mechanic: {}, designer: {} };
    for (const n of body.category || []) if (n.startsWith('k')) out.category[n] = Number(n.slice(1)) + 1;
    return out;
  };
  const first = await links.resolveBggLinks({ category: ['k1', 'x1', 'k1'] }, ask);
  assert.deepEqual(first, { category: { k1: 2 }, mechanic: {}, designer: {} });
  assert.deepEqual(asked, [{ category: ['k1', 'x1'] }]);

  // Both the hit and the miss are remembered: a re-render asks for nothing.
  const again = await links.resolveBggLinks({ category: ['k1', 'x1'] }, ask);
  assert.deepEqual(again.category, { k1: 2 });
  assert.equal(asked.length, 1);

  // Above the route's cap the question is split, never sent whole (a 400).
  const many = Array.from({ length: links.BGG_LINK_NAMES_MAX + 5 }, (_, i) => `k${100 + i}`);
  const out = await links.resolveBggLinks({ category: many }, ask);
  assert.equal(asked.length, 3);
  assert.deepEqual(asked.slice(1).map((b) => b.category.length), [links.BGG_LINK_NAMES_MAX, 5]);
  assert.equal(Object.keys(out.category).length, many.length);
});

test('a failed resolve degrades to plain names, and is retried on the next render', async () => {
  links.bggLinkCache.clear();
  let calls = 0;
  const down = async () => { calls += 1; throw new Error('offline'); };
  assert.deepEqual(await links.resolveBggLinks({ mechanic: ['Drafting'] }, down), { category: {}, mechanic: {}, designer: {} });
  const up = async () => { calls += 1; return { mechanic: { Drafting: 2041 } }; };
  assert.deepEqual((await links.resolveBggLinks({ mechanic: ['Drafting'] }, up)).mechanic, { Drafting: 2041 });
  assert.equal(calls, 2, 'a failure is not cached as a miss');
});

/* ------------------------------ the surfaces ------------------------------ */

// An api() stub answering the link lookup, recording every question asked.
function linkApi(ids, extra) {
  const asked = [];
  const fn = async (method, url, body) => {
    if (url === '/api/bgg-links') {
      asked.push({ ...body });
      const out = { category: {}, mechanic: {}, designer: {} };
      for (const type of Object.keys(out)) {
        for (const n of body[type] || []) if (ids[type] && ids[type][n]) out[type][n] = ids[type][n];
      }
      return out;
    }
    if (extra) return extra(method, url, body);
    throw new Error(`unexpected api ${method} ${url}`);
  };
  return { fn, asked };
}

const IDS = {
  category: { Economic: 1021 },
  mechanic: { 'Hand Management': 2040 },
  designer: { 'Uwe Rosenberg': 10 },
};

const linkedGame = {
  id: 7, title: 'Agricola', minPlayers: 1, maxPlayers: 4, weight: 3.6, rating: 7.9,
  categories: ['Economic', 'Farming'], mechanics: ['Hand Management'],
  designers: ['Uwe Rosenberg', '(Uncredited)'],
};

test('game detail: categories, mechanics and designers link to BGG once the ids arrive', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const api = linkApi(IDS);
  dom.set('api', api.fn);
  const body = dom.call('gameInfoRest', linkedGame);
  dom.document.body.appendChild(body);
  // Plain first — the same text as before the feature, never waiting on the lookup.
  assert.equal(body.querySelectorAll('a').length, 0);
  const plain = [...body.querySelectorAll('.game-info__fact-value')].map((v) => v.textContent);
  await flush();

  const values = [...body.querySelectorAll('.game-info__fact-value')];
  assert.deepEqual(values.map((v) => v.textContent), plain, 'linking changes no visible text');
  const anchors = [...body.querySelectorAll('.game-info__fact-value a')];
  assert.deepEqual(anchors.map((a) => [a.textContent, a.getAttribute('href')]), [
    ['Economic', 'https://boardgamegeek.com/boardgamecategory/1021'],
    ['Hand Management', 'https://boardgamegeek.com/boardgamemechanic/2040'],
    ['Uwe Rosenberg', 'https://boardgamegeek.com/boardgamedesigner/10'],
  ]);
  // „Farming" has no id and stays text; (Uncredited) is never shown, so never asked.
  assert.ok(values[0].textContent.includes('Farming'));
  assert.equal(api.asked.length, 1);
  assert.deepEqual([...api.asked[0].designer], ['Uwe Rosenberg']);
});

test('game detail: a row none of whose names resolved is left exactly as it was', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', linkApi({}).fn);
  const body = dom.call('gameInfoRest', linkedGame);
  const before = body.innerHTML;
  await flush();
  assert.equal(body.innerHTML, before);
});

test('the vote sheet stays UNLINKED and asks for nothing — a vote never leads out of the app', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const api = linkApi(IDS);
  dom.set('api', api.fn);
  const body = dom.call('gameInfoBody', linkedGame);
  dom.document.body.appendChild(body);
  await flush();
  assert.ok(body.textContent.includes('Economic'), 'the sheet does list the names');
  assert.equal(body.querySelectorAll('a').length, 0);
  assert.equal(api.asked.length, 0);
});

test('Regal-Steckbrief: the top mechanics, categories and designers link to BGG', async (t) => {
  const game = (id, over) => ({
    id, title: 'Spiel ' + id, minPlayers: 2, maxPlayers: 4, maxPlaytime: 60, weight: 2.4,
    categories: ['Economic'], mechanics: ['Hand Management', 'Set Collection'],
    designers: ['Uwe Rosenberg'], image: null, ...over,
  });
  const round = {
    id: 3, name: 'Freitagsrunde', members: [{ id: 1, name: 'Anna' }], tags: [],
    games: Array.from({ length: 9 }, (_, i) => game(10 + i)),
    sessions: [{
      id: 's1', createdAt: '2026-09-01T20:00:00.000Z', finished: true, done: true,
      gameIds: Array.from({ length: 9 }, (_, i) => 10 + i), memberIds: [1],
      votes: { 1: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [10 + i, { rating: 4 }])) },
    }],
  };
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const api = linkApi(IDS, async () => round);
  dom.set('api', api.fn);
  dom.set('toast', () => {});
  await dom.call('showShelfProfile', round.id);
  await flush();

  const names = [...dom.app.querySelectorAll('.shelf-top__name')];
  assert.ok(names.length >= 3, `only ${names.length} panel names rendered`);
  const linked = Object.fromEntries(names.filter((n) => n.querySelector('a'))
    .map((n) => [n.textContent, n.querySelector('a').getAttribute('href')]));
  assert.deepEqual(linked, {
    'Hand Management': 'https://boardgamegeek.com/boardgamemechanic/2040',
    Economic: 'https://boardgamegeek.com/boardgamecategory/1021',
    'Uwe Rosenberg': 'https://boardgamegeek.com/boardgamedesigner/10',
  });
  // „Set Collection" has no id and keeps its plain text.
  const plain = names.find((n) => n.textContent === 'Set Collection');
  assert.ok(plain && !plain.querySelector('a'));
});

test('Entdecken: a favourite with an id from the payload links to BGG; one without stays text', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const payload = {
    generatedAt: '2026-10-12T10:00:00.000Z',
    names: {
      favDesigner: [{ name: 'Uwe Rosenberg', score: 4.3, games: 5, rank: 1, bggId: 10 }],
      favCategory: [{ name: 'Economic', score: 4.1, games: 3, rank: 1 }],
    },
  };
  dom.set('fetch', async (url) => {
    if (String(url).startsWith('/api/stats/public')) return { ok: true, json: async () => payload };
    if (String(url).startsWith('/api/config')) return { ok: true, json: async () => ({}) };
    throw new Error(`unexpected fetch: ${url}`);
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  await dom.call('showEntdecken');

  const titles = [...dom.document.querySelectorAll('.stats-card__title')];
  const designer = titles.find((el) => el.textContent === 'Uwe Rosenberg');
  assert.equal(designer.tagName, 'A');
  assert.equal(designer.getAttribute('href'), 'https://boardgamegeek.com/boardgamedesigner/10');
  assert.equal(designer.getAttribute('target'), '_blank');
  const category = titles.find((el) => el.textContent === 'Economic');
  assert.equal(category.tagName, 'SPAN');
});
