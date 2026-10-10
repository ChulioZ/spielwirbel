'use strict';

/* The price aggregator's BATCH lookup (#680), against a body captured live on
   2026-10-09 with two BGG ids in one request (Ark Nova 342942, Catan 13) and
   trimmed to a few editions — .claude/rules/wish-list-prices.md asks for a
   captured body, not a hand-written one, before anything parses it. */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const bgp = require('../lib/prices/boardgameprices');
const BODY = require('./fixtures/bgp-info-batch-2026-10-09.json');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

test('one request carries every id, and the answer is split back per game by external_id', async () => {
  const urls = [];
  global.fetch = async (url) => { urls.push(String(url)); return { ok: true, status: 200, json: async () => BODY }; };
  const { currency, byId } = await bgp.infoBatch(['342942', '13'], { destination: 'DE', currency: 'EUR' });
  assert.equal(urls.length, 1);
  const q = new URL(urls[0]).searchParams;
  assert.equal(q.get('eid'), '342942,13');
  assert.deepEqual([q.get('destination'), q.get('currency')], ['DE', 'EUR']);
  assert.equal(currency, 'EUR');
  assert.deepEqual([...byId.keys()], ['342942', '13']);
  assert.ok(byId.get('342942').every((it) => String(it.external_id) === '342942'));
  assert.ok(byId.get('13').every((it) => String(it.external_id) === '13'));
  assert.equal(byId.get('342942').length + byId.get('13').length, BODY.items.length, 'nothing dropped, nothing doubled');
});

test('each slice is priced exactly as the detail page prices one game', async () => {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => BODY });
  const market = { destination: 'DE', currency: 'EUR' };
  const { currency, byId } = await bgp.infoBatch(['342942', '13'], market);
  // Ark Nova has a German edition in the body, so a DE watch prices that box.
  const ark = bgp.priceFromItems(byId.get('342942'), { want: 'DE', market, currency });
  assert.equal(ark.edition.lang, 'DE');
  const single = bgp.parseInfo({ currency, items: byId.get('342942') }, { want: 'DE', destination: 'DE' });
  assert.equal(ark.amount, single.best.amount, 'the same offer the single lookup would quote');
  // Catan's captured slice has no German edition: the most-offers fallback.
  const catan = bgp.priceFromItems(byId.get('13'), { want: 'DE', market, currency });
  assert.ok(catan && catan.amount > 0);
  // An id the body does not mention is no price, not a crash.
  assert.equal(bgp.priceFromItems([], { want: 'DE', market, currency }), null);
});

test('a failed batch throws, so the job can tell a failed day from an empty one', async () => {
  global.fetch = async () => ({ ok: false, status: 504, json: async () => ({}) });
  await assert.rejects(bgp.infoBatch(['1'], { destination: 'DE', currency: 'EUR' }), /504/);
});
