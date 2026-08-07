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

// Frozen because this one object is returned from several call sites AND stored
// in the shared cache under many keys, so a stray mutation anywhere would be a
// mutation everywhere, for an hour, with nothing to trace it back to.
const UNAVAILABLE = Object.freeze({ available: false });

/*
 * A source that just failed is not asked again for a couple of minutes.
 *
 * Without this, a sustained upstream outage costs the FULL timeout on every
 * single wish-detail view — the successful answers are cached for an hour but a
 * failure deliberately is not, so nothing throttles the retries. Measured
 * 2026-08-07, when boardgameprices.co.uk 504'd for hours: every view spent 10 s
 * server-side and added load to an upstream that was already failing.
 *
 * The two obvious alternatives are both wrong at one end. Caching the failure
 * like a result would repeat a five-second blip back at the user for an hour;
 * caching nothing is what we had. A short cooldown sits between them: the
 * outage is discovered again within minutes, and in the meantime it is asked
 * once per source rather than once per view.
 *
 * Keyed by SOURCE, not by game: an upstream that is down is down for every
 * game, so a per-game key would still issue one request per wished game. Being
 * per source is also what keeps Steam answering while the aggregator is out.
 *
 * Process-local, like the cache and the rate limiters (#215) — during the few
 * seconds a deploy overlaps two containers each holds its own. That is fine:
 * this is politeness and cost control, not correctness.
 */
const coolingUntil = new Map();
const DEFAULT_COOLDOWN_SECONDS = 120;
// A marker the loader returns instead of fetching. It must never be stored (see
// shouldStore below) or the cooldown would outlive itself as a cache entry.
const COOLING = Symbol('cooling');

// Read per call, so a test — or a live re-tune from the Railway dashboard —
// picks up the current env (.claude/rules/security-middleware.md).
function cooldownMs() {
  const raw = Number(process.env.PRICES_FAILURE_COOLDOWN_SECONDS);
  return (Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_COOLDOWN_SECONDS) * 1000;
}

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
        // The cooldown is checked HERE, inside the loader, and not before the
        // cache lookup — that placement is the whole point. An entry we already
        // hold is a perfectly good price and must keep being served while the
        // upstream is out; skipping the cache during a cooldown would take
        // prices away from exactly the games we already had answers for.
        if ((coolingUntil.get(source.id) || 0) > Date.now()) return COOLING;
        const p = await source.price(externalId, lang);
        return p ? { ...p, available: true, fetchedAt: new Date().toISOString() } : UNAVAILABLE;
      },
      // Cache the "no price" answer too — an unknown id or a game nobody stocks
      // is a settled answer, and re-asking hourly is what the terms ask us not
      // to do. An upstream FAILURE is never cached: it throws out of the loader
      // before this runs, so the next view tries again once the cooldown lapses.
      (value) => value !== COOLING,
      source.CACHE_TTL_MS
    );
    if (payload === COOLING) return UNAVAILABLE;
    // Reached only through a real answer, so the source is healthy again.
    coolingUntil.delete(source.id);
    return payload;
  } catch (err) {
    const cooldown = cooldownMs();
    coolingUntil.set(source.id, Date.now() + cooldown);
    // Warn, don't error: the upstream being down is not our fault and not the
    // user's problem. Message only — never the URL, which carries the game's
    // external id. `cooldownSeconds` is in the line so the operator can see the
    // silence that follows is deliberate rather than the feature having died.
    logger.warn(
      { source: source.id, err: err && err.message, cooldownSeconds: cooldown / 1000 },
      'price lookup failed — pausing this source'
    );
    return UNAVAILABLE;
  }
}

module.exports = {
  pricesEnabled,
  priceFor,
  sourceFor,
  // exported for unit tests: the cooldown is module state shared by every spec
  // in a file, so one spec's simulated outage would pause the source for the
  // next two minutes and silently starve the specs after it. Setting the env to
  // 0 is not enough — a deadline recorded while it was 60 is still in the
  // future. There is no production caller.
  resetCooldowns: () => coolingUntil.clear(),
};
