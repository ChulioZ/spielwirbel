'use strict';

/* The purchase price on screen (#1773), run through the jsdom harness
 * (.claude/rules/testing-views-under-jsdom.md): the Spielepass chip and its
 * editor, Pokale's „Bester Kauf" card, the round export's columns and the
 * „Ins Regal" offer on a wish with a current price. The arithmetic and the
 * route are test/purchase-price.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush, waitFor } = require('./support/dom');

const RID = 'r1';
const COVER = 'https://cf.geekdo-images.com/x.jpg';

const played = (id, gid) => ({
  id, createdAt: `2026-07-0${id.slice(1)}T20:00:00.000Z`, gameIds: [gid], memberIds: ['m1', 'm2'],
  votes: {}, votedIds: [], finished: true, cancelled: false, done: true, winnerIds: ['m1'],
  chosenGameId: gid, events: [],
});

function roundFixture() {
  return {
    id: RID, name: 'Freitagsrunde', background: null, tags: [], providers: [],
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
    games: [
      // Played three times: 40,00 € / 3 = 13,33 € per session.
      { id: 'g1', title: 'Brass', image: COVER, minPlayers: 2, maxPlayers: 4, tagIds: [],
        purchasePrice: { amount: 4000, currency: 'EUR' } },
      // Priced, never played: the chip states the price alone.
      { id: 'g2', title: 'Azul', image: COVER, minPlayers: 2, maxPlayers: 4, tagIds: [],
        purchasePrice: { amount: 2999, currency: 'EUR' } },
      // No price: an invitation.
      { id: 'g3', title: 'Catan', image: COVER, minPlayers: 3, maxPlayers: 4, tagIds: [] },
      // A wish with a BGG link — the price section fetches a current price.
      { id: 'g4', title: 'Arche Nova', wish: true, tagIds: [],
        source: { provider: 'bgg', externalId: '342942', url: 'https://boardgamegeek.com/boardgame/342942' } },
    ],
    sessions: [played('s1', 'g1'), played('s2', 'g1'), played('s3', 'g1'), played('s4', 'g3')],
  };
}

const LIVE = {
  available: true, source: 'boardgameprices', currency: 'EUR', amount: 49.89, product: 44.99,
  shipping: 4.9, shippingKnown: true, country: 'DE', destination: 'DE', offerCount: 8,
  url: 'https://boardgameprices.co.uk/item/show/77', fetchedAt: '2026-08-07T10:04:00.000Z',
};

function bootApp(t_, round = roundFixture()) {
  const dom = loadApp({ locale: 'de' });
  t_.after(() => dom.close());
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (/\/activities$/.test(url)) return [];
    if (url.includes('/prices')) return LIVE;
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('toast', (msg) => calls.push({ toast: msg }));
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  dom.run('window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });');
  return { dom, calls, round };
}

const chip = (dom) => dom.app.querySelector('.gd-head .tag--price');
const patches = (calls) => calls.filter((c) => c.method === 'PATCH');
const norm = (s) => s.replace(/[\u00a0\u202f]/g, ' ').trim();

test('the chip states the price, and from the first session what each session cost', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  assert.ok(chip(dom), 'a priced game carries the chip');
  assert.equal(norm(chip(dom).textContent), '40,00 € · 13,33 € pro Session');

  await dom.call('showGameDetail', RID, 'g2');
  assert.equal(norm(chip(dom).textContent), 'Gekauft für 29,99 €', 'before the first session: the price only');

  await dom.call('showGameDetail', RID, 'g3');
  assert.ok(chip(dom).classList.contains('tag--empty'));
  assert.equal(norm(chip(dom).textContent), 'Kaufpreis eintragen');

  await dom.call('showGameDetail', RID, 'g4');
  assert.equal(chip(dom), null, 'a wish was not bought — no price chip');
});

test('the chip formats through the reader\'s locale', async (t_) => {
  const dom = loadApp({ locale: 'en' });
  t_.after(() => dom.close());
  const round = roundFixture();
  dom.set('api', async (method, url) => (/\/activities$/.test(url) ? [] : round));
  await dom.call('showGameDetail', RID, 'g1');
  assert.equal(norm(chip(dom).textContent), '€40.00 · €13.33 per session');
});

test('the editor opens prefilled, sends cents, and clears with null', async (t_) => {
  const { dom, calls } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  chip(dom).click();
  const input = dom.document.querySelector('.editor--price input, .popover--price input');
  const select = dom.document.querySelector('.editor--price select, .popover--price select');
  assert.equal(input.value, '40,00');
  assert.equal(select.value, 'EUR');
  input.value = '1.234,5';
  select.value = 'GBP';
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await waitFor(() => patches(calls).length);
  assert.deepEqual({ ...patches(calls)[0].body.purchasePrice }, { amount: 123450, currency: 'GBP' });

  await dom.call('showGameDetail', RID, 'g1');
  chip(dom).click();
  const clear = [...dom.document.querySelectorAll('.editor--price button, .popover--price button')]
    .find((b) => b.textContent.includes('Kaufpreis entfernen'));
  assert.ok(clear, 'a set price offers the way out');
  clear.click();
  await waitFor(() => patches(calls).length === 2);
  assert.equal(patches(calls)[1].body.purchasePrice, null);
});

test('a refused amount toasts and sends nothing; a new price defaults to the round\'s currency', async (t_) => {
  const round = roundFixture();
  round.games[0].purchasePrice.currency = 'SEK';
  round.games[1].purchasePrice.currency = 'SEK';
  const { dom, calls } = bootApp(t_, round);
  await dom.call('showGameDetail', RID, 'g3');
  chip(dom).click();
  assert.equal(dom.document.querySelector('.editor--price select, .popover--price select').value, 'SEK');
  const input = dom.document.querySelector('.editor--price input, .popover--price input');
  input.value = '12,345';
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flush();
  assert.equal(patches(calls).length, 0);
  assert.ok(calls.some((c) => c.toast === dom.run("t('purchasePrice.invalid')")));
});

const cardByLabel = (root, label) =>
  [...root.querySelectorAll('.pokale-card')].find((c) => (c.querySelector('.pokale-card__label') || {}).textContent === label);

test('Pokale names the best buy once a game qualifies, and not before', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showRound', RID, 'pokale');
  const card = cardByLabel(dom.app, dom.run("t('pokale.bestBuy')"));
  assert.ok(card, 'Brass is priced and was played three times');
  assert.deepEqual([...card.querySelectorAll('.pokale-game__title')].map((a) => a.textContent), ['Brass']);
  assert.equal(norm(card.querySelector('.pokale-card__sub').textContent), '13,33 € pro Session');

  const round = roundFixture();
  round.sessions = round.sessions.slice(1); // two plays: under the floor
  const again = bootApp(t_, round);
  await again.dom.call('showRound', RID, 'pokale');
  assert.ok(again.dom.app.querySelector('.pokale-card'), 'the tab rendered its other cards');
  assert.equal(cardByLabel(again.dom.app, again.dom.run("t('pokale.bestBuy')")), undefined);
});

test('the round export carries the price as an amount and a currency', (t_) => {
  const { dom, round } = bootApp(t_);
  dom.context.__round = round;
  const csv = dom.run("roundExportTables(__round)['games.csv']");
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  const header = lines[0].split(',');
  const row = (title) => lines.find((l) => l.includes(`,${title},`)).split(',');
  const col = (r, name) => r[header.indexOf(name)];
  assert.equal(col(row('Brass'), 'purchase_price'), '40');
  assert.equal(col(row('Brass'), 'currency'), 'EUR');
  assert.equal(col(row('Azul'), 'purchase_price'), '29.99');
  assert.equal(col(row('Catan'), 'purchase_price'), '');
});

test('„Ins Regal" on a wish with a current price offers it, unticked, and writes it only when ticked', async (t_) => {
  const { dom, calls } = bootApp(t_);
  const asked = [];
  // The user ticks the box: the price is taken over after the move.
  dom.set('confirmDialog', async (o) => { asked.push(o); return { ok: true, picked: { price: true } }; });
  await dom.call('showGameDetail', RID, 'g4');
  await waitFor(() => dom.app.querySelector('.gd-price'));
  const btn = [...dom.app.querySelectorAll('.gd-bar button')].find((b) => b.textContent.includes(dom.run("t('wish.restore')")));
  btn.click();
  await waitFor(() => patches(calls).length);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].options[0].checked, false, 'the offer is opt-in');
  assert.match(norm(asked[0].options[0].label), /49,89 €/);
  const wishIdx = calls.findIndex((c) => c.method === 'POST' && c.url.endsWith('/g4/wish'));
  const patchIdx = calls.findIndex((c) => c.method === 'PATCH');
  assert.ok(wishIdx !== -1 && wishIdx < patchIdx, 'the move first, then the price');
  assert.deepEqual({ ...patches(calls)[0].body.purchasePrice }, { amount: 4989, currency: 'EUR' });
});

test('„Ins Regal" left unticked moves the wish and writes no price; a dismissal moves nothing', async (t_) => {
  const { dom, calls } = bootApp(t_);
  let answer = { ok: true, picked: { price: false } };
  dom.set('confirmDialog', async () => answer);
  await dom.call('showGameDetail', RID, 'g4');
  await waitFor(() => dom.app.querySelector('.gd-price'));
  const btn = () => [...dom.app.querySelectorAll('.gd-bar button')].find((b) => b.textContent.includes(dom.run("t('wish.restore')")));
  btn().click();
  await waitFor(() => calls.some((c) => c.method === 'POST' && c.url.endsWith('/g4/wish')));
  await flush();
  assert.equal(patches(calls).length, 0);

  calls.length = 0;
  answer = { ok: false, picked: {} };
  await dom.call('showGameDetail', RID, 'g4');
  await waitFor(() => dom.app.querySelector('.gd-price'));
  btn().click();
  await flush();
  assert.equal(calls.some((c) => c.method === 'POST' && c.url.endsWith('/g4/wish')), false);
});
