'use strict';

/*
 * Board-game prices, from the Brettspielpreise.de / BoardGamePrices aggregator
 * (issue #679). Keyed on the BGG id we already store as `game.source.externalId`,
 * so the expensive half of any price feature — matching a title to a retailer SKU
 * — is solved before we start.
 *
 *   GET https://boardgameprices.co.uk/api/info
 *       ?eid=<bgg id>&currency=EUR&destination=DE&sitename=<our host>
 *
 * Deliberately NOT in lib/providers/: those five are game-database lookup
 * providers with a search/detail/IMAGE_HOSTS contract wired into the add-game
 * dropdown and into round.providers (.claude/rules/add-game-lookup-provider.md).
 * A price source answers a different question and must never appear in that
 * registry.
 *
 * Everything below the fetch is a pure exported parse* function, unit-tested
 * against a captured body and never the network — the same shape every provider
 * follows. Three properties of the live API drive the whole parser, each of which
 * fails SILENTLY if missed; test/prices-boardgameprices.test.js pins all three:
 *
 *  1. ONE BGG id returns MANY items, one per language edition. items[0] is the
 *     English one, so a German round shown items[0] sees a different box at a
 *     different price. The reader's language decides, not the array order.
 *  2. `destination` means "ships to here", not "the shop is here" — a DE query
 *     legitimately returns AT, CH, LV and GR shops. The country travels with the
 *     offer so the UI can say whose shop it is.
 *  3. `shipping_known: false` arrives with `shipping: 0`, so `price` equals the
 *     product price while LOOKING like a total. Presenting it as an inclusive
 *     price is a PAngV § 3/§ 6 problem, not a rounding nicety — such an offer can
 *     never outrank a real total, and when it is all we have the payload says so.
 */

const BASE = 'https://boardgameprices.co.uk/api/info';
const TIMEOUT_MS = 10000;

// Their terms ask for at least an hour's caching, and prices move nightly on
// their side. Deliberately NOT lib/provider-cache.js's shared 10-minute TTL:
// lowering theirs to ours would be impolite, raising the shared one would give
// the BGG and storefront hops an hour-long cache they were never designed for.
const CACHE_TTL_MS = 60 * 60 * 1000;

// The shop country the aggregator uses per edition. Uppercase, and not always an
// ISO country: the English edition is 'GB'.
const EDITION_LANGS = new Map([
  ['de', 'DE'],
  ['en', 'GB'],
  ['fr', 'FR'],
  ['es', 'ES'],
  ['it', 'IT'],
  ['nl', 'NL'],
  ['pt', 'PT'],
]);

// Where we ask them to ship, and in what currency. The API supports exactly
// DK/SE/GB/DE/US as destinations — there is no AT or CH one, so Austrian and
// Swiss readers see German shipping estimates.
//
// A Map, and consulted as an ALLOWLIST rather than interpolated, because both
// values land in a fetched URL's query string — the resolveLocale shape in
// .claude/rules/storefront-lookup-locale.md §1 (a Map so '__proto__' reaches
// nothing).
//
// It does NOT go through lib/providers/locales.js `resolveLocale`, whose
// two-tier fallback sends any recognised-but-unmapped locale to English. That is
// right for a LANGUAGE (a French reader is better served by English than by the
// deployment's German) and wrong for a SHIPPING DESTINATION: it would put a
// French, Spanish or Italian reader on British shops in pounds when German shops
// in euros are what actually reach them. So there is one fallback here, the
// deployment default, and the eurozone locales land on it.
const MARKETS = new Map([
  ['de', { destination: 'DE', currency: 'EUR' }],
  ['en', { destination: 'GB', currency: 'GBP' }],
]);
const DESTINATIONS = ['DK', 'SE', 'GB', 'DE', 'US'];
const CURRENCIES = ['EUR', 'GBP', 'USD', 'DKK', 'SEK'];

// Read per call, never at module load, so a test — or a live re-tune from the
// Railway dashboard — picks up the current env (.claude/rules/security-middleware.md).
function defaultMarket() {
  const destination = String(process.env.PRICES_DESTINATION || 'DE').toUpperCase();
  const currency = String(process.env.PRICES_CURRENCY || 'EUR').toUpperCase();
  return {
    destination: DESTINATIONS.includes(destination) ? destination : 'DE',
    currency: CURRENCIES.includes(currency) ? currency : 'EUR',
  };
}

// The { destination, currency } pair this request should use.
function resolveMarket(requested) {
  const ui = String(requested == null ? '' : requested).trim().toLowerCase();
  return MARKETS.get(ui) || defaultMarket();
}

// Their attribution mechanism: the item URLs they hand back already carry
// `utm_source=site_<sitename>`, so this must be our real host.
function siteName() {
  return String(process.env.PRICES_SITENAME || 'spielwirbel.app').trim() || 'spielwirbel.app';
}

const money = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

// One offer, normalized. Null for anything unusable, so a single odd row costs
// its own line rather than the whole price box.
//
// `stock` arrives as 'Y', 'N', '?' or ' ' — only 'Y' is a promise, and the other
// three must never win: in the captured body all three are CHEAPER than the
// cheapest available offer, so a ranking that ignored stock would send the user
// to a shop that has not got the game.
function parseOffer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const product = money(raw.product);
  if (product === null) return null;
  const shippingKnown = raw.shipping_known === true;
  const shipping = shippingKnown ? money(raw.shipping) : null;
  // `price` is product + shipping + fee on the wire, but only means that when
  // the shipping is known; otherwise it is the product price under another name.
  const total = money(raw.price);
  return {
    amount: shippingKnown ? (total === null ? product : total) : product,
    product,
    shipping: shippingKnown ? (shipping === null ? 0 : shipping) : null,
    shippingKnown,
    inStock: raw.stock === 'Y',
    country: typeof raw.country === 'string' && raw.country ? raw.country : null,
    link: typeof raw.link === 'string' && raw.link.startsWith('https://') ? raw.link : null,
  };
}

function parseItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const langs = raw.versions && Array.isArray(raw.versions.lang) ? raw.versions.lang.map(String) : [];
  const offers = (Array.isArray(raw.prices) ? raw.prices : []).map(parseOffer).filter(Boolean);
  return {
    title: raw.name ? String(raw.name) : null,
    lang: langs[0] || null,
    langs,
    url: typeof raw.url === 'string' && raw.url.startsWith('https://') ? raw.url : null,
    offers,
  };
}

// The edition to show. The reader's language wins; failing that, the one with the
// most offers — which for a well-covered game is the English edition, i.e. the
// same answer `items[0]` would have given, but for a reason rather than by luck.
function pickEdition(items, lang) {
  const want = EDITION_LANGS.get(String(lang == null ? '' : lang).trim().toLowerCase());
  const matched = want ? items.find((it) => it.langs.includes(want)) : null;
  if (matched && matched.offers.length) return matched;
  let best = null;
  for (const it of items) {
    if (!it.offers.length) continue;
    if (!best || it.offers.length > best.offers.length) best = it;
  }
  return best;
}

// Rank the offers we may actually quote. Known-shipping offers come first as a
// block — never interleaved by amount — because an unknown-shipping offer's
// number is not comparable to a total, and letting it win would put an
// incomplete price where the UI promises an inclusive one.
function pickBest(offers) {
  const available = offers.filter((o) => o.inStock);
  const inclusive = available.filter((o) => o.shippingKnown);
  const pool = inclusive.length ? inclusive : available;
  let best = null;
  for (const o of pool) if (!best || o.amount < best.amount) best = o;
  return best;
}

// A parsed /api/info body, or null when there is no price to show (an unknown
// BGG id answers a clean 200 with items: []). Never throws.
function parseInfo(json, { lang, destination } = {}) {
  if (!json || typeof json !== 'object') return null;
  const rawItems = Array.isArray(json.items) ? json.items : [];
  const items = rawItems.map(parseItem).filter(Boolean);
  const edition = pickEdition(items, lang);
  if (!edition) return null;
  const best = pickBest(edition.offers);
  if (!best) return null;
  return {
    source: 'boardgameprices',
    currency: typeof json.currency === 'string' && json.currency ? json.currency : null,
    destination: destination || null,
    edition: { title: edition.title, lang: edition.lang },
    itemUrl: edition.url,
    offerCount: edition.offers.length,
    inStockCount: edition.offers.filter((o) => o.inStock).length,
    offers: edition.offers,
    best,
  };
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`BoardGamePrices responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// The cache key must carry the eid, the market AND the edition language — the
// same reasoning as localeKey() in lib/routes/lookup.js. The market because two
// markets answer different prices for one game; the language because one body
// yields a different EDITION per reader, so a key without it would serve a German
// reader the English box for the whole hour.
function cacheKey(externalId, requested) {
  const { destination, currency } = resolveMarket(requested);
  const lang = EDITION_LANGS.get(String(requested == null ? '' : requested).trim().toLowerCase()) || '-';
  return `bgp:info:${destination}:${currency}:${lang}:${externalId}`;
}

// The flat payload every price source answers with, or null when there is
// nothing to show. `shippingKnown: false` means `amount` is the product price
// alone — the renderer must say so rather than call it a total.
async function price(externalId, requested) {
  const market = resolveMarket(requested);
  const params = new URLSearchParams({
    eid: String(externalId),
    currency: market.currency,
    destination: market.destination,
    sitename: siteName(),
  });
  const parsed = parseInfo(await fetchJson(`${BASE}?${params.toString()}`), {
    lang: requested,
    destination: market.destination,
  });
  if (!parsed) return null;
  return {
    source: 'boardgameprices',
    currency: parsed.currency || market.currency,
    amount: parsed.best.amount,
    product: parsed.best.product,
    shipping: parsed.best.shipping,
    shippingKnown: parsed.best.shippingKnown,
    country: parsed.best.country,
    destination: parsed.destination,
    offerCount: parsed.offerCount,
    inStockCount: parsed.inStockCount,
    edition: parsed.edition,
    // Where the user goes: the aggregator's own item page, never the shop's deep
    // link. We do not select shops, and the comparison is theirs to present with
    // its own disclosures (BGH I ZR 55/16).
    url: parsed.itemUrl,
  };
}

module.exports = {
  id: 'boardgameprices',
  price,
  cacheKey,
  resolveMarket,
  CACHE_TTL_MS,
  DESTINATIONS,
  CURRENCIES,
  // exported for unit tests:
  parseInfo,
  parseOffer,
  parseItem,
  pickEdition,
  pickBest,
};
