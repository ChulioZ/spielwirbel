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
   the same shape recap.js and period-recap.js already use, and
   for the same reason: a public/js file cannot require() a sibling, so a
   function that must also run under Node has to be handed them. `lib/user-stats.js`
   passes the real modules; the browser omits the argument and the shared global
   scope answers instead.

   The fallback cannot hide a forgotten argument, which is why it is allowed
   here where `wireGameCardHead` refuses one: under Node the globals do not
   exist at all, so omitting `deps` throws a ReferenceError on the first call
   rather than quietly taking a second code path. */
/* How many plays' worth of the member's OWN overall win rate „Stärkstes Spiel"
   mixes into each game's rate before ranking (#1715) — `shrinkScore`'s shape in
   vote-score.js, with its own strength, because `SHRINK_M` belongs to the vote
   scale. Three keeps what the play floor it replaced was for: a 1/1 game cannot
   outrank a 4/5 one. */
const BEST_GAME_PRIOR_PLAYS = 3;

/* The value „Stärkstes Spiel" RANKS by — never printed. `prior` is the member's
   contested win rate: per round on the member page, merged across rounds on the
   profile (lib/user-stats.js), which is why this is shared rather than written
   twice. */
function bestGameValue(gameWins, plays, prior) {
  return (gameWins + BEST_GAME_PRIOR_PLAYS * prior) / (plays + BEST_GAME_PRIOR_PLAYS);
}

function memberStats(round, mid, deps) {
  const d = deps || {
    sessionEnding,
    isContestSession,
    sessionPartyGroups,
    isNameableGame,
  };
  const finished = round.sessions.filter((s) => s.finished);

  // Sessions joined: finished sessions whose memberIds include the member.
  // Legacy sessions have no memberIds -> everyone counts as having joined.
  const joined = finished.filter(
    (s) => !Array.isArray(s.memberIds) || s.memberIds.includes(mid)
  );
  const wins = finished.filter((s) => (s.winnerIds || []).includes(mid)).length;

  // The RATE is over contested evenings only (#895) — `isContestSession`
  // (session-people.js) says which. A solo night is not a contest, and counting
  // it showed a member who logs their solo plays at 100 % — the naive "measure
  // against opportunity" fix, which makes the solo case worse than the plain
  // count it replaced rather than better. `wins` above stays over every
  // finished night: it is a factual record of nights won, not a claim about
  // skill. „Kein Sieger"/„Fortsetzung folgt" (#1038) leave the rate untouched;
  // „Verloren" stays contested and unwon — the table played to win and did not
  // — and so does a whole-table team's (#1624): four people beating the game
  // together is a win for each of them, and losing to it a loss.
  const contested = joined.filter((s) => d.isContestSession(round, s, d.sessionEnding));
  const contestedWins = contested.filter((s) => (s.winnerIds || []).includes(mid)).length;
  const winRate = contested.length ? contestedWins / contested.length : null;
  // The two COUNTS ride out alongside the rate (#1089), because a rate cannot be
  // aggregated across seats: `lib/user-stats.js` has to recompute Σ wins / Σ
  // contested, and an average of per-seat rates is a different — wrong — number
  // whenever the seats saw different numbers of contests.

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
  const perGame = {}; // gameId -> { game, ratings: [], plays, gameWins }
  const entry = (gid) => {
    if (perGame[gid]) return perGame[gid];
    const game = round.games.find((g) => g.id === gid && d.isNameableGame(g));
    if (!game) return null;
    perGame[gid] = { game, ratings: [], plays: 0, gameWins: 0 };
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
  /* Per-game contest tally, feeding the tile below and the cross-round merge in
     lib/user-stats.js. Over `contested` rather than `joined`, for the reason the
     tile's own comment gives. `entry()` applies the nameability bar, so a game
     the round no longer holds simply never appears. */
  contested.forEach((s) => {
    if (!s.chosenGameId) return;
    const e = entry(s.chosenGameId);
    if (!e) return;
    e.plays += 1;
    if ((s.winnerIds || []).includes(mid)) e.gameWins += 1;
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

  /* „Stärkstes Spiel" (#920): the game this member wins most OFTEN when they
     play it — wins over contested plays, not a raw count.

     It was the per-game Siegwertung until #1185's follow-up, when that measure
     was withdrawn from the whole app (operator, 2026-09-22): fair and hard to
     read, and in most rounds all but one person carried a negative number. A
     rate says the same thing in a form nobody has to have explained.

     THE DENOMINATOR IS `contested`, the same one `winRate` uses — a one-person
     night is not a contest, and „Kein Sieger"/„Fortsetzung folgt" are not
     either, so counting them would make a member who logs solo plays
     unbeatable. A whole-table team's plays DO count (#1624). That is
     the trap #895 was originally written to close, and a per-game rate walks
     straight into it unless it borrows the same denominator.

     RANKED BY `bestGameValue`, the rate pulled toward the member's own
     `winRate` by BEST_GAME_PRIOR_PLAYS plays (#1715), so one lucky win cannot
     top the tile. It replaced a three-play floor, which was all-or-nothing: a
     member whose every win sat in a game played under three times had only
     never-won games left to rank, and the tile named one at 0 % beside 7 Siege.
     The adjusted value only orders — `bestScore` is the RAW rate of the named
     game, which is what the tile prints.

     A game the member never won is never named, so „no game won yet" is the
     one empty state. With any win at all this skip changes nothing: a won game
     always adjusts above a never-won one.

     Ties are broken by PLAYS before sharing the tile: two games at the same
     value are not equal evidence. Only a genuine tie in both shares — and then
     wins and plays are equal too, so the raw rate is well-defined.

     Same nameability bar as the favourite, and deliberately so: a retired game
     may not be NAMED by a stat tile even though it still counts toward the
     rate beside it — the split is between measuring and naming (#643). */
  let bestGames = [];
  let bestScore = null;
  let bestPlays = 0;
  let bestValue = null;
  Object.keys(perGame).forEach((gid) => {
    const e = perGame[gid];
    if (!e.gameWins) return;
    const v = bestGameValue(e.gameWins, e.plays, winRate);
    if (bestValue === null || v > bestValue || (v === bestValue && e.plays > bestPlays)) {
      bestValue = v;
      bestScore = e.gameWins / e.plays;
      bestPlays = e.plays;
      bestGames = [e.game];
    } else if (v === bestValue && e.plays === bestPlays) {
      bestGames.push(e.game);
    }
  });

  return {
    wins,
    joined: joined.length,
    winRate,
    avgGiven,
    favorite,
    favAvg,
    bestGames,
    bestScore,
    bestPlays,
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
  module.exports = { memberStats, bestGameValue, BEST_GAME_PRIOR_PLAYS };
}
