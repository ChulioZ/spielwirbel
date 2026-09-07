'use strict';

/* What a game's numbers ARE, and how they print: the Spielwirbel-Score fields
   carried by both stat functions, the per-session and per-round rollups, the
   shelf index, the retirement recommendations, and the display trio
   (displayScore / scoreColor / scoreReason).

   Split out of core.js by #956. One concern despite its length — every function
   here answers "what is this game worth to this round", each is a layer over the
   one above it (scoreFields -> rawGameStats -> shelveStats -> gameStats), and
   `retireRecommendations` needs the histogram `scoreFields` carries. The curve
   itself is NOT here: it lives in vote-score.js, which owns TILE_VALUE and is
   shared with the server (`.claude/rules/shared-constants-across-the-stack.md`).

   The display trio comes along because it is the same question one step on —
   what the number LOOKS like — and `scoreColor` is the only caller of the
   rating ramp that is not itself a rating. No `module.exports`: these are
   reached through the jsdom harness like the rest of the shared scope, and
   adding one would change what enters the coverage report. */

// The Spielwirbel-Score fields both stat functions carry (#893). Spread rather
// than nested so `st.score` reads exactly like `st.avg` at the call sites, and
// so a screen that has not switched over yet keeps working untouched.
//
// `score` is null for an empty list, matching `avg`, so every `!== null` guard
// already on screen transfers as-is.
//
// `tiles` is the per-tile histogram, and it is part of the contract: it carries
// "how many voted 2", which `vetoes` cannot express and which the
// lone-dissenter guard in retireRecommendations() needs (#922). It is scored
// through `scoreTally` rather than `scoreRatings` — the two are the same
// function over two input shapes, so this is behaviour-identical and leaves ONE
// counting loop instead of a second one beside it. Admission goes through
// `tileValue` for the same reason scoreRatings' does: an off-scale stray has to
// be skipped by the histogram and the score alike, or the two would disagree
// about who voted.
function scoreFields(ratings) {
  const tiles = TILE_VALUE.map(() => 0);
  (Array.isArray(ratings) ? ratings : []).forEach((r) => { if (tileValue(r) !== null) tiles[r] += 1; });
  const s = scoreTally(tiles);
  return s
    ? { score: s.score, low: s.low, vetoes: s.vetoes, tiles }
    : { score: null, low: null, vetoes: 0, tiles };
}

// Rating stats of a game within ONE session. Iterates the session's PEOPLE, not
// the round's members, so a guest's rating counts too (#458) — a guest actually
// played the game, and leaving their vote out would make this screen and the
// game's own average silently disagree. Since #909 a guest's scale is the same
// 1–5 as a member's, so there is nothing here to treat differently at all.
//
// `v.rating` is read directly: a vote is its rating and nothing else. That was
// not true between #797 and #909, when a retirement proposal was the zero of a
// 0–5 scale and had to be resolved through a shared `effectiveRating`.
function gameStatsForSession(round, session, gameId) {
  const ratings = [];
  sessionPeople(round, session).forEach((p) => {
    const v = (session.votes[p.id] || {})[gameId];
    if (v && Number.isFinite(v.rating)) ratings.push(v.rating);
  });
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  // `avg` is kept beside `score` for the per-member stats, which are about how
  // a PERSON votes rather than how good a game is — a game-scoring curve would
  // be a category error there (#893). It no longer has a second reader on the
  // game detail header, which printed the honest mean beside the score until
  // #919.
  return { avg, ...scoreFields(ratings), count: ratings.length };
}

// Rating stats of a game across ALL (still existing) sessions, BEFORE the shelf
// decides how much of that to believe (#894). Computed on demand on purpose:
// sessions are the single source of truth, so deleting a session automatically
// removes its effect.
//
// Nothing renders this directly — every shelf surface goes through `gameStats`
// or `roundScoreIndex` below, which is what stops one screen showing a game's
// raw score beside another showing its shrunk one.
function rawGameStats(round, gameId) {
  const ratings = [];
  let sessions = 0;
  round.sessions.forEach((s) => {
    if (!s.gameIds.includes(gameId)) return;
    sessions++;
    // Guests included, for the same reason as gameStatsForSession above (#458).
    sessionPeople(round, s).forEach((p) => {
      const v = (s.votes[p.id] || {})[gameId];
      if (v && Number.isFinite(v.rating)) ratings.push(v.rating);
    });
  });
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  return { avg, ...scoreFields(ratings), count: ratings.length, sessions };
}

// The raw stats plus the shelf's verdict on them (#894). `score` becomes the
// shrunk value because at shelf scope the shrunk score simply IS the score —
// the pill, the ring and the Pokale cards all read this one field, so the
// numbers and the ordering can never contradict each other. `rawScore` is kept
// beside it for tests and for anyone who needs the unshrunk figure; `avg` is
// still the honest arithmetic mean and is untouched by any of this.
//
// Every other field (`count`, `tiles`, `vetoes`) stays raw on purpose: they are
// counts of what happened, and `scoreReason()` and `retireRecommendations()`
// both read them as such.
function shelveStats(raw, plays) {
  return {
    ...raw,
    plays,
    rawScore: raw.score,
    score: shelfScore(raw.score, raw.count, plays),
  };
}

/* The shelf's view of a whole round, computed ONCE per render (#894).

   THE O(n²) TRAP THIS EXISTS TO AVOID. The play count is a property of the
   round, not of the game being scored, so deriving it inside `rawGameStats`
   would rescan every session for every game on every card. lib/recommend.js
   records the same mistake with numbers: 19.8 ms -> 364 ms for one call at the
   1000-game quota ceiling. Hence one `playCounts` walk and one `rawGameStats`
   pass — never a second walk and never a per-game one.

   `games` narrows the index to the ACTIVE shelf, which is what every loop site
   renders. Since #928 nothing here is read ACROSS games — the prior is fixed,
   so a game's number depends on its own votes and plays alone — so this
   argument now only decides which entries `byGame` carries, not what any of
   them says. Callers that already hold `activeGames` pass it; otherwise it is
   derived here with the same predicate they use. */
function roundScoreIndex(round, games) {
  const shelf = games || round.games.filter(isActiveGame);
  const plays = playCounts(round);
  const byGame = {};
  shelf.forEach((g) => (byGame[g.id] = shelveStats(rawGameStats(round, g.id), plays.get(g.id) || 0)));
  return { plays, byGame };
}

// Shelf-scope stats for ONE game — the single-game entry point (the game detail
// screen). It scores the game on its own, which is only possible since #928: it
// used to build the whole `roundScoreIndex` because the prior was read across
// the shelf, and an off-shelf game (retired, completed or a wish, opened by its
// own URL) had to be scored against a shelf it was not part of. With the prior
// fixed, one game's number needs nothing but that game — so this is one
// `playCounts` walk plus one `rawGameStats`, not a full pass over the shelf.
//
// Loop sites still take `roundScoreIndex` above and read `byGame`: `playCounts`
// walks every session, so calling this in a loop is the O(n²) trap that
// function's header describes.
function gameStats(round, gameId) {
  return shelveStats(rawGameStats(round, gameId), playCounts(round).get(gameId) || 0);
}

/* Retirement suggestions: games the round's accumulated votes say are dragging
   the shelf down. Nothing is proposed until there are enough votes, so a few
   opinions never raise a banner.

   ONE BRANCH SINCE #909. There used to be a second, `SORT_SHARE`: at least half
   the votes on a game being explicit "aussortieren" proposals. That control is
   gone from the vote card — and it had already stopped deciding anything, which
   is the argument that retired it. With a trash vote worth -6 under #893's
   curve, half a game's votes being trash caps its best possible score at
   (−6 + 5) / 2 = −0,5, far below the 1,0 bar below; so the share branch could
   never fire without the score branch firing first. The score branch is in fact
   the MORE sensitive of the two — two vetoes among five voters with the rest at
   5 lands on exactly 1,0 and proposes the game at a 40 % share.

   What is knowingly given up with the tile: the 1 says „not tonight" and the
   trash said „off the shelf", so this is now purely inferential — a game the
   group is merely tired of reads like one they want gone. Accepted (#909); in
   real use the 1 was already being read as the veto. */
function retireRecommendations(activeGames, statsByGame, minVotes) {
  // "very low" on the SCORE scale. Was `LOW_AVG = 2.0` against the raw mean
  // (#797); the veto curve makes a 2,0 far easier to reach, so the threshold
  // came down with it (#893) rather than quietly widening what gets proposed.
  //
  // 1.0 is not a magnitude, it is an ANCHOR: it is exactly what a flat 2 from
  // everybody scores — „eher nicht" all round, the worst a game can be while
  // still getting a real rating from every voter. That is the bar for saying
  // "this one is dragging the shelf down", and reading it that way is what
  // keeps a retune honest.
  //
  // The value 1.5 was tried first and is WRONG, for a reason worth recording:
  // a game rated {1,4,5,3} — three of four people like it, one does not want to
  // play it at all — scores exactly 1.5, and one dissenter must not retire a
  // game on their own.
  //
  // The SECOND correction (#922) is not to the number but to its DIVISOR. The
  // 1.5-was-wrong analysis above was done entirely at n=4, where one dissenter
  // weighs `TILE_VALUE[1] / 4`; at n=3 the same dissent weighs -5/3 and {1,4,4}
  // lands on exactly 1.0. So the anchor was being reached by group size rather
  // than by how the game was received — {1,4,4} proposed, {1,4,4,4} not. The
  // threshold stayed at 1.0 and the rating branch grew the lone-dissenter guard
  // below instead, which is group-size independent by construction.
  // Pinned by test/retire-score-threshold.test.js, demo fixture included.
  //
  // THE THIRD CORRECTION (#894) IS ABOUT WHICH SCORE IT READS. Everything the
  // shelf displays is shrunk, but this branch deliberately keeps reading
  // `rawScore`, for two reasons that both survive #928's fixed prior:
  //
  // - No fixed threshold on the shrunk scale can hold the anchor. {2,2,2,2}
  //   shrinks to 2,00 at four votes and 1,18 at forty, so the bar would be
  //   reached by how many people voted rather than by how the game was received
  //   — which is exactly the defect #922 fixed one divisor over.
  // - The play lift moves it too. A game the round keeps putting on the table
  //   is shrunk toward a higher prior, so „dieses Spiel zieht das Regal runter"
  //   would get quieter the more often they play it. (Before #928 the same
  //   objection had a second, larger form: the prior was the round's own shelf,
  //   so a good shelf made a bad game harder to propose.)
  //
  // This is not a second ranking: shrinkage is monotonic in the raw score at a
  // fixed (n, plays), so `rawScore <= LOW_SCORE` is EXACTLY the same decision as
  // comparing the shrunk score against the shrunk anchor — just without a
  // threshold that has to move. Uncertainty is already handled here by
  // `minVotes` (three times the member count), which is a harder evidence bar
  // than shrinkage expresses; applying both would count it twice.
  //
  // The number the banner PRINTS is still the shrunk one, so it agrees with the
  // pill and the ring rather than showing a second figure for the same game.
  const LOW_SCORE = 1.0;
  const recs = [];
  activeGames.forEach((g) => {
    const st = statsByGame[g.id];
    // `count` is the evidence bar: since #909 a vote IS a rating, so the
    // separate `votesCast` (votes carrying a rating and/or the retire flag)
    // this used to gate on is the same number.
    if (!st || st.count < minVotes) return;
    // Decline when the low score rests on a SINGLE voter (#922): exactly one
    // vote below 2, and nobody at 2. Requiring nobody at 2 is what keeps the
    // anchor intact — „eher nicht" from anyone else still leaves the game
    // proposable, so this suppresses a dissenting minority of one and nothing
    // wider. (It read `tiles[0] + tiles[1]` while the trash tile existed; tile 0
    // is a permanent hole since #909, so only the 1 remains.)
    const loneDissenter = st.tiles[1] === 1 && st.tiles[2] === 0;
    if (st.rawScore === null || st.rawScore > LOW_SCORE || loneDissenter) return;
    const reasons = [t('rec.reasonAvg', { avg: fmtAvg(displayScore(st.score)) })];
    // Ranked on the raw score for the same reason the branch gates on it: this
    // orders "how badly is this game received", not "where does it sit on the
    // shelf".
    recs.push({ game: g, reasons, severity: Math.max(0, 3 - st.rawScore) / 3 });
  });
  recs.sort((a, b) => b.severity - a.severity);
  return recs;
}

// Recommendation box minimized for this session (per round).
const minimizedRecs = new Set();

// What a score PRINTS as. The curve can carry a score below zero — five vetoes
// score −5 — and a negative reads as a broken app rather than as a bad game, so
// every display clamps at the floor. Ranking deliberately uses the unclamped
// value, so two games at the floor still sort by how bad they actually are;
// `computePlaces` then ties them on the displayed number, which is what makes
// two floored games correctly share a place (#893).
const displayScore = (score) => Math.max(SCORE_MIN, score);

// The score's colour. `avgColor`'s ramp runs over 0–5 and the score's floor is
// its bottom — one ramp, two domains. Keep `avgColor` for anything on the 1–5
// tile scale itself (the selected vote tile, the distribution chart) and this
// for anything on the score scale, which reaches below 1.
const scoreColor = (score) => avgColor(displayScore(score));

// Why this score is what it is, in a few words — „1× gar nicht" (#893).
//
// This is the PRIMARY explanation of the number, not the ⓘ sheet: it explains
// THIS game at the moment the group is deciding, which a popup describing the
// principle in general cannot. Empty whenever there is nothing to say, which is
// the common case — a game nobody rated below 3 scores exactly its raw average,
// so a reason line there would be noise claiming a divergence that is not
// happening.
//
// It had a second sentence for the trash tile („1× aussortieren") until #909
// removed that tile; the veto clause is the whole of it now, and stays — it
// explains the score pill rather than recommending a retirement.
function scoreReason(st) {
  return st.vetoes ? tn(st.vetoes, 'score.reasonVetoOne', 'score.reasonVeto', { n: st.vetoes }) : '';
}
