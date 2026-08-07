'use strict';

/*
 * Steam prices (issue #679). The thinnest of the two price sources: the store's
 * `appdetails` response has always carried `price_overview`, and the lookup
 * provider has always thrown it away — so this adds a hop, not an integration.
 *
 * The parsing lives with the endpoint in lib/providers/steam.js (next to
 * parsePlayers, which reads the same body); this file is the price-source
 * adapter, i.e. what lib/prices/index.js dispatches to. Keeping the two apart is
 * what stops a price capability leaking into the lookup registry
 * (.claude/rules/add-game-lookup-provider.md).
 */

const steam = require('../providers/steam');

// A digital purchase has no shipping, so the store price IS the total — which is
// what `shippingKnown: true` says to the renderer. It is not a placeholder: the
// PAngV question ("is this number the whole price?") has a real answer here, and
// the answer is yes.
async function price(externalId, lang) {
  const p = await steam.price(externalId, lang);
  if (!p) return null;
  return {
    source: 'steam',
    currency: p.currency,
    amount: p.amount,
    regular: p.regular,
    discountPercent: p.discountPercent,
    shippingKnown: true,
    url: `https://store.steampowered.com/app/${encodeURIComponent(externalId)}/`,
  };
}

// Steam answers in the caller's country + language (STEAM_CC/STEAM_LOCALE, or
// the UI locale since #505), so the effective provider locale has to be in the
// key or a German reader is served a British one's prices for the whole hour.
function cacheKey(externalId, lang) {
  return `steam:price:${steam.resolveLocale(lang)}:${externalId}`;
}

// Steam publishes no caching requirement, but a price box is not worth a
// storefront round trip per page view either. Same hour as the aggregator, so
// the two sources cannot disagree about how stale "just now" may be.
const CACHE_TTL_MS = 60 * 60 * 1000;

module.exports = { id: 'steam', price, cacheKey, CACHE_TTL_MS };
