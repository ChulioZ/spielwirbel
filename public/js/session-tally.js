/* Spielwirbel – counts over a round's finished sessions (#1381): the win
   streak the Pokale card shows, the record streak Die Brücke's plate shows
   (#1422), and a session's number in the round.

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
  const { chrono, memberWinners } = streakNights(round, sessions, deps);
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

/* The nights a streak is counted over, oldest first, and who of the members won
   each — the skip rules above, shared by `winStreak` and `longestStreak` so the
   current streak and the record cannot come to disagree about which nights
   count. */
function streakNights(round, sessions, deps) {
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
  return { chrono, memberWinners };
}

/* The round's RECORD streak (#1422, Die Brücke's „Längste Serie", B3.4): the
   longest run of counted nights one member won in a row, at any point in the
   round's history — `winStreak` is the run still going, this is the best one
   there has ever been. Same nights, same skips, and a shared win extends the run
   of every winner (#1421), so a run two people won together is ONE run with one
   span, held by both.

   Returns { memberIds, n, from, to }: everyone holding a run of the record
   length, in the order their runs began; the length; and the `createdAt` of the
   run's first and last night. Two DIFFERENT runs of the record length (Anna in
   March, Ben in May) have no single span, so `from`/`to` are null and the caller
   prints the length instead. */
function longestStreak(round, sessions, deps) {
  const { chrono, memberWinners } = streakNights(round, sessions, deps);
  const open = new Map();
  const runs = [];
  const close = (id) => {
    runs.push({ id, ...open.get(id) });
    open.delete(id);
  };
  chrono.forEach((s) => {
    const ws = new Set(memberWinners(s));
    [...open.keys()].forEach((id) => { if (!ws.has(id)) close(id); });
    ws.forEach((id) => {
      const run = open.get(id);
      if (run) {
        run.n++;
        run.to = s.createdAt;
      } else open.set(id, { n: 1, from: s.createdAt, to: s.createdAt });
    });
  });
  [...open.keys()].forEach(close);
  const n = runs.reduce((max, r) => Math.max(max, r.n), 0);
  const best = runs.filter((r) => r.n === n && n > 0)
    .sort((a, b) => String(a.from).localeCompare(String(b.from)));
  const oneSpan = best.length > 0 && best.every((r) => r.from === best[0].from && r.to === best[0].to);
  return {
    memberIds: [...new Set(best.map((r) => r.id))],
    n,
    from: oneSpan ? best[0].from : null,
    to: oneSpan ? best[0].to : null,
  };
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
  module.exports = { winStreak, longestStreak, sessionNumber };
}
