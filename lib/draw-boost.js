'use strict';

/* The opt-in draw boost (#1777): „Wer zu kurz kommt, ist dran". With the round
   setting on, the games liked by the seated member whose favourites have
   reached the table least get a better chance of entering the vote. The vote
   itself, its scores, the shelf score and the winner are untouched — this only
   shifts WHICH games are drawn, and only the server draws (no client re-draw).

   „Whose favourites reached the table" is #1776's `tasteShare`, required from
   public/js/ so the boost and the Pokale Rückblick cannot disagree about it
   (.claude/rules/shared-constants-across-the-stack.md). It is called with the
   real sibling modules as `deps`, because under Node the shared-scope globals
   it would otherwise read do not exist.

   THE DEFINITIONS (each an open question in the PR, chosen as the simplest
   defensible reading):
   - „lately" is ALL-TIME — the same figure the Rückblick shows, so the lobby
     line can be checked against a screen the group already reads.
   - Candidates are the SEATED members (guests have no taste, #458) with at
     least TASTE_SHARE_MIN_FAVOURITES favourites; below the Rückblick's own
     young-round bar (TASTE_SHARE_FROM_SESSIONS played evenings) nobody is
     behind, because „0 vs 2" is mostly which evenings came first.
   - BEHIND is STRICTLY the fewest evenings among at least two candidates. A tie
     for last boosts nobody: an arbitrary pick between equals would be a
     preference the numbers do not state.
   - Only that member's FAVOURITES (top face, tie-aware) are weighted, by
     DRAW_BOOST_WEIGHT; every other game keeps weight 1. */

const { shuffle } = require('./draw');
const { tasteShare, TASTE_SHARE_FROM_SESSIONS, TASTE_SHARE_MIN_FAVOURITES } = require('../public/js/taste-share');
const { sessionPeople } = require('../public/js/session-people');
const { isNameableGame } = require('../public/js/recap');
const { ratingRung, RATING_MAX } = require('../public/js/rating-faces');
const { sessionOutcome } = require('../public/js/session-outcome');

// How much likelier one of the behind member's favourites is to be drawn than
// any other game of the pool. Pinned by test/draw-boost.test.js.
const DRAW_BOOST_WEIGHT = 2;

const TASTE_DEPS = { peopleOf: sessionPeople, isNameableGame, ratingRung, ratingMax: RATING_MAX };

// The tasteShare entry of the member the boost is for, or null when nobody is
// strictly behind.
function behindEntry(round, seatedIds) {
  // Played evenings counted exactly as youngRoundPlayed (hub-insights.js) counts
  // them for the Rückblick's bar — through `sessionOutcome`, so a split parent
  // or a cancelled draw cannot count differently here.
  const played = (round.sessions || []).filter((s) => sessionOutcome(s) === 'played').length;
  if (played < TASTE_SHARE_FROM_SESSIONS) return null;
  const seated = new Set(seatedIds || []);
  const candidates = tasteShare(round, TASTE_DEPS)
    .filter((e) => seated.has(e.memberId) && e.favouriteIds.length >= TASTE_SHARE_MIN_FAVOURITES);
  if (candidates.length < 2) return null;
  const least = Math.min(...candidates.map((e) => e.evenings));
  const behind = candidates.filter((e) => e.evenings === least);
  return behind.length === 1 ? behind[0] : null;
}

/* Which `count` games of `pool` enter the vote. Returns { picked, boostMemberId }.

   Boost off — and on with nobody behind, or with nothing it could change —
   is the plain shuffle, byte for byte: the same function, the same RNG calls.
   `boostMemberId` is set ONLY when the boost actually changed the odds, so the
   lobby never announces an extra chance that was not there: some but not all of
   the pool are the member's favourites, and the draw leaves something out.

   Boosted, it is weighted sampling without replacement (Efraimidis–Spirakis:
   each game draws the key u^(1/w), the `count` highest win). For a single game
   that is exactly „probability ∝ weight"; for several it keeps every draw
   distinct while still favouring the heavier games. */
function drawGames(round, pool, count, { boost = false, seatedIds = [], rng = Math.random } = {}) {
  const n = Math.min(count, pool.length);
  const plain = () => ({ picked: shuffle(pool.slice(), rng).slice(0, n), boostMemberId: null });
  if (!boost || n >= pool.length) return plain();
  const member = behindEntry(round, seatedIds);
  if (!member) return plain();
  const favs = new Set(member.favouriteIds);
  const inPool = pool.filter((g) => favs.has(g.id)).length;
  if (inPool === 0 || inPool === pool.length) return plain();
  const keyed = pool.map((g) => ({ g, k: Math.pow(rng(), 1 / (favs.has(g.id) ? DRAW_BOOST_WEIGHT : 1)) }));
  keyed.sort((a, b) => b.k - a.k);
  return { picked: keyed.slice(0, n).map((x) => x.g), boostMemberId: member.memberId };
}

// The behind member's id, or null — what the spec pins the definition through.
function boostedMember(round, seatedIds) {
  const entry = behindEntry(round, seatedIds);
  return entry ? entry.memberId : null;
}

module.exports = { DRAW_BOOST_WEIGHT, boostedMember, drawGames };
