'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, store, createRound } = require('./helpers');

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
  delete process.env.PRICES_FALLBACK_MAX_AGE_DAYS;
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

test('a game nobody stocks is a settled answer and IS cached — marked as such (#707)', async () => {
  process.env.PRICES_ENABLED = 'true';
  const calls = stubFetch({ currency: 'EUR', items: [] });
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '1008' });
  const path = `/api/rounds/${round.id}/games/${game.id}/prices`;
  // The marker is what lets the client SAY "no price available" — a claim it may
  // make only for a settled answer, never for an unreachable upstream.
  assert.deepEqual((await request(app).get(path)).body, { available: false, reason: 'no_offers' });
  await request(app).get(path);
  assert.equal(calls.length, 1);
});

// #744 retired lib/prices/steam.js, so `bgg -> boardgameprices` is the whole
// SOURCES map. A Steam-linked wish is now simply a game whose provider has no
// price source — the already-handled "nothing to fetch" path, pinned below
// alongside the hand-typed wish rather than as a case of its own.
test('a wish linked to a RETIRED provider has no price source and makes no request', async () => {
  process.env.PRICES_ENABLED = 'true';
  let called = false;
  global.fetch = async () => { called = true; throw new Error('must not be contacted'); };
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '99' });
  // Rewritten in the store past the route's validation, exactly as a pre-#744
  // row still sits there — POST would no longer mint this link.
  const stored = store.findRound(round.id).games.find((g) => g.id === game.id);
  stored.source = { provider: 'steam', externalId: '477160', url: null };
  store.saveData();

  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices`);
  assert.deepEqual(res.body, { available: false });
  assert.equal(called, false);
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

/*
 * There WAS a spec here proving the cooldown is keyed per SOURCE rather than
 * globally — Steam answering while the aggregator was out. #744 left one price
 * source, so those two implementations are now behaviourally identical and no
 * test can tell them apart; writing one anyway would be green against either.
 *
 * The half that IS still observable is covered by the spec above: four games,
 * one upstream call, which is what separates per-source from per-GAME. The
 * per-source-vs-global distinction becomes testable again the day a second
 * source is added, and that is when the spec should come back.
 */

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
  assert.equal(require('../lib/provider-cache').TTL_MS, 10 * 60 * 1000);
});

/*
 * The stored last-known price (#688).
 *
 * These specs seed `last_prices` DIRECTLY rather than fetching twice, and that is
 * not a shortcut — it is the only way to reach the fallback at all. A successful
 * fetch fills the hour-long in-memory cache, which is served ahead of the
 * fallback by design, so a second request in the same spec can never get past it.
 * Seeding the row and then failing the fetch is also the exact production
 * scenario this feature exists for: the process restarted (cache empty, row
 * still there) and the upstream is down.
 */
const repo = require('../lib/repo');
const bgp = require('../lib/prices/boardgameprices');
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// What the source itself would key this lookup under. Taken from the source
// rather than spelled out here: a hand-written key would pass whatever the
// implementation did, which is the hand-copied-constant trap
// (.claude/rules/shared-constants-across-the-stack.md).
const storedPrice = (eid, lang, over = {}) => repo.putLastPrice(bgp.cacheKey(eid, lang), {
  available: true, source: 'boardgameprices', currency: 'EUR', amount: 51.5,
  shippingKnown: true, country: 'DE', fetchedAt: isoAgo(2 * DAY), ...over,
});

test('a successful lookup remembers the price for the next outage', async () => {
  process.env.PRICES_ENABLED = 'true';
  stubFetch(bgpBody('3001', [OFFER]));
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '3001' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=de`);
  assert.equal(res.body.available, true);

  const row = await repo.getLastPrice(bgp.cacheKey('3001', 'de'));
  assert.ok(row, 'a served price must be written through, or there is no fallback later');
  assert.equal(row.price.amount, 49.89);
  assert.equal(row.fetchedAt, res.body.fetchedAt, 'the stored row keeps the RETRIEVAL time');
  assert.equal(row.price.stale, undefined, 'freshness is decided on read, never baked into the row');
});

test('a stored price answers while the source is down — labelled stale', async () => {
  process.env.PRICES_ENABLED = 'true';
  await storedPrice('3002', 'de', { amount: 51.5, fetchedAt: isoAgo(3 * DAY) });
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '3002' });

  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=de`);
  assert.equal(res.body.available, true, 'a wish must not go blank just because the upstream is out');
  assert.equal(res.body.amount, 51.5);
  assert.equal(res.body.stale, true, 'the renderer leads with the age only when this flag says to');
  // The ORIGINAL retrieval time, not now: the age is the whole disclosure, so
  // re-stamping it here would present a three-day-old price as current.
  assert.ok(Date.now() - new Date(res.body.fetchedAt).getTime() > 2 * DAY);
});

test('a stored price past the display ceiling shows NOTHING, not something misleading', async () => {
  process.env.PRICES_ENABLED = 'true';
  await storedPrice('3003', 'de', { fetchedAt: isoAgo(8 * DAY) });
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '3003' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=de`);
  assert.deepEqual(res.body, { available: false }, 'eight days is past the seven-day ceiling');
});

test('the ceiling is tunable, and refuses a value that would disable the fallback', async () => {
  process.env.PRICES_ENABLED = 'true';
  process.env.PRICES_FALLBACK_MAX_AGE_DAYS = '1';
  await storedPrice('3004', 'de', { fetchedAt: isoAgo(2 * DAY) });
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '3004' });
  assert.deepEqual(
    (await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=de`)).body,
    { available: false }, 'two days is past a one-day ceiling'
  );

  // A zero or negative ceiling would silently switch the feature off through a
  // config typo — the shipped default is used instead.
  const prices = require('../lib/prices');
  process.env.PRICES_FALLBACK_MAX_AGE_DAYS = '0';
  assert.equal(prices.maxAgeDays(), prices.DEFAULT_MAX_AGE_DAYS);
  process.env.PRICES_FALLBACK_MAX_AGE_DAYS = '-3';
  assert.equal(prices.maxAgeDays(), prices.DEFAULT_MAX_AGE_DAYS);
});

test('the shipped ceiling is seven days — read without a test setting it', () => {
  // Every spec above either sets the env or relies on the default implicitly, so
  // none of them can see a wrong default
  // (.claude/rules/break-the-code-on-purpose.md).
  delete process.env.PRICES_FALLBACK_MAX_AGE_DAYS;
  const prices = require('../lib/prices');
  assert.equal(prices.DEFAULT_MAX_AGE_DAYS, 7);
  assert.equal(prices.maxAgeDays(), 7);
});

test('a LIVE lookup always wins — the stored price is a fallback, never a substitute', async () => {
  process.env.PRICES_ENABLED = 'true';
  await storedPrice('3005', 'de', { amount: 99.99, fetchedAt: isoAgo(2 * HOUR) });
  stubFetch(bgpBody('3005', [OFFER]));
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '3005' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=de`);
  assert.equal(res.body.amount, 49.89, 'the fresh answer, not the two-hour-old one');
  assert.equal(res.body.stale, undefined);

  // …and the successful lookup overwrote the row rather than leaving the old
  // value to be served at the next outage.
  assert.equal((await repo.getLastPrice(bgp.cacheKey('3005', 'de'))).price.amount, 49.89);
});

test('"nobody stocks this" is a settled answer and is NOT overridden by a stored price', async () => {
  process.env.PRICES_ENABLED = 'true';
  await storedPrice('3006', 'de', { amount: 12.34, fetchedAt: isoAgo(HOUR) });
  stubFetch({ currency: 'EUR', items: [] });
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '3006' });
  // The upstream answered successfully; it simply has no offer. Serving last
  // week's price here would contradict fresh data rather than survive an outage.
  assert.deepEqual(
    (await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=de`)).body,
    { available: false, reason: 'no_offers' }
  );
});

test('a cooling source still answers from the stored price', async () => {
  process.env.PRICES_ENABLED = 'true';
  process.env.PRICES_FAILURE_COOLDOWN_SECONDS = '60';
  const round = await createRound(request);
  const trigger = await addWish(round.id, { sourceExternalId: '3007' });
  const held = await addWish(round.id, { sourceExternalId: '3008' });
  await storedPrice('3008', 'de', { amount: 33.3, fetchedAt: isoAgo(5 * HOUR) });

  // One failure pauses the whole source; the second game is never even asked.
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error('ECONNRESET'); };
  await request(app).get(`/api/rounds/${round.id}/games/${trigger.id}/prices?lang=de`);

  const res = await request(app).get(`/api/rounds/${round.id}/games/${held.id}/prices?lang=de`);
  assert.equal(calls, 1, 'the source is paused, so this answer came from storage alone');
  assert.equal(res.body.amount, 33.3);
  assert.equal(res.body.stale, true);
});

test('the stored price is keyed per MARKET — a British reader gets no German fallback', async () => {
  process.env.PRICES_ENABLED = 'true';
  await storedPrice('3009', 'de', { amount: 44.4 });
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '3009' });
  // Same game, different market and edition — a key built from the game id alone
  // would serve the German box's euro price to a reader shopping in pounds.
  assert.deepEqual(
    (await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=en`)).body,
    { available: false }
  );
  assert.equal((await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=de`)).body.amount, 44.4);
});

test('the stored price is keyed per EDITION too, not just per market', async () => {
  process.env.PRICES_ENABLED = 'true';
  await storedPrice('3012', 'de', { amount: 49.89 });
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '3012' });

  // A French reader falls back to the deployment market, so 'fr' and 'de' share
  // a destination AND a currency — and are shown DIFFERENT editions at different
  // prices. This is the case a (source, externalId, destination, currency) key
  // cannot see: it would hand the French reader the German box's price with
  // nothing anywhere to indicate the substitution. Storing under the source's own
  // cache key, which already carries the edition, is what makes it impossible.
  assert.deepEqual(
    (await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=fr`)).body,
    { available: false }
  );
});

test('the scheduled sweep deletes what can no longer be shown, and keeps what can', async () => {
  // Driven through runJob, not through prices.purgeStoredPrices(), so the spec
  // covers the SCHEDULER WIRING as well as the sweep — calling the function
  // directly stays green with the JOBS entry deleted, i.e. with nothing ever
  // running it in production.
  const { runJob } = require('../lib/scheduler');
  const live = bgp.cacheKey('3010', 'de');
  const dead = bgp.cacheKey('3011', 'de');
  await storedPrice('3010', 'de', { fetchedAt: isoAgo(2 * DAY) });
  await storedPrice('3011', 'de', { fetchedAt: isoAgo(9 * DAY) });

  // Note PRICES_ENABLED is unset here, and the job must run anyway: rows written
  // while the feature was on still have to be cleaned up after it is switched
  // off, or retention.md's line about them is false.
  assert.equal(process.env.PRICES_ENABLED, undefined);
  const removed = await runJob('purgeStoredPrices');
  assert.ok(removed >= 1, 'a disabled feature must not strand its rows forever');
  assert.equal(await repo.getLastPrice(dead), null, 'a row past the ceiling is unusable, so it goes');
  assert.ok(await repo.getLastPrice(live), 'a row still inside the ceiling must survive the sweep');
});

test('the round and the game still 404 honestly', async () => {
  process.env.PRICES_ENABLED = 'true';
  const round = await createRound(request);
  assert.equal((await request(app).get('/api/rounds/nope/games/x/prices')).status, 404);
  assert.equal((await request(app).get(`/api/rounds/${round.id}/games/nope/prices`)).status, 404);
});

/*
 * The stored-only fast path (#707): `?stored=1`, the first leg of the client's
 * stale-while-revalidate race. Its whole value is being instant and inert, so
 * what these specs pin hardest is what it must NOT do: fetch, cache, cool, or
 * write. Every fetch stub here would answer happily — a call count above zero is
 * the failure, not a broken stub.
 */

test('?stored=1 answers the stored row instantly — and asks nothing upstream', async () => {
  process.env.PRICES_ENABLED = 'true';
  await storedPrice('4001', 'de', { amount: 41.5, fetchedAt: isoAgo(2 * DAY) });
  const calls = stubFetch(bgpBody('4001', [OFFER]));
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '4001' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=de&stored=1`);
  assert.equal(res.body.available, true);
  assert.equal(res.body.amount, 41.5);
  assert.equal(res.body.stale, true, 'a stored price is always age-labelled, on this path too');
  assert.deepEqual(calls, [], 'the fast path must never fetch');
});

test('?stored=1 fills no cache and cools nothing — the full lookup after it still fetches fresh', async () => {
  process.env.PRICES_ENABLED = 'true';
  await storedPrice('4002', 'de', { amount: 33.0, fetchedAt: isoAgo(2 * DAY) });
  const calls = stubFetch(bgpBody('4002', [OFFER]));
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '4002' });
  const path = `/api/rounds/${round.id}/games/${game.id}/prices?lang=de`;
  await request(app).get(`${path}&stored=1`);
  assert.deepEqual(calls, []);
  // The live request right after is untouched by the fast read: it fetches (so
  // nothing was cached), answers fresh (so no cooldown was set), and overwrites
  // the row as any success does.
  const live = await request(app).get(path);
  assert.equal(calls.length, 1, 'the stored read must not have primed the cache');
  assert.equal(live.body.amount, 49.89);
  assert.equal(live.body.stale, undefined);
  const bgpRepo = require('../lib/prices/boardgameprices');
  assert.equal((await repo.getLastPrice(bgpRepo.cacheKey('4002', 'de'))).price.amount, 49.89);
});

test('?stored=1 past the display ceiling shows NOTHING — the lastKnown gate holds here too', async () => {
  process.env.PRICES_ENABLED = 'true';
  await storedPrice('4003', 'de', { fetchedAt: isoAgo(8 * DAY) });
  const calls = stubFetch(bgpBody('4003', [OFFER]));
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '4003' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=de&stored=1`);
  assert.deepEqual(res.body, { available: false }, 'eight days is past the seven-day ceiling');
  assert.deepEqual(calls, []);
});

test('?stored=1 with nothing stored is a plain unavailable — never a no_offers claim', async () => {
  process.env.PRICES_ENABLED = 'true';
  const calls = stubFetch(bgpBody('4004', [OFFER]));
  const round = await createRound(request);
  const game = await addWish(round.id, { sourceExternalId: '4004' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${game.id}/prices?lang=de&stored=1`);
  assert.deepEqual(res.body, { available: false });
  assert.deepEqual(calls, []);
});

test('the gates stay in front of ?stored=1: disabled 404s, a shelf game gets nothing', async () => {
  // PRICES_ENABLED unset → the same 404 as the full path, before any read.
  const round = await createRound(request);
  const wish = await addWish(round.id, { sourceExternalId: '4005' });
  const off = await request(app).get(`/api/rounds/${round.id}/games/${wish.id}/prices?lang=de&stored=1`);
  assert.equal(off.status, 404);
  assert.equal(off.body.error, 'prices_disabled');

  process.env.PRICES_ENABLED = 'true';
  await storedPrice('4006', 'de', { fetchedAt: isoAgo(2 * DAY) });
  const shelf = await addWish(round.id, { sourceExternalId: '4006', wish: 'false' });
  const res = await request(app).get(`/api/rounds/${round.id}/games/${shelf.id}/prices?lang=de&stored=1`);
  assert.deepEqual(res.body, { available: false }, 'the wish-only guard holds for the fast path');
});
