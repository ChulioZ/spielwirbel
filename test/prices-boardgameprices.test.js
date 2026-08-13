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

/*
 * PROVENANCE: captured live on 2026-08-09 from
 *   https://boardgameprices.co.uk/api/info?eid=241477&currency=EUR&destination=DE&sitename=spielwirbel.app
 * (Karak, BGG id 241477), trimmed to two of the seven items with a few verbatim
 * offers each. It preserves what ARK_NOVA cannot show — issue #700's bug: ONE
 * item can be MULTILINGUAL. items[0] carries versions.lang ["GB","DE","NL","FR",
 * "IT"], so a German reader is correctly matched to this item while langs[0]
 * says 'GB'. GB-first is the live order and load-bearing: put DE first and the
 * label assertion below is satisfied by array order, proving nothing (the same
 * anti-vacuous shape as ARK_NOVA's inverted offer counts).
 */
const KARAK = {
  currency: 'EUR',
  sitename: 'Brettspielpreise.de',
  url: 'https://brettspielpreise.de',
  items: [
    {
      id: 33256,
      name: 'Karak',
      url: 'https://brettspielpreise.de/item/show/33256/karak?utm_source=site_spielwirbel.app&utm_medium=cmsplugin&utm_content=getprice&utm_campaign=wpplugin',
      versions: { lang: ['GB', 'DE', 'NL', 'FR', 'IT'] },
      external_id: '241477',
      prices: [
        { link: 'https://brettspielpreise.de/item/go?source=A&storeitemid=3278790', price: 26.14, product: 26.14, shipping: '0.00', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'DE' },
        { link: 'https://brettspielpreise.de/item/go?source=A&storeitemid=5729988', price: 27.939999999999998, product: 22.99, shipping: '4.95', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'DE' },
        { link: 'https://brettspielpreise.de/item/go?source=A&storeitemid=6340820', price: 31, product: 26, shipping: '5.00', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'DE' },
        { link: 'https://brettspielpreise.de/item/go?source=A&storeitemid=4758400', price: 31.430000000000003, product: 27.29, shipping: '4.95', discount: 0.81, fee: 0, stock: 'Y', shipping_known: true, country: 'NL' },
      ],
    },
    {
      id: 62407,
      name: 'Karak',
      url: 'https://brettspielpreise.de/item/show/62407/karak?utm_source=site_spielwirbel.app&utm_medium=cmsplugin&utm_content=getprice&utm_campaign=wpplugin',
      versions: { lang: ['ES'] },
      external_id: '241477',
      prices: [
        { link: 'https://brettspielpreise.de/item/go?source=A&storeitemid=3862583', price: 43.45, product: 31.45, shipping: '12.00', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'ES' },
        { link: 'https://brettspielpreise.de/item/go?source=A&storeitemid=3736494', price: 43.99, product: 34.99, shipping: '9.00', discount: null, fee: 0, stock: 'Y', shipping_known: true, country: 'ES' },
      ],
    },
  ],
};

const de = () => bgp.parseInfo(ARK_NOVA, { want: 'DE', destination: 'DE' });

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
  const out = bgp.parseInfo(ARK_NOVA, { want: null, destination: 'DE' });
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
  const out = bgp.parseInfo(ARK_NOVA, { want: 'GB', destination: 'DE' });
  assert.equal(out.edition.lang, 'GB');
  assert.equal(out.offerCount, 6);
});

test('a multilingual listing is labelled with the language that MATCHED the reader', () => {
  // Issue #700: the price was right, the label was wrong — pickEdition matched
  // this item for a German reader via 'DE', but langs[0] is 'GB', so the box
  // said „Ausgabe: Karak (GB)" over the German-market offers.
  const out = bgp.parseInfo(KARAK, { want: 'DE', destination: 'DE' });
  assert.equal(out.edition.title, 'Karak');
  assert.equal(out.edition.lang, 'DE');
  assert.equal(out.best.amount, 26.14);
});

test('the label follows the reader — the SAME multilingual listing reads (GB) to an English reader', () => {
  const out = bgp.parseInfo(KARAK, { want: 'GB', destination: 'DE' });
  assert.equal(out.edition.lang, 'GB');
  assert.equal(out.offerCount, 4);
});

test('the most-offers fallback keeps the item\'s own first language', () => {
  // 'pt' maps to 'PT', which no Karak item carries, so the fallback picks the
  // multilingual item on offer count — and must NOT relabel it 'PT': no
  // reader-language edition existed, so langs[0] is the honest answer there.
  const out = bgp.parseInfo(KARAK, { want: 'PT', destination: 'DE' });
  assert.equal(out.edition.lang, 'GB');
  assert.equal(out.offerCount, 4);
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
  const { best } = bgp.parseInfo(ARK_NOVA, { want: 'GB', destination: 'DE' });
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
  const { best } = bgp.parseInfo(body, { want: 'DE', destination: 'DE' });
  assert.equal(best.shippingKnown, false);
  assert.equal(best.amount, 35.99);
  assert.equal(best.country, 'GR');
});

test('totals are rounded — the wire carries binary float noise', () => {
  const out = bgp.parseInfo(ARK_NOVA, { want: 'DE', destination: 'DE' });
  const noisy = out.offers.find((o) => o.product === 64.9);
  assert.equal(noisy.amount, 69.85);
});

test('a body with no items at all is not a price', () => {
  // What the API answers for an eid it does not know: a clean 200, items: [].
  assert.equal(bgp.parseInfo({ currency: 'EUR', items: [] }, { want: 'DE', destination: 'DE' }), null);
});

test('an edition with no offers at all is not a price', () => {
  const body = { currency: 'EUR', items: [{ id: 1, name: 'Leer', versions: { lang: ['DE'] }, prices: [] }] };
  assert.equal(bgp.parseInfo(body, { want: 'DE', destination: 'DE' }), null);
});

test('a malformed body degrades to null instead of throwing', () => {
  for (const body of [null, undefined, {}, 'nope', 42, { items: 'nope' }, { items: [null] }, { items: [{}] }]) {
    assert.equal(bgp.parseInfo(body, { want: 'DE', destination: 'DE' }), null, `body: ${JSON.stringify(body)}`);
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

test('a timeout is reported as OUR budget expiring, naming the source', async () => {
  // AbortError's own message is "This operation was aborted" — no source, no
  // budget, no cause. The operator reads this string in the admin panel's log,
  // and on 2026-08-07 it sent them looking at their own config and a redeploy
  // while the real cause was the upstream 504ing at 10.1 s.
  const realFetch = global.fetch;
  global.fetch = async () => { throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }); };
  try {
    await assert.rejects(
      bgp.price('342942', 'de'),
      (err) => err.message.includes('BoardGamePrices') && err.message.includes(String(bgp.TIMEOUT_MS))
    );
  } finally {
    global.fetch = realFetch;
  }
});

test('a non-abort failure keeps its own message', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 504 });
  try {
    // The whole point of the 12 s budget: their gateway error must reach the log
    // instead of being masked by our abort firing first.
    await assert.rejects(bgp.price('342942', 'de'), /BoardGamePrices responded 504/);
  } finally {
    global.fetch = realFetch;
  }
});

/* ---- which EDITION a lookup is about (#742): the box, not the reader -------- */

test('the game\'s stored edition beats the reader\'s locale', () => {
  // The whole of #742 in one line: a German-speaking round that wished for the
  // ENGLISH box was quoted the German one (49.89 € vs 55.17 € on Ark Nova), and
  // two members of one round saw different prices for the same wish purely
  // because they read the app in different languages.
  assert.equal(bgp.resolveEditionLang('de', ['English']), 'GB');
  assert.equal(bgp.resolveEditionLang('en', ['German']), 'DE');
});

test('with no stored edition it is still the reader\'s locale — today\'s behaviour', () => {
  // Every game whose cover predates #742, and every pasted or uploaded cover
  // after it. This arm is what makes the change invisible to them.
  assert.equal(bgp.resolveEditionLang('de', []), 'DE');
  assert.equal(bgp.resolveEditionLang('en', null), 'GB');
  assert.equal(bgp.resolveEditionLang('de', undefined), 'DE');
});

test('a printing the aggregator does not sell falls back to the reader, not to nothing', () => {
  // BGG names ~80 languages and the aggregator sells seven, so a Polish or
  // Japanese box is the ordinary case rather than an edge one — and it must keep
  // a working price box rather than emptying it.
  assert.equal(bgp.resolveEditionLang('de', ['Polish']), 'DE');
  assert.equal(bgp.resolveEditionLang('en', ['Japanese']), 'GB');
  // Neither maps: null, i.e. the most-offers edition.
  assert.equal(bgp.resolveEditionLang('sv', ['Polish']), null);
  assert.equal(bgp.resolveEditionLang(null, null), null);
});

test('a multilingual printing takes the FIRST language that maps', () => {
  // One BGG version legitimately lists several languages, and any of them
  // describes the same physical box.
  assert.equal(bgp.resolveEditionLang('de', ['Polish', 'French', 'German']), 'FR');
  assert.equal(bgp.resolveEditionLang('de', ['Czech', 'Polish']), 'DE', 'none map -> the reader');
});

test('the language table is an ALLOWLIST, and BGG\'s capitalisation is not the contract', () => {
  // The value it yields lands in a cache key and decides which edition a fetched
  // body is read as (.claude/rules/allowlist-request-values-that-reach-a-url.md).
  assert.equal(bgp.resolveEditionLang('sv', ['german']), 'DE');
  assert.equal(bgp.resolveEditionLang('sv', [' German ']), 'DE');
  // A Map, so a key off Object.prototype reaches nothing.
  assert.equal(bgp.resolveEditionLang('sv', ['__proto__']), null);
  assert.equal(bgp.resolveEditionLang('sv', ['constructor']), null);
  // Junk in the array must not throw or match.
  assert.equal(bgp.resolveEditionLang('sv', [null, 42, {}]), null);
  assert.equal(bgp.resolveEditionLang('sv', 'German'), null, 'not an array -> no edition');
});

test('the cache key splits the MARKET from the EDITION — they come from different places', () => {
  // The trap #742 had to avoid: deriving both from one value would quote a
  // German reader asking for the English box GB shipping in GBP.
  const en = bgp.cacheKey('342942', 'en', ['German']);
  assert.match(en, /:GB:GBP:DE:342942$/, 'British market, German box');
  const de = bgp.cacheKey('342942', 'de', ['English']);
  assert.match(de, /:DE:EUR:GB:342942$/, 'German market, English box');
  // Two readers of one wish now share a key where they used to differ, which is
  // the second half of the bug: one round, one price.
  assert.equal(bgp.cacheKey('342942', 'de', ['German']), bgp.cacheKey('342942', 'de', ['German']));
  assert.notEqual(de, bgp.cacheKey('342942', 'de', ['German']), 'a different box is a different lookup');
  // Unchanged for a game with no stored edition.
  assert.equal(bgp.cacheKey('342942', 'de', []), bgp.cacheKey('342942', 'de'));
  // No tenant, round, user or game-row id — the vvt.md row 21 constraint.
  assert.equal(bgp.cacheKey('342942', 'de', ['German']), 'bgp:info:DE:EUR:DE:342942');
});
