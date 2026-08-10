'use strict';

/* The session draw's game pool: which of a round's games a random draw may pick
   from, plus the shuffle that picks them.

   Extracted from lib/routes/sessions.js (#486) so the "is this game active"
   filter has ONE named home that can be unit-tested directly instead of only
   through an HTTP round-trip — see .claude/rules/active-games-filter-sites.md,
   which exists because that filter is duplicated across ~10 sites and the
   server-side ones fail silently. */

/* The two predicates the setup screen's live preview applies to the same games
   come from public/js/draw-pool.js (#634) — a backend file requiring out of
   public/js/ is the deliberate shape for a rule both sides must apply
   identically (.claude/rules/shared-constants-across-the-stack.md). Only the
   TAG clauses below stay here: the server resolves tags to explicit
   include/exclude id lists, while the client holds a tri-state chip map, so the
   two express the same filter over different inputs and sharing them would mean
   inventing a third representation for nobody's benefit. `isActiveGame` is
   re-exported so lib/routes/sessions.js's direct-pick guard keeps its one
   import. */
const { isActiveGame, fitsPlayerCount } = require('../public/js/draw-pool');

// The games a draw may pick from.
//
// `playerCount` is the number of PARTIES at the table, not bodies — the caller
// computes it (members + guests, with each team counting as one) and passes it
// in, because the same arithmetic is mirrored in the client's live preview and
// the two must agree (.claude/rules/session-teams.md §2). Deriving it from
// `round.members` here would silently drop guests.
//
// `tagIds`/`excludeTagIds` are null when unfiltered, already resolved against
// the round's own tags by the caller. Included tags combine per `tagMode`
// (#726): 'all' — the default — requires every one, 'any' at least one.
// Excluded tags reject a game carrying any of them in BOTH modes (#238,
// tri-state #241) — the mode widens what qualifies, it never softens a
// rejection.
//
// Anything other than the exact string 'any' reads as 'all', so an absent or
// malformed mode can only ever produce the pre-#726 pool.
function drawPool(round, { tagIds = null, excludeTagIds = null, tagMode = 'all', playerCount } = {}) {
  const carries = (g, x) => (g.tagIds || []).includes(x);
  const included = (g) =>
    !tagIds || (tagMode === 'any' ? tagIds.some((x) => carries(g, x)) : tagIds.every((x) => carries(g, x)));
  return round.games.filter(
    (g) =>
      isActiveGame(g) &&
      included(g) &&
      (!excludeTagIds || !excludeTagIds.some((x) => carries(g, x))) &&
      fitsPlayerCount(g, playerCount)
  );
}

// Fisher-Yates, in place — callers pass a copy when they need the original.
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { drawPool, isActiveGame, shuffle };
