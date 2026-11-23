/* Spielwirbel – where a round stands, as the Start tab's stage says it (#1854).

   One question, five answers, and every design's stage draws the same one:

   - `empty`   — no active game. The stage keeps the empty table (hubEmptyTable).
   - `young`   — games, but nothing drawn that was not cancelled (roundIsYoung).
   - `running` — the newest open session is still being voted on.
   - `table`   — the newest open session is voted, its result not entered yet.
   - `normal`  — nothing open, at least one session played.

   „Open" means outcome `open` (session-outcome.js): a split PARENT is resolved —
   its tables are what is open — and a split TABLE stays a ticket grouped under
   its parent, so the stage never speaks for one table of several. When more
   than one session is open the stage speaks for the newest; the rest stay
   tickets under it (hubRunningTickets' `except`).

   The open session is asked FIRST: a running first vote is not young (the same
   answer roundIsYoung gives), so `young` can only mean nothing at all is open.
   Its test is roundIsYoung's own — no session whose outcome is not cancelled.

   Pure and dependency-free: `deps` carries `sessionOutcome` (session-outcome.js)
   and `newestSessionsFirst` (session-order.js), so a Node spec can require this
   file without the shared scope (.claude/rules/frontend-helper-modules-and-coverage.md). */

function stageState(round, activeGames, deps) {
  const sessions = round.sessions || [];
  const open = sessions.filter((s) => deps.sessionOutcome(s) === 'open' && !s.parentSessionId);
  const session = deps.newestSessionsFirst(open)[0] || null;
  const games = activeGames || [];
  if (session) {
    const voting = !session.done;
    const game = voting ? null
      : (round.games || []).find((g) => g.id === session.chosenGameId) || null;
    return { kind: voting ? 'running' : 'table', session, game, counts: { games: (session.gameIds || []).length } };
  }
  if (!games.length) return { kind: 'empty', session: null, game: null, counts: { games: 0 } };
  const played = sessions.some((s) => deps.sessionOutcome(s) !== 'cancelled');
  return { kind: played ? 'normal' : 'young', session: null, game: null, games, counts: { games: games.length } };
}

/* Who has voted in a running session, as the sub-line says it: their names up
   to STAGE_VOTER_NAMES, past that a count of how many of how many. `people` is
   the session's own people (members AND guests — sessionPeople), so the voters
   keep their order and the caller labels them as the lobby does (personLabel).
   It names voters, never votes. */
const STAGE_VOTER_NAMES = 3;

function stageVoters(people, votedIds) {
  const voted = new Set(votedIds || []);
  const voters = people.filter((p) => voted.has(p.id));
  if (voters.length > STAGE_VOTER_NAMES) return { kind: 'count', n: voters.length, of: people.length };
  return { kind: voters.length ? 'names' : 'none', voters };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { stageState, stageVoters, STAGE_VOTER_NAMES };
}
