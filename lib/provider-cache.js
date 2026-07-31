'use strict';

/*
 * The shared in-memory cache for provider hops, so we stay polite to the
 * external game databases: debounced typing repeats the same search, the import
 * sheet fetches a collection once to list and again to import, and the cover
 * refresh (#518) is a button a user may well press twice.
 *
 * Extracted from routes/lookup.js when routes/games.js became a second consumer
 * — one Map and one TTL rather than a second hand-rolled copy of the same
 * expiry logic (.claude/rules/shared-constants-across-the-stack.md).
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
// build them; see localeKey() in routes/lookup.js for why the effective locale
// beats the raw ?lang= (two UI locales that map to one storefront locale share
// an entry, and BGG — which ignores the locale — stays at a single entry).
function cachedIf(key, fn, shouldStore) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  return Promise.resolve(fn()).then((value) => {
    if (shouldStore(value)) cache.set(key, { value, expires: Date.now() + TTL_MS });
    return value;
  });
}

// Cache whatever the hop answered. Right for search and detail, where an empty
// result is itself a settled answer worth not re-asking for.
const cached = (key, fn) => cachedIf(key, fn, () => true);

module.exports = { cached, cachedIf, TTL_MS };
