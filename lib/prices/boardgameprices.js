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
 * follows. Four properties of the live API drive the whole parser, each of which
 * fails SILENTLY if missed; test/prices-boardgameprices.test.js pins all four:
 *
 *  1. ONE BGG id returns MANY items, one per language edition. items[0] is the
 *     English one, so a German round shown items[0] sees a different box at a
 *     different price. Since #742 the GAME's stored edition decides — the box the
 *     round picked its cover from — falling back to the reader's language and
 *     then to the most-offers edition. Never the array order.
 *  2. `destination` means "ships to here", not "the shop is here" — a DE query
 *     legitimately returns AT, CH, LV and GR shops. The country travels with the
 *     offer so the UI can say whose shop it is.
 *  3. `shipping_known: false` arrives with `shipping: 0`, so `price` equals the
 *     product price while LOOKING like a total. Presenting it as an inclusive
 *     price is a PAngV § 3/§ 6 problem, not a rounding nicety — such an offer can
 *     never outrank a real total, and when it is all we have the payload says so.
 *  4. One item can be MULTILINGUAL: a single listing carries several languages,
 *     GB first (Karak: GB,DE,NL,FR,IT), so langs[0] is not "the" edition
 *     language — a German reader correctly matched to that item would be told
 *     "(GB)" over the German-market offers (#700). The edition label follows the
 *     matched language; langs[0] only ever labels the most-offers fallback.
 */

const BASE = 'https://boardgameprices.co.uk/api/info';
// Deliberately ABOVE their own gateway's budget, which returns 504 at ~10.1 s.
// At 10 s ours fired ~100 ms first, so a plain upstream outage was reported as
// "This operation was aborted" — a message that names OUR timeout and hides
// theirs. Measured 2026-08-07 during a real outage: every request, including
// their own /api/plugin docs page, answered 504 at 10.10 s. Two seconds of
// headroom turns that into "BoardGamePrices responded 504", which says whose
// problem it is. The extra wait costs nothing now that a failure puts the whole
// source on a cooldown (lib/prices/index.js) instead of being paid per page view.
const TIMEOUT_MS = 12000;

// Their terms ask for at least an hour's caching, and prices move nightly on
// their side. Deliberately NOT lib/provider-cache.js's shared 10-minute TTL:
// lowering theirs to ours would be impolite, raising the shared one would give
// the BGG hops an hour-long cache they were never designed for.
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

// The same codes, keyed by BGG's own `<link type="language">` VALUE — which is
// what the edition-cover picker hands back and what a game's stored `edition`
// carries (#742). Lower-cased on both sides so BGG's capitalisation is not part
// of the contract.
//
// A Map, and consulted as an ALLOWLIST rather than interpolated, for the same
// reason MARKETS is: the code it yields lands in a cache key and decides which
// edition a fetched body is read as. An unrecognised printing (Polish, Japanese
// — BGG names ~80 languages, the aggregator sells seven) simply falls through to
// the reader's locale, so the price box keeps working rather than emptying.
// See .claude/rules/allowlist-request-values-that-reach-a-url.md.
const BGG_EDITION_LANGS = new Map([
  ['german', 'DE'],
  ['english', 'GB'],
  ['french', 'FR'],
  ['spanish', 'ES'],
  ['italian', 'IT'],
  ['dutch', 'NL'],
  ['portuguese', 'PT'],
]);

// Where we ask them to ship, and in what currency. The API supports exactly
// DK/SE/GB/DE/US as destinations — there is no AT or CH one, so Austrian and
// Swiss readers see German shipping estimates.
//
// A Map, and consulted as an ALLOWLIST rather than interpolated, because both
// values land in a fetched URL's query string — see
// .claude/rules/allowlist-request-values-that-reach-a-url.md (a Map so
// '__proto__' reaches nothing).
//
// The fallback is SINGLE-tier on purpose. The storefront locale tables retired in
// #744 used a two-tier one, sending any recognised-but-unmapped locale to English
// first: right for a LANGUAGE (a French reader is better served by English than by
// the deployment's German) and wrong for a SHIPPING DESTINATION, where it would
// put a French, Spanish or Italian reader on British shops in pounds when German
// shops in euros are what actually reach them. So there is one fallback here, the
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

// The aggregator's edition-language code the reader's UI locale maps to, if any.
function wantedLang(requested) {
  return EDITION_LANGS.get(String(requested == null ? '' : requested).trim().toLowerCase());
}

// The aggregator's code for a game's stored edition, from BGG's language values.
// The FIRST that maps wins: one BGG version legitimately lists several languages
// (a multilingual printing), and any of them describes the same box.
function editionLang(languages) {
  for (const name of Array.isArray(languages) ? languages : []) {
    const code = BGG_EDITION_LANGS.get(String(name).trim().toLowerCase());
    if (code) return code;
  }
  return null;
}

// Which edition THIS lookup is about, as one function, because two callers must
// never disagree about it: `cacheKey` writes it into the key the cache and the
// stored fallback share, and `price` reads the fetched body with it. A key built
// from one rule and a body read with another would let the fallback answer a
// question the live lookup would have answered differently
// (.claude/rules/last-known-price-fallback.md §1).
//
// The game's own edition first — the group picked that cover, so that is the box
// they want priced — then the reader's locale, which is all this had before
// #742, then null for the most-offers fallback.
function resolveEditionLang(requested, editionLanguages) {
  return editionLang(editionLanguages) || wantedLang(requested) || null;
}

// The edition to show, for an already-resolved `want` code (above). Failing a
// match, the one with the most offers — which for a well-covered game is the
// English edition, i.e. the same answer `items[0]` would have given, but for a
// reason rather than by luck.
function pickEdition(items, want) {
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
// `want` is the resolved aggregator code (`resolveEditionLang`), never a UI
// locale — the caller does that mapping once so the cache key cannot describe a
// different edition than the body it is keyed to.
function parseInfo(json, { want, destination } = {}) {
  if (!json || typeof json !== 'object') return null;
  const rawItems = Array.isArray(json.items) ? json.items : [];
  const items = rawItems.map(parseItem).filter(Boolean);
  const edition = pickEdition(items, want);
  if (!edition) return null;
  const best = pickBest(edition.offers);
  if (!best) return null;
  // Property 4 above: when the shown box includes the wanted language, that
  // match is the honest label; the item's own first language labels only the
  // most-offers fallback, where no wanted-language edition existed.
  return {
    source: 'boardgameprices',
    currency: typeof json.currency === 'string' && json.currency ? json.currency : null,
    destination: destination || null,
    edition: { title: edition.title, lang: want && edition.langs.includes(want) ? want : edition.lang },
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
  } catch (err) {
    // An AbortError's own message is "This operation was aborted", which names
    // no source, no budget and no cause — it reads like an internal fault. The
    // operator sees this string in the admin panel's log, so it has to say what
    // actually happened.
    if (err && err.name === 'AbortError') {
      throw new Error(`BoardGamePrices did not answer within ${TIMEOUT_MS} ms`, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// The cache key must carry the eid, the market AND the edition language — the
// same reasoning as localeKey() in lib/routes/lookup.js. The market because two
// markets answer different prices for one game; the language because one body
// yields a different EDITION, so a key without it would serve a German reader the
// English box for the whole hour.
//
// The two terms come from DIFFERENT places since #742 and the split is the whole
// point: the market is the reader's (shipping is about the person), the edition
// is the game's (which box it is). Note the key still carries no tenant, round,
// user or game-row id — that is what keeps docs/legal/vvt.md row 21 a documented
// non-processing (.claude/rules/last-known-price-fallback.md §5).
function cacheKey(externalId, requested, editionLanguages) {
  const { destination, currency } = resolveMarket(requested);
  const lang = resolveEditionLang(requested, editionLanguages) || '-';
  return `bgp:info:${destination}:${currency}:${lang}:${externalId}`;
}

// The flat payload every price source answers with, or null when there is
// nothing to show. `shippingKnown: false` means `amount` is the product price
// alone — the renderer must say so rather than call it a total.
async function price(externalId, requested, editionLanguages) {
  // The reader's locale decides where it ships and in what currency; the game's
  // stored edition decides WHICH BOX. Deriving both from one value is what made a
  // German-speaking round wishing for the English box get quoted the German one —
  // and, taken the other way, would quote a German reader GB shipping in GBP.
  const market = resolveMarket(requested);
  const params = new URLSearchParams({
    eid: String(externalId),
    currency: market.currency,
    destination: market.destination,
    sitename: siteName(),
  });
  const parsed = parseInfo(await fetchJson(`${BASE}?${params.toString()}`), {
    want: resolveEditionLang(requested, editionLanguages),
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
  TIMEOUT_MS,
  DESTINATIONS,
  CURRENCIES,
  // exported for unit tests:
  parseInfo,
  parseOffer,
  parseItem,
  pickEdition,
  pickBest,
  resolveEditionLang,
};
