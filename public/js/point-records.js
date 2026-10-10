/* Spielwirbel – per-player points on a finished session (#1630): the bounds a
   score may take, and the bests and records derived from them.

   Called "points" in code, never "score": the Spielwirbel-Score (vote-score.js)
   already owns `SCORE_MIN` and the word, and a second meaning under one name in
   one global scope is how a reader picks up the wrong one. The stored field is
   still `session.scores`, as the issue named it.

   ## The bounds are shared with the route

   `POINTS_MIN`/`POINTS_MAX` are what the sheet's inputs offer and what
   `PUT …/sessions/:sid/scores` accepts, so they live in ONE file both require
   (.claude/rules/shared-constants-across-the-stack.md): a drifted server copy
   would 400 a value the sheet let through.

   ## Bests and records are DERIVED, never stored

   Like the rating averages (game-stats.js), everything here is computed on
   demand from the round's sessions, so deleting or re-dating a session, or
   clearing its points, corrects every best and record with no write anywhere.

   Who can hold what:
     - a MEMBER playing as themselves has a personal best per game;
     - a TEAM's score counts for the group record only — a shared result is not
       a personal one, so it never becomes any member's best;
     - a GUEST's score shows on its session and can hold the group record, but a
       guest has no personal best: guest ids are minted per session, so there is
       no person to carry a best across evenings
       (.claude/rules/session-guests-are-not-members.md).

   „Neuer Rekord" means strictly better than that member's best in EARLIER
   sessions of the same game. A first score is not a record (there was nothing
   to beat) and neither is a tie. "Earlier" is by session date, never insertion
   order — a session logged after the fact (#1616) is inserted last while
   belonging in the middle — so the sessions are sorted with the same
   `sortSessionsByDate` both repo backends use.

   Pure and DOM-free. The two siblings it needs are INJECTED (`deps`), the
   member-stats.js shape: a public/js file cannot require() a sibling, so a spec
   passes the real modules and the browser falls back to the shared global
   scope. Under Node a forgotten `deps` throws rather than taking a quiet second
   path. */

'use strict';

// Whole numbers only, negatives allowed — golf-style and penalty games go below
// zero, and nobody's table game scores past five digits.
const POINTS_MIN = -9999;
const POINTS_MAX = 99999;

function isValidPoints(v) {
  return Number.isInteger(v) && v >= POINTS_MIN && v <= POINTS_MAX;
}

// Is `a` strictly better than `b` for a game played in this direction?
function pointsBeat(a, b, lowWins) {
  return lowWins ? a < b : a > b;
}

/* Every scored play of one game, oldest first, plus the bests and the record.

   A play counts when the session is finished, not cancelled, played this game
   (`chosenGameId`) and carries points. Each play's lines are the session's
   parties (sessionPartyGroups — one per team, one per un-teamed person) that
   have a score, best first in the game's direction; a party with no score is
   simply not listed. Ties in a line keep party order, so the sheet's order
   decides who is named first.

   Returns
     plays:  [{ session, lines: [{ party, points, newRecord }] }]  oldest first
     bests:  Map memberId -> { points, session }   (members only)
     record: { points, party, session } | null    (the earliest to reach it) */
function gamePointRecords(round, game, deps) {
  const d = deps || { sessionPartyGroups, sortSessionsByDate };
  const lowWins = !!(game && game.lowScoreWins);
  const gid = game && game.id;
  const bests = new Map();
  let record = null;
  const plays = [];
  d.sortSessionsByDate((round && round.sessions) || []).forEach((s) => {
    if (!s || !s.finished || s.cancelled || s.chosenGameId !== gid) return;
    const scores = s.scores && typeof s.scores === 'object' ? s.scores : null;
    if (!scores) return;
    const lines = [];
    d.sessionPartyGroups(round, s).forEach((party) => {
      const points = scores[party.id];
      if (!isValidPoints(points)) return;
      const member = !party.team && !party.people[0].guest;
      let newRecord = false;
      if (member) {
        const prev = bests.get(party.id);
        newRecord = !!prev && pointsBeat(points, prev.points, lowWins);
        if (!prev || newRecord) bests.set(party.id, { points, session: s });
      }
      if (!record || pointsBeat(points, record.points, lowWins)) record = { points, party, session: s };
      lines.push({ party, points, newRecord });
    });
    if (!lines.length) return;
    // Stable, so equal points keep the party order.
    lines.sort((a, b) => (pointsBeat(a.points, b.points, lowWins) ? -1 : pointsBeat(b.points, a.points, lowWins) ? 1 : 0));
    plays.push({ session: s, lines });
  });
  return { plays, bests, record };
}

// One session's lines, with its „neuer Rekord" marks — read off the whole
// game's history, since whether a score beat a best depends on every earlier
// evening. Empty when the session has no points (or no chosen game).
function sessionPointLines(round, session, deps) {
  const game = ((round && round.games) || []).find((g) => g.id === (session && session.chosenGameId));
  if (!game) return [];
  const play = gamePointRecords(round, game, deps).plays.find((p) => p.session.id === session.id);
  return play ? play.lines : [];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { POINTS_MIN, POINTS_MAX, isValidPoints, pointsBeat, gamePointRecords, sessionPointLines };
}
