'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

/*
 * GET /api/rounds/:rid/games/:gid/prices (#679).
 *
 * Never hits the network: `global.fetch` is replaced per test and restored
 * afterwards, the shape every provider spec here uses
 * (.claude/rules/add-game-lookup-provider.md, "Testing").
 *
 * EVERY spec needs its OWN external id. The price cache is process-wide and its
 * TTL is an hour, so a shared id means the second spec is answered from the
 * first's entry — which presents as "my fetch stub is being ignored"
 * (.claude/rules/bgg-collection-import.md §4).
 */

/*
 * The failure COOLDOWN is module state shared by every spec in this file: one
 * spec's simulated outage would otherwise pause the source for the next two
 * minutes and silently starve every spec after it — which is exactly what
 * happened when it was added (two unrelated specs went red). So the file turns
 * it off by default and the cooldown specs opt in.
 *
 * That means almost nothing here can see the real DEFAULT, so one spec below
 * deletes the override and drives the shipped value through the real path
 * (.claude/rules/break-the-code-on-purpose.md, "a test that SETS the state it
 * asserts cannot see a wrong default").
 */
process.env.PRICES_FAILURE_COOLDOWN_SECONDS = '0';

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.PRICES_ENABLED;
  process.env.PRICES_FAILURE_COOLDOWN_SECONDS = '0';
  // Resetting the env alone does NOT clear a deadline already recorded while it
  // was 60 — that timestamp is still in the future.
  require('../lib/prices').resetCooldowns();
});

const stubFetch = (json, { ok = true } = {}) => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return { ok, status: ok ? 200 : 500, json: async () => json };
  };
  return calls;
};

const bgpBody = (eid, prices) => ({
  currency: 'EUR',
  items: [{
    id: 1, name: 'Arche Nova', url: 'https://brettspielpreise.de/item/show/1/arche-nova',
    versions: { lang: ['DE'] }, external_id: String(eid), prices,
  }],
});

const OFFER = { link: 'https://brettspielpreise.de/item/go?storeitemid=1', price: 49.89, product: 44.99, shipping: '4.90', stock: 'Y', shipping_known: true, country: 'DE' };

// A wished-for game carrying a provider link. `wish` and the source fields both
// ride the multipart create route.
async function addWish(rid, over = {}) {
  const fields = {
    title: 'Arche Nova', minPlayers: '1', maxPlayers: '4', wish: 'true',
    sourceProvider: 'bgg', sourceExternalId: '342942', ...over,
  };
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  return (await req).body;
}

test('the route 404s while PRICES_ENABLED is unset — and asks nothing upstream', async () => {
  const calls = stubFetch(bgpBody('1001', [OFFER]));
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '1001' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'prices_disabled');
  assert.deepEqual(calls, []);
});

test('an enabled instance answers the cheapest in-stock total for the wished game', async () => {
  process.env.PRICES_ENABLED = 'true';
  const calls = stubFetch(bgpBody('1002', [
    { ...OFFER, price: 62.95, product: 62.95, shipping: '0.00' },
    OFFER,
    { ...OFFER, price: 44.5, product: 44.5, stock: 'N' },
  ]));
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '1002' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=de`);
  assert.equal(res.status, 200);
  assert.equal(res.body.available, true);
  assert.equal(res.body.source, 'boardgameprices');
  assert.equal(res.body.amount, 49.89);
  assert.equal(res.body.shippingKnown, true);
  assert.equal(res.body.currency, 'EUR');
  assert.equal(res.body.country, 'DE');
  assert.equal(res.body.offerCount, 3);
  assert.equal(res.body.inStockCount, 2);
  assert.equal(res.body.url, 'https://brettspielpreise.de/item/show/1/arche-nova');
  assert.ok(res.body.fetchedAt, 'a retrieval timestamp is part of the answer, not a nicety');

  // The upstream call carries the BGG id and our real host, and nothing else.
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]);
  assert.equal(url.origin + url.pathname, 'https://boardgameprices.co.uk/api/info');
  assert.equal(url.searchParams.get('eid'), '1002');
  assert.equal(url.searchParams.get('destination'), 'DE');
  assert.equal(url.searchParams.get('currency'), 'EUR');
  assert.equal(url.searchParams.get('sitename'), 'spielwirbel.app');
});

test('a second view inside the hour is answered from the cache, not a second request', async () => {
  process.env.PRICES_ENABLED = 'true';
  const calls = stubFetch(bgpBody('1003', [OFFER]));
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '1003' });
  const path = `/api/rounds/${round.id}/games/${game.id}/prices?lang=de`;
  const first = await request(app).get(path);
  const second = await request(app).get(path);
  assert.equal(calls.length, 1, 'their terms ask for at least an hour of caching');
  assert.deepEqual(second.body, first.body);
  assert.equal(second.body.fetchedAt, first.body.fetchedAt, 'the timestamp is when it was FETCHED, not when it was served');
});

test('a shelf game gets no price and makes no upstream request', async () => {
  process.env.PRICES_ENABLED = 'true';
  const calls = stubFetch(bgpBody('1004', [OFFER]));
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '1004', wish: 'false' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { available: false });
  assert.deepEqual(calls, []);
});

test('a hand-typed wish has no link, so nothing is asked and nothing is guessed', async () => {
  process.env.PRICES_ENABLED = 'true';
  const calls = stubFetch(bgpBody('1005', [OFFER]));
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceProvider: '', sourceExternalId: '' });
  assert.ok(!game.source);
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices`);
  assert.deepEqual(res.body, { available: false });
  assert.deepEqual(calls, [], 'a title-search fallback would quote the wrong edition');
});

test('a provider with no price source is unavailable, not an error', async () => {
  process.env.PRICES_ENABLED = 'true';
  const calls = stubFetch({});
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceProvider: 'psstore', sourceExternalId: 'EP0006-TEST_00-0' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { available: false });
  assert.deepEqual(calls, []);
});

test('an upstream failure leaves the page whole — no 502, nothing thrown', async () => {
  process.env.PRICES_ENABLED = 'true';
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '1006' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { available: false });

  // And it is not cached: the next view asks again rather than repeating a
  // transient outage back at the user for an hour.
  const calls = stubFetch(bgpBody('1006', [OFFER]));
  const retry = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices`);
  assert.equal(retry.body.available, true);
  assert.equal(calls.length, 1);
});

test('an upstream 500 is a failure, not an empty price', async () => {
  process.env.PRICES_ENABLED = 'true';
  stubFetch({}, { ok: false });
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '1007' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices`);
  assert.deepEqual(res.body, { available: false });
});

test('a game nobody stocks is a settled answer and IS cached', async () => {
  process.env.PRICES_ENABLED = 'true';
  const calls = stubFetch({ currency: 'EUR', items: [] });
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '1008' });
  const path = `/api/rounds/${round.id}/games/${game.id}/prices`;
  assert.deepEqual((await request(app).get(path)).body, { available: false });
  await request(app).get(path);
  assert.equal(calls.length, 1);
});

test('a Steam wish is priced from price_overview', async () => {
  process.env.PRICES_ENABLED = 'true';
  const calls = stubFetch({
    77: { success: true, data: { name: 'Test', price_overview: { currency: 'EUR', initial: 5999, final: 2999, discount_percent: 50 } } },
  });
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceProvider: 'steam', sourceExternalId: '77' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=de`);
  assert.equal(res.body.available, true);
  assert.equal(res.body.source, 'steam');
  assert.equal(res.body.amount, 29.99);
  assert.equal(res.body.regular, 59.99);
  assert.equal(res.body.discountPercent, 50);
  // A digital purchase has no shipping, so the store price really is the total.
  assert.equal(res.body.shippingKnown, true);
  assert.equal(res.body.url, 'https://store.steampowered.com/app/77/');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith('https://store.steampowered.com/api/appdetails'));
});

test('a free Steam game shows nothing rather than 0,00 €', async () => {
  process.env.PRICES_ENABLED = 'true';
  stubFetch({ 78: { success: true, data: { name: 'Dota 2', is_free: true } } });
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceProvider: 'steam', sourceExternalId: '78' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices`);
  assert.deepEqual(res.body, { available: false });
});

test('a failing source is PAUSED, not re-asked on every page view', async () => {
  process.env.PRICES_ENABLED = 'true';
  process.env.PRICES_FAILURE_COOLDOWN_SECONDS = '60';
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error('ECONNRESET'); };
  const round = await createRound(request);
  // Four DIFFERENT games, i.e. four cache keys — a per-game cooldown would let
  // every one of them through and the count would be 4. The upstream is down for
  // all of them, so the pause has to be per SOURCE.
  const games = [];
  for (const eid of ['2001', '2002', '2003', '2004']) games.push(await addWish(round.id, { sourceExternalId: eid }));
  for (const g of games) {
    const res = await request(app).get(`/api/rounds/${round.id}/games/${g.id}/prices`);
    assert.deepEqual(res.body, { available: false });
  }
  assert.equal(calls, 1, 'the outage is discovered once, not once per wished game');
});

test('the cooldown is per SOURCE — Steam keeps answering while the aggregator is out', async () => {
  process.env.PRICES_ENABLED = 'true';
  process.env.PRICES_FAILURE_COOLDOWN_SECONDS = '60';
  const round = await createRound(request);
  const bgg = await addWish(round.id, { sourceExternalId: '2010' });
  const steam = await addWish(round.id, { sourceProvider: 'steam', sourceExternalId: '2011' });

  global.fetch = async () => { throw new Error('ECONNRESET'); };
  assert.deepEqual((await request(app).get(`/api/rounds/${round.id}/games/${bgg.id}/prices`)).body, { available: false });

  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    2011: { success: true, data: { price_overview: { currency: 'EUR', final: 1999, discount_percent: 0 } } },
  }) });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${steam.id}/prices`);
  assert.equal(res.body.available, true, 'one source failing must not silence the other');
  assert.equal(res.body.amount, 19.99);
});

test('a price we ALREADY HOLD keeps being served while its source is cooling', async () => {
  process.env.PRICES_ENABLED = 'true';
  process.env.PRICES_FAILURE_COOLDOWN_SECONDS = '60';
  const round = await createRound(request);
  const good = await addWish(round.id, { sourceExternalId: '2020' });
  const bad = await addWish(round.id, { sourceExternalId: '2021' });

  stubFetch(bgpBody('2020', [OFFER]));
  const first = await request(app).get(`/api/rounds/${round.id}/games/${good.id}/prices?lang=de`);
  assert.equal(first.body.available, true);

  // A different game fails and puts the whole source on cooldown.
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  await request(app).get(`/api/rounds/${round.id}/games/${bad.id}/prices?lang=de`);

  // The cached answer must survive it. Checking the cooldown BEFORE the cache
  // lookup would take the price away from the one game we could still answer.
  const again = await request(app).get(`/api/rounds/${round.id}/games/${good.id}/prices?lang=de`);
  assert.equal(again.body.available, true, 'a held price must outlive its source going down');
  assert.equal(again.body.amount, 49.89);
  assert.equal(again.body.fetchedAt, first.body.fetchedAt);
});

test('the cooldown is ON by default — not only when a test sets it', async () => {
  process.env.PRICES_ENABLED = 'true';
  // Drop this file's own override and drive the shipped default through the
  // real path; every other spec here pins it to 0, so nothing else can see it.
  delete process.env.PRICES_FAILURE_COOLDOWN_SECONDS;
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error('ECONNRESET'); };
  const round = await createRound(request);
  const a = await addWish(round.id, { sourceExternalId: '2030' });
  const b = await addWish(round.id, { sourceExternalId: '2031' });
  await request(app).get(`/api/rounds/${round.id}/games/${a.id}/prices`);
  await request(app).get(`/api/rounds/${round.id}/games/${b.id}/prices`);
  assert.equal(calls, 1, 'shipped default must pause the source, not retry per view');
});

test('the timeout sits ABOVE their gateway budget, so a 504 is reported not masked', () => {
  // Measured 2026-08-07 during a real outage: their edge returns 504 at ~10.1 s.
  // At 10 s ours fired first and the operator saw "This operation was aborted",
  // which names our timeout and hides theirs.
  assert.ok(require('../lib/prices/boardgameprices').TIMEOUT_MS > 10100);
});

test('the price TTL is an hour, and the shared provider TTL is untouched', () => {
  // The spec above proves that SOMETHING is cached; only these two numbers say
  // for how long. Their terms require at least an hour — and the shared hop
  // cache must stay at ten minutes, because raising it would hand BGG's
  // "queued, come back" collection answer an hour of life
  // (.claude/rules/bgg-collection-import.md §3).
  const HOUR = 60 * 60 * 1000;
  assert.ok(require('../lib/prices/boardgameprices').CACHE_TTL_MS >= HOUR);
  assert.ok(require('../lib/prices/steam').CACHE_TTL_MS >= HOUR);
  assert.equal(require('../lib/provider-cache').TTL_MS, 10 * 60 * 1000);
});

test('the round and the game still 404 honestly', async () => {
  process.env.PRICES_ENABLED = 'true';
  const round = await createRound(request);
  assert.equal((await request(app).get('/api/rounds/nope/games/x/prices')).status, 404);
  assert.equal((await request(app).get(`/api/rounds/${round.id}/games/nope/prices`)).status, 404);
});
