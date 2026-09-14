/* Spielwirbel – one member's statistics, derived on demand from the round's
   sessions (sessions are the single source of truth, exactly like the game
   rating averages — nothing here is denormalised).

   Its own file since #1075, which pushed views-member.js past the 700-line
   budget. A real seam rather than a trim: this is a PURE derivation over the
   round object, edited when a statistic changes, while its former host is
   edited when the screen does. The two share no state, and the split is what
   lets a spec drive the arithmetic without rendering anything.

   Part of the frontend; all files share one global script scope (load order:
   see index.html). Dependency-free on purpose — it must load before the views
   that read it. */

// Statistics for one member, computed on demand from the round's sessions
// (sessions are the single source of truth, like the game rating averages).
function memberStats(round, mid) {
  const finished = round.sessions.filter((s) => s.finished);

  // Sessions joined: finished sessions whose memberIds include the member.
  // Legacy sessions have no memberIds -> everyone counts as having joined.
  const joined = finished.filter(
    (s) => !Array.isArray(s.memberIds) || s.memberIds.includes(mid)
  );
  const wins = finished.filter((s) => (s.winnerIds || []).includes(mid)).length;

  // The RATE is over contested evenings only (#895). A solo night is not a
  // contest, and counting it showed a member who logs their solo plays at
  // 100 % — the naive "measure against opportunity" fix, which makes the solo
  // case worse than the plain count it replaced rather than better. `wins`
  // above stays over every finished night: it is a factual record of nights
  // won, not a claim about skill.
  // …and a night that was not ABOUT winning is not a contest either (#1038):
  // „Kein Sieger" and „Fortsetzung folgt" leave the rate untouched rather than
  // counting as a loss. „Verloren" stays contested and unwon — the table played
  // to win and did not — so it lowers the rate, which is the honest reading.
  const notAContest = (s) => {
    const e = sessionEnding(s);
    return e === 'noWinner' || e === 'ongoing';
  };
  const contested = joined.filter((s) => sessionPartyCount(round, s) > 1 && !notAContest(s));
  const contestedWins = contested.filter((s) => (s.winnerIds || []).includes(mid)).length;
  const winRate = contested.length ? contestedWins / contested.length : null;

  // The Siegwertung, the measure the Ruhmeshalle now ranks on (#895). Shown
  // here UNCLAMPED, negatives included, unlike the Pokale tab: this is the
  // member's own stats page rather than a leaderboard, the number sits beside
  // the rate it explains, and clamping it would make one person's figure
  // disagree with the standings they are reading it against.
  const winScore = memberWinScores(round, sessionPartyGroups)[mid];

  // Every numeric rating this member has given, and the per-game averages used
  // to find their favorite game (only games that still exist in the round and
  // that a taste stat may name — `isNameableGame`, recap.js, which this page
  // shares with the Pokale Lieblingsspiele card so a game cannot vanish there
  // while still sitting here). `allRatings` — and so `avgGiven` — deliberately
  // counts EVERY rating, retired games included: it measures how this member
  // rates, not what is on the shelf, so the filter must not reach it (#643).
  const allRatings = [];
  const perGame = {}; // gameId -> [ratings]
  round.sessions.forEach((s) => {
    const votes = s.votes[mid] || {};
    Object.keys(votes).forEach((gid) => {
      const v = votes[gid];
      if (!v || !Number.isFinite(v.rating)) return;
      const r = v.rating;
      allRatings.push(r);
      if (round.games.some((g) => g.id === gid && isNameableGame(g)))
        (perGame[gid] = perGame[gid] || []).push(r);
    });
  });
  const avgGiven = allRatings.length
    ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length
    : null;

  // Favorite game(s): highest average this member gave. Ties share the tile.
  let favGames = [];
  let favAvg = null;
  Object.keys(perGame).forEach((gid) => {
    const avg = perGame[gid].reduce((a, b) => a + b, 0) / perGame[gid].length;
    if (favAvg === null || avg > favAvg) {
      favAvg = avg;
      favGames = [gid];
    } else if (avg === favAvg) {
      favGames.push(gid);
    }
  });
  const favorite = favGames.map((gid) => round.games.find((g) => g.id === gid)).filter(Boolean);

  /* „Stärkstes Spiel" (#920): the same Siegwertung above, partitioned by the
     game that was played. It is a TERM of that total rather than a second
     measure, so the two tiles can never disagree — and it needs none of #894's
     shrinkage for the same reason `win-score.js` gives: a sum, not a rate.

     Same nameability bar as the favourite, and deliberately so: a retired game
     may not be NAMED by a stat tile even though it still counts toward the
     Siegwertung beside it. That is the opposite call from `avgGiven` (#643),
     which counts every rating including retired games — the split is between
     measuring and naming, not between two filters.

     Ties share the tile, like `favorite`. A member with no qualifying game
     leaves `bestScore` at null, which is what the empty state keys off: 0 is a
     real answer here (a solo-only game scores exactly 0) and must not be
     mistaken for "nothing". */
  const perGameWin = memberGameWinScores(round, mid, sessionPartyGroups);
  let bestIds = [];
  let bestScore = null;
  Object.keys(perGameWin).forEach((gid) => {
    if (!round.games.some((g) => g.id === gid && isNameableGame(g))) return;
    const v = perGameWin[gid];
    if (bestScore === null || v > bestScore) {
      bestScore = v;
      bestIds = [gid];
    } else if (v === bestScore) {
      bestIds.push(gid);
    }
  });
  const bestGames = bestIds.map((gid) => round.games.find((g) => g.id === gid)).filter(Boolean);

  return {
    wins,
    joined: joined.length,
    winRate,
    winScore,
    avgGiven,
    favorite,
    favAvg,
    bestGames,
    bestScore,
  };
}
