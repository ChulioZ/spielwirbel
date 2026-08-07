'use strict';

/*
 * Current prices for a game on the Wunschliste (issue #679). Read-only,
 * server-side, cached — no alerts, no price history, and no affiliate parameter
 * of any kind (operator decision 2026-08-07: never; it is a different legal
 * posture, not a config change).
 *
 * Since #688 the last price each lookup answered IS stored (one current value per
 * lookup, overwritten on every success), as the fallback documented further down.
 * That is not a history and not a per-user record — see
 * .claude/rules/last-known-price-fallback.md §5 before storing anything more.
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
const repo = require('../repo');
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

/*
 * The LAST KNOWN price (#688) — a persistent fallback UNDER the cache above.
 *
 * The cache alone makes the feature exactly as available as its upstream, in two
 * ways that are each easy to miss. An expired entry is not a fallback: `cachedIf`
 * serves a hit only while it is live, then refetches, and a failed refetch is
 * `{available: false}` while the old value sits unread in the Map. And the Map is
 * per process, so a deploy or a restart wipes every price. Measured 2026-08-07,
 * hours after #679 shipped: the aggregator 504'd for hours and every board-game
 * wish showed nothing at all.
 *
 * Three properties decide whether this is honest rather than merely helpful:
 *
 *  - It is read ONLY when a live lookup is unavailable, never in place of one. A
 *    successful lookup that finds no price ("nobody stocks this") is a settled
 *    answer, and answering it with last week's price would contradict fresh data.
 *  - The stored payload keeps its ORIGINAL `fetchedAt`, and the answer carries
 *    `stale: true` so the renderer can lead with the age instead of tucking a
 *    date into a footnote. A days-old price presented as current is a § 5a UWG
 *    misleading omission, so the flag is a legal requirement, not a hint.
 *  - Past MAX_AGE we show NOTHING rather than something misleading. Seven days
 *    (operator decision 2026-08-07) covers a weekend-long outage while staying
 *    inside the window where a board-game price is still worth quoting.
 *
 * Their terms permit this: "cache obtained information for at least one hour" is
 * a MINIMUM with no stated maximum and no prohibition on persistence (read
 * 2026-08-07 — the check #688 made the first implementation step). Attribution is
 * the other condition and is unchanged: the source line and the link back are
 * already there (.claude/rules/wish-list-prices.md).
 */
const DEFAULT_MAX_AGE_DAYS = 7;

// Read per call, like every other ceiling here, so a live re-tune from the
// Railway dashboard takes effect without a deploy.
function maxAgeDays() {
  const n = Number(process.env.PRICES_FALLBACK_MAX_AGE_DAYS);
  // Zero or negative would silently disable the fallback through a config typo —
  // fall back to the shipped value rather than honour it (the `ttlDays()` shape
  // in lib/vote-link.js).
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_AGE_DAYS;
}

// Prices fetched before this instant may no longer be shown. ISO-8601 UTC,
// because that is how `fetchedAt` is stored and the comparison is a plain
// lexicographic one.
function lastPriceCutoff(now = Date.now()) {
  return new Date(now - maxAgeDays() * 24 * 60 * 60 * 1000).toISOString();
}

// Remember what a source just answered. Never rejects and never blocks the
// answer: a store that is down must cost the reader nothing — they have a live
// price in hand, which is strictly better than the one being written.
async function remember(key, payload) {
  try {
    await repo.putLastPrice(key, payload);
  } catch (err) {
    logger.warn({ key, err: err && err.message }, 'could not store the last known price');
  }
}

// The stored price for a lookup, if there is one and it is still young enough.
// Null otherwise — including on a read failure, because a fallback that throws
// would turn a degraded price box into a broken detail page.
async function lastKnown(key) {
  try {
    const row = await repo.getLastPrice(key);
    // A row with no `fetchedAt` cannot have its age judged, so it is refused
    // rather than shown ageless — the same fail-closed reading the sweep applies.
    if (!row || !row.fetchedAt || row.fetchedAt < lastPriceCutoff()) return null;
    return { ...row.price, stale: true };
  } catch (err) {
    logger.warn({ key, err: err && err.message }, 'could not read the last known price');
    return null;
  }
}

// The scheduler's half (lib/scheduler.js). A row past the display ceiling can
// never be shown again, so it is dead by definition — and sweeping is what makes
// docs/legal/retention.md's line about this store true rather than aspirational.
async function purgeStoredPrices() {
  return repo.deleteExpiredLastPrices(lastPriceCutoff());
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
  // One key for the live lookup, the cache AND the stored fallback. Reusing the
  // source's own cache key is what makes it impossible for the fallback to answer
  // a question the live lookup would have answered differently: it already
  // encodes the market and the EDITION LANGUAGE, and a key built from the game's
  // id and market alone would serve a French reader's edition to a German one.
  const key = source.cacheKey(externalId, lang);
  try {
    const payload = await cachedIf(
      key,
      async () => {
        // The cooldown is checked HERE, inside the loader, and not before the
        // cache lookup — that placement is the whole point. An entry we already
        // hold is a perfectly good price and must keep being served while the
        // upstream is out; skipping the cache during a cooldown would take
        // prices away from exactly the games we already had answers for.
        if ((coolingUntil.get(source.id) || 0) > Date.now()) return COOLING;
        const p = await source.price(externalId, lang);
        if (!p) return UNAVAILABLE;
        const fresh = { ...p, available: true, fetchedAt: new Date().toISOString() };
        // Refreshed opportunistically, on any successful lookup — which is every
        // lookup that reaches here, since the hour-long cache absorbs the rest.
        // Only a real price is stored: "nobody stocks this" is a settled answer
        // that the fallback would never be asked to serve anyway.
        await remember(key, fresh);
        return fresh;
      },
      // Cache the "no price" answer too — an unknown id or a game nobody stocks
      // is a settled answer, and re-asking hourly is what the terms ask us not
      // to do. An upstream FAILURE is never cached: it throws out of the loader
      // before this runs, so the next view tries again once the cooldown lapses.
      (value) => value !== COOLING,
      source.CACHE_TTL_MS
    );
    // Cooling: the source is known to be down, so the last price we hold is the
    // best answer available. Note this is reached only on a cache MISS — a live
    // cache entry is still served ahead of it, which is the ordering the
    // "a price we ALREADY HOLD" spec pins.
    if (payload === COOLING) return (await lastKnown(key)) || UNAVAILABLE;
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
    return (await lastKnown(key)) || UNAVAILABLE;
  }
}

module.exports = {
  pricesEnabled,
  priceFor,
  sourceFor,
  purgeStoredPrices,
  lastPriceCutoff,
  maxAgeDays,
  DEFAULT_MAX_AGE_DAYS,
  // exported for unit tests: the cooldown is module state shared by every spec
  // in a file, so one spec's simulated outage would pause the source for the
  // next two minutes and silently starve the specs after it. Setting the env to
  // 0 is not enough — a deadline recorded while it was 60 is still in the
  // future. There is no production caller.
  resetCooldowns: () => coolingUntil.clear(),
};
