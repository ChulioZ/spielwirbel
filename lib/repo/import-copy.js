'use strict';

/*
 * What travels when a game is COPIED onto another round's shelf — the
 * „Spiele übernehmen von" import at round creation (#921), and the copy half of
 * the games sheet (#916), which copies into a round that already exists.
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
//
// The test is null/undefined rather than falsiness, and the difference is real:
// a `minPlayers: 0` is a value, and `expansionOf: []` is the provider having
// named no base games. Neither may be dropped.
const carry = (dst, src, key) => {
  if (src[key] !== undefined && src[key] !== null) dst[key] = src[key];
};

// The fields copied verbatim beside the provider-metadata set. `source` is
// copied AS IS — no provider hop at import time, which would be N network calls
// inside round creation; the lazy backfill already exists for anything missing.
// `providerInfoAt` rides along with the metadata it stamps, so a copy is not
// re-fetched from BGG the first time somebody opens it.
//
// `expansionOf` is the one whose EMPTY form is a value rather than an absence:
// [] means "the provider named no base games" (#664/#703), so it must survive
// the copy while an absent key stays absent. It is reachable on an imported
// game because an expansion put on the shelf from the wish list stays its own
// row and keeps the key.
const COPIED_FIELDS = [
  'minPlayers', 'maxPlayers', 'source', 'edition', 'providerInfoAt', 'expansionOf',
];

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
  // Every object-valued field above — `source`, `edition`, the categories and
  // mechanics lists, and the expansions' own nested values — was carried by
  // REFERENCE. In the JSON backend `data` is one shared in-memory tree, so that
  // aliases two rounds' live objects and an in-place edit to the source round's
  // list would silently rewrite the copy's. It is the hazard the expansion deep
  // copy has always guarded against, one field set wider. Nothing mutates these
  // in place today (every writer replaces the whole value), so this closes a
  // trap rather than a live bug — and the contract suite is structurally blind
  // to it, because every read goes through clone(). See test/repo.test.js.
  return structuredClone(game);
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

// Copying onto an EXISTING shelf (#916). The field set is the import's, with one
// difference: the copy keeps the source game's shelf STATE. An import starts a
// round, so everything it carries belongs on the active shelf; a copy answers
// „wir haben diese Spiele auch hier", and a game the group has aussortiert or
// only wished for is still that game. The picker offers archived and wished rows
// for exactly that reason, so silently reviving them here would make the sheet
// lie about what it just did.
//
// Only the flag that is actually set is written — `importGame` has already put
// the false/null pair there, and an absent stamp stays null rather than becoming
// undefined (absent-key parity, .claude/rules/postgres-backend.md).
function copyGame(src, gid, remap, mintId) {
  const game = importGame(src, gid, remap, mintId);
  if (src.retired === true) { game.retired = true; game.retiredAt = src.retiredAt || null; }
  if (src.completed === true) { game.completed = true; game.completedAt = src.completedAt || null; }
  if (src.wish === true) { game.wish = true; game.wishAt = src.wishAt || null; }
  return game;
}

// Find-or-create each source tag on a target round that ALREADY has tags — the
// remap `moveGames` and `copyGames` both build (#253/#916), shared for the reason
// `importGame` is shared: two backends, one answer, and the trimmed
// case-insensitive dedupe rule `addTag` uses must be spelled once
// (.claude/rules/shared-constants-across-the-stack.md).
//
// Unlike `importTags` there is nothing to cap and nothing to drop: the target
// exists, so an over-cap remap is REFUSED by the caller's quota gate rather than
// silently trimmed — `createdTags` is reported back for exactly that check, and
// the caller must run it before writing anything.
//
// A tag no moving/copying game carries is skipped: it has nothing to remap and
// is not worth creating in the target.
function mergeTagsInto(srcTags, moving, targetTags, mintId) {
  const used = new Set();
  for (const g of moving) for (const x of g.tagIds || []) used.add(x);

  const remap = new Map();
  const created = [];
  let mergedTags = 0;
  const norm = (s) => s.trim().toLowerCase();
  for (const tag of srcTags || []) {
    if (!used.has(tag.id)) continue;
    const match = (targetTags || []).find((tg) => norm(tg.name) === norm(tag.name));
    if (match) {
      // Reused as it is spelled in the TARGET, and never restyled — same rule
      // addTag applies to a duplicate name (#255).
      remap.set(tag.id, match.id);
      mergedTags += 1;
      continue;
    }
    const fresh = { id: mintId(), name: tag.name };
    if (tag.icon) fresh.icon = tag.icon;
    created.push(fresh);
    remap.set(tag.id, fresh.id);
  }
  return { remap, created, mergedTags };
}

module.exports = { importGame, copyGame, importTags, mergeTagsInto, COPIED_FIELDS };
