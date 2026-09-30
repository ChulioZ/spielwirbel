/* Spielwirbel – two counts over a round's finished sessions (#1381): the sole-win
   streak the Pokale card shows, and a session's number in the round.

   The streak lived inline in views-pokale.js until Das Programmheft's share card
   (#1381, P8.4 „Serie") needed the same figure. One copy, here, so the card and
   the Pokale tab cannot disagree about what a streak is — the rule has moved
   three times (#458, #895, #1038) and each move would otherwise have had to find
   both.

   Pure and dependency-free: `deps` carries `sessionEnding` (session-outcome.js)
   and `sessionPartyCount` (session-people.js), injected — the memberStats shape,
   since a public/js file cannot require() a sibling. The browser passes the
   shared-scope functions; the spec passes the required ones. */

'use strict';

/* Who holds the current sole-win streak over `sessions`, and how long it is.

   Chronological by `createdAt` (when the night happened), like the Chronik —
   `finishedAt` moves when an old session is re-finished
   (.claude/rules/server-computed-calendar-periods.md §7).

   Three kinds of night neither break nor extend a streak, and are skipped:
   - one any GUEST won (#458): a session-only visitor has no member row, and
     treating their win as an ordinary sole win would silently blank the card —
     which is breaking it by another name;
   - a SOLO one (#895): one party is single-winner by definition, so twenty
     logged solo plays would read as a twenty-night streak;
   - one recorded as „Kein Sieger" or „Fortsetzung folgt" (#1038): not a
     contest. „Verloren" is NOT skipped — the table played to win and did not,
     which breaks a streak exactly as somebody else's win does (via
     `ws.length !== 1`). An UNRECORDED night also still breaks one; the fix for
     that is recording it.

   Returns { memberId, n, lastId }: the holder (null when the latest counted
   night had no sole winner), the run's length, and the id of the night it ends
   at — so a caller asking "is the streak THIS session's" can tell a skipped
   session from the one that counted. */
function soleWinStreak(round, sessions, deps) {
  const wonByGuest = (s) => {
    const gids = new Set((s.guests || []).map((g) => g.id));
    return gids.size > 0 && (s.winnerIds || []).some((wid) => gids.has(wid));
  };
  const isSolo = (s) => deps.sessionPartyCount(round, s) === 1;
  const notAContest = (s) => {
    const e = deps.sessionEnding(s);
    return e === 'noWinner' || e === 'ongoing';
  };
  const chrono = [...sessions]
    .filter((s) => !wonByGuest(s) && !isSolo(s) && !notAContest(s))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  let memberId = null;
  let n = 0;
  for (let i = chrono.length - 1; i >= 0; i--) {
    const ws = chrono[i].winnerIds || [];
    if (memberId === null) {
      if (ws.length !== 1) break;
      memberId = ws[0];
      n = 1;
    } else if (ws.length === 1 && ws[0] === memberId) {
      n++;
    } else break;
  }
  return { memberId, n, lastId: chrono.length ? chrono[chrono.length - 1].id : null };
}

/* A session's number in its round: 1 + the other FINISHED sessions that
   happened no later than it (by `createdAt`, as above). The session itself
   counts whether or not its stored copy is finished yet — the results screen
   shares a session the moment it ends, before the round snapshot knows. */
function sessionNumber(round, session) {
  const at = String(session.createdAt);
  return 1 + (round.sessions || []).filter((s) => s.id !== session.id && s.finished && String(s.createdAt) <= at).length;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { soleWinStreak, sessionNumber };
}
