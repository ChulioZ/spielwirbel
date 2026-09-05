/* Spielwirbel – what a member's WINS are worth: the Siegwertung (#895).

   WHY THIS EXISTS. The Ruhmeshalle ranked members by raw win count, which
   measures attendance rather than play: someone simply present more often
   accumulates more wins, and the leaderboard reads as a ranking while counting
   something closer to a calendar. Worse, a one-person session is representable
   (lib/routes/sessions.js only rejects an EMPTY member list), so a member
   logging their solo plays into the round won essentially all of them and built
   a total nobody playing in a group could answer.

   THE MEASURE. Each win is weighted by the size of the field it beat. Over
   every finished session that has at least one recorded winner:

     p = playing parties that night     w = parties that won
     a member of a winning party scores   1 − w/p
     a member of any other party scores     − w/p

   Four properties are load-bearing, and each is pinned in test/win-score.test.js:

   - A SOLO EVENING FALLS OUT AT ZERO BY CONSTRUCTION: p = w = 1 gives 1 − 1 = 0.
     There is deliberately no `if (solo)` anywhere in this file — a special case
     is the thing that drifts later, and the formula already says it.
   - ZERO-SUM OVER PARTIES, per session: Σ (won ? 1 : 0) − w/p = w − p·(w/p) = 0,
     for any p and w including a multi-winner night. Over PARTIES, not members —
     a three-person team shares the win, which is intended.
   - A SUM, DELIBERATELY NOT A RATE. A rate would need #894's shrinkage to be
     usable at all (one lucky win reads 100 %); a sum needs none, because a
     single win contributes at most 1 − 1/p < 1. That is what keeps this file
     independent of #894.
   - SESSIONS WITH NO RECORDED WINNER ARE SKIPPED ENTIRELY. Charging every
     participant w/p for an evening nobody was recorded as winning would be
     scoring an incompleteness in the data as though it were a result. This also
     covers a cancelled evening and a split parent for free — neither carries
     winnerIds — so this file needs no `sessionOutcome` branch of its own.

   THE FORK, if this is ever retuned: the shape above answers "who has won the
   most". If the family later wants "who is the best", the variant is this same
   score divided by the number of NON-SOLO sessions joined — and that variant
   then needs #894's shrinkage, or a two-night member shows a perfect record.
   The trade is between a total and a rate, not between two constants.

   `partyGroupsOf` is INJECTED rather than required: `sessionPartyGroups` lives
   in session-people.js and a public/js file cannot require() a sibling. It is
   also the rule — a party is the unit and its arithmetic is not re-derived here
   (.claude/rules/session-teams.md). Same injection shape recap.js and
   period-recap.js already use. Pure and dependency-free otherwise, so it works
   both as a shared-scope frontend script and as a CommonJS module the tests
   require. Load order: see index.html — after session-people.js. */

'use strict';

// One session's contribution, as Map<personId, number>. Keyed by PERSON, so a
// guest appears here too; dropping guests from the standings is the caller's
// job (#458) and belongs where the round members are known.
function sessionWinScores(round, session, partyGroupsOf) {
  const scores = new Map();
  const winnerIds = session.winnerIds || [];
  if (!winnerIds.length) return scores;

  const parties = partyGroupsOf(round, session);
  const p = parties.length;
  if (!p) return scores;

  const won = new Set(
    parties.filter((party) => party.personIds.some((id) => winnerIds.includes(id)))
  );
  // Every recorded winner is a stale id nobody at the table matches. That is
  // the same incompleteness as an unrecorded winner, so it is skipped the same
  // way rather than charging the whole table w/p = 0.
  if (!won.size) return scores;

  const share = won.size / p;
  parties.forEach((party) => {
    const value = (won.has(party) ? 1 : 0) - share;
    party.personIds.forEach((id) => scores.set(id, value));
  });
  return scores;
}

// Every round member's Siegwertung across the round, as { [memberId]: number }.
// Members who never played are present at 0 rather than absent — the standings
// sort over this map, and a missing key would sort as NaN.
function memberWinScores(round, partyGroupsOf) {
  const totals = {};
  (round.members || []).forEach((m) => (totals[m.id] = 0));
  (round.sessions || []).forEach((session) => {
    if (!session.finished) return;
    sessionWinScores(round, session, partyGroupsOf).forEach((value, id) => {
      if (id in totals) totals[id] += value;
    });
  });
  return totals;
}

// The same score, partitioned by the game that was played, as
// { [gameId]: number } — the „Stärkstes Spiel" tile (#920). Each finished
// night's value is attributed to its `chosenGameId`, so this is the round total
// expressed in its own terms rather than a second measure.
//
// A night with NO chosen game names no game and is simply absent here, so the
// per-game sums deliberately do NOT re-add to memberWinScores' total. That is
// the honest reading: the evening happened and counts for the round, but there
// is nothing to credit it to. The split parent falls out here for that reason
// AND for carrying no winnerIds, so neither the parent's people nor its game
// need a branch of their own.
//
// Absent means "did not sit at that game", never "scored 0 at it": a member who
// missed the night is not in the session's map at all, while a solo night is
// present at 0 by the same construction as everywhere else in this file.
// Retirement and round membership are NOT filtered here — whether a game may be
// NAMED is `isNameableGame`'s question (recap.js) and belongs to the caller.
function memberGameWinScores(round, mid, partyGroupsOf) {
  const totals = {};
  (round.sessions || []).forEach((session) => {
    if (!session.finished) return;
    const gid = session.chosenGameId;
    if (!gid) return;
    const value = sessionWinScores(round, session, partyGroupsOf).get(mid);
    if (value === undefined) return;
    totals[gid] = (totals[gid] || 0) + value;
  });
  return totals;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sessionWinScores, memberWinScores, memberGameWinScores };
}
