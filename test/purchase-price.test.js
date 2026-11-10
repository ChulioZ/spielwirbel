'use strict';

/*
 * A game's purchase price (#1773): `purchasePrice: { amount, currency }`, cents
 * of one of the price feature's currencies, and what it derives — the cost per
 * session on the Spielepass and Pokale's „Bester Kauf".
 *
 * Pinned here: the pure arithmetic (parse, validity, cost per play, the
 * tie-aware best buy), the route's refusals, and that move, copy and the round
 * export carry the price. The repo half (both backends, the absent-key clear)
 * is in test/support/repo-contract.js; the rendered chip, editor and Pokale
 * card are test/purchase-price-view.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const {
  PURCHASE_PRICE_CURRENCIES, PURCHASE_PRICE_MAX_CENTS, BEST_BUY_MIN_PLAYS,
  isValidPurchasePrice, parsePurchaseAmount, costPerPlay, bestBuy,
} = require('../public/js/purchase-price');
const { CURRENCIES: PRICE_FEATURE_CURRENCIES } = require('../lib/prices/boardgameprices');

async function addGame(rid, title) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8' })) req.field(k, String(v));
  return (await req).body;
}
const patch = (rid, gid, body) => request(app).patch(`/api/rounds/${rid}/games/${gid}`).send(body);
const gameOf = async (rid, gid) =>
  (await request(app).get(`/api/rounds/${rid}`)).body.games.find((g) => g.id === gid);

/* ------------------------------ arithmetic ------------------------------ */

test('parsePurchaseAmount reads either decimal separator and refuses what it would have to guess', () => {
  assert.equal(parsePurchaseAmount('39,99'), 3999);
  assert.equal(parsePurchaseAmount('39.99'), 3999);
  assert.equal(parsePurchaseAmount(' 40 '), 4000);
  assert.equal(parsePurchaseAmount('12,5'), 1250);
  assert.equal(parsePurchaseAmount('1.234,56'), 123456, 'German thousands separator');
  assert.equal(parsePurchaseAmount('1,234.56'), 123456, 'English thousands separator');
  for (const bad of ['', 'abc', '0', '0,00', '-5', '3,999', '1e3', '12,', String(PURCHASE_PRICE_MAX_CENTS / 100 + 1)]) {
    assert.equal(parsePurchaseAmount(bad), null, `"${bad}" must be refused`);
  }
});

test('the currency list IS the price feature\'s, so a current price can always be taken over', () => {
  assert.deepEqual([...PURCHASE_PRICE_CURRENCIES].sort(), [...PRICE_FEATURE_CURRENCIES].sort());
});

test('isValidPurchasePrice: integer cents in range, a known currency, nothing else', () => {
  assert.equal(isValidPurchasePrice({ amount: 3999, currency: 'EUR' }), true);
  assert.equal(isValidPurchasePrice({ amount: PURCHASE_PRICE_MAX_CENTS, currency: 'SEK' }), true);
  for (const bad of [null, undefined, [], {}, { amount: 0, currency: 'EUR' }, { amount: 39.5, currency: 'EUR' },
    { amount: PURCHASE_PRICE_MAX_CENTS + 1, currency: 'EUR' }, { amount: 100, currency: 'eur' },
    { amount: 100, currency: 'KRW' }, { amount: 100, currency: 'EUR', note: 'x' }]) {
    assert.equal(isValidPurchasePrice(bad), false, JSON.stringify(bad));
  }
});

test('costPerPlay: nothing to divide by before the first session, then price ÷ plays', () => {
  const price = { amount: 4000, currency: 'EUR' };
  assert.equal(costPerPlay(price, 0), null);
  assert.equal(costPerPlay(price, 1), 4000);
  assert.equal(costPerPlay(price, 3), 4000 / 3);
  assert.equal(costPerPlay({ amount: 0, currency: 'EUR' }, 3), null);
});

const g = (id, amount, currency = 'EUR', extra = {}) => ({ id, title: id, purchasePrice: { amount, currency }, ...extra });

test(`bestBuy needs ${BEST_BUY_MIN_PLAYS} sessions, and is tie-aware by exact fraction`, () => {
  // 30/3 and 40/4 are both 10,00 per session — a tie, compared without floats.
  // Named so a title/insertion fallback would order them the other way round.
  const games = [g('b-forty', 4000), g('a-thirty', 3000), g('cheap-but-new', 500), g('dear', 9000)];
  const plays = new Map([['b-forty', 4], ['a-thirty', 3], ['cheap-but-new', BEST_BUY_MIN_PLAYS - 1], ['dear', 3]]);
  const buy = bestBuy(games, plays);
  assert.equal(buy.cents, 1000);
  assert.equal(buy.currency, 'EUR');
  assert.deepEqual(buy.games.map((x) => x.id), ['b-forty', 'a-thirty']);
  // One session more on the 40 € game breaks the tie in its favour.
  plays.set('b-forty', 5);
  assert.deepEqual(bestBuy(games, plays).games.map((x) => x.id), ['b-forty']);
});

test('bestBuy is absent until a game qualifies, and never names a wish or a guest game', () => {
  assert.equal(bestBuy([], new Map()), null);
  assert.equal(bestBuy([g('x', 100)], new Map([['x', 2]])), null);
  assert.equal(bestBuy([{ id: 'u', title: 'u' }], new Map([['u', 9]])), null, 'an unpriced game cannot win');
  const games = [g('wished', 100, 'EUR', { wish: true }), g('visitor', 100, 'EUR', { guestGame: true }), g('ours', 6000)];
  const plays = new Map([['wished', 9], ['visitor', 9], ['ours', 3]]);
  assert.deepEqual(bestBuy(games, plays).games.map((x) => x.id), ['ours']);
  // A retired game was still bought and still played: a record.
  assert.deepEqual(bestBuy([g('gone', 300, 'EUR', { retired: true })], new Map([['gone', 3]])).games.map((x) => x.id), ['gone']);
});

test('bestBuy compares only within the currency most priced games use — no conversion', () => {
  // The single pound game is far cheaper per session but cannot be compared.
  const games = [g('pounds', 300, 'GBP'), g('e1', 6000), g('e2', 9000)];
  const plays = new Map([['pounds', 3], ['e1', 3], ['e2', 3]]);
  const buy = bestBuy(games, plays);
  assert.equal(buy.currency, 'EUR');
  assert.deepEqual(buy.games.map((x) => x.id), ['e1']);
});

/* -------------------------------- route --------------------------------- */

test('PATCH sets, changes and clears a purchase price; a clear leaves no key', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'Brass');
  let res = await patch(round.id, game.id, { purchasePrice: { amount: 5999, currency: 'EUR' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual((await gameOf(round.id, game.id)).purchasePrice, { amount: 5999, currency: 'EUR' });
  res = await patch(round.id, game.id, { purchasePrice: { amount: 4500, currency: 'GBP' } });
  assert.equal(res.status, 200);
  assert.deepEqual((await gameOf(round.id, game.id)).purchasePrice, { amount: 4500, currency: 'GBP' });
  res = await patch(round.id, game.id, { purchasePrice: null });
  assert.equal(res.status, 200);
  assert.equal('purchasePrice' in (await gameOf(round.id, game.id)), false);
});

test('PATCH refuses an invalid purchase price and stores nothing', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'Azul');
  const bad = [
    { amount: 0, currency: 'EUR' }, { amount: -100, currency: 'EUR' }, { amount: 12.5, currency: 'EUR' },
    { amount: '1200', currency: 'EUR' }, { amount: PURCHASE_PRICE_MAX_CENTS + 1, currency: 'EUR' },
    { amount: 1200, currency: 'JPY' }, { amount: 1200 }, { amount: 1200, currency: 'EUR', paidBy: 'Anna' }, 1200, 'x',
  ];
  for (const purchasePrice of bad) {
    const res = await patch(round.id, game.id, { purchasePrice });
    assert.equal(res.status, 400, `${JSON.stringify(purchasePrice)} must 400`);
  }
  assert.equal('purchasePrice' in (await gameOf(round.id, game.id)), false);
});

test('moving and copying a game carry its purchase price', async () => {
  const from = await createRound(request);
  const copyTo = await createRound(request, { name: 'Copy target' });
  const moveTo = await createRound(request, { name: 'Move target' });
  const copied = await addGame(from.id, 'Brass');
  const moved = await addGame(from.id, 'Azul');
  await patch(from.id, copied.id, { purchasePrice: { amount: 5999, currency: 'EUR' } });
  await patch(from.id, moved.id, { purchasePrice: { amount: 3500, currency: 'USD' } });

  let res = await request(app).post(`/api/rounds/${from.id}/games/copy-to`).send({ targetRoundId: copyTo.id, gameIds: [copied.id] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  res = await request(app).post(`/api/rounds/${from.id}/games/move-to`).send({ targetRoundId: moveTo.id, gameIds: [moved.id] });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const titled = async (rid, title) => (await request(app).get(`/api/rounds/${rid}`)).body.games.find((x) => x.title === title);
  assert.deepEqual((await titled(copyTo.id, 'Brass')).purchasePrice, { amount: 5999, currency: 'EUR' });
  assert.deepEqual((await titled(moveTo.id, 'Azul')).purchasePrice, { amount: 3500, currency: 'USD' });
});
