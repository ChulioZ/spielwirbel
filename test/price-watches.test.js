'use strict';

/*
 * Price watches (issue #680): the account's watch API and the daily job.
 *
 * A watch belongs to the ACCOUNT and a BGG id; the job checks each at most once
 * a day in BATCHED upstream requests, claims each watch before acting so two
 * overlapping processes cannot notify twice, and writes an inbox item — never a
 * mail — when the price is at or below the threshold under the rule in
 * lib/price-watches.js. The upstream is stubbed at `fetch`, answering per `eid`.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, store } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');
const { runJob } = require('../lib/scheduler');
const { checkPriceWatches, decideWatch, CHECK_EVERY_MS, RETRY_AFTER_MS } = require('../lib/price-watches');

const PASSWORD = 'correct horse battery';
const handle = (email) => email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');
const auth = (token) => ({ Authorization: `Bearer ${token}` });
let n = 0;
async function account(tag) {
  const email = `pw-${tag}-${(n += 1)}@example.com`;
  await request(app).post('/api/account/register').send({ email, username: handle(email), password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}
const watch = (acct, body) => request(app).post('/api/price-watches').set(auth(acct.token))
  .send({ title: 'Arche Nova', thresholdCents: 4000, lang: 'de', ...body });
const list = (acct) => request(app).get('/api/price-watches').set(auth(acct.token));

// The upstream, answering per `eid`: the price each game costs today (null = no
// in-stock offer), every call recorded.
let priceOf = {};
let calls = [];
let failing = false;
const realFetch = global.fetch;
beforeEach(() => {
  process.env.PRICES_ENABLED = 'true';
  priceOf = {};
  calls = [];
  failing = false;
  // Every spec starts with nobody's watches due but its own.
  store.data.priceWatches.length = 0;
  global.fetch = async (url) => {
    calls.push(String(url));
    if (failing) return { ok: false, status: 504, json: async () => ({}) };
    const ids = new URL(url).searchParams.get('eid').split(',');
    const items = ids.flatMap((eid) => (priceOf[eid] == null ? [] : [{
      id: Number(eid), name: `Spiel ${eid}`, url: `https://brettspielpreise.de/item/show/${eid}/x`,
      versions: { lang: ['DE'] }, external_id: eid,
      prices: [{ link: 'https://brettspielpreise.de/item/go?x=1', price: priceOf[eid], product: priceOf[eid] - 4.9, shipping: '4.90', stock: 'Y', shipping_known: true, country: 'DE' }],
    }]));
    return { ok: true, status: 200, json: async () => ({ currency: new URL(url).searchParams.get('currency'), items }) };
  };
});
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.PRICES_ENABLED;
  delete process.env.MAX_PRICE_WATCHES_PER_USER;
});

const priceItems = (uid) => store.data.inbox.filter((it) => it.userId === uid && it.type === 'price_drop');
const DAY = 24 * 60 * 60 * 1000;

test('setting a watch stores the market and edition it was set with; a second set changes the threshold', async () => {
  const anna = await account('anna');
  const res = await watch(anna, { externalId: '342942', editionLanguages: ['German'] });
  assert.equal(res.status, 201);
  assert.equal(res.body.watch.currency, 'EUR');
  assert.equal(res.body.watch.destination, 'DE');
  assert.equal(res.body.watch.editionLang, 'DE');

  const again = await watch(anna, { externalId: '342942', thresholdCents: 3500, lang: 'en' });
  assert.equal(again.status, 200);
  assert.equal(again.body.updated, true);
  assert.equal(again.body.watch.thresholdCents, 3500);
  assert.equal(again.body.watch.currency, 'EUR', 'the market stays the one the watch was set with');
  assert.equal((await list(anna)).body.watches.length, 1, 'one watch per account and game');

  // English UI, no edition: the British market and the English box.
  const en = await watch(anna, { externalId: '13', lang: 'en', title: 'Catan' });
  assert.deepEqual([en.body.watch.destination, en.body.watch.currency, en.body.watch.editionLang], ['GB', 'GBP', 'GB']);
});

test('the quota refuses past the ceiling and removing a watch frees it', async () => {
  process.env.MAX_PRICE_WATCHES_PER_USER = '2';
  const ben = await account('ben');
  await watch(ben, { externalId: '1' });
  await watch(ben, { externalId: '2' });
  const third = await watch(ben, { externalId: '3' });
  assert.equal(third.status, 403);
  assert.equal(third.body.error, 'quota_price_watches');
  const [first] = (await list(ben)).body.watches;
  assert.equal((await request(app).delete(`/api/price-watches/${first.id}`).set(auth(ben.token))).status, 204);
  assert.equal((await watch(ben, { externalId: '3' })).status, 201);
});

test('a watch is its owner\'s alone, and bad input is refused', async () => {
  const cleo = await account('cleo');
  const dana = await account('dana');
  const { watch: w } = (await watch(cleo, { externalId: '7' })).body;
  assert.equal((await list(dana)).body.watches.length, 0);
  assert.equal((await request(app).patch(`/api/price-watches/${w.id}`).set(auth(dana.token)).send({ thresholdCents: 1 })).status, 404);
  assert.equal((await request(app).delete(`/api/price-watches/${w.id}`).set(auth(dana.token))).status, 404);
  assert.equal((await watch(cleo, { externalId: 'abc' })).status, 400);
  assert.equal((await watch(cleo, { externalId: '8', thresholdCents: 0 })).body.error, 'invalid_threshold');
  assert.equal((await request(app).get('/api/price-watches')).status, 401, 'an account is required');
});

test('prices off: the API does not exist and the job is inert', async () => {
  const emil = await account('emil');
  await watch(emil, { externalId: '9' });
  delete process.env.PRICES_ENABLED;
  assert.equal((await list(emil)).status, 404);
  assert.equal(await runJob('checkPriceWatches'), null);
  assert.equal(calls.length, 0);
});

test('a price at or below the threshold writes ONE inbox item and no mail, however often the job runs', async () => {
  const finn = await account('finn');
  await watch(finn, { externalId: '100', thresholdCents: 4000 });
  priceOf['100'] = 39.9;
  const mails = outbox.length;
  // Two processes in the same instant on a DUE watch, as during a deploy
  // overlap. Counted by notifications and fetches, not by inbox items: a newer
  // item replaces an older one, so an item count would hide a double notify.
  const pair = await Promise.all([checkPriceWatches(), checkPriceWatches()]);
  assert.equal(pair[0].notified + pair[1].notified, 1, 'exactly one process notified');
  await runJob('checkPriceWatches');
  const items = priceItems(finn.user.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].payload.amountCents, 3990);
  assert.equal(items[0].payload.thresholdCents, 4000);
  assert.equal(items[0].payload.title, 'Arche Nova');
  assert.match(items[0].payload.url, /^https:\/\/brettspielpreise\.de\//, 'the aggregator link their terms ask for');
  assert.ok(items[0].payload.observedAt, 'the item says when the price was seen');
  assert.equal(outbox.length, mails, 'no mail on any path');
  assert.equal(calls.length, 1, 'checked once, not once per run');
});

test('the dip rule: a lower price notifies again, the same or higher does not, rising above re-arms', async () => {
  const gina = await account('gina');
  await watch(gina, { externalId: '200', thresholdCents: 4000 });
  let now = Date.now();
  const day = async (price) => { priceOf['200'] = price; now += DAY; return checkPriceWatches({ now }); };

  assert.equal((await day(39)).notified, 1, 'first reading under the threshold');
  assert.equal((await day(39)).notified, 0, 'the same price, the same dip');
  assert.equal((await day(39.5)).notified, 0, 'higher, still under: not news');
  assert.equal((await day(35)).notified, 1, 'lower than reported: news');
  assert.equal((await day(45)).notified, 0, 'above the threshold re-arms');
  assert.equal((await day(38)).notified, 1, 'a new dip notifies, even above the last reported price');
  // One item at a time per watch: the newest replaced the older ones.
  const items = priceItems(gina.user.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].payload.amountCents, 3800);
});

test('upstream requests are batched per market, twenty games a request', async () => {
  const hans = await account('hans');
  process.env.MAX_PRICE_WATCHES_PER_USER = '50';
  for (let i = 1; i <= 25; i += 1) await watch(hans, { externalId: String(1000 + i) });
  await watch(hans, { externalId: '2001', lang: 'en' });
  const r = await runJob('checkPriceWatches');
  assert.equal(r.requests, 3, 'two DE/EUR chunks (20 + 5) and one GB/GBP');
  assert.equal(calls.length, 3);
  const eurCalls = calls.filter((u) => u.includes('currency=EUR'));
  assert.deepEqual(eurCalls.map((u) => new URL(u).searchParams.get('eid').split(',').length).sort((a, b) => a - b), [5, 20]);
});

test('a failed fetch writes nothing, keeps the watch, and retries after the pause — not on the next tick', async () => {
  const ida = await account('ida');
  await watch(ida, { externalId: '300', thresholdCents: 5000 });
  priceOf['300'] = 10;
  failing = true;
  const now = Date.now();
  const r = await checkPriceWatches({ now });
  assert.equal(r.failed, 1);
  assert.equal(priceItems(ida.user.id).length, 0, 'no item from a failed fetch');
  const [w] = store.data.priceWatches.filter((x) => x.userId === ida.user.id);
  assert.equal(w.lastCheckedAt, null, 'not counted as checked');
  failing = false;
  assert.equal((await checkPriceWatches({ now: now + 15 * 60 * 1000 })).claimed, 0, 'the next tick leaves it alone');
  assert.equal((await checkPriceWatches({ now: now + RETRY_AFTER_MS + 1000 })).notified, 1, 'the retry recovers');
});

test('a watch is due again only after the daily interval', async () => {
  const jan = await account('jan');
  await watch(jan, { externalId: '400' });
  priceOf['400'] = 99;
  const now = Date.now();
  assert.equal((await checkPriceWatches({ now })).checked, 1);
  assert.equal((await checkPriceWatches({ now: now + CHECK_EVERY_MS - 60000 })).due, 0);
  assert.equal((await checkPriceWatches({ now: now + CHECK_EVERY_MS + 60000 })).checked, 1);
});

test('nothing in stock is no reading; a new threshold re-arms the watch', async () => {
  const kim = await account('kim');
  const { watch: w } = (await watch(kim, { externalId: '500', thresholdCents: 3000 })).body;
  priceOf['500'] = 25;
  let now = Date.now();
  assert.equal((await checkPriceWatches({ now })).notified, 1);
  priceOf['500'] = null;
  now += DAY;
  assert.equal((await checkPriceWatches({ now })).notified, 0);
  assert.equal(store.data.priceWatches.find((x) => x.id === w.id).lastPrice, null);
  // Changing the threshold is a new question: the next reading under it notifies.
  await request(app).patch(`/api/price-watches/${w.id}`).set(auth(kim.token)).send({ thresholdCents: 2800 });
  priceOf['500'] = 25;
  now += DAY;
  assert.equal((await checkPriceWatches({ now })).notified, 1);
});

test('erasing the account takes its watches', async () => {
  const lea = await account('lea');
  await watch(lea, { externalId: '600' });
  assert.equal(store.data.priceWatches.filter((x) => x.userId === lea.user.id).length, 1);
  await repo.eraseAccount(lea.user.id);
  assert.equal(store.data.priceWatches.filter((x) => x.userId === lea.user.id).length, 0);
});

test('decideWatch, case by case', () => {
  const at = '2026-10-09T00:00:00.000Z';
  const w = (over) => ({ thresholdCents: 4000, armed: true, lastNotifiedPrice: null, ...over });
  const r = (amount) => ({ amount, currency: 'EUR', shippingKnown: true });
  assert.equal(decideWatch(w(), r(40), at).notify, true, 'AT the threshold counts');
  assert.equal(decideWatch(w(), r(40.01), at).notify, false);
  assert.equal(decideWatch(w({ armed: false, lastNotifiedPrice: 3900 }), r(39), at).notify, false);
  assert.equal(decideWatch(w({ armed: false, lastNotifiedPrice: 3900 }), r(38.99), at).notify, true);
  assert.equal(decideWatch(w({ armed: false }), r(41), at).patch.armed, true);
  assert.equal(decideWatch(w(), null, at).notify, false);
});

test('the search answers from BGG\'s search, mapped to what a watch needs', async (t) => {
  const bgg = require('../lib/providers').getProvider('bgg');
  const real = bgg.search;
  t.after(() => { bgg.search = real; });
  bgg.search = async () => [{ providerId: 342942, title: 'Arche Nova', year: 2021, thumbnail: null }];
  const mia = await account('mia');
  assert.deepEqual((await request(app).get('/api/price-watches/search?q=a').set(auth(mia.token))).body, { results: [] });
  const res = await request(app).get('/api/price-watches/search?q=arche-unique-q').set(auth(mia.token));
  assert.deepEqual(res.body.results, [{ externalId: '342942', title: 'Arche Nova', year: 2021 }]);
});

test('ending a watch removes its price message; saving the same threshold does not re-alert', async () => {
  const nina = await account('nina');
  const { watch: w } = (await watch(nina, { externalId: '700', thresholdCents: 3000 })).body;
  priceOf['700'] = 25;
  let now = Date.now();
  assert.equal((await checkPriceWatches({ now })).notified, 1);
  // Opening „Ändern" and saving the same value: still the same question.
  await request(app).patch(`/api/price-watches/${w.id}`).set(auth(nina.token)).send({ thresholdCents: 3000 });
  now += DAY;
  assert.equal((await checkPriceWatches({ now })).notified, 0);
  assert.equal(priceItems(nina.user.id).length, 1);
  await request(app).delete(`/api/price-watches/${w.id}`).set(auth(nina.token));
  assert.equal(priceItems(nina.user.id).length, 0);
});

test('one failed request ends the tick for the upstream: no chunk after it waits out the timeout', async () => {
  const otto = await account('otto');
  process.env.MAX_PRICE_WATCHES_PER_USER = '50';
  for (let i = 1; i <= 25; i += 1) await watch(otto, { externalId: String(3000 + i) });
  failing = true;
  const r = await checkPriceWatches();
  assert.equal(r.requests, 1);
  assert.equal(r.failed, 25);
});

test('a body in another currency changes nothing but the check time', async () => {
  const pia = await account('pia');
  const { watch: w } = (await watch(pia, { externalId: '800', thresholdCents: 9000 })).body;
  priceOf['800'] = 50;
  let now = Date.now();
  await checkPriceWatches({ now });
  const before = store.data.priceWatches.find((x) => x.id === w.id).lastPrice;
  const real = global.fetch;
  global.fetch = async (url) => { const r = await real(url); const body = await r.json(); return { ok: true, status: 200, json: async () => ({ ...body, currency: 'USD' }) }; };
  now += DAY;
  const r = await checkPriceWatches({ now });
  assert.equal(r.notified, 0);
  assert.deepEqual(store.data.priceWatches.find((x) => x.id === w.id).lastPrice, before, 'not „nicht vorrätig"');
});

test('a long game title is shortened, not refused', async () => {
  const quinn = await account('quinn');
  const res = await watch(quinn, { externalId: '900', title: 'x'.repeat(250) });
  assert.equal(res.status, 201);
  assert.equal(res.body.watch.title.length, 200);
});
