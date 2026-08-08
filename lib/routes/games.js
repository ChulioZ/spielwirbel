'use strict';

/* Routes for the games of a round: add (with image), retire/restore,
   complete/uncomplete, wish/unwish (#560), permanently delete (games outside
   the active collection only).
   Mounted under /api/rounds/:rid/games (mergeParams for rid). */

const express = require('express');
const { z } = require('zod');
const storage = require('../storage');
const { upload, saveUploadedImage } = require('../upload');
const {
  getProvider,
  providerCoverUrl,
  roundAllowsProvider,
  resolveProviderCover,
} = require('../providers');
const { cachedIf } = require('../provider-cache');
// Prices for a wished-for game (#679). Its own module tree, deliberately not a
// sixth entry in lib/providers/ — a price source answers a different question and
// must never reach the add-game lookup registry or round.providers.
const prices = require('../prices');
// The one expansion bound the UI OFFERS (the free-text input's maxlength), so it
// is required out of public/js/ rather than duplicated — the shape in
// .claude/rules/shared-constants-across-the-stack.md. The per-game CAP is a
// quota (lib/quota.js): the client never states it, it only sees the 403.
const { EXPANSION_TITLE_MAX } = require('../../public/js/draw-pool');
const { validateBody } = require('../validate');
const quota = require('../quota');
const { trackEvent } = require('../observability');
const { emitFeedEvent } = require('../feed');
// The seat the acting account holds in this round (#207) — the actor for the four
// game-lifecycle activities below. Undefined when the caller holds no seat (an
// owner who never took one, or accounts-off mode), so a single-actor round's feed
// carries no actor at all. This was a local copy until #563, when it turned out to
// be missing its uid guard and to have been crediting all four activities to the
// round's FIRST member whenever accounts are off
// (.claude/rules/actor-seat-needs-a-uid-guard.md).
const { actorSeat } = require('../actor-seat');

const router = express.Router({ mergeParams: true });

// A player count sent as a form field: parseInt (NaN if unparseable), never a
// hard field error — the superRefine below owns the messages so they stay the
// exact strings the route used to emit. `catch(NaN)` keeps NaN flowing through
// (z.number() rejects NaN) instead of raising a generic "expected number" issue.
const playerField = z.preprocess((v) => parseInt(v, 10), z.number().catch(NaN));

// Create-game body. Title and the player range are the only hard requirements.
// Order of the superRefine issues mirrors the old top-to-bottom checks (title,
// then min, max) so the surfaced message is unchanged. The cover/source fields
// are read straight off req.body.
const createGameSchema = z
  .object({
    title: z.preprocess((v) => String(v || '').trim(), z.string()),
    minPlayers: playerField,
    maxPlayers: playerField,
    // Round-tag assignment (#238). Multipart repeats the field, so a single
    // value arrives as a bare string — coerce to a string array either way;
    // membership in the round's tag list is checked in the handler.
    tagIds: z.preprocess(
      (v) => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]),
      z.array(z.string())
    ),
    // Create the game straight onto the Wunschliste (#560) instead of the shelf.
    // OPT-IN and coerced from a string: this route is multipart, so a checkbox
    // arrives as 'true'/'1' rather than a boolean, and anything unrecognised has
    // to read as false — the shelf is the safe default, and a game silently
    // landing on the wish list would be invisible on the screen the user is
    // looking at.
    wish: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()),
  })
  .superRefine((val, ctx) => {
    if (!val.title) ctx.addIssue({ code: 'custom', message: 'Title is missing', path: ['title'] });
    if (!Number.isInteger(val.minPlayers) || val.minPlayers < 1)
      ctx.addIssue({ code: 'custom', message: 'minPlayers is required (integer >= 1)', path: ['minPlayers'] });
    if (!Number.isInteger(val.maxPlayers) || val.maxPlayers < val.minPlayers)
      ctx.addIssue({ code: 'custom', message: 'maxPlayers is required (integer >= minPlayers)', path: ['maxPlayers'] });
  });

// Edit-game body: only the pure, self-contained field checks (present-and-nonempty
// title). The min/max range is reconciled against the *stored* game in the
// handler (it defaults to the game's current values when one side is omitted), so
// it's business logic, not body-shape validation, and stays there.
const updateGameSchema = z.object({
  // `.optional()` short-circuits an absent key before this runs, so (like the old
  // `if (b.title !== undefined) String(b.title).trim()`) it only sees a present
  // value — a blank one 400s with the same message.
  title: z.preprocess((v) => String(v).trim(), z.string().min(1, 'Title is missing')).optional(),
});

// Move-games body (#253): the round to move into, plus an OPTIONAL subset of
// game ids (#402). Absent means "every game of the round" — the original
// all-or-nothing behaviour, kept as the default for backward compatibility and
// for the same absent-≠-empty reason as `providers`
// (.claude/rules/round-provider-config.md). An EMPTY array is a client error,
// not a silent no-op: nothing asked to move is a bug in the caller.
const moveGamesSchema = z.object({
  targetRoundId: z.preprocess((v) => String(v || '').trim(), z.string().min(1, 'targetRoundId is missing')),
  gameIds: z.array(z.string().min(1)).min(1, 'gameIds must not be empty').optional(),
});

// Replace a game's owned expansions (#653). Every entry is one of three things
// and the schema deliberately does not distinguish them — the handler does,
// because which fields it may TRUST differs per kind:
//
//   { id }                     -> keep an expansion already on this game, verbatim
//   { providerId }             -> a ticked provider expansion, resolved server-side
//   { title, min?, max? }      -> hand-typed
//
// `minPlayers`/`maxPlayers` are nullable rather than optional so the client can
// state "I don't know" explicitly; both must be present together and sane, since
// a HALF-declared range widens nothing at all (public/js/draw-pool.js).
const expansionEntrySchema = z.object({
  id: z.string().min(1).max(64).optional(),
  providerId: z.string().min(1).max(64).optional(),
  title: z.preprocess((v) => (v == null ? v : String(v).trim()),
    z.string().min(1).max(EXPANSION_TITLE_MAX)).optional(),
  minPlayers: z.number().int().min(1).max(999).nullable().optional(),
  maxPlayers: z.number().int().min(1).max(999).nullable().optional(),
});

// "Ins Regal" for a wished EXPANSION (#664): which game of this round it joins.
// The client picks the base game — from the row's server-resolved `expansionOf`
// when exactly one parent is in the round, by asking otherwise — and the repo
// refuses an id that is not another game of this same round.
const acquireExpansionSchema = z.object({
  baseGameId: z.preprocess((v) => String(v || '').trim(), z.string().min(1, 'baseGameId is missing')),
});

const setExpansionsSchema = z.object({
  // Bounded here as well as by the quota: the quota is inert outside the public
  // multi-tenant mode, so without this a self-hosted instance would accept an
  // unbounded array straight into the round document.
  expansions: z.array(expansionEntrySchema).max(500),
});

// Build the optional { provider, externalId, url } source link from POST fields,
// or null when no known provider is referenced.
function buildSource(body) {
  const provider = getProvider(body.sourceProvider);
  const externalId = String(body.sourceExternalId || '').trim();
  if (!provider || !externalId) return null;
  const url = String(body.sourceUrl || '').trim();
  return {
    provider: provider.id,
    externalId,
    url: /^https?:\/\//.test(url) ? url : null,
  };
}

router.post('/', upload.single('image'), async (req, res) => {
  // Light read: existence + tags. Only the quota branch below counts games,
  // and quotas are inert outside the public multi-tenant mode — so the full
  // round is fetched exactly when the cap is actually enforced.
  const round = quota.enforced()
    ? await req.repo.getRound(req.params.rid)
    : await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  // Per-tenant games-per-round cap (#139): only in the public multi-tenant mode.
  // Counts every game in the round (active + archived — both hold a row and a
  // possible cover). multer has buffered any upload in memory but nothing is
  // persisted yet, so refusing here leaves no orphan file.
  if (quota.enforced() && (round.games || []).length >= quota.gamesPerRound()) {
    return res.status(403).json({ error: 'quota_games', limit: quota.gamesPerRound() });
  }

  const body = validateBody(createGameSchema, req, res);
  if (!body) return;
  const { title, minPlayers, maxPlayers } = body;

  // Tags must belong to this round (deduped; unknown ids -> 400, #238).
  const tagIds = [...new Set(body.tagIds)];
  const roundTagIds = new Set((round.tags || []).map((tg) => tg.id));
  if (tagIds.some((x) => !roundTagIds.has(x)))
    return res.status(400).json({ error: 'Unknown tag' });

  // Cover: an uploaded file wins and is stored by us (verified by content —
  // magic bytes — not the client mimetype). A provider image URL is instead
  // stored as-is and hotlinked, never re-hosted (#172).
  let image = null;
  if (req.file) {
    image = await saveUploadedImage(req.file);
    if (!image) return res.status(400).json({ error: 'Uploaded file is not a supported image' });
  } else if (req.body.imageUrl) {
    image = providerCoverUrl(req.body.imageUrl);
  }

  const game = await req.repo.createGame(req.params.rid, {
    title,
    minPlayers,
    maxPlayers,
    image,
    source: buildSource(req.body),
    tagIds,
    wish: body.wish,
  }, actorSeat(round, req.userId));
  if (!game) return res.status(404).json({ error: 'Round not found' });
  // A wish is SILENT on all three channels (#560) — no Chronik entry (written in
  // the repo, which skips it likewise), no product event, no feed event. The
  // group has not acquired anything yet; the event fires when the game reaches
  // the shelf, from POST …/wish { wish: false }.
  if (!body.wish) {
    trackEvent('game_added', { tenantId: req.tenantId });
    // Freundeskreis feed (#325): "‹user› hat ‹Spiel› ins Regal gestellt". Attributed
    // to the acting account (req.userId, set only in accounts mode); title + cover
    // snapshot only — no round or member data. Best-effort, after the mutation.
    await emitFeedEvent(req.userId, { type: 'game_added', title: game.title, coverUrl: game.image });
  }
  res.status(201).json(game);
});

// Move games (active + archived) of this round into another round, merging the
// two rounds' tags by name (#253) — the whole shelf by default, or just the
// games named in `gameIds` (#402). Both rounds are looked up through the
// tenant-scoped req.repo, which is what makes "another round of the same user"
// enforce itself: a round of any other tenant is simply not found.
//
// Registered before the '/:gid' handlers below; it is a POST on a single
// segment, so it can't collide with the two-segment '/:gid/retire|complete'.
router.post('/move-to', async (req, res) => {
  // Owner-only (#411), same guard and placement as the round delete and the
  // share removal (lib/routes/rounds.js): a grant lets a grantee act WITHIN a shared
  // round, never reparent its whole shelf out of it. Fails fast, BEFORE the
  // round lookup — which is also what closes the target-round hole: a grant
  // re-scopes req.repo to the owner's WHOLE tenant (see
  // .claude/rules/round-grant-resolver.md), so without this a grantee could
  // resolve — and move games into — any round of the owner's they were never
  // invited to. Nothing from a grantee reaches that lookup now.
  if (req.grant) return res.status(403).json({ error: 'not_owner' });

  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const body = validateBody(moveGamesSchema, req, res);
  if (!body) return;
  if (body.targetRoundId === req.params.rid)
    return res.status(400).json({ error: 'Target round must be a different round' });

  const target = await req.repo.getRoundMeta(body.targetRoundId);
  if (!target) return res.status(404).json({ error: 'Target round not found' });

  // Per-tenant caps (#139), inert outside the public multi-tenant mode. Passed
  // down rather than checked here: the number of tags the move would create is
  // only known once the data layer has built the tag remap, and the refusal has
  // to be atomic with the move itself.
  const limits = quota.enforced()
    ? { maxGames: quota.gamesPerRound(), maxTags: quota.tagsPerRound() }
    : null;

  // Deduped here so both backends receive the same list and count. Membership
  // in the source round is checked down in the data layer instead of against a
  // snapshot read here: the shelf is already loaded inside the move's own
  // transaction, so the check is atomic with the move rather than racing it.
  const gameIds = body.gameIds ? [...new Set(body.gameIds)] : null;

  const result = await req.repo.moveGames(req.params.rid, body.targetRoundId, limits, gameIds);
  if (result === null) return res.status(404).json({ error: 'Round not found' });
  if (result === 'same_round')
    return res.status(400).json({ error: 'Target round must be a different round' });
  if (result === 'unknown_game') return res.status(400).json({ error: 'Unknown game' });
  if (result === 'quota_games')
    return res.status(403).json({ error: 'quota_games', limit: limits.maxGames });
  if (result === 'quota_tags')
    return res.status(403).json({ error: 'quota_tags', limit: limits.maxTags });

  res.json(result);
});

// Edit game details. Accepts any subset of title, min/max players, the cover
// image, and a provider source link. Sent as JSON, or as
// multipart when an image file is involved (new file, or removeImage=true to
// clear the current one). A cover can also be set from a provider imageUrl and
// the game linked to a provider (sourceProvider/…) — this is what "link an
// existing game to a provider" (issue #74) uses.
router.patch('/:gid', upload.single('image'), async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const game = await req.repo.getGame(req.params.rid, req.params.gid);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const b = req.body;
  const valid = validateBody(updateGameSchema, req, res);
  if (!valid) return;

  // Collect only the fields that actually change; the data layer applies them.
  const patch = {};

  if (valid.title !== undefined) patch.title = valid.title;
  if (b.minPlayers !== undefined || b.maxPlayers !== undefined) {
    const minPlayers = b.minPlayers !== undefined ? parseInt(b.minPlayers, 10) : game.minPlayers;
    const maxPlayers = b.maxPlayers !== undefined ? parseInt(b.maxPlayers, 10) : game.maxPlayers;
    if (!Number.isInteger(minPlayers) || minPlayers < 1)
      return res.status(400).json({ error: 'minPlayers must be an integer >= 1' });
    if (!Number.isInteger(maxPlayers) || maxPlayers < minPlayers)
      return res.status(400).json({ error: 'maxPlayers must be an integer >= minPlayers' });
    patch.minPlayers = minPlayers;
    patch.maxPlayers = maxPlayers;
  }

  // Replace the game's tag assignment (#238). Sent as JSON, so an array (or
  // null to clear) arrives as-is; unknown ids -> 400 like on create.
  if (b.tagIds !== undefined) {
    const list = Array.isArray(b.tagIds) ? b.tagIds.map(String) : b.tagIds == null ? [] : [String(b.tagIds)];
    const tagIds = [...new Set(list)];
    const roundTagIds = new Set((round.tags || []).map((tg) => tg.id));
    if (tagIds.some((x) => !roundTagIds.has(x)))
      return res.status(400).json({ error: 'Unknown tag' });
    patch.tagIds = tagIds;
  }

  // Attach a provider source link (used to link a previously-unlinked game to a
  // provider). Only set when a valid provider + id is supplied; never clobber an
  // existing link with an empty/invalid one.
  const source = buildSource(b);
  if (source) patch.source = source;

  // Detach an existing link (#282). Opt-in and multipart-safe like removeImage,
  // and it wins over a source sent in the same request — an explicit clear is
  // never the ambiguous half of a contradictory body.
  const removeSource = b.removeSource === 'true' || b.removeSource === true;
  if (removeSource) patch.source = null;

  // Image: a new upload replaces the old file; removeImage clears it; otherwise
  // a provider imageUrl (host-allowlisted) is stored as a hotlink (#172). The
  // old cover is deleted unless another game still references it — and only
  // when we actually hosted it (storage.remove ignores hotlinked URLs).
  const oldImage = game.image;
  let newImage = oldImage;
  if (req.file) {
    const stored = await saveUploadedImage(req.file);
    if (!stored) return res.status(400).json({ error: 'Uploaded file is not a supported image' });
    newImage = stored;
  } else if (b.removeImage === 'true' || b.removeImage === true) {
    newImage = null;
  } else if (b.imageUrl) {
    const linked = providerCoverUrl(b.imageUrl);
    if (linked) newImage = linked; // an untrusted/malformed URL keeps the old cover
  } else if (removeSource && !storage.isHostedImage(oldImage)) {
    // Unlinking takes the hotlinked provider cover with it — keeping it would
    // leave the game showing artwork from a provider it is no longer linked to.
    // A '/uploads/' cover is the member's own upload and stays. The game falls
    // back to the deterministic per-title placeholder (#256).
    newImage = null;
  }
  if (newImage !== oldImage) patch.image = newImage;

  // No activity entry: with inline editing, small tweaks are frequent and would
  // just clutter the feed. Retire/restore/add/delete remain the noteworthy events.
  const updated = await req.repo.updateGame(req.params.rid, req.params.gid, patch);
  if (!updated) return res.status(404).json({ error: 'Game not found' });
  if (oldImage && oldImage !== newImage && !(await req.repo.isImageReferenced(oldImage))) {
    await storage.remove(oldImage);
  }
  res.json(updated);
});

// Re-fetch a provider-linked game's cover from its provider (#518). Offered for
// any linked game — with a cover (it doubles as a repair for a rotted hotlink)
// or without one, which is the case that had no way back at all: unlinking is
// what drops a hotlinked cover, so the only route to a new one was to unlink,
// re-search and re-link.
//
// The request carries nothing but ?lang= — provider, external id and title all
// come from the STORED game, so a hand-rolled call cannot make us fetch an
// arbitrary title or write an arbitrary image URL onto a game (the same
// reasoning as the collection import's account-supplied BGG handle,
// .claude/rules/bgg-collection-import.md).
//
// A grantee may use it, like the PATCH above: this is an in-round edit, not a
// destructive round-level action (.claude/rules/round-grant-resolver.md §3).
router.post('/:gid/cover/provider', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const game = await req.repo.getGame(req.params.rid, req.params.gid);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const source = game.source || null;
  if (!source || !source.externalId) return res.status(400).json({ error: 'no_source' });
  const provider = getProvider(source.provider);
  if (!provider) return res.status(400).json({ error: 'Unknown provider' });
  // A round that switched this provider off has said "don't query it", and #294
  // made that enforced rather than advisory. The client hides the action in that
  // case, so this is only reachable from a stale tab.
  if (!roundAllowsProvider(round, provider.id))
    return res.status(403).json({ error: 'provider_disabled' });

  // Cached like the lookup hops, keyed on the EFFECTIVE provider locale so two
  // UI locales mapping to one storefront locale share an entry (#505) — a click
  // on a game whose cover we just resolved costs nothing upstream, and neither
  // does refreshing several games that share a provider.
  //
  // Only a RESOLVED cover is stored, never a null. This is the fetchCollection
  // rule (.claude/rules/bgg-collection-import.md §3) and it matters more here:
  // the button exists to REPAIR a missing cover, so caching "there is none"
  // would answer the user's retry from our own cache for ten minutes instead of
  // asking the provider whether anything had changed — which is precisely the
  // state they are trying to get out of.
  let resolved;
  try {
    resolved = await cachedIf(
      `${provider.id}:cover:${provider.resolveLocale(req.query.lang)}:${source.externalId}`,
      () => resolveProviderCover(provider, source.externalId, game.title, req.query.lang),
      (url) => !!url
    );
  } catch {
    return res.status(502).json({ error: 'provider_unreachable' });
  }
  // Hotlinked, never re-hosted (#172), and only from a host the provider vouches
  // for. A provider that legitimately has no cover for this id is a 404 the UI
  // can state honestly rather than a generic failure.
  const image = providerCoverUrl(resolved);
  if (!image) return res.status(404).json({ error: 'no_cover' });

  const oldImage = game.image;
  const updated = await req.repo.updateGame(req.params.rid, req.params.gid, { image });
  if (!updated) return res.status(404).json({ error: 'Game not found' });
  // Free the replaced cover unless another game still shows it — a no-op for a
  // hotlink, and the point for an '/uploads/' cover the member had uploaded.
  if (oldImage && oldImage !== image && !(await req.repo.isImageReferenced(oldImage))) {
    await storage.remove(oldImage);
  }
  res.json(updated);
});

// The current best price for a game the round wants but does not own (#679).
//
// Off by default: with PRICES_ENABLED unset the route 404s and the detail page
// is byte-identical to what it was — this is a new external dependency with no
// SLA, and it must be switchable off from the dashboard without a deploy (the
// DEMO_ENABLED shape, lib/demo.js).
//
// Answers `{ available: false }` rather than a 502 for every other failure: an
// unreachable aggregator, a game with no link, a provider with no price source,
// a game nobody stocks. A price box is an extra, and a failing extra must not
// break the page it sits on.
//
// Deliberately NOT gated on the round's provider setting (#294). That setting
// governs which providers the add-game LOOKUP queries; this game already carries
// its link, and the detail page already renders that link's "View on …" button
// regardless of the setting. The price follows the stored link, exactly like the
// link does.
//
// Wished-for games only. The round already owns everything else, so quoting a
// price on the shelf would be answering a question nobody asked — and the two
// archives are games they have deliberately moved on from.
router.get('/:gid/prices', async (req, res) => {
  if (!prices.pricesEnabled()) return res.status(404).json({ error: 'prices_disabled' });
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const game = await req.repo.getGame(req.params.rid, req.params.gid);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (!game.wish) return res.json({ available: false });
  res.json(await prices.priceFor(game, req.query.lang));
});

// Replace the expansions a round owns for one game (#653).
//
// A full replace, because the tick-list UI is inherently "here is the set we
// own" — there is no per-entry add or remove. A grantee may use it, like the
// PATCH above: it is an in-round edit, not a destructive round-level action
// (.claude/rules/round-grant-resolver.md §3).
//
// A STORED entry is immutable: the client may keep it (by sending its id) or
// drop it (by omitting it), never edit it. That is what keeps a provider's own
// title from being rewritten under our BGG licence
// (.claude/rules/add-game-lookup-provider.md, "BGG forbids modifying the
// retrieved data") without needing a per-field trust rule. Fixing a wrong range
// is remove-and-re-add as free text.
router.put('/:gid/expansions', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const game = await req.repo.getGame(req.params.rid, req.params.gid);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  // A wishlist-imported EXPANSION (#698) holds no expansions of its own, and
  // anything stored here would be silently dropped on acquire —
  // acquireWishExpansion carries only title/link/range onto the base game and
  // deletes the wish row in the same transaction. Presence check like the
  // acquire route's `not_wish` guard: the key is absent on ordinary games and
  // legitimately [] on an orphan expansion.
  if (Array.isArray(game.expansionOf)) return res.status(400).json({ error: 'is_expansion' });

  const body = validateBody(setExpansionsSchema, req, res);
  if (!body) return;

  const stored = new Map((game.expansions || []).map((e) => [e.id, e]));
  const keep = [];
  const wanted = [];      // provider ids still to resolve
  const slots = [];       // one per request item, in order
  const usedIds = new Set();

  for (const entry of body.expansions) {
    if (entry.id && stored.has(entry.id)) {
      // A repeated id is kept ONCE, and skipped rather than 400'd — it names a
      // real expansion, it just names it twice. The repo merges by id, so two
      // slots pointing at one stored entry would leave the game holding two
      // entries with the SAME id: removing either becomes ambiguous, and the
      // operator's expansion redaction — which locates an entry by id alone
      // across the whole shelf — stops being able to name one. The UI never
      // sends a duplicate; a hand-rolled request can.
      if (usedIds.has(entry.id)) continue;
      usedIds.add(entry.id);
      // Verbatim, including its source link and its addedAt.
      const known = stored.get(entry.id);
      keep.push(known);
      slots.push({ kind: 'keep', value: known });
      continue;
    }
    if (entry.providerId) {
      wanted.push(entry.providerId);
      slots.push({ kind: 'provider', providerId: entry.providerId });
      continue;
    }
    if (!entry.title) return res.status(400).json({ error: 'Expansion title is missing' });
    // Both bounds or neither: a lone bound states no interval, and treating it
    // as an open one would push the game down to solo or up to infinity.
    const min = entry.minPlayers == null ? null : entry.minPlayers;
    const max = entry.maxPlayers == null ? null : entry.maxPlayers;
    if ((min === null) !== (max === null))
      return res.status(400).json({ error: 'minPlayers and maxPlayers must be given together' });
    if (min !== null && max < min)
      return res.status(400).json({ error: 'maxPlayers must be >= minPlayers' });
    slots.push({ kind: 'typed', value: { title: entry.title, source: null, minPlayers: min, maxPlayers: max } });
  }

  // Resolve every newly ticked expansion in ONE upstream request, and take the
  // title and the range from the PROVIDER, never from the body — the same
  // reasoning as the collection import's server-side re-resolution.
  let resolved = new Map();
  if (wanted.length) {
    const provider = getProvider((game.source || {}).provider);
    if (!provider || typeof provider.expansionDetails !== 'function')
      return res.status(400).json({ error: 'expansions_unsupported' });
    // A round that switched this provider off has said "don't query it" (#294).
    if (!roundAllowsProvider(round, provider.id))
      return res.status(403).json({ error: 'provider_disabled' });
    let list;
    try {
      list = await cachedIf(
        `${provider.id}:expdetail:${[...new Set(wanted)].sort().join(',')}`,
        () => provider.expansionDetails([...new Set(wanted)]),
        (value) => value.length > 0
      );
    } catch {
      return res.status(502).json({ error: 'provider_unreachable' });
    }
    resolved = new Map(list.filter((e) => e.title).map((e) => [e.providerId, e]));
  }

  // Assemble in request order, dropping provider ids the provider does not know
  // (a stale tick-list) and any expansion this game already owns by source.
  const seen = new Set(keep.map((e) => (e.source || {}).externalId).filter(Boolean));
  const expansions = [];
  for (const slot of slots) {
    if (slot.kind !== 'provider') { expansions.push(slot.value); continue; }
    const hit = resolved.get(slot.providerId);
    if (!hit || seen.has(hit.providerId)) continue;
    seen.add(hit.providerId);
    expansions.push({
      title: hit.title,
      source: {
        provider: (game.source || {}).provider,
        externalId: hit.providerId,
        url: /^https?:\/\//.test(hit.url || '') ? hit.url : null,
      },
      minPlayers: hit.minPlayers,
      maxPlayers: hit.maxPlayers,
    });
  }

  // Per-game cap (#139's shape), only in the public multi-tenant mode. Refuses
  // the write cleanly rather than truncating — a silently clipped list is how a
  // group would lose an expansion with no error anywhere.
  if (quota.enforced() && expansions.length > quota.expansionsPerGame()) {
    return res.status(403).json({ error: 'quota_expansions', limit: quota.expansionsPerGame() });
  }

  const updated = await req.repo.setGameExpansions(
    req.params.rid, req.params.gid, expansions, actorSeat(round, req.userId));
  if (!updated) return res.status(404).json({ error: 'Game not found' });
  res.json(updated);
});

// Retire a game (or take it back into the collection). The game is kept, only
// flagged as retired with a timestamp.
router.post('/:gid/retire', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const retired = req.body.retired !== false; // default: true
  const game = await req.repo.retireGame(req.params.rid, req.params.gid, retired, actorSeat(round, req.userId));
  if (!game) return res.status(404).json({ error: 'Game not found' });
  res.json(game);
});

// Mark a game as completed ("durchgespielt") — the group finished its content,
// as opposed to retiring it. Like retiring it takes the game out of the active
// collection; the data layer keeps the two states mutually exclusive (#250).
router.post('/:gid/complete', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const completed = req.body.completed !== false; // default: true
  const game = await req.repo.completeGame(req.params.rid, req.params.gid, completed, actorSeat(round, req.userId));
  if (!game) return res.status(404).json({ error: 'Game not found' });
  res.json(game);
});

// Put a game on the round's Wunschliste, or take it off onto the shelf (#560).
// Symmetric with /retire and /complete so the three endpoints are one shape; the
// UI only ever sends `{ wish: false }` ("Ins Regal"), and the other direction
// comes free.
//
// Clearing the flag is an ACQUISITION, so the repo writes the ordinary
// `game_added` activity — and this route fires the same product + feed events a
// direct add does, which is what makes a game reaching the shelf via the wish
// list indistinguishable from one added straight to it.
router.post('/:gid/wish', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const wish = req.body.wish !== false; // default: true
  const game = await req.repo.wishGame(req.params.rid, req.params.gid, wish, actorSeat(round, req.userId));
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (!wish) {
    trackEvent('game_added', { tenantId: req.tenantId });
    await emitFeedEvent(req.userId, { type: 'game_added', title: game.title, coverUrl: game.image });
  }
  res.json(game);
});

// "Ins Regal" for a wished EXPANSION (#664) — the branch /wish cannot take.
//
// A wished expansion must NOT become a shelf entry: an expansion is never voted
// on, drawn, rated or tagged, so clearing its wish flag would put a box on the
// shelf that the group cannot actually play. It becomes an entry on its base
// game's `expansions` instead, and the wish row goes — one repo call, because a
// half-applied conversion has no meaningful state.
//
// Deliberately SILENT on the two non-Chronik channels, unlike /wish's
// acquisition: an expansion has no product counter and no feed event anywhere in
// the app, and adding one is a deliberate act rather than symmetry
// (.claude/rules/expansions-widen-by-union.md,
// .claude/rules/product-event-logging.md). The repo writes the ordinary
// `game_expansion_added` Chronik entry, the same one a tick on the detail page
// produces.
router.post('/:gid/acquire-expansion', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const body = validateBody(acquireExpansionSchema, req, res);
  if (!body) return;

  const limits = quota.enforced() ? { maxExpansions: quota.expansionsPerGame() } : null;
  const result = await req.repo.acquireWishExpansion(
    req.params.rid, req.params.gid, body.baseGameId, limits, actorSeat(round, req.userId));

  if (result === null) return res.status(404).json({ error: 'Game not found' });
  if (result === 'not_wish')
    return res.status(400).json({ error: 'Only a wished-for expansion can be acquired onto a game' });
  if (result === 'unknown_base') return res.status(404).json({ error: 'Base game not found' });
  if (result === 'quota_expansions')
    return res.status(403).json({ error: 'quota_expansions', limit: limits.maxExpansions });

  // The wish row is gone, so its cover is unreachable — free it unless another
  // game still shows the same one (an imported round copies the path, not the
  // file). A hotlinked provider cover is ignored by storage.remove() itself.
  if (result.image && !(await req.repo.isImageReferenced(result.image))) {
    await storage.remove(result.image);
  }

  res.json(result.game);
});

// Permanently delete an archived game: remove it from the collection and erase
// every trace of it from past sessions and the activity feed. Rating averages
// are derived from session votes, so they adjust automatically.
router.delete('/:gid', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  // The data layer removes the game and scrubs it from sessions + the feed,
  // returning the deleted game's cover path so the file can be cleaned up.
  const result = await req.repo.deleteGame(req.params.rid, req.params.gid, actorSeat(round, req.userId));
  if (result === null) return res.status(404).json({ error: 'Game not found' });
  if (result === 'not_archived')
    return res.status(400).json({ error: 'Only retired, completed or wished-for games can be deleted' });

  // Remove the cover image unless another game (e.g. in an imported round) still
  // uses the same one. Best effort; the store no longer references it.
  if (result.image && !(await req.repo.isImageReferenced(result.image))) {
    await storage.remove(result.image);
  }

  res.json({ ok: true });
});

module.exports = router;
