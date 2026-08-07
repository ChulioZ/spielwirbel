'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const bgp = require('../lib/prices/boardgameprices');

/*
 * PROVENANCE: captured live on 2026-08-07 from
 *   https://boardgameprices.co.uk/api/info?eid=342942&currency=EUR&destination=DE&sitename=spielwirbel.app
 * (Ark Nova, BGG id 342942), with each item's `prices` array trimmed. Every row
 * below is verbatim from that response — the numbers, the `shipping` string/number
 * split, the four `stock` spellings and the one `shipping_known: false` offer are
 * all real, which is the point: a hand-written body would have agreed with
 * whatever the parser assumed (.claude/rules/storefront-lookup-locale.md
 * "Fixtures cannot answer the questions above").
 *
 * Three properties of the real body the fixture preserves deliberately:
 *  - ONE BGG id returns TEN items, one per language edition, GB first.
 *  - The two selection rules DISAGREE here, which is what makes either of them
 *    testable: GB is items[0] but carries 6 offers, DE carries 8. So "the
 *    reader's language" and "the most offers" pick different editions, and
 *    neither picks items[0] by accident. (Live the GB edition has the most, 57
 *    to 17 — the counts are inverted here on purpose.)
 *  - The GB item's cheapest offer overall (48.28) is an unknown-shipping one, so
 *    a naive "cheapest price wins" presents a number that is not a total.
 */
const ARK_NOVA = {
  currency: 'EUR',
  sitename: 'Brettspielpreise.de',
  url: 'https://brettspielpreise.de',
  items: [
    {
      id: 40549,
      name: 'Ark Nova',
      url: 'https://brettspielpreise.de/item/show/40549/ark-nova?utm_source=site_spielwirbel.app',
      versions: { lang: ['GB'] },
      external_id: '342942',
      prices: [
        { link: 'https://brettspielpreise.de/item/go?storeitemid=3138559', price: 55.17, product: 55.17, shipping: '0.00', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'DE' },
        { link: 'https://brettspielpreise.de/item/go?storeitemid=3915596', price: 62.95, product: 62.95, shipping: '0.00', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'DE' },
        // Cheapest of the whole GB edition — and NOT a total (shipping unknown).
        { link: 'https://brettspielpreise.de/item/go?storeitemid=3378129', price: 48.28, product: 48.28, shipping: 0, discount: null, fee: 0, stock: 'Y', shipping_known: false, country: 'DE' },
        { link: 'https://brettspielpreise.de/item/go?storeitemid=5961933', price: 58.79, product: 53.8, shipping: '4.99', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'DK' },
        { link: 'https://brettspielpreise.de/item/go?storeitemid=6760827', price: 62, product: 47, shipping: '15.00', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'LV' },
        { link: 'https://brettspielpreise.de/item/go?storeitemid=7021467', price: 66.48, product: 55.99, shipping: '10.49', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'GB' },
      ],
    },
    {
      id: 42840,
      name: 'Arche Nova',
      url: 'https://brettspielpreise.de/item/show/42840/arche-nova?utm_source=site_spielwirbel.app',
      versions: { lang: ['DE'] },
      external_id: '342942',
      prices: [
        { link: 'https://brettspielpreise.de/item/go?storeitemid=3138540', price: 49.89, product: 44.99, shipping: '4.90', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'DE' },
        { link: 'https://brettspielpreise.de/item/go?storeitemid=3138352', price: 54.95, product: 54.95, shipping: '0.00', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'DE' },
        // Floating-point noise straight from the wire: 64.9 + 4.95.
        { link: 'https://brettspielpreise.de/item/go?storeitemid=5390090', price: 69.85000000000001, product: 64.9, shipping: '4.95', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'DE' },
        { link: 'https://brettspielpreise.de/item/go?storeitemid=3145510', price: 66.8, product: 53.9, shipping: '12.90', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'AT' },
        { link: 'https://brettspielpreise.de/item/go?storeitemid=4081528', price: 130.61, product: 69.59, shipping: '61.02', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'CH' },
        // The three non-'Y' stock spellings, all cheaper than the winner above.
        { link: 'https://brettspielpreise.de/item/go?storeitemid=3139920', price: 44.89, product: 39.99, shipping: '4.90', discount: null, fee: 0, stock: '?', shipping_known: true, country: 'DE' },
        { link: 'https://brettspielpreise.de/item/go?storeitemid=3136733', price: 45.99, product: 45.99, shipping: '0.00', discount: null, fee: 0, stock: 'N', shipping_known: true, country: 'DE' },
        { link: 'https://brettspielpreise.de/item/go?storeitemid=3416301', price: 46.5, product: 44, shipping: '2.50', discount: null, fee: 0, stock: ' ', shipping_known: true, country: 'DE' },
      ],
    },
    { id: 42841, name: 'Ark Nova', url: 'https://brettspielpreise.de/item/show/42841/ark-nova', versions: { lang: ['NL'] }, external_id: '342942', prices: [] },
    { id: 42842, name: 'Ark Nova', url: 'https://brettspielpreise.de/item/show/42842/ark-nova', versions: { lang: ['FR'] }, external_id: '342942', prices: [] },
    { id: 42843, name: 'Ark Nova', url: 'https://brettspielpreise.de/item/show/42843/ark-nova', versions: { lang: ['ES'] }, external_id: '342942', prices: [] },
    { id: 42844, name: 'Ark Nova', url: 'https://brettspielpreise.de/item/show/42844/ark-nova', versions: { lang: ['IT'] }, external_id: '342942', prices: [] },
    { id: 42845, name: 'Ark Nova', url: 'https://brettspielpreise.de/item/show/42845/ark-nova', versions: { lang: ['PL'] }, external_id: '342942', prices: [] },
    { id: 67003, name: 'Ark Nova', url: 'https://brettspielpreise.de/item/show/67003/ark-nova', versions: { lang: ['FI'] }, external_id: '342942', prices: [] },
    { id: 68962, name: 'Ark Nova', url: 'https://brettspielpreise.de/item/show/68962/ark-nova', versions: { lang: ['HU'] }, external_id: '342942', prices: [] },
    { id: 69172, name: 'Archa Nova', url: 'https://brettspielpreise.de/item/show/69172/archa-nova', versions: { lang: ['CZ'] }, external_id: '342942', prices: [] },
  ],
};

const de = () => bgp.parseInfo(ARK_NOVA, { lang: 'de', destination: 'DE' });

test('the reader\'s language edition wins — NOT items[0]', () => {
  const out = de();
  assert.equal(out.edition.title, 'Arche Nova');
  assert.equal(out.edition.lang, 'DE');
  // The live body puts the GB edition first and it has 3.3x the offers, so both
  // "first" and "most offers" are wrong answers for a German reader.
  assert.notEqual(out.edition.title, ARK_NOVA.items[0].name);
  assert.equal(out.itemUrl, ARK_NOVA.items[1].url);
});

test('an unmapped language falls back to the edition with the most offers', () => {
  const out = bgp.parseInfo(ARK_NOVA, { lang: 'sv', destination: 'DE' });
  assert.equal(out.edition.lang, 'DE');
  assert.equal(out.offerCount, 8);
  // Not items[0], which is the whole reason the fallback is a rule and not the
  // array order.
  assert.notEqual(out.edition.lang, ARK_NOVA.items[0].versions.lang[0]);
});

test('a matching language beats a bigger edition', () => {
  // The DE edition carries more offers (8 vs 6), so an English reader landing on
  // the GB edition proves the language rule ran and won — the fallback would
  // have answered 'DE' here.
  const out = bgp.parseInfo(ARK_NOVA, { lang: 'en', destination: 'DE' });
  assert.equal(out.edition.lang, 'GB');
  assert.equal(out.offerCount, 6);
});

test('the best offer is the cheapest IN-STOCK one, as a total including shipping', () => {
  const { best } = de();
  assert.equal(best.amount, 49.89);
  assert.equal(best.product, 44.99);
  assert.equal(best.shipping, 4.9);
  assert.equal(best.shippingKnown, true);
  assert.equal(best.country, 'DE');
  assert.equal(best.link, 'https://brettspielpreise.de/item/go?storeitemid=3138540');
});

test('an out-of-stock offer never wins, whichever of the three spellings it uses', () => {
  const { best, offerCount, inStockCount } = de();
  // '?', 'N' and ' ' are all cheaper than the 49.89 winner in this fixture, so a
  // ranking that ignored stock would pick 44.89 and send the user to a shop that
  // has not got the game.
  assert.ok(best.amount < 50, 'sanity: the winner is the cheap end of the list');
  assert.equal(best.amount, 49.89);
  assert.equal(offerCount, 8);
  assert.equal(inStockCount, 5);
});

test('an unknown-shipping offer never wins on price it cannot claim', () => {
  // The GB edition's cheapest offer (48.28) has shipping_known: false, so its
  // "price" is the product price wearing a total's clothes. PAngV § 3/§ 6: we may
  // not present it as an inclusive price, so it must not outrank a real total.
  const { best } = bgp.parseInfo(ARK_NOVA, { lang: 'en', destination: 'DE' });
  assert.equal(best.shippingKnown, true);
  assert.equal(best.amount, 55.17);
});

test('when NO in-stock offer knows its shipping, the winner says so and shows the product price', () => {
  const body = {
    currency: 'EUR',
    items: [{
      id: 1, name: 'Nur Unbekannt', url: 'https://example.invalid/i/1', versions: { lang: ['DE'] },
      prices: [
        { link: 'https://example.invalid/go/1', price: 35.99, product: 35.99, shipping: 0, stock: 'Y', shipping_known: false, country: 'GR' },
        { link: 'https://example.invalid/go/2', price: 31.5, product: 31.5, shipping: 0, stock: 'N', shipping_known: false, country: 'GR' },
      ],
    }],
  };
  const { best } = bgp.parseInfo(body, { lang: 'de', destination: 'DE' });
  assert.equal(best.shippingKnown, false);
  assert.equal(best.amount, 35.99);
  assert.equal(best.country, 'GR');
});

test('totals are rounded — the wire carries binary float noise', () => {
  const out = bgp.parseInfo(ARK_NOVA, { lang: 'de', destination: 'DE' });
  const noisy = out.offers.find((o) => o.product === 64.9);
  assert.equal(noisy.amount, 69.85);
});

test('a body with no items at all is not a price', () => {
  // What the API answers for an eid it does not know: a clean 200, items: [].
  assert.equal(bgp.parseInfo({ currency: 'EUR', items: [] }, { lang: 'de', destination: 'DE' }), null);
});

test('an edition with no offers at all is not a price', () => {
  const body = { currency: 'EUR', items: [{ id: 1, name: 'Leer', versions: { lang: ['DE'] }, prices: [] }] };
  assert.equal(bgp.parseInfo(body, { lang: 'de', destination: 'DE' }), null);
});

test('a malformed body degrades to null instead of throwing', () => {
  for (const body of [null, undefined, {}, 'nope', 42, { items: 'nope' }, { items: [null] }, { items: [{}] }]) {
    assert.equal(bgp.parseInfo(body, { lang: 'de', destination: 'DE' }), null, `body: ${JSON.stringify(body)}`);
  }
});

test('the request is built from an ALLOWLIST — a request value never reaches the URL', () => {
  // destination and currency land in a fetched URL's query string, i.e. the
  // resolveLocale shape in .claude/rules/storefront-lookup-locale.md §1.
  assert.deepEqual(bgp.resolveMarket('de'), { destination: 'DE', currency: 'EUR' });
  // Eurozone locales the UI may ship later must NOT inherit English's GB/GBP —
  // a French reader is served by German shops in euros, not by British ones in
  // pounds. They fall through to the deployment default.
  assert.deepEqual(bgp.resolveMarket('fr'), { destination: 'DE', currency: 'EUR' });
  assert.deepEqual(bgp.resolveMarket('en'), { destination: 'GB', currency: 'GBP' });
  for (const hostile of ['__proto__', 'constructor', '../../etc/passwd', 'de&destination=XX', null, undefined, 7]) {
    const m = bgp.resolveMarket(hostile);
    assert.ok(bgp.DESTINATIONS.includes(m.destination), `destination escaped: ${m.destination}`);
    assert.ok(bgp.CURRENCIES.includes(m.currency), `currency escaped: ${m.currency}`);
  }
});
