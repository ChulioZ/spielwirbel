'use strict';

/* The session draw's game pool: which of a round's games a random draw may pick
   from, plus the shuffle that picks them.

   Extracted from lib/routes/sessions.js (#486) so the "is this game active"
   filter has ONE named home that can be unit-tested directly instead of only
   through an HTTP round-trip — see .claude/rules/active-games-filter-sites.md,
   which exists because that filter is duplicated across ~10 sites and the
   server-side ones fail silently. */

// A game is in the active collection when it sits in NEITHER archive (#250).
// The direct-pick guard in the sessions route shares this predicate, so a third
// archive state added here closes both draw paths at once rather than leaving
// the archived game playable by id.
function isActiveGame(game) {
  return !game.retired && !game.completed;
}

// The games a draw may pick from.
//
// `playerCount` is the number of PARTIES at the table, not bodies — the caller
// computes it (members + guests, with each team counting as one) and passes it
// in, because the same arithmetic is mirrored in the client's live preview and
// the two must agree (.claude/rules/session-teams.md §2). Deriving it from
// `round.members` here would silently drop guests.
//
// `tagIds`/`excludeTagIds` are null when unfiltered, already resolved against
// the round's own tags by the caller. Included tags use AND semantics (a game
// must carry every one); excluded tags reject a game carrying any of them
// (#238, tri-state #241).
function drawPool(round, { tagIds = null, excludeTagIds = null, playerCount } = {}) {
  return round.games.filter(
    (g) =>
      isActiveGame(g) &&
      (!tagIds || tagIds.every((x) => (g.tagIds || []).includes(x))) &&
      (!excludeTagIds || !excludeTagIds.some((x) => (g.tagIds || []).includes(x))) &&
      (typeof g.minPlayers !== 'number' || playerCount >= g.minPlayers) &&
      (typeof g.maxPlayers !== 'number' || playerCount <= g.maxPlayers)
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
