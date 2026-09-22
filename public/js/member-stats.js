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
/* The floor „Stärkstes Spiel" ranks above. Three, because at two contested
   plays a perfect record is a coin toss and the tile would name whichever game
   the member happened to win first — and because a member has to be able to
   REACH it: most rounds play a given box a handful of times a year, so a higher
   floor would leave the tile empty for almost everybody. */
const BEST_GAME_MIN_PLAYS = 3;

function memberStats(round, mid, deps) {
  const d = deps || {
    sessionEnding,
    sessionPartyCount,
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

     THE DENOMINATOR IS `contested`, the same one `winRate` uses — a solo night
     is not a contest, and „Kein Sieger"/„Fortsetzung folgt" are not either, so
     counting them would make a member who logs solo plays unbeatable. That is
     the trap #895 was originally written to close, and a per-game rate walks
     straight into it unless it borrows the same denominator.

     BEST_GAME_MIN_PLAYS is what stops one lucky win topping the tile: at two
     plays a perfect record is a coin toss, and the tile would name whatever
     game the member happened to win first. Below the floor a game is not
     ranked at all rather than ranked low — an unproven game is not a weak one.

     Ties are broken by PLAYS before sharing the tile: two games both at 100 %
     are not equal evidence, and without this the tile would routinely show
     three games nobody has played more than three times. Only a genuine tie in
     both rate and plays shares.

     Same nameability bar as the favourite, and deliberately so: a retired game
     may not be NAMED by a stat tile even though it still counts toward the
     rate beside it — the split is between measuring and naming (#643). */
  let bestGames = [];
  let bestScore = null;
  let bestPlays = 0;
  Object.keys(perGame).forEach((gid) => {
    const e = perGame[gid];
    if (e.plays < BEST_GAME_MIN_PLAYS) return;
    const rate = e.gameWins / e.plays;
    if (bestScore === null || rate > bestScore || (rate === bestScore && e.plays > bestPlays)) {
      bestScore = rate;
      bestPlays = e.plays;
      bestGames = [e.game];
    } else if (rate === bestScore && e.plays === bestPlays) {
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
  module.exports = { memberStats, BEST_GAME_MIN_PLAYS };
}
