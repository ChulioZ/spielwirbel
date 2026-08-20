/* Spielwirbel – what one vote on a game is worth (#797).

   The retirement proposal is not a second, independent control any more: it is
   the ZERO of the same 0–5 scale the rest of the vote uses. A voter who picks
   the trash tile is saying "gar nicht", one rung below the 1 — so that vote
   counts into every average as `0` rather than being left out of it while
   quietly moving a separate counter.

   Storage keeps its `{ rating, retire }` shape and there is no migration
   (CLAUDE.md), so the rule has to be applied ON READ. That is the whole reason
   this is one shared file rather than a line repeated at each of the eight
   sites: the client renders the averages and the server computes `groupRating`
   and the cross-tenant corpus aggregate from the same votes, so a drifted copy
   would make two screens disagree about the same game with no error anywhere
   (.claude/rules/shared-constants-across-the-stack.md). Pure and
   dependency-free, so it works both as a shared-scope frontend script and as a
   CommonJS module the server and the test suite require.
   Load order: see index.html — before core.js. */

'use strict';

// The scale's ends. `RATING_MIN` is 0 because of `retire`, not because a 0 is
// ever stored: `sanitizePersonVotes` still validates a written rating as 1–5.
const RATING_MIN = 0;
const RATING_MAX = 5;

// Does this vote propose retiring the game? A guest can never carry the flag —
// their card offers no zero tile and the server strips a hand-crafted one
// (#458, .claude/rules/session-guests-are-not-members.md).
function wantsRetire(vote) {
  return !!vote && vote.retire === true;
}

// What the vote counts as, or null when it counts as nothing.
//
// Retirement WINS over a stored rating. New data can no longer carry both —
// the tiles are mutually exclusive and `sanitizePersonVotes` drops the rating
// when the flag is set — but data written before #797 can, and resolving it
// here is what makes every one of those legacy rows correct for free.
//
// `Number.isFinite`, deliberately not `Number.isInteger`: it is the exact JS
// equivalent of Postgres's `jsonb_typeof(…) = 'number'`, which is how the
// corpus aggregate in lib/repo/postgres.js has to spell the same test (SQL
// cannot require this file). JSON has no NaN or Infinity, so the two admit
// precisely the same values — and a rule the two backends express differently
// is a disagreement waiting for a fixture nobody wrote.
function effectiveRating(vote) {
  if (!vote) return null;
  if (wantsRetire(vote)) return RATING_MIN;
  return Number.isFinite(vote.rating) ? vote.rating : null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RATING_MIN, RATING_MAX, wantsRetire, effectiveRating };
}
