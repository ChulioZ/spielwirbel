'use strict';

/*
 * Current prices for a game on the Wunschliste (issue #679). Read-only,
 * server-side, cached — no alerts, no stored prices, and no affiliate parameter
 * of any kind (operator decision 2026-08-07: never; it is a different legal
 * posture, not a config change).
 *
 * Two sources, dispatched on the link the game already carries:
 *
 *   game.source.provider === 'bgg'   -> ./boardgameprices  (the aggregator)
 *   game.source.provider === 'steam' -> ./steam            (price_overview)
 *
 * A game with no source, or one linked to a provider with no price source, has
 * no price and makes NO upstream request — a hand-typed wish gets nothing, and a
 * title-search fallback is deliberately not offered because it would guess the
 * wrong edition and quote a price for a box the group did not mean.
 *
 * Everything here degrades to `{ available: false }`. A price box is an extra;
 * a failing one must never break the detail page it sits on — the same reasoning
 * as BGG's "no token => [], never a throw"
 * (.claude/rules/add-game-lookup-provider.md).
 */

const { cachedIf } = require('../provider-cache');
const boardgameprices = require('./boardgameprices');
const steam = require('./steam');
const { logger } = require('../observability');

// A Map, so a request-supplied provider name like '__proto__' reaches nothing —
// the same allowlist-not-sanitize shape as the locale tables
// (.claude/rules/storefront-lookup-locale.md §1).
const SOURCES = new Map([
  ['bgg', boardgameprices],
  ['steam', steam],
]);

// Read per call, never at module load, so a test — or a live flip from the
// Railway dashboard — picks up the current env. The feature is off by default:
// it is a new external dependency with no SLA, and it must be switchable off
// without deploying code (the DEMO_ENABLED shape, lib/demo.js).
function pricesEnabled() {
  return process.env.PRICES_ENABLED === 'true';
}

const UNAVAILABLE = { available: false };

// The price source for a game, or null. Exported so the route can answer
// "nothing to fetch" without a request.
function sourceFor(game) {
  const src = game && game.source && typeof game.source === 'object' ? game.source : null;
  const id = src && typeof src.provider === 'string' ? src.provider : null;
  const externalId = src && src.externalId != null ? String(src.externalId) : '';
  if (!id || !externalId) return null;
  const source = SOURCES.get(id);
  return source ? { source, externalId } : null;
}

// `{ available: true, … }` or `{ available: false }`. Never throws, never
// rejects.
//
// `fetchedAt` is stamped where the fetch happens and travels INSIDE the cache
// entry, so a cached answer reports when the price was really retrieved rather
// than when it was served. That timestamp is a legal requirement, not a nicety:
// a stale price presented as current is a misleading omission, and nothing in CI
// can detect an upstream that stopped updating.
async function priceFor(game, lang) {
  if (!pricesEnabled()) return UNAVAILABLE;
  const hit = sourceFor(game);
  if (!hit) return UNAVAILABLE;
  const { source, externalId } = hit;
  try {
    const payload = await cachedIf(
      source.cacheKey(externalId, lang),
      async () => {
        const p = await source.price(externalId, lang);
        return p ? { ...p, available: true, fetchedAt: new Date().toISOString() } : UNAVAILABLE;
      },
      // Cache the "no price" answer too — an unknown id or a game nobody stocks
      // is a settled answer, and re-asking hourly is what the terms ask us not
      // to do. An upstream FAILURE is never cached: it throws out of the loader
      // before this runs, so the next view tries again.
      () => true,
      source.CACHE_TTL_MS
    );
    return payload;
  } catch (err) {
    // Warn, don't error: the upstream being down is not our fault and not the
    // user's problem. Status/message only — never the URL, which carries the
    // game's external id.
    logger.warn({ source: source.id, err: err && err.message }, 'price lookup failed');
    return UNAVAILABLE;
  }
}

module.exports = { pricesEnabled, priceFor, sourceFor };
