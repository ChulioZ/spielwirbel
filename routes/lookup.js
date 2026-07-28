'use strict';

/*
 * Add-game lookup: proxies external game-database providers (PlayStation Store,
 * BoardGameGeek, Steam, Nintendo eShop, Xbox) so the browser never makes the
 * cross-origin call itself.
 *
 * Mounted under /api/rounds/:rid/lookup (mergeParams for rid) — round-scoped
 * since #294, because which providers may be queried is a per-round setting and
 * has to be enforced server-side, not merely hidden in the UI:
 *
 *   GET /api/rounds/:rid/lookup/search?provider=psstore&q=witcher
 *       -> { results: [{ providerId, title, thumbnail }] }
 *   GET /api/rounds/:rid/lookup/game?provider=psstore&id=UP4497-PPSA10407_00-0
 *       -> { provider, externalId, title, minPlayers, maxPlayers, type,
 *            duration, imageUrl, url }
 *
 * Plus the one-shot collection import (#481), BGG-only today:
 *
 *   GET  /api/rounds/:rid/lookup/collection?provider=bgg
 *       -> { state, games: [{ …, present }] }
 *   POST /api/rounds/:rid/lookup/import?provider=bgg  { externalIds: [...] }
 *       -> { imported, skipped }
 *
 * Upstream failures return 502 { error: 'provider_unreachable' } so the UI can
 * show a "couldn't reach provider" state; an empty match set is a normal 200.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../lib/repo');
const { getProvider, providerCoverUrl } = require('../lib/providers');
const { validateBody } = require('../lib/validate');
const quota = require('../lib/quota');
const { trackEvent } = require('../lib/observability');
const { emitFeedEvent } = require('../lib/feed');

const router = express.Router({ mergeParams: true });

// Tiny in-memory cache to be polite to the provider (debounced typing still
// repeats the same queries). Keyed per provider+kind+key, short TTL.
const cache = new Map();
const TTL_MS = 10 * 60 * 1000;

function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  return Promise.resolve(fn()).then((value) => {
    cache.set(key, { value, expires: Date.now() + TTL_MS });
    return value;
  });
}

// Resolve the requested provider against BOTH the registry and the round's
// enabled list (#294). Answers with the provider, or an { status, error } the
// caller returns as-is:
//   - unknown id            -> 400, as before
//   - round gone            -> 404
//   - registered but off    -> 403 provider_disabled
// A disabled provider must be REFUSED, not silently answered: the UI filters its
// fan-out too, so a request naming one is either a stale client or a hand-rolled
// call, and answering it would make the setting advisory rather than enforced.
async function resolveProvider(req) {
  const provider = getProvider(req.query.provider);
  if (!provider) return { status: 400, error: 'Unknown provider' };
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return { status: 404, error: 'Round not found' };
  // Absent = never configured = every provider enabled (pre-#294 behaviour).
  const enabled = round.providers;
  if (Array.isArray(enabled) && !enabled.includes(provider.id)) {
    return { status: 403, error: 'provider_disabled' };
  }
  return { provider };
}

// The cache-key component for this request's language (#505). The four
// storefronts answer in the caller's UI language, so a cache keyed on the query
// alone would serve a French user a German user's hits for the whole TTL.
//
// It keys on the EFFECTIVE provider locale, never on the raw `?lang=`: two UI
// locales that map to the same storefront locale then share one entry, and BGG —
// which ignores the locale entirely — stays at a single entry instead of
// fragmenting seven ways for byte-identical results.
//
// Note the raw value still reaches provider.search/detail, which map it
// themselves. That is deliberate: mapping lives in exactly one place per
// provider, so no caller can construct a URL from an unmapped value.
function localeKey(provider, req) {
  return provider.resolveLocale(req.query.lang);
}

router.get('/search', async (req, res) => {
  const { provider, status, error } = await resolveProvider(req);
  if (!provider) return res.status(status).json({ error });
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  try {
    const results = await cached(
      `${provider.id}:search:${localeKey(provider, req)}:${q.toLowerCase()}`,
      () => provider.search(q, 8, req.query.lang)
    );
    res.json({ results });
  } catch {
    res.status(502).json({ error: 'provider_unreachable' });
  }
});

router.get('/game', async (req, res) => {
  const { provider, status, error } = await resolveProvider(req);
  if (!provider) return res.status(status).json({ error });
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing id' });
  try {
    const game = await cached(
      `${provider.id}:game:${localeKey(provider, req)}:${id}`,
      () => provider.detail(id, req.query.lang)
    );
    if (!game) return res.status(404).json({ error: 'Not found' });
    res.json(game);
  } catch {
    res.status(502).json({ error: 'provider_unreachable' });
  }
});

/* ------------------------- collection import (#481) ------------------------ */

// Which games to import, by the provider id the collection listed them under.
// Never titles or cover URLs: re-resolving each id against the fetched
// collection server-side is what keeps a hand-rolled request from writing an
// arbitrary title or an arbitrary image URL into someone's Regal.
const importSchema = z.object({
  externalIds: z.array(z.string().min(1)).min(1, 'externalIds must not be empty').max(2000),
});

// Resolve the collection provider for this round, plus the ACTING account's
// linked handle. Answers a { status, error } the caller returns as-is, or a
// `state` the caller reports in a 200 (see the state contract on GET below).
//
// The username comes from the account, never from the request: taking it from a
// query parameter would turn this into an arbitrary-BGG-user collection scraper
// running under our application token.
async function resolveCollection(req) {
  const resolved = await resolveProvider(req);
  if (!resolved.provider) return resolved;
  if (typeof resolved.provider.collection !== 'function') {
    return { status: 400, error: 'collection_unsupported' };
  }
  if (!req.userId) return { state: 'no_username' };
  const user = await repo.getUserById(req.userId);
  const username = (user && user.bggUsername) || '';
  if (!username) return { state: 'no_username' };
  return { provider: resolved.provider, username };
}

// Fetch the acting account's owned collection through the same 10-minute cache
// the search and detail hops use — a collection body is far heavier than either,
// and the import sheet fetches it once to list and once more to import. Keyed by
// the BGG handle alone, because the collection belongs to that BGG user rather
// than to our account: two of our accounts linking the same handle correctly
// share one fetch.
//
// It does NOT go through cached(), because only a settled 'ok' may be stored.
// Caching 'queued' would make "BGG is still building it, try again shortly" a
// lie for the next ten minutes: the retry the message asks for would be answered
// from the cache instead of asking BGG whether it had finished.
async function fetchCollection(provider, username) {
  const key = `${provider.id}:collection:${username.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await provider.collection(username);
  if (value.state === 'ok') cache.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

// The candidate list for the import sheet. Every outcome the user can act on is
// a 200 carrying a `state`, so the UI renders five distinguishable, localized
// messages instead of guessing from a status code:
//
//   'no_username'   -> nothing linked yet ("link your BGG account first")
//   'invalid_user'  -> BGG does not know that handle
//   'queued'        -> BGG is still building the export; try again shortly
//   'ok' + []       -> a real collection with nothing marked as owned
//   'ok' + games    -> the candidates
//
// A genuine outage stays a 502, matching the sibling routes.
router.get('/collection', async (req, res) => {
  const { provider, username, state, status, error } = await resolveCollection(req);
  if (state) return res.json({ state, games: [] });
  if (!provider) return res.status(status).json({ error });

  const round = await req.repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  let result;
  try {
    result = await fetchCollection(provider, username);
  } catch {
    return res.status(502).json({ error: 'provider_unreachable' });
  }

  // Mark what is already on the shelf rather than hiding it: the list is the
  // user's own collection, and silently dropping half of it reads as the import
  // having lost games. The client shows these checked-off and non-selectable.
  const present = new Set(
    (round.games || [])
      .filter((g) => g.source && g.source.provider === provider.id)
      .map((g) => g.source.externalId)
  );
  res.json({
    state: result.state,
    games: result.items.map((g) => ({
      externalId: g.externalId,
      title: g.title,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
      imageUrl: g.imageUrl,
      url: g.url,
      present: present.has(g.externalId),
    })),
  });
});

// Import the selected games in ONE write: one Chronik entry, one product event,
// one feed event — see repo.createGames for why a loop over POST /games is not
// an option at collection scale.
router.post('/import', async (req, res) => {
  const { provider, username, state, status, error } = await resolveCollection(req);
  // 'no_username' is the only state resolveCollection reports, and on the ACTION
  // (unlike the listing above) it is a refusal rather than something to render:
  // the sheet only offers the button once it has candidates, so getting here
  // without a linked handle means a stale client.
  if (state) return res.status(400).json({ error: 'no_bgg_username' });
  if (!provider) return res.status(status).json({ error });

  const body = validateBody(importSchema, req, res);
  if (!body) return;

  // Light read: existence + the member seats, nothing more. The shelf itself is
  // re-read inside createGames' own transaction (that is what makes the
  // already-present check atomic), so pulling it here as well would load the
  // whole collection twice — on the one route built for large ones.
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  let result;
  try {
    result = await fetchCollection(provider, username);
  } catch {
    return res.status(502).json({ error: 'provider_unreachable' });
  }
  if (result.state !== 'ok') return res.status(409).json({ error: result.state });

  // Intersect the request with what the collection actually holds, in the
  // COLLECTION's order — so the imported games land on the shelf in the order
  // the user just saw, and an id that is not in the collection is ignored rather
  // than trusted.
  const want = new Set(body.externalIds);
  const games = result.items
    .filter((g) => want.has(g.externalId))
    .map((g) => ({
      title: g.title,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
      // Hotlinked, never re-hosted (#172), and only from a host the provider
      // vouches for — providerCoverUrl returns null for anything else, which
      // costs a cover rather than the whole import.
      image: providerCoverUrl(g.imageUrl),
      source: {
        provider: provider.id,
        externalId: g.externalId,
        url: /^https?:\/\//.test(g.url || '') ? g.url : null,
      },
    }));
  if (!games.length) return res.json({ imported: 0, skipped: 0 });

  const limits = quota.enforced() ? { maxGames: quota.gamesPerRound() } : null;
  const actorMemberId = (round.members.find((m) => m.userId === req.userId) || {}).id;
  const created = await req.repo.createGames(req.params.rid, games, actorMemberId, limits);
  if (created === null) return res.status(404).json({ error: 'Round not found' });
  if (created === 'quota_games')
    return res.status(403).json({ error: 'quota_games', limit: limits.maxGames });

  if (created.created.length) {
    trackEvent('games_imported', { tenantId: req.tenantId });
    // ONE feed event for the whole import. The allowlist addFeedEvent enforces
    // is { type, title, coverUrl } with no count field, so an aggregate line is
    // not expressible without widening it (a deliberate act, see
    // .claude/rules/product-event-logging.md). Reporting the first game as an
    // ordinary `game_added` says one true thing instead of N noisy ones.
    const first = created.created[0];
    await emitFeedEvent(req.userId, { type: 'game_added', title: first.title, coverUrl: first.image });
  }
  res.json({ imported: created.created.length, skipped: created.skipped });
});

module.exports = router;
