/* Spielwirbel – whose taste the table follows (#1776).

   For each member: which games are their FAVOURITES, and how often one of them
   was actually put on the table with that member sitting at it. The Pokale
   Rückblick lists it („Favoriten kamen 9× auf den Tisch"), the member page
   states it once, and #1777 (an opt-in draw boost for the member whose
   favourites reach the table least) reads the same numbers.

   Derived ON DEMAND from session votes, like everything in recap.js: sessions
   are the single source of truth, so deleting one removes its effect for free.

   THE DEFINITIONS, each borrowed rather than invented:

   - A member's ratings are read exactly as the Pokale Lieblingsspiele card
     reads them (`collectRatings` in recap.js): through `peopleOf`
     (sessionPeople), straight off the vote map, numeric ratings only, games the
     round no longer holds dropped, GUESTS skipped — a guest id is
     session-scoped, so it has no taste to aggregate (#458).
   - A FAVOURITE is a game whose average rating by that member draws as the TOP
     face — `ratingRung(avg) === RATING_MAX` (rating-faces.js), the one rounding
     every screen uses for a person's average (#1537). So it is tie-aware by
     construction: every game at the top face is a favourite, not one winner.
   - A RETIRED game is nobody's favourite (`isNameableGame`, recap.js, #643):
     retiring withdraws the preference. A completed one stays.
   - A PLAY is an evening as the shelf score counts it (#1721, `playCounts` in
     vote-score.js): a non-cancelled session with a `chosenGameId`. A split
     parent carries none, so its TABLES count individually, each with its own
     seats. Teams change nothing: a team member is still a seat at the table.
   - „With them at the table" is `peopleOf` again: the member is among that
     session's people (a legacy session without `memberIds` seats everyone).

   Retired MEMBERS get no entry (#1006), the same forward-facing filter
   `memberFavourites` spells out — and for the same reason it is spelled out
   rather than calling `activeMembers`: this file is require()d from Node.

   SHARED-SCOPE AND NODE, with the siblings INJECTED. A public/js file cannot
   require() a sibling, so `peopleOf`, `isNameableGame` and `ratingRung` /
   `ratingMax` come in as `deps`; the browser omits the argument and the shared
   global scope answers (memberStats' shape, member-stats.js). Under Node the
   globals do not exist, so a forgotten `deps` throws instead of quietly
   computing something else.

   #1777's server-side draw is expected to `require('../public/js/taste-share')`
   from lib/ and pass the real modules (session-people.js, recap.js,
   rating-faces.js), so the boost and the screens cannot disagree about whose
   favourites reached the table. The file lives HERE rather than in lib/ for
   that reason (.claude/rules/shared-constants-across-the-stack.md) — and the
   change that first requires it from lib/ owes an entry in
   .claude/rules/shared-constants-inventory.md (test/rule-enumerations.test.js).

   Load order: see index.html — after recap.js and rating-faces.js. */

'use strict';

// From the round's sixth PLAYED session (youngRoundPlayed, hub-insights.js):
// below that, „9× vs 2×" is mostly which evenings happened to come first.
const TASTE_SHARE_FROM_SESSIONS = 6;
// A member with one favourite is a single game, not a taste; their line would
// say only whether that one box came out.
const TASTE_SHARE_MIN_FAVOURITES = 2;

/* One entry per active member, in round order — ALL of them, including those
   with no favourites, so a caller (the draw boost) can apply its own bar:
   { memberId, favouriteIds, evenings, favouritesPlayed }
   - `evenings`: plays of any favourite with the member at the table;
   - `favouritesPlayed`: how many DISTINCT favourites reached the table that way. */
function tasteShare(round, deps) {
  const d = deps || { peopleOf: sessionPeople, isNameableGame, ratingRung, ratingMax: RATING_MAX };
  const nameable = new Set((round.games || []).filter((g) => d.isNameableGame(g)).map((g) => g.id));
  const sessions = round.sessions || [];

  // memberId -> gameId -> [ratings], over nameable games only.
  const byMember = new Map();
  sessions.forEach((session) => {
    const votes = session.votes || {};
    // Guests need no skip here: entries exist for members only, so a guest's
    // ratings are collected and never read.
    d.peopleOf(round, session).forEach((person) => {
      const own = votes[person.id] || {};
      Object.keys(own).forEach((gid) => {
        if (!nameable.has(gid)) return;
        const vote = own[gid];
        if (!vote || !Number.isFinite(vote.rating)) return;
        let games = byMember.get(person.id);
        if (!games) byMember.set(person.id, (games = new Map()));
        const list = games.get(gid) || [];
        list.push(vote.rating);
        games.set(gid, list);
      });
    });
  });

  const entries = (round.members || []).filter((m) => !m.retired).map((m) => {
    const favouriteIds = [];
    (byMember.get(m.id) || new Map()).forEach((ratings, gid) => {
      const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      if (d.ratingRung(avg) === d.ratingMax) favouriteIds.push(gid);
    });
    return { memberId: m.id, favouriteIds, evenings: 0, favouritesPlayed: 0 };
  });

  const index = new Map(entries.map((e) => [e.memberId, { entry: e, favs: new Set(e.favouriteIds), seen: new Set() }]));
  sessions.forEach((session) => {
    if (session.cancelled) return;
    // No `!chosenGameId` skip: a null never matches a favourite id below.
    const gid = session.chosenGameId;
    d.peopleOf(round, session).forEach((person) => {
      const slot = index.get(person.id);
      if (!slot || !slot.favs.has(gid)) return;
      slot.entry.evenings += 1;
      slot.seen.add(gid);
    });
  });
  index.forEach((slot) => { slot.entry.favouritesPlayed = slot.seen.size; });
  return entries;
}

/* What the Rückblick lists: members with enough favourites to have a taste,
   most evenings first. Equal counts keep round order — the list states counts
   in words, never places, so a tie needs no tiebreak beyond being stable, and
   Array#sort IS stable (ES2019): an explicit index key would be a guard no
   test could reach. */
function tasteShareRows(entries) {
  return entries
    .filter((e) => e.favouriteIds.length >= TASTE_SHARE_MIN_FAVOURITES)
    .sort((a, b) => b.evenings - a.evenings);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TASTE_SHARE_FROM_SESSIONS, TASTE_SHARE_MIN_FAVOURITES, tasteShare, tasteShareRows };
}
