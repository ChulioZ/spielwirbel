'use strict';

/* The draw half of „Wer zu kurz kommt, ist dran" (#1830, replacing #1777's
   favourites-played logic). With the round setting on, every SEATED member who
   recently played games they did not enjoy pushes their favourites: a game's
   draw weight is `100 + Σ boost` over the seated members for whom it is a
   favourite, in integer percent. A favourite of one member at +50 % weighs 150;
   one of two members at +25 % and +10 % weighs 135; everything else keeps 100.
   Only the server draws (no client re-draw).

   The boost and the favourites come from public/js/vote-boost.js, required with
   the real sibling modules as `deps` (Node has no shared scope), so the draw,
   the result screen's weights and the hint cannot disagree about who is
   boosted (.claude/rules/shared-constants-across-the-stack.md). */

const { shuffle } = require('./draw');
const { memberBoosts, favouritesByMember, VOTE_WEIGHT_BASE } = require('../public/js/vote-boost');
const { sessionPeople, sessionPartyGroups } = require('../public/js/session-people');
const { isNameableGame } = require('../public/js/recap');
const { ratingRung, RATING_MAX } = require('../public/js/rating-faces');
const { sessionOutcome } = require('../public/js/session-outcome');
const { sortSessionsByDate } = require('../public/js/session-order');

const BOOST_DEPS = {
  peopleOf: sessionPeople,
  partyGroups: sessionPartyGroups,
  outcome: sessionOutcome,
  ratingRung,
  ratingMax: RATING_MAX,
  isNameableGame,
  sortByDate: sortSessionsByDate,
};

/* gameId -> integer draw weight in percent, for the games of `pool`. Seated
   members only, guests aside (they carry no member row), retired members never
   (memberBoosts drops them). The session being started is not in the round
   yet, so the boost is the fold over ALL played history. */
function drawWeights(round, pool, seatedIds) {
  const seated = new Set(seatedIds || []);
  const boosts = memberBoosts(round, null, BOOST_DEPS);
  const pushers = [...boosts].filter(([mid, b]) => b > 0 && seated.has(mid));
  const weights = new Map(pool.map((g) => [g.id, VOTE_WEIGHT_BASE]));
  if (!pushers.length) return weights;
  const favs = favouritesByMember(round, BOOST_DEPS);
  pushers.forEach(([mid, b]) => {
    (favs.get(mid) || new Set()).forEach((gid) => {
      if (weights.has(gid)) weights.set(gid, weights.get(gid) + b);
    });
  });
  return weights;
}

/* Which `count` games of `pool` enter the vote. Returns { picked }.

   Boost off — and on with nothing it could change (nobody seated is boosted, no
   boosted member has a favourite in the pool, every game weighs the same, or
   the draw takes the whole pool) — is the plain shuffle, byte for byte: the
   same function, the same RNG calls.

   Otherwise it is weighted sampling without replacement (Efraimidis–Spirakis:
   each game draws the key u^(1/w), the `count` highest win, w = weight/100). For
   a single game that is exactly „probability ∝ weight"; for several it keeps
   every draw distinct while still favouring the heavier games. */
function drawGames(round, pool, count, { boost = false, seatedIds = [], rng = Math.random } = {}) {
  const n = Math.min(count, pool.length);
  const plain = () => ({ picked: shuffle(pool.slice(), rng).slice(0, n) });
  if (!boost || n >= pool.length) return plain();
  const weights = drawWeights(round, pool, seatedIds);
  const distinct = new Set(weights.values());
  if (distinct.size <= 1) return plain();
  const keyed = pool.map((g) => ({ g, k: Math.pow(rng(), VOTE_WEIGHT_BASE / weights.get(g.id)) }));
  keyed.sort((a, b) => b.k - a.k);
  return { picked: keyed.slice(0, n).map((x) => x.g) };
}

module.exports = { BOOST_DEPS, drawWeights, drawGames };
