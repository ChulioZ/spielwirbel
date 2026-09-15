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

/* Statistics for one member, computed on demand from the round's sessions
   (sessions are the single source of truth, like the game rating averages).

   `deps` is the six sibling helpers this function needs, INJECTED (#1089) —
   the same shape recap.js, period-recap.js and win-score.js already use, and
   for the same reason: a public/js file cannot require() a sibling, so a
   function that must also run under Node has to be handed them. `lib/user-stats.js`
   passes the real modules; the browser omits the argument and the shared global
   scope answers instead.

   The fallback cannot hide a forgotten argument, which is why it is allowed
   here where `wireGameCardHead` refuses one: under Node the globals do not
   exist at all, so omitting `deps` throws a ReferenceError on the first call
   rather than quietly taking a second code path. */
function memberStats(round, mid, deps) {
  const d = deps || {
    sessionEnding,
    sessionPartyCount,
    sessionPartyGroups,
    memberWinScores,
    memberGameWinScores,
    isNameableGame,
  };
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
    const e = d.sessionEnding(s);
    return e === 'noWinner' || e === 'ongoing';
  };
  const contested = joined.filter((s) => d.sessionPartyCount(round, s) > 1 && !notAContest(s));
  const contestedWins = contested.filter((s) => (s.winnerIds || []).includes(mid)).length;
  const winRate = contested.length ? contestedWins / contested.length : null;
  // The two COUNTS ride out alongside the rate (#1089), because a rate cannot be
  // aggregated across seats: `lib/user-stats.js` has to recompute Σ wins / Σ
  // contested, and an average of per-seat rates is a different — wrong — number
  // whenever the seats saw different numbers of contests.

  // The Siegwertung, the measure the Ruhmeshalle now ranks on (#895). Shown
  // here UNCLAMPED, negatives included, unlike the Pokale tab: this is the
  // member's own stats page rather than a leaderboard, the number sits beside
  // the rate it explains, and clamping it would make one person's figure
  // disagree with the standings they are reading it against.
  const winScore = d.memberWinScores(round, d.sessionPartyGroups)[mid];

  // Every numeric rating this member has given, and the per-game averages used
  // to find their favorite game (only games that still exist in the round and
  // that a taste stat may name — `isNameableGame`, recap.js, which this page
  // shares with the Pokale Lieblingsspiele card so a game cannot vanish there
  // while still sitting here). `allRatings` — and so `avgGiven` — deliberately
  // counts EVERY rating, retired games included: it measures how this member
  // rates, not what is on the shelf, so the filter must not reach it (#643).
  const allRatings = [];

  /* ONE per-game pass, feeding BOTH tiles below and the cross-round merge in
     `lib/user-stats.js` (#1089). It used to be two independent collections — a
     `perGame` ratings map here and a `perGameWin` map at the foot of the
     function — each applying the `isNameableGame` bar separately. Merging them
     is what lets the account-wide aggregate ask this function for its raw
     material instead of re-deriving it, which would have put the nameability
     rule in two places (.claude/rules/shared-constants-across-the-stack.md).

     `entry()` returns null for a game the round no longer holds, or one a taste
     stat may not name — so the bar is applied once, at the only door in. */
  const perGame = {}; // gameId -> { game, ratings: [], winScore }
  const entry = (gid) => {
    if (perGame[gid]) return perGame[gid];
    const game = round.games.find((g) => g.id === gid && d.isNameableGame(g));
    if (!game) return null;
    perGame[gid] = { game, ratings: [], winScore: null };
    return perGame[gid];
  };
  round.sessions.forEach((s) => {
    const votes = s.votes[mid] || {};
    Object.keys(votes).forEach((gid) => {
      const v = votes[gid];
      if (!v || !Number.isFinite(v.rating)) return;
      const r = v.rating;
      allRatings.push(r);
      const e = entry(gid);
      if (e) e.ratings.push(r);
    });
  });
  const avgGiven = allRatings.length
    ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length
    : null;

  // Favorite game(s): highest average this member gave. Ties share the tile.
  let favorite = [];
  let favAvg = null;
  Object.keys(perGame).forEach((gid) => {
    const e = perGame[gid];
    if (!e.ratings.length) return;
    const avg = e.ratings.reduce((a, b) => a + b, 0) / e.ratings.length;
    if (favAvg === null || avg > favAvg) {
      favAvg = avg;
      favorite = [e.game];
    } else if (avg === favAvg) {
      favorite.push(e.game);
    }
  });

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
  const perGameWin = d.memberGameWinScores(round, mid, d.sessionPartyGroups);
  let bestGames = [];
  let bestScore = null;
  // Iterated in `perGameWin`'s OWN key order, not `perGame`'s, so which of two
  // tied games leads the tile is unchanged by the merge above.
  Object.keys(perGameWin).forEach((gid) => {
    const e = entry(gid);
    if (!e) return;
    const v = perGameWin[gid];
    e.winScore = v;
    if (bestScore === null || v > bestScore) {
      bestScore = v;
      bestGames = [e.game];
    } else if (v === bestScore) {
      bestGames.push(e.game);
    }
  });

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
    /* Raw material for the account-wide aggregate (#1089), additive: the member
       page reads none of it. The two contest counts are what make Σ wins / Σ
       contested computable across seats, the two rating totals what make a
       count-weighted mean computable, and `games` what makes a game playable in
       two rounds resolve to ONE favourite rather than two. */
    contested: contested.length,
    contestedWins,
    ratingSum: allRatings.reduce((a, b) => a + b, 0),
    ratingCount: allRatings.length,
    games: Object.keys(perGame).map((gid) => perGame[gid]),
  };
}

/* Required by lib/user-stats.js (#1089) — the account-wide aggregate computes
   the same statistics over every seat an account holds, so it must run THIS
   function rather than a second copy of the arithmetic.
   .claude/rules/shared-constants-inventory.md carries the entry. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { memberStats };
}
