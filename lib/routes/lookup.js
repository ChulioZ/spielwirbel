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
 * Plus three BGG-only capabilities. The per-edition cover list (#519):
 *
 *   GET /api/rounds/:rid/lookup/covers?provider=bgg&id=13
 *       -> { covers: [{ imageUrl, edition, year, languages }] }
 *
 * the expansions a game has (#653), for the detail page's tick-list:
 *
 *   GET /api/rounds/:rid/lookup/expansions?provider=bgg&id=13
 *       -> { expansions: [{ providerId, title }] }
 *
 * and the one-shot collection import (#481):
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
const repo = require('../repo');
const { getProvider, providerCoverUrl, roundAllowsProvider } = require('../providers');
const { validateBody } = require('../validate');
const quota = require('../quota');
const { trackEvent } = require('../observability');
const { emitFeedEvent } = require('../feed');
// The lazy provider-metadata backfill (#717): the import is its third trigger
// — the bulk entry point, where filling at once is the polite option.
const { backfillProviderInfo } = require('../provider-info');

const router = express.Router({ mergeParams: true });

// The tiny in-memory cache that keeps us polite to the providers (debounced
// typing repeats the same queries) lives in lib/provider-cache.js since #518
// made lib/routes/games.js a second consumer. Keyed per provider+kind+key.
const { cached, cachedIf } = require('../provider-cache');

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
  // The three-state decode lives in lib/providers (roundAllowsProvider) since
  // #518 added a second server-side consumer — lib/routes/games.js' cover refresh.
  if (!roundAllowsProvider(round, provider.id)) {
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

/* ------------------------- edition covers (#519) --------------------------- */

// Every cover BGG holds for one game's editions, so the user can pick the
// printing on their own shelf instead of the item's default image. An OPTIONAL
// provider capability, like collection(): the four storefronts expose no
// per-edition image set, so a provider without it answers 400 rather than the
// route pretending every provider has one.
//
// Cached like the sibling hops (10 min, keyed on the id). No locale in the key:
// BGG's resolveLocale() returns a constant and the version list is the same in
// every language — which of them sorts first is a client concern.
//
// Every URL goes through providerCoverUrl before it leaves, so a host outside
// IMAGE_HOSTS can never be offered as something to store, and the client can
// send one back on save without the server having to trust it.
router.get('/covers', async (req, res) => {
  const { provider, status, error } = await resolveProvider(req);
  if (!provider) return res.status(status).json({ error });
  if (typeof provider.covers !== 'function') {
    return res.status(400).json({ error: 'covers_unsupported' });
  }
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing id' });
  try {
    const covers = await cached(`${provider.id}:covers:${id}`, () => provider.covers(id));
    res.json({
      covers: covers
        .map((c) => ({ ...c, imageUrl: providerCoverUrl(c.imageUrl) }))
        .filter((c) => c.imageUrl),
    });
  } catch {
    res.status(502).json({ error: 'provider_unreachable' });
  }
});

/* --------------------------- expansions (#653) ----------------------------- */

// The expansions the provider knows for one game, as the tick-list on the game
// detail page. An OPTIONAL capability like covers() and collection(): the four
// storefronts have no concept of an expansion, so a provider without
// `expansionDetails` answers 400 and the client falls back to the free-text
// path rather than to an error.
//
// It goes through provider.detail() — the SAME call and the SAME cache entry the
// add-game hop uses — because BGG already ships the `<link
// type="boardgameexpansion">` children in that body. So opening the section
// right after linking a game costs no upstream request at all, and it needs no
// heavier query parameter (contrast covers(), where `versions=1` multiplies the
// body 2.5–5× and therefore had to be its own lazy hop).
router.get('/expansions', async (req, res) => {
  const { provider, status, error } = await resolveProvider(req);
  if (!provider) return res.status(status).json({ error });
  if (typeof provider.expansionDetails !== 'function') {
    return res.status(400).json({ error: 'expansions_unsupported' });
  }
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing id' });
  try {
    const game = await cached(
      `${provider.id}:game:${localeKey(provider, req)}:${id}`,
      () => provider.detail(id, req.query.lang)
    );
    res.json({ expansions: (game && game.expansions) || [] });
  } catch {
    res.status(502).json({ error: 'provider_unreachable' });
  }
});

/* ------------------------- collection import (#481) ------------------------ */

// Which games to import, by the provider id the collection listed them under.
// The TITLE and the player range are never taken from the request: re-resolving
// each id against the fetched collection server-side is what keeps a hand-rolled
// request from writing an arbitrary title into someone's Regal.
//
// `covers` is the one exception, and only since #519 let the import screen offer
// a per-game edition cover: a chosen URL rides along keyed by external id, and
// the server accepts it only through providerCoverUrl — i.e. exactly the host
// allowlist that already gates the `imageUrl` a single POST /games may carry
// (.claude/rules/add-game-lookup-provider.md, "the cover-host allowlist is the
// trust boundary"). Anything else falls back to the collection's own cover, so a
// rejected URL costs the *choice*, never the cover.
//
// Bounded to the same 2000 ids the list is, so the body cannot grow unbounded.
const importSchema = z.object({
  externalIds: z.array(z.string().min(1)).min(1, 'externalIds must not be empty').max(2000),
  covers: z
    .record(z.string(), z.string().max(2048))
    .refine((m) => Object.keys(m).length <= 2000, 'too many covers')
    .optional(),
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

// Which of the account's BGG shelves this request is about: the owned collection
// (the Regal import, #481) or the wishlist (the Wunschliste import, #560).
// Anything else reads as 'own' — the provider allowlists it again, so this is
// only about naming one cache entry per shelf.
const collectionStatus = (req) => (req.query.status === 'wishlist' ? 'wishlist' : 'own');

// Fetch one of the acting account's collections through the same 10-minute cache
// the search and detail hops use — a collection body is far heavier than either,
// and the import sheet fetches it once to list and once more to import. Keyed by
// the BGG handle, because the collection belongs to that BGG user rather than to
// our account: two of our accounts linking the same handle correctly share one
// fetch.
//
// THE STATUS IS PART OF THE KEY, and it has to be: the two shelves are different
// documents for the same handle, so a key without it answers the wishlist import
// from the owned collection's entry (or the reverse) for the next ten minutes —
// a completely plausible wrong result with no error anywhere. The sibling trap is
// that every test spec needs its own handle AND status or it is served an earlier
// spec's entry (.claude/rules/bgg-collection-import.md §4).
//
// It does NOT go through cached(), because only a settled 'ok' may be stored.
// Caching 'queued' would make "BGG is still building it, try again shortly" a
// lie for the next ten minutes: the retry the message asks for would be answered
// from the cache instead of asking BGG whether it had finished.
function fetchCollection(provider, username, status) {
  return cachedIf(
    `${provider.id}:collection:${status}:${username.toLowerCase()}`,
    () => provider.collection(username, status),
    (value) => value.state === 'ok'
  );
}

// Which base games each wished EXPANSION in the list belongs to (#664), keyed by
// the expansion's own provider id.
//
// It needs a second hop: a collection item carries no `<link>` elements at all,
// so the body says *that* an item is an expansion and never *which* game it
// expands. Keyed on the exact id set rather than on the handle, so a wishlist
// that changed between two fetches cannot be answered from the previous set's
// entry — and two accounts wishing the same expansions still share one fetch.
//
// EVERY failure degrades to "no parents known" rather than to an error: the
// collection itself already arrived, and an expansion with no parent is a
// perfectly good unattached wish that the acquire flow asks about. Failing the
// whole listing because the optional second hop stumbled would be a strictly
// worse answer.
async function resolveExpansionParents(provider, items) {
  const ids = items.filter((g) => g.expansion).map((g) => g.externalId);
  if (!ids.length || typeof provider.expansionParents !== 'function') return new Map();
  try {
    const list = await cachedIf(
      `${provider.id}:expparents:${[...ids].sort().join(',')}`,
      () => provider.expansionParents(ids),
      (value) => value.length > 0
    );
    return new Map(list.map((e) => [e.providerId, e.parents]));
  } catch {
    return new Map();
  }
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
    result = await fetchCollection(provider, username, collectionStatus(req));
  } catch {
    return res.status(502).json({ error: 'provider_unreachable' });
  }

  // Mark what the round already holds rather than hiding it: the list is the
  // user's own collection, and silently dropping half of it reads as the import
  // having lost games. The client shows these checked-off and non-selectable.
  //
  // Deliberately unfiltered by game state — a game already on the shelf, in
  // either archive, or already wished for is "present" for both imports. That is
  // what stops the wishlist import re-adding a game the group has since bought
  // (it would land as a wish for a game on their own shelf), and it matches what
  // createGames' own `sameSource` dedupe will do a moment later.
  const present = new Set(
    (round.games || [])
      .filter((g) => g.source && g.source.provider === provider.id)
      .map((g) => g.source.externalId)
  );
  // An expansion the round has already ACQUIRED lives on its base game's row, not
  // as a game of its own (#664) — so without this the wishlist import would offer
  // it again on every re-run and re-add it as a fresh wish for something the
  // group owns. Same reasoning as the unfiltered game states above.
  for (const g of round.games || []) {
    for (const e of g.expansions || []) {
      if (e.source && e.source.provider === provider.id) present.add(e.source.externalId);
    }
  }

  const parents = await resolveExpansionParents(provider, result.items);
  res.json({
    state: result.state,
    games: result.items.map((g) => ({
      externalId: g.externalId,
      title: g.title,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
      // What the picker needs to say "Erweiterung zu Catan" rather than offering
      // an expansion as if it were a game. Both are always present so the shape
      // is uniform; on the owned shelf they are `false` and `[]` by construction.
      expansion: g.expansion === true,
      expansionOf: parents.get(g.externalId) || [],
      // Through the same gate the import itself applies, for two reasons: the
      // listing then previews exactly what would be stored (a cover the
      // allowlist refuses shows as the placeholder rather than as a preview
      // that silently vanishes on import), and since #519 the client renders
      // this into `background-image: url('…')` — the CSS-injection context
      // COVER_UNSAFE_RE exists for.
      imageUrl: providerCoverUrl(g.imageUrl),
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

  const shelf = collectionStatus(req);
  let result;
  try {
    result = await fetchCollection(provider, username, shelf);
  } catch {
    return res.status(502).json({ error: 'provider_unreachable' });
  }
  if (result.state !== 'ok') return res.status(409).json({ error: result.state });

  // Intersect the request with what the collection actually holds, in the
  // COLLECTION's order — so the imported games land on the shelf in the order
  // the user just saw, and an id that is not in the collection is ignored rather
  // than trusted.
  const want = new Set(body.externalIds);
  const chosen = body.covers || {};
  // Re-resolved server-side from the provider, exactly like the titles and the
  // ranges beside it (#664): the body may say WHICH candidates to import, never
  // what they expand. Taking a parent from the request would let a hand-rolled
  // call graft a row onto an arbitrary game of the round.
  const parents = await resolveExpansionParents(provider, result.items);
  const games = result.items
    .filter((g) => want.has(g.externalId))
    .map((g) => ({
      title: g.title,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
      // Present ONLY on an expansion, and possibly empty — an expansion BGG
      // reports no inbound link for is still a game the group wants, so it lands
      // as an unattached wish and the acquire flow asks which game it joins.
      // Its presence is also what marks the row as an expansion at all, so the
      // key must stay absent on an ordinary game (absent-key parity).
      ...(g.expansion ? { expansionOf: parents.get(g.externalId) || [] } : {}),
      // Hotlinked, never re-hosted (#172), and only from a host the provider
      // vouches for — providerCoverUrl returns null for anything else, which
      // costs a cover rather than the whole import. An edition cover the user
      // picked on the import screen (#519) wins where it survives that gate.
      image:
        providerCoverUrl(Object.prototype.hasOwnProperty.call(chosen, g.externalId) ? chosen[g.externalId] : null) ||
        providerCoverUrl(g.imageUrl),
      source: {
        provider: provider.id,
        externalId: g.externalId,
        url: /^https?:\/\//.test(g.url || '') ? g.url : null,
      },
    }));
  if (!games.length) return res.json({ imported: 0, skipped: 0 });

  const limits = quota.enforced() ? { maxGames: quota.gamesPerRound() } : null;
  const actorMemberId = (round.members.find((m) => m.userId === req.userId) || {}).id;
  const wish = shelf === 'wishlist';
  const created = await req.repo.createGames(req.params.rid, games, actorMemberId, limits, wish);
  if (created === null) return res.status(404).json({ error: 'Round not found' });
  if (created === 'quota_games')
    return res.status(403).json({ error: 'quota_games', limit: limits.maxGames });

  // Fill the provider metadata for what just landed (#717 follow-up). The
  // reported gap was import → draw → vote with no info anywhere: a collection
  // body carries none of it, and the session-start backfill races the first
  // voter. Import time is the polite place — one batched /thing per 60 games,
  // long before anyone draws. Fire-and-forget like the session-start trigger;
  // a failure retries via the other two triggers.
  if (created.created.length) {
    backfillProviderInfo(req.repo, req.params.rid, created.created).catch(() => {});
  }

  // A wishlist import is SILENT on all three channels (#560), like adding a
  // single wish: the repo writes no `games_imported` activity either. The group
  // has acquired nothing, so there is nothing to report to the round or to a
  // friend's feed — the event fires later, per game, when one reaches the shelf.
  if (created.created.length && !wish) {
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
