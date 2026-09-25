'use strict';

/*
 * The FILTER half of a draw, resolved against a round (#1328).
 *
 * Two routes take the same six controls off the session setup screen — tags
 * (include + exclude), the tag mode, the metadata filters, multi-table and the
 * count — and both have to resolve them the same way:
 *
 *   - POST …/sessions draws with them and remembers them as the round's
 *     `lastSessionFilters` (#252);
 *   - POST …/filters saves them under a name (#1328).
 *
 * They were one inline block in the draw route until #1328 needed the second
 * caller. One function, so a saved filter and a remembered draw can never be
 * normalized by two slightly different copies of the same rules — the
 * shared-constants shape (.claude/rules/shared-constants-across-the-stack.md)
 * applied to a normalization rather than to a list.
 *
 * Both callers keep their own seat handling: a draw falls back to the whole
 * round when no seat survives, a saved filter stores only ACTIVE seats and
 * leaves the fallback to the screen that uses it.
 */

const { z } = require('zod');
const {
  metadataFilterOptions,
  normalizeMetadataFilters,
  countMetadataFilters,
} = require('../public/js/draw-pool');

// The request fields both routes accept, lenient exactly as the draw route has
// always been: an unknown or malformed value becomes the default rather than a
// 400. Spread into each route's own schema.
const DRAW_FILTER_FIELDS = {
  count: z.preprocess((v) => parseInt(v, 10), z.number().catch(NaN)),
  tagIds: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
  excludeTagIds: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
  // How the INCLUDED tags combine (#726). `.catch` swallows an absent,
  // misspelled or non-string value into 'all', the pre-#726 behaviour.
  tagMode: z.enum(['all', 'any']).catch('all'),
  // The metadata filters (#725). Passed through as-is and normalized below
  // against what the shelf can offer; the schema only keeps a non-object out.
  metadata: z.preprocess(
    (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    z.record(z.string(), z.unknown())
  ),
  // Multi-table (#796): only a literal `true` turns it on.
  multiTable: z.preprocess((v) => v === true, z.boolean()),
};

/*
 * Resolve the filter fields of a validated body against a round.
 *
 * `round` needs `tags`; `activeGames` is the shelf the metadata options are
 * derived from — the ACTIVE games, because those are the only ones a draw can
 * pick and the setup screen derives its controls from the same set.
 *
 * Returns the resolved values the draw consumes (`tagIds`/`excludeTagIds` are
 * null when empty — the pool's "no filter"), plus `hasMetadata`.
 */
function resolveDrawFilters(body, round, activeGames) {
  // Tag filter (#238, tri-state #241). Unknown ids are dropped (lenient, like
  // memberIds); empty means no filter.
  const roundTagIds = new Set(((round && round.tags) || []).map((tg) => tg.id));
  let tagIds = [...new Set(body.tagIds || [])].filter((x) => roundTagIds.has(x));
  if (tagIds.length === 0) tagIds = null;
  // A tag can't be both included and excluded — include wins, mirroring the
  // single-state-per-tag guarantee of the client cycle.
  let excludeTagIds = [...new Set(body.excludeTagIds || [])]
    .filter((x) => roundTagIds.has(x) && !(tagIds && tagIds.includes(x)));
  if (excludeTagIds.length === 0) excludeTagIds = null;
  // With nothing included the mode cannot mean anything, so it collapses to
  // 'all' and never reaches a stored blob. Kept for a SINGLE included tag, where
  // the two modes draw the same pool but the user's choice has to survive into
  // the preset.
  const tagMode = tagIds && body.tagMode === 'any' ? 'any' : 'all';

  // Normalized against what this shelf can actually offer, so an unknown
  // category is dropped exactly like an unknown tag id above, and a bound
  // outside the offered ladder collapses to "unfiltered" rather than 400ing.
  const metadata = normalizeMetadataFilters(body.metadata, metadataFilterOptions(activeGames || []));
  const hasMetadata = countMetadataFilters(metadata) > 0;

  const multiTable = body.multiTable === true;

  let count = body.count;
  if (!Number.isFinite(count) || count < 1) count = 1;

  return { tagIds, excludeTagIds, tagMode, metadata, hasMetadata, multiTable, count };
}

/*
 * The stored shape of a resolved filter — `round.lastSessionFilters` (#252) and
 * the filter half of a saved filter (#1328). Arrays rather than nulls, so the
 * client presets without re-deriving null-vs-empty.
 *
 * ABSENT-KEY DISCIPLINE: `tagMode` only when 'any', `metadata` only when
 * non-empty, `multiTable` only when true. The preset is replaced wholesale, so
 * an absent key is what makes the next screen open on the default — and an
 * ordinary blob stays byte-identical across both backends
 * (.claude/rules/postgres-backend.md).
 */
function filterPreset(r) {
  return {
    tagIds: r.tagIds || [],
    excludeTagIds: r.excludeTagIds || [],
    count: r.count,
    ...(r.tagMode === 'any' ? { tagMode: 'any' } : {}),
    ...(r.hasMetadata ? { metadata: r.metadata } : {}),
    ...(r.multiTable ? { multiTable: true } : {}),
  };
}

module.exports = { DRAW_FILTER_FIELDS, resolveDrawFilters, filterPreset };
