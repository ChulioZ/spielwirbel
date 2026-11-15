/* Spielwirbel – „Wer zu kurz kommt, ist dran" (#1830): the rating-based boost.

   With the round setting on, a member who recently PLAYED games they did not
   enjoy gets more say next time — their ballot weighs more in the session
   result and in the table-split proposals, and their favourites are likelier
   to be drawn. It replaced #1777's "whose favourites reached the table least",
   which measured an all-time count rather than whether anyone had a bad run.

   THE ACCRUAL. Walk the round's PLAYED sessions (`sessionOutcome === 'played'`:
   cancelled draws and split parents are out, each split TABLE is in, with its
   own `chosenGameId`) in date order — `createdAt`, so a hand-dated session
   (#1616) sits where it was played. For every member SEATED there, `r` is their
   rating of the game they actually played:
     1. their vote on it in that session, if they cast one;
     2. else their mean rating of that game from sessions STRICTLY BEFORE this
        one, rounded to a face (`ratingRung`, the one rounding every screen
        uses). Strictly before, so a later vote can never rewrite an earlier
        session's boost. A split table carries no votes of its own, so this is
        how its people's parent-session vote reaches it;
     3. no rating at all → the boost carries unchanged.
   Then `BOOST_STEP[r]` is added, and a 4 or a 5 resets it to 0. Uncapped by
   operator decision. Absent members carry. Guests are never boosted (#458) and
   retired members get none (#1006) — both read as weight 100.

   WHERE IT ACTS — only ever inside a session. The shelf, the Spielepass,
   Discover, the Pokale, achievements, the period recap and the recommender all
   score the raw stored votes; nothing here writes a vote or stores a weight.

   Weights are INTEGER PERCENT (`100 + boost`), never fractions: `scoreSplit`'s
   determinism rests on exact integer sums (see TILE_VALUE in vote-score.js),
   and integer weights keep every `Σ w·tileValue(r)` an integer.

   SHARED-SCOPE AND NODE. lib/draw-boost.js and lib/session-split.js require
   this file, and a public/js file cannot require() a sibling, so the siblings
   come in as `deps` (memberStats' shape); the browser omits the argument and
   the shared global scope answers. Under Node a forgotten `deps` throws a
   ReferenceError rather than quietly computing something else.

   Load order: see index.html. Every sibling is read at call time. */

'use strict';

// Boost points added for a played game rated r, indexed by rating like
// TILE_VALUE (slot 0 is a hole). 4 and 5 are not "+0" but a RESET — see
// `boostAfter`, which is the one place that reads this table.
const BOOST_STEP = [null, 50, 25, 10, 0, 0];
// A rating at or above this resets the boost: they enjoyed it.
const BOOST_RESET_FROM = 4;
// Everybody's weight before any boost, in percent.
const VOTE_WEIGHT_BASE = 100;

function voteBoostDeps(deps) {
  return deps || {
    peopleOf: sessionPeople,
    partyGroups: sessionPartyGroups,
    outcome: sessionOutcome,
    ratingRung,
    ratingMax: RATING_MAX,
    isNameableGame,
    sortByDate: sortSessionsByDate,
  };
}

function boostAfter(boost, r) {
  if (!Number.isInteger(r) || r < 1 || r >= BOOST_STEP.length) return boost;
  return r >= BOOST_RESET_FROM ? 0 : boost + BOOST_STEP[r];
}

/* memberId -> boost (whole percentage points, ≥ 0) for every ACTIVE member,
   folded over the played sessions before `session` — or over all of them when
   `session` is not (yet) one of the round's, which is the draw's case: the
   session being started does not exist until the draw has picked. */
function memberBoosts(round, session, deps) {
  const d = voteBoostDeps(deps);
  const ordered = d.sortByDate(round.sessions || []);
  const stopId = session && session.id;
  const boost = new Map((round.members || []).map((m) => [m.id, 0]));
  // memberId -> gameId -> { sum, n }, over every session already walked, so the
  // fallback mean is "strictly before" by construction and costs one pass.
  const seen = new Map();

  for (const s of ordered) {
    if (stopId && s.id === stopId) break;
    const votes = s.votes || {};
    if (d.outcome(s) === 'played' && s.chosenGameId) {
      const gid = s.chosenGameId;
      d.peopleOf(round, s).forEach((p) => {
        // Members only: a guest id has no member row, so the map lookup is the
        // whole guest rule — a second `p.guest` check would be a guard no test
        // could reach (.claude/rules/redundant-guards-make-each-other-untestable.md).
        if (!boost.has(p.id)) return;
        const own = (votes[p.id] || {})[gid];
        let r = own && Number.isFinite(own.rating) ? own.rating : null;
        if (r === null) {
          const prior = (seen.get(p.id) || new Map()).get(gid);
          if (prior) r = d.ratingRung(prior.sum / prior.n);
        }
        if (r !== null) boost.set(p.id, boostAfter(boost.get(p.id), r));
      });
    }
    // This session's votes join the history only AFTER it was scored.
    Object.keys(votes).forEach((pid) => {
      const byGame = votes[pid] || {};
      Object.keys(byGame).forEach((gid) => {
        const v = byGame[gid];
        if (!v || !Number.isFinite(v.rating)) return;
        let games = seen.get(pid);
        if (!games) seen.set(pid, (games = new Map()));
        const acc = games.get(gid) || { sum: 0, n: 0 };
        acc.sum += v.rating;
        acc.n += 1;
        games.set(gid, acc);
      });
    });
  }

  (round.members || []).forEach((m) => { if (m.retired) boost.delete(m.id); });
  return boost;
}

/* memberId -> Set of favourite game ids. A FAVOURITE is #1776's definition,
   moved here when taste-share.js went: a game whose average rating by that
   member draws as the TOP face (`ratingRung(avg) === RATING_MAX`), so it is
   tie-aware — every game at the top face counts. Ratings are read through
   `peopleOf` off each session's vote map (guests skipped: a guest id is
   session-scoped and has no taste), retired games are nobody's favourite
   (`isNameableGame`), and retired members get no entry. */
function favouritesByMember(round, deps) {
  const d = voteBoostDeps(deps);
  const nameable = new Set((round.games || []).filter((g) => d.isNameableGame(g)).map((g) => g.id));
  const byMember = new Map();
  (round.sessions || []).forEach((s) => {
    const votes = s.votes || {};
    // A guest's ratings are collected and never read: only member rows get an
    // entry below, so no separate guest skip is needed here.
    d.peopleOf(round, s).forEach((p) => {
      const own = votes[p.id] || {};
      Object.keys(own).forEach((gid) => {
        const v = own[gid];
        if (!nameable.has(gid) || !v || !Number.isFinite(v.rating)) return;
        let games = byMember.get(p.id);
        if (!games) byMember.set(p.id, (games = new Map()));
        const acc = games.get(gid) || { sum: 0, n: 0 };
        acc.sum += v.rating;
        acc.n += 1;
        games.set(gid, acc);
      });
    });
  });
  const out = new Map();
  (round.members || []).filter((m) => !m.retired).forEach((m) => {
    const favs = new Set();
    (byMember.get(m.id) || new Map()).forEach((acc, gid) => {
      if (d.ratingRung(acc.sum / acc.n) === d.ratingMax) favs.add(gid);
    });
    out.set(m.id, favs);
  });
  return out;
}

/* personId -> integer weight in percent for one session's ballots, or NULL when
   the weights change nothing: the session did not start with the boost on
   (`voteBoost`, stored once at the draw), or nobody at the table is boosted.
   Null is what lets every caller keep today's unweighted arithmetic byte for
   byte — the off path is not "weights of 100", it is no weights at all.

   A TEAM (#575) gets one weight, not one per player: each of its people weighs
   the team's mean, rounded (guests count 100). That keeps the team's total say
   what its people would have had individually while giving it one voice —
   the simplest reading that holds "one weight per team". */
function sessionVoteWeights(round, session, deps) {
  if (!session || session.voteBoost !== true) return null;
  const d = voteBoostDeps(deps);
  const boosts = memberBoosts(round, session, d);
  const weights = new Map();
  d.peopleOf(round, session).forEach((p) => {
    // A guest has no entry in `boosts`, so it weighs the base.
    weights.set(p.id, VOTE_WEIGHT_BASE + (boosts.get(p.id) || 0));
  });
  d.partyGroups(round, session).forEach((party) => {
    if (!party.team) return;
    const ws = party.personIds.map((pid) => weights.get(pid) || VOTE_WEIGHT_BASE);
    const mean = Math.round(ws.reduce((a, b) => a + b, 0) / ws.length);
    party.personIds.forEach((pid) => weights.set(pid, mean));
  });
  for (const w of weights.values()) if (w !== VOTE_WEIGHT_BASE) return weights;
  return null;
}

/* The members the hint names: seated, active, boosted. Only for a session that
   carries the flag — the hint must never announce a say the result does not
   give. No numbers leave this function (faces, not numbers). */
function boostedSeatIds(round, session, deps) {
  if (!session || session.voteBoost !== true) return [];
  const d = voteBoostDeps(deps);
  const boosts = memberBoosts(round, session, d);
  return d.peopleOf(round, session)
    .filter((p) => (boosts.get(p.id) || 0) > 0)
    .map((p) => p.id);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BOOST_STEP, BOOST_RESET_FROM, VOTE_WEIGHT_BASE,
    memberBoosts, favouritesByMember, sessionVoteWeights, boostedSeatIds,
  };
}
