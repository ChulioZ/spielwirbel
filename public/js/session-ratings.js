/* Spielwirbel – every RATING a session holds, of either kind (#1838).

   A session carries two kinds of rating on the one 1–5 scale:

   - a VOTE (`session.votes[personId][gameId] = { rating }`) — "how much do I
     want to play this tonight", given before the game;
   - a VERDICT (`session.verdicts[personId][gameId] = { rating }`, absent key
     when none) — „Wie war's?", given after it, only by the people who sat at
     the table of the game that was played.

   A verdict is a real rating, so it counts everywhere a figure describes HOW
   SOMEONE LIKES A GAME (a member's averages, the Pokale, the taste neighbour,
   the recommender, the draw boost's favourites, Discover). It does NOT count
   where a figure describes a BALLOT — tonight's tally, the result, who voted,
   the vote weights, the vote link — which keep reading `session.votes`.

   WHY ONE ACCESSOR. Taste figures used to loop over `session.votes` each in its
   own way. Verdicts in a separate map would have been silently ignored by every
   loop nobody remembered to change, and nothing goes red. So the taste sites
   read through here instead, and test/votes-read-sites.test.js fails on a
   direct `.votes` read outside the ballot-only allowlist.

   The SHELF SCORE is the one taste site that does not take verdicts as plain
   ratings: there a verdict replaces its seat's share of the play's assumed
   value (`playEvidence` in vote-score.js), and the vote stays that evening's
   rated evening. A voted-and-played evening by the same person is two ratings.

   Pure and dependency-free: a shared-scope frontend script and a CommonJS
   module the server requires. Load order: see index.html. */

'use strict';

const RATING_KINDS = ['vote', 'verdict'];

function ratingMap(session, kind) {
  const m = session && session[kind === 'vote' ? 'votes' : 'verdicts'];
  return m && typeof m === 'object' ? m : {};
}

/* One person's ratings in one session: [{ gameId, rating, kind }], votes first.
   `Number.isFinite` is the admission test every taste loop used on votes, kept
   so a round without verdicts reads byte for byte what it did. */
function personRatings(session, personId, kinds) {
  const out = [];
  (kinds || RATING_KINDS).forEach((kind) => {
    const own = ratingMap(session, kind)[personId];
    if (!own || typeof own !== 'object') return;
    Object.keys(own).forEach((gameId) => {
      const v = own[gameId];
      if (v && Number.isFinite(v.rating)) out.push({ gameId, rating: v.rating, kind });
    });
  });
  return out;
}

/* Every rating the given PEOPLE hold in this session:
   [{ person, gameId, rating, kind }]. `people` is whichever set the caller
   means — sessionPeople for the session's own figures, sessionRaters for the
   shelf's "outside the session" set (#1538) — so this file never decides who
   counts, only what they said. */
function sessionRatings(session, people, kinds) {
  const out = [];
  (people || []).forEach((person) => {
    personRatings(session, person.id, kinds).forEach((r) => out.push({ person, ...r }));
  });
  return out;
}

/* One person's verdict on one game, or null. */
function verdictOf(session, personId, gameId) {
  const own = ratingMap(session, 'verdict')[personId];
  const v = own && own[gameId];
  return v && Number.isFinite(v.rating) ? v.rating : null;
}

/* Does this person hold ANY rating in the session, of either kind? The member
   delete guard asks this: a seat with only verdicts has history too. */
function hasAnyRating(session, personId) {
  return RATING_KINDS.some((kind) => {
    const own = ratingMap(session, kind)[personId];
    return !!own && typeof own === 'object' && Object.keys(own).length > 0;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RATING_KINDS, personRatings, sessionRatings, verdictOf, hasAnyRating };
}
