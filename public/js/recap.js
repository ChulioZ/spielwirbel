/* Spielwirbel – the round recap (#484): the aggregates behind the Pokale tab's
   "Rückblick" section — what the group's accumulated ratings say about its taste.

   Everything here is derived ON DEMAND from session votes. Sessions stay the
   single source of truth (CLAUDE.md §Architecture), so deleting one removes its
   effect for free; nothing in this file is stored or denormalized.

   Its two sibling dependencies are passed IN rather than read off the shared
   scope: `peopleOf` (sessionPeople, from session-people.js) and `ratingOf`
   (effectiveRating, from vote-scale.js — what a vote is worth once a retirement
   proposal counts as the 0 it is, #797). A public/js file cannot require() a
   sibling — `require` is not among eslint.config.js's frontendGlobals and the
   browser has none — so injecting them is what keeps this file usable both as a
   shared-scope frontend script and as a CommonJS module the test suite can
   require, without a second copy of either rule. Both callers pass the real
   ones; a caller that substituted its own would be reintroducing exactly the
   drift those two modules exist to prevent.

   Load order: see index.html. */

'use strict';

// Minimum ratings before a game may be called the best or the worst of a round.
// The Pokale best-rated card has always used 3 and now reads it from here, so
// the new worst-rated card beside it cannot grow a hand-copied second threshold
// that drifts (.claude/rules/shared-constants-across-the-stack.md).
const RECAP_MIN_RATINGS = 3;

const recapMean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Every rating in the round, indexed per game — `all` for the game's overall
// average, `byMember` for the per-person stats.
//
// Guests count toward `all` and are deliberately absent from `byMember` (#458).
// Both halves matter: a guest actually played, so leaving their vote out of an
// average would make this section disagree with the game's own ring; but a guest
// id is SESSION-scoped, so aggregating one across sessions is meaningless and
// naming a one-evening visitor in a per-member stat would be noise — the same
// split the Pokale standings and the streak already draw.
//
// Votes are read straight off the vote map rather than through `s.gameIds`,
// so a rating always counts exactly once; ids of deleted games are dropped,
// since a stat naming a game that is no longer on the shelf has nothing to show.
function collectRatings(round, peopleOf, ratingOf) {
  const known = new Set(round.games.map((g) => g.id));
  const games = new Map();
  let total = 0;
  round.sessions.forEach((session) => {
    const votes = session.votes || {};
    peopleOf(round, session).forEach((person) => {
      const own = votes[person.id] || {};
      Object.keys(own).forEach((gid) => {
        if (!known.has(gid)) return;
        // A retirement proposal is the zero of the scale, so it belongs in
        // the taste stats like any other vote (#797).
        const rating = ratingOf(own[gid]);
        if (rating === null) return;
        let entry = games.get(gid);
        if (!entry) games.set(gid, (entry = { all: [], byMember: new Map() }));
        entry.all.push(rating);
        total += 1;
        if (person.guest) return;
        const mine = entry.byMember.get(person.id) || [];
        mine.push(rating);
        entry.byMember.set(person.id, mine);
      });
    });
  });
  return { games, total };
}

// The best- and worst-rated games, over the ACTIVE shelf only. Both are read as
// "what should we reach for / what is dragging the shelf down", which is only
// actionable for a game still on it — and it keeps the pair symmetric with the
// best-rated card that has always filtered this way. Ties share a card.
//
// `worst` is null unless a *different* game holds it: with a single qualifying
// game the same title would otherwise be announced as both the best and the
// worst thing the group owns, which reads as a bug rather than as thin data.
function bestAndWorst(round, index) {
  const rated = round.games
    .filter((g) => !g.retired && !g.completed && !g.wish)
    .map((g) => {
      const entry = index.games.get(g.id);
      const ratings = entry ? entry.all : [];
      return { id: g.id, avg: ratings.length ? recapMean(ratings) : null, count: ratings.length };
    })
    .filter((r) => r.avg !== null && r.count >= RECAP_MIN_RATINGS);
  if (!rated.length) return { best: null, worst: null };
  const top = Math.max(...rated.map((r) => r.avg));
  const bottom = Math.min(...rated.map((r) => r.avg));
  const pick = (avg) => ({ gameIds: rated.filter((r) => r.avg === avg).map((r) => r.id), avg });
  return { best: pick(top), worst: bottom < top ? pick(bottom) : null };
}

// May a stat about the group's TASTE name this game? (#643)
//
// This is deliberately not the "active" filter used by bestAndWorst above
// (`!retired && !completed`): the two archives part company here. Retiring is
// the user saying the game has left the collection — so calling it a favourite
// afterwards asserts a preference they have withdrawn. Completing is not: the
// game was played through, the opinions still stand, and it stays. Don't
// collapse the two back into one "archived" predicate.
//
// It is a shared function rather than a `!g.retired` check repeated per site
// because the member page computes its own Lieblingsspiel from the raw sessions
// (`memberStats`, views-member.js) instead of going through this file's index —
// two implementations of one rule, which is the drift
// `.claude/rules/shared-constants-across-the-stack.md` is about. A game must not
// be able to vanish from the Pokale favourites while still sitting on the
// member's own page.
//
// NOT used by the Meistgespielt tally, which counts every night including a
// retired game's: that card is a record of what happened, not a claim of taste.
const isNameableGame = (game) => !game.retired;

// The ids this round may not name, as a Set for the per-game scans below.
const retiredIds = (round) =>
  new Set(round.games.filter((g) => !isNameableGame(g)).map((g) => g.id));

// The game two members disagree about most: the largest gap between any two
// members' own averages for it. Needs two members who both rated it, plus the
// same evidence bar as best/worst. Completed games count — a game the group
// argued about and played through is part of the record; retired ones are
// skipped (see retiredIds above).
// Ties go to the game with more ratings behind it, so the answer is stable
// rather than dependent on which session happened to be indexed first.
// No membership filter is needed here, and adding one back would be dead code:
// `peopleOf` only ever yields the round's CURRENT members plus that session's
// guests, and the guests are dropped as byMember is built — so every id in
// byMember names a member who is still in the round. A vote cast by someone who
// has since been removed is never even read.
function mostDivisive(round, index) {
  const retired = retiredIds(round);
  let found = null;
  index.games.forEach((entry, gid) => {
    if (retired.has(gid)) return;
    if (entry.all.length < RECAP_MIN_RATINGS) return;
    const per = [];
    entry.byMember.forEach((ratings, mid) => {
      per.push({ memberId: mid, avg: recapMean(ratings) });
    });
    if (per.length < 2) return;
    per.sort((a, b) => a.avg - b.avg);
    const low = per[0];
    const high = per[per.length - 1];
    const spread = high.avg - low.avg;
    if (spread <= 0) return;
    const count = entry.all.length;
    if (!found || spread > found.spread || (spread === found.spread && count > found.count)) {
      found = { gameId: gid, spread, count, low, high };
    }
  });
  return found;
}

// Each member's own favourite: the game they personally rate highest. Completed
// games count — this is a retrospective record of taste, and someone's favourite
// should not disappear because the group played it through. RETIRED ones do not
// (#643, see retiredIds): the skip happens inside the per-member scan, so a
// member whose top game was retired keeps a card naming their best remaining
// game, and only drops out once nothing non-retired is left. Members who have
// not rated anything yet are simply left out. Ties go to the game they rated
// more often, then to the one indexed first.
function memberFavourites(round, index) {
  const retired = retiredIds(round);
  return round.members
    .map((m) => {
      let best = null;
      index.games.forEach((entry, gid) => {
        if (retired.has(gid)) return;
        const mine = entry.byMember.get(m.id);
        if (!mine || !mine.length) return;
        const avg = recapMean(mine);
        if (!best || avg > best.avg || (avg === best.avg && mine.length > best.count)) {
          best = { memberId: m.id, gameId: gid, avg, count: mine.length };
        }
      });
      return best;
    })
    .filter(Boolean);
}

// The whole recap for one round. `peopleOf` is sessionPeople(round, session).
function roundRecap(round, peopleOf, ratingOf) {
  const index = collectRatings(round, peopleOf, ratingOf);
  const { best, worst } = bestAndWorst(round, index);
  return {
    totals: {
      // Finished sessions only, matching the count the home screen and the rail
      // already show; an abandoned draw is not a night the group played.
      sessions: round.sessions.filter((s) => s.finished).length,
      // These two are deliberately NOT complements since #560: a wish is
      // neither owned (so not `games`) nor something the group ever had (so not
      // `archived`). A game they do not own belongs in neither half of a recap
      // of their year.
      games: round.games.filter((g) => !g.retired && !g.completed && !g.wish).length,
      archived: round.games.filter((g) => g.retired || g.completed).length,
      ratings: index.total,
    },
    best,
    worst,
    divisive: mostDivisive(round, index),
    favourites: memberFavourites(round, index),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RECAP_MIN_RATINGS, roundRecap, isNameableGame };
}
