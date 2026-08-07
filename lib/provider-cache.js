'use strict';

/*
 * The shared in-memory cache for provider hops, so we stay polite to the
 * external game databases: debounced typing repeats the same search, the import
 * sheet fetches a collection once to list and again to import, and the cover
 * refresh (#518) is a button a user may well press twice.
 *
 * Extracted from lib/routes/lookup.js when lib/routes/games.js became a second consumer
 * — one Map and one default TTL rather than a second hand-rolled copy of the same
 * expiry logic (.claude/rules/shared-constants-across-the-stack.md). Since #679 a
 * caller may pass its own TTL for one hop (the price sources are required to
 * cache for an hour); the default below is what every other hop still gets.
 *
 * Deliberately process-local and unevicted: entries are keyed by provider hop
 * and expire logically, the working set is small, and a shared store is the
 * separate question #215 tracks for the rate limiters. Nothing personal is
 * cached — only what a provider answered about a public game.
 */

const cache = new Map();
const TTL_MS = 10 * 60 * 1000;

// Keys must carry the provider, the hop and the EFFECTIVE provider locale, or a
// French user is served a German user's hits for the whole TTL (#505). Callers
// build them; see localeKey() in lib/routes/lookup.js for why the effective locale
// beats the raw ?lang= (two UI locales that map to one storefront locale share
// an entry, and BGG — which ignores the locale — stays at a single entry).
// `ttlMs` is per hop and defaults to the shared TTL above. It exists for the
// price sources (#679), whose terms require caching for at least an hour —
// lowering theirs to ten minutes would be impolite, and raising the shared
// constant would hand the BGG and storefront hops an hour-long cache they were
// never designed for (a "queued" collection answer must not survive ten minutes,
// let alone sixty — .claude/rules/bgg-collection-import.md §3).
function cachedIf(key, fn, shouldStore, ttlMs = TTL_MS) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  return Promise.resolve(fn()).then((value) => {
    if (shouldStore(value)) cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  });
}

// Cache whatever the hop answered. Right for search and detail, where an empty
// result is itself a settled answer worth not re-asking for.
const cached = (key, fn) => cachedIf(key, fn, () => true);

module.exports = { cached, cachedIf, TTL_MS };
