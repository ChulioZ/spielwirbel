/* Spielwirbel – two counts over a round's finished sessions (#1381): the win
   streak the Pokale card shows, and a session's number in the round.

   The streak lived inline in views-pokale.js until Das Programmheft's share card
   (#1381, P8.4 „Serie") needed the same figure. One copy, here, so the card and
   the Pokale tab cannot disagree about what a streak is — the rule has moved
   four times (#458, #895, #1038, #1421) and each move would otherwise have had
   to find both.

   Pure and dependency-free: `deps` carries `sessionEnding` (session-outcome.js)
   and `sessionPartyCount` (session-people.js), injected — the memberStats shape,
   since a public/js file cannot require() a sibling. The browser passes the
   shared-scope functions; the spec passes the required ones. */

'use strict';

/* Who holds the current win streak over `sessions`, and how long it is.

   A SHARED win continues the streak for every winner (#1421, operator decision
   2026-09-26, B16.3/P7): a tie is a full win for each of them — as memberStats
   and the Pokale standings already counted it, and as the Serienheld badge
   (achievements.js) already measured it. Until #1421 this was a SOLE-win streak
   and any tie ended it for everybody.

   So the walk runs back from the latest counted night with that night's winners
   as the candidates, keeps on each earlier night only the candidates who won it
   too, and stops when none are left. The answer is the longest run still going
   and everyone who holds it: Aylin alone three times and then level with Nils
   is Aylin on 4 (Nils is on 1, which is not the longest).

   Chronological by `createdAt` (when the night happened), like the Chronik —
   `finishedAt` moves when an old session is re-finished
   (.claude/rules/server-computed-calendar-periods.md §7).

   Three kinds of night neither break nor extend a streak, and are skipped:
   - one only GUESTS won (#458): a session-only visitor has no member row, and
     treating their win as an ordinary win would silently blank the card —
     which is breaking it by another name. A night a guest won TOGETHER with
     members is not skipped: the guest is dropped and it is a shared win for
     the members (#1421), exactly as a tie between members is;
   - a SOLO one (#895): one party wins by definition, so twenty logged solo
     plays would read as a twenty-night streak;
   - one recorded as „Kein Sieger" or „Fortsetzung folgt" (#1038): not a
     contest. „Verloren" is NOT skipped — the table played to win and did not,
     which breaks a streak exactly as somebody else's win does (no winner is
     left among the candidates). An UNRECORDED night also still breaks one; the
     fix for that is recording it.

   Returns { memberIds, n, lastId }: the holders (empty when the latest counted
   night had no winner), the run's length, and the id of the night it ends at —
   so a caller asking "is the streak THIS session's" can tell a skipped session
   from the one that counted. */
function winStreak(round, sessions, deps) {
  const guestIds = (s) => new Set((s.guests || []).map((g) => g.id));
  const memberWinners = (s) => {
    const gids = guestIds(s);
    return (s.winnerIds || []).filter((wid) => !gids.has(wid));
  };
  const wonOnlyByGuests = (s) => (s.winnerIds || []).length > 0 && memberWinners(s).length === 0;
  const isSolo = (s) => deps.sessionPartyCount(round, s) === 1;
  const notAContest = (s) => {
    const e = deps.sessionEnding(s);
    return e === 'noWinner' || e === 'ongoing';
  };
  const chrono = [...sessions]
    .filter((s) => !wonOnlyByGuests(s) && !isSolo(s) && !notAContest(s))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  let holders = null;
  let n = 0;
  for (let i = chrono.length - 1; i >= 0; i--) {
    const ws = memberWinners(chrono[i]);
    const next = holders === null ? [...new Set(ws)] : holders.filter((id) => ws.includes(id));
    if (!next.length) break;
    holders = next;
    n++;
  }
  return { memberIds: holders || [], n, lastId: chrono.length ? chrono[chrono.length - 1].id : null };
}

/* A session's number in its round: 1 + the other FINISHED sessions that
   happened no later than it (by `createdAt`, as above). The session itself
   counts whether or not its stored copy is finished yet — the results screen
   shares a session the moment it ends, before the round snapshot knows. */
function sessionNumber(round, session) {
  const at = String(session.createdAt);
  return 1 + (round.sessions || []).filter((s) => s.id !== session.id && s.finished && String(s.createdAt) <= at).length;
}

/* Which win of `memberId`'s this session is, and which play of `gameId` —
   Forest's fact line under the result (#1468: „9. Sieg für Jonas",
   „Nordlichter zum 4. Mal"). The same window as sessionNumber: the OTHER
   finished sessions that happened no later than this one, plus this one. The
   session itself is counted by assumption rather than read off its stored
   copy, because the caller asks only for a winner it is showing and a game it
   is showing — and the result screen states both before the round snapshot
   knows them. Counted like memberStats' `wins` (every finished night a member
   is among the winners, a shared win included), so the line can never disagree
   with the member page. */
function sessionWinNumber(round, session, memberId) {
  const at = String(session.createdAt);
  return 1 + (round.sessions || []).filter((s) => s.id !== session.id && s.finished
    && String(s.createdAt) <= at && (s.winnerIds || []).includes(memberId)).length;
}
function sessionPlayNumber(round, session, gameId) {
  const at = String(session.createdAt);
  return 1 + (round.sessions || []).filter((s) => s.id !== session.id && s.finished
    && String(s.createdAt) <= at && s.chosenGameId === gameId).length;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { winStreak, sessionNumber, sessionWinNumber, sessionPlayNumber };
}
