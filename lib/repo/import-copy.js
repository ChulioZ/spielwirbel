'use strict';

/*
 * What travels when `createRound`'s „Spiele übernehmen von" import copies a
 * game onto a brand-new round's shelf (#921).
 *
 * It is ONE module because both backends have to reach the same answer and the
 * question is pure field shape — the same reason `lib/provider-info-fields.js`
 * is shared rather than restated per backend
 * (.claude/rules/shared-constants-across-the-stack.md). The id minter is
 * injected because that is the only part the two backends genuinely disagree
 * about (`id` vs `newId`). The expansion deep-copy moved in here with it: this
 * import was its only caller, and each backend keeps only `mergeExpansions`,
 * which has callers of its own.
 *
 * Before #921 the import named only `title` and `image`, so a copied game
 * arrived as a STUB of the original. The player range was the sharp loss and it
 * was silent: `fitsPlayerCount` (public/js/draw-pool.js) reads an absent range
 * as "any table size" — deliberately, so a free-text game nobody filled in stays
 * drawable — so a 3-4 game imported into a new round was offered to a table of
 * eight, by the draw AND by the setup screen's preview, with no error anywhere.
 * Losing `source` was a dead end rather than a missing link: without it the copy
 * cannot be repaired (`POST …/:gid/cover/provider` 400s `no_source`) or enriched
 * (the lazy backfill has nothing to key on), and the cover it DID copy is a
 * hotlink to the provider's own URL (.claude/rules/provider-cover-hotlinking.md)
 * — so when that URL rots, the one button that would fix it is unavailable.
 */

const { assignProviderInfo } = require('../provider-info-fields');

// Every key stays ABSENT on a copy whose source does not carry it, never null —
// a free-text game's row must come out byte-identical to what it always was
// (.claude/rules/postgres-backend.md). A stored null is treated as absent for
// the same reason: the copy must not invent a shape the source never had.
const carry = (dst, src, key) => {
  if (src[key] !== undefined && src[key] !== null) dst[key] = src[key];
};

// The fields copied verbatim beside the provider-metadata set. `source` is
// copied AS IS — no provider hop at import time, which would be N network calls
// inside round creation; the lazy backfill already exists for anything missing.
// `providerInfoAt` rides along with the metadata it stamps, so a copy is not
// re-fetched from BGG the first time somebody opens it.
const COPIED_FIELDS = ['minPlayers', 'maxPlayers', 'source', 'edition', 'providerInfoAt'];

// One imported game: a fresh row on `gid`, carrying everything but the history.
// `remap` maps the source round's tag ids onto the ones importTags created; a
// tag that did not make it simply drops out, exactly as moveGames' remap does.
function importGame(src, gid, remap, mintId) {
  const game = {
    id: gid,
    title: src.title,
    // Shares the same image file — files are never deleted, and two games
    // naming one path is a shape isImageReferenced already handles
    // (.claude/rules/deletion-paths-must-free-cover-objects.md).
    image: src.image,
    retired: false,
    retiredAt: null,
    completed: false,
    completedAt: null,
    wish: false,
    wishAt: null,
  };
  for (const key of COPIED_FIELDS) carry(game, src, key);
  // The guards decide what counts as a value worth storing, so a field added to
  // PROVIDER_INFO_FIELDS travels without an edit here
  // (.claude/rules/provider-info-is-a-field-set.md).
  assignProviderInfo(game, src);
  const tagIds = (src.tagIds || []).map((x) => remap.get(x)).filter(Boolean);
  if (tagIds.length) game.tagIds = tagIds;
  // Owned expansions ride along (#653) — the copy is answering "we have these
  // games", and what is in the box is part of that. Fresh ids and a DEEP copy,
  // both load-bearing: sharing the array would alias two rounds' live objects in
  // the JSON backend, and a duplicated expansion id would make the operator's
  // redaction ambiguous across games.
  if ((src.expansions || []).length) {
    game.expansions = src.expansions.map((e) => ({ ...e, id: mintId() }));
  }
  return game;
}

// The tags at least one imported game carries, recreated on the new round. The
// target starts empty, so unlike moveGames' remap there is nothing to merge with
// — every used tag is created, in the source round's own tag order.
//
// A `limits.maxTags` is capped SILENTLY rather than refusing: round creation
// must not fail over a secondary field the user did not ask for, and they asked
// for a round, not for tags. A game whose tag did not fit keeps the ids that do
// exist. In practice the cap is unreachable — the source round is bounded by the
// same ceiling — so this only bites a round that predates a lowered cap.
function importTags(srcTags, importing, limits, mintId) {
  const used = new Set();
  for (const g of importing) for (const x of g.tagIds || []) used.add(x);

  const max = limits && Number.isFinite(limits.maxTags) ? limits.maxTags : Infinity;
  const tags = [];
  const remap = new Map();
  for (const tag of srcTags || []) {
    if (!used.has(tag.id)) continue;
    if (tags.length >= max) break;
    const fresh = { id: mintId(), name: tag.name };
    if (tag.icon) fresh.icon = tag.icon;
    tags.push(fresh);
    remap.set(tag.id, fresh.id);
  }
  return { tags, remap };
}

module.exports = { importGame, importTags, COPIED_FIELDS };
