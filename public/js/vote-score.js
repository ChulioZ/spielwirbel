/* Spielwirbel – what a SET of votes on a game is worth: the Spielwirbel-Score
   (#893).

   Its sibling vote-scale.js answers what ONE vote is worth (the #797
   retire-precedence rule); this answers what a collection of them is worth.
   Keep the composition explicit — callers resolve a vote through
   `effectiveRating` first, then feed the resulting 0–5 numbers in here.

   WHY THIS EXISTS. The raw arithmetic mean discards the one fact a group
   actually decides on. `{5,5,4,3,0}` and `{4,3,3,3,4}` both read Ø 3,4 — in the
   same size, in the same colour — while being completely different
   recommendations: the first has somebody who does not want to play at all, the
   second has nobody unhappy. Field evidence from real family use: a game gets a
   good mean, one person votes 1, and the children say „aber da hat jemand eine
   1 gegeben, das können wir nicht nehmen." That is correct usage, and the vote
   card's own copy agrees — the 1 is labelled „gar nicht".

   The app already believed this at two tables and nowhere else: `scoreSplit`
   (table-split.js) ranks seatings `[violations, -sum, …]`, i.e. vetoes first.
   So the same votes on the same evening got a "nobody must be miserable"
   objective if the group split and a purely utilitarian one if it did not. This
   file is what makes the single-table path agree with the multi-table one — and
   `tableFeedback` sums through `tileValue` so the two cannot drift
   (.claude/rules/shared-constants-across-the-stack.md).

   Pure and dependency-free, so it works both as a shared-scope frontend script
   and as a CommonJS module the server (lib/recommend.js) and the test suite
   require. Load order: see index.html — after vote-scale.js, before core.js. */

'use strict';

/* What each tile is worth once a vote is scored. Index is the 0–5 rating.

   INTEGERS ON PURPOSE: `scoreSplit` compares sums lexicographically and its
   determinism argument ("two runs of the same search cannot disagree") rests on
   exact integer arithmetic. Keep them integers when retuning.

     0 🗑 aussortieren  -6     3 😐  3
     1 😢 gar nicht     -5     4 🙂  4
     2 🙁                1     5 🤩  5

   THREE PROPERTIES ARE DELIBERATE — preserve them when retuning:

   1. A game nobody rated below 3 scores exactly its raw average. The score only
      ever diverges from the familiar number when there is something to say.
   2. f(3) = 3 and f(5) = 5, so „alle 3en" still reads 3,0 and „alle 5en" 5,0.
   3. THE CALIBRATION ANCHOR: four people at 5 and one at 1 scores exactly the
      same as five people at 3 — „vier Leute, die es unbedingt wollen, heben
      genau eine Person auf, die gar nicht will." That one sentence is the whole
      value judgement, and `TILE_VALUE[1]` is the number to move if the family
      disagrees with it.

   The cliff sits between 1 and 2 because the app itself calls the 1 „gar nicht".
   The 0 sits just below it rather than far below: the EXTRA content of a trash
   vote is about the shelf, not about tonight, and `retireRecommendations()`
   already reads that separately off `sortCount`.

   These are starting values chosen to be retuned from real use. Changing a
   number is expected; changing the SHAPE (where the cliff sits, whether the top
   is super-linear) is a scope change. test/vote-score.test.js pins both, so a
   retune that breaks an anchor fails differently from one that shifts a
   magnitude.

   Why a lookup table and not a set of λ weights: any stack of per-level share
   penalties and bonuses collapses algebraically to `mean(f(rᵢ))` with
   `f(k) = k − λₖ + μₖ`. The whole design is six numbers, and it is still a mean
   — just not of the tile numerals. Do not reintroduce separate λ terms; they
   cannot express anything this table cannot, and they make tuning and testing
   much harder. */
const TILE_VALUE = [-6, -5, 1, 3, 4, 5];

// The displayed floor. The score can go negative — a game five people vetoed
// scores −5 — and a negative reads as broken rather than as bad, so screens
// clamp. Ranking uses the UNCLAMPED value, so two genuinely different disasters
// still sort; only what is printed is floored.
const SCORE_MIN = 0;

// What one tile is worth, or null when the argument is not a tile at all.
// Integer-only: a fractional "rating" is not a tile the card can produce, and
// admitting one would silently interpolate a curve that is deliberately a step
// function.
function tileValue(r) {
  return Number.isInteger(r) && r >= 0 && r < TILE_VALUE.length ? TILE_VALUE[r] : null;
}

/* Score a list of 0–5 ratings.

   Returns null for an empty list, matching what `avg` has always been in that
   case, so every `st.avg !== null` guard already on screen transfers unchanged.

   `low`, `vetoes` and `retires` come back with the score because the reason
   line („2,2 · 1× gar nicht") needs them at the same moment, and computing them
   in a second pass at each call site is how the two would drift. `vetoes` and
   `retires` stay separate counters rather than one "unhappy" total: they phrase
   different sentences, and the trash tile is members-only (#458), so merging
   them would put a control a guest never sees into a guest's mouth.

   Values off the scale are skipped rather than admitted. Nothing should ever
   store one, but the plain mean would turn a single stray into NaN and paint
   every pill on the screen with it. */
function scoreRatings(ratings) {
  const list = Array.isArray(ratings) ? ratings : [];
  const tiles = TILE_VALUE.map(() => 0);
  list.forEach((r) => { if (tileValue(r) !== null) tiles[r] += 1; });
  return scoreTally(tiles);
}

/* Score a per-tile HISTOGRAM: `tiles[k]` is how many votes landed on tile k.

   Same curve, same return shape and the same null-on-empty contract as
   `scoreRatings` — which is now expressed through it, so the two input shapes
   cannot come to disagree about what a set of votes is worth.

   WHY A SECOND SHAPE EXISTS AT ALL (#914). The cross-tenant Discover aggregate
   (lib/public-stats.js) is fed by a `count(*) FILTER` per tile from SQL, because
   the Postgres aggregate cannot require() this file. The obvious alternative — a
   `sum(CASE …)` over the tile values there — would hand-restate all six
   TILE_VALUE numbers in a place that can never be kept in step, and the header
   above says those numbers are *expected* to be retuned. That copy would freeze
   the public podium on the old curve, silently, on the one surface a logged-out
   visitor sees (.claude/rules/shared-constants-across-the-stack.md). A histogram
   carries no curve at all — only which tile a vote landed on, which is the
   SCALE, and the scale is already restated in that SQL for #797's sake.

   A non-integer or negative bucket is treated as empty rather than trusted:
   `count` is a divisor here, and a stray value would paint every podium NaN. */
function scoreTally(tiles) {
  const counts = Array.isArray(tiles) ? tiles : [];
  let sum = 0;
  let count = 0;
  let low = null;
  let vetoes = 0;
  let retires = 0;
  for (let r = 0; r < TILE_VALUE.length; r++) {
    const n = counts[r];
    if (!Number.isInteger(n) || n <= 0) continue;
    sum += TILE_VALUE[r] * n;
    count += n;
    if (low === null) low = r;
    if (r === 1) vetoes = n;
    if (r === 0) retires = n;
  }
  if (!count) return null;
  return { score: sum / count, count, low, vetoes, retires };
}

/* ------------------------------------------------------------------ #894 --
   SHELF SCOPE: how much of its own score a game has actually earned.

   Everything above answers "what are these votes worth". This half answers a
   second question the shelf asks and one evening does not: "how much should we
   believe them yet". A game three people rated 5,5,5 on the one night it was
   played used to sit above every staple the round had actually formed a view
   on — permanently, and at the top of the Regal, which is where it is most
   visible. #893 made that worse rather than neutral: the most one voter can
   move a score is (top - bottom) / n, which the curve raises from 5/n to 11/n,
   so a single vote's leverage on a thin-data game more than doubled.

   THE PRIOR IS FIXED, AND THAT IS THE WHOLE POINT (#928). Every input to a
   game's shelf score is a fact about THAT game — its own votes, its own plays —
   so two rounds holding identical votes and plays print the identical number,
   by construction rather than by discipline. `shelfScore` takes no prior
   parameter for exactly that reason: "which prior did this screen use" is not a
   question the code can express, so it cannot drift into two answers.

   IT SHIPPED SHELF-RELATIVE FIRST, AND THAT WAS WRONG TWICE OVER. #894 shrank
   toward a prior computed from the round's own shelf, reasoning that "what does
   a game here usually turn out to be worth" is the honest expectation for a
   newcomer. Both halves failed:

   1. THE UNITS DID NOT MATCH. `PRIOR_DEFAULT` is the value of one neutral VOTE;
      the shelf-relative prior was a mean over GAME SCORES, and #893's curve is
      deeply asymmetric (`TILE_VALUE[1] = -5`). A game carrying one „gar nicht"
      scores -5 and entered that mean as one full data point, weighing exactly
      as much as an established game at +4. On a real 85-game family shelf where
      most games have one or two votes, that thin low-voted tail WAS the prior:
      measured at ≈ 0,4 against a documented intent of 3,0, which pulled the
      whole shelf down by two to three points and collapsed roughly a third of
      it onto the `SCORE_MIN` clamp — the one signal that would have made the
      broken scale visible.
   2. THE NUMBER MEANT NOTHING ACROSS ROUNDS. The app labels it
      „Spielwirbel-Score" on the Regal, on the detail ring, in the Pokale, in
      the Chronik and in the share text people send OUTSIDE the round — while
      the number said as much about the other 84 games on that shelf as about
      the game it was printed on. `/entdecken` printed a third quantity again on
      the same 0–5 ring. A label used in five places must denote one thing.

   Note the curve itself was NOT the defect and is unchanged at both scopes: the
   vote card asks about tonight („Wie gern möchtest du das spielen?") and #893's
   anchor is a decision rule for one table, which remains right. Fixing the
   prior recovers the numbers without touching it.

   SESSION SCOPE IS DELIBERATELY UNTOUCHED. Tonight's podium reads
   `gameStatsForSession`, and none of this applies there for two independent
   reasons: `n` is the whole electorate rather than a sample (the vote card
   refuses to advance until everyone present has rated every drawn game), and
   shrinking equal-`n` values toward a common prior is order-preserving anyway,
   so it would move every number on the podium and none of its ranking.

   ACCEPTED CONSEQUENCE: shrinkage softens a veto on thin data. `{5,5,1}` played
   once reads 2,8 rather than 1,7. That is intended, not a bug to fix later —
   one person's veto on one evening should not permanently sink a game the round
   has otherwise formed no view on, and the veto keeps its full force exactly
   where it decides something, on tonight's unshrunk podium.

   A FLOOR (`max(shrunk, prior)`) was considered and REJECTED. It reads well
   („plays set a floor, ratings only exceed it") and it destroys the veto signal
   #893 exists to surface: a game everybody rates 1 and the group still plays
   weekly would read 3,9. Do not reintroduce it without solving that. */

// How much evidence a game needs before its own score outweighs the prior —
// roughly one table's worth of votes, so a game earns its place on the shelf
// after about one full evening of ratings. A STARTING VALUE, expected to be
// retuned from real use like TILE_VALUE above. Deliberately left at 4 by #928:
// the recovery there came from fixing the prior, not from trusting thin data
// more, and those are separate dials that must not be conflated.
const SHRINK_M = 4;

// What we assume about a game before its own evidence speaks. It is the neutral
// face's value under TILE_VALUE, so „wir wissen es noch nicht" and „keiner hat
// was dagegen" are literally the same number — and it is a CONSTANT, never
// derived from the shelf, which is what makes the score comparable between
// rounds (#928, and the unit mismatch in §1 of the header above).
const PRIOR_DEFAULT = 3;

// Full play credit is worth TWO TILES of prior: a game the group keeps choosing
// is presumed 🤩 „wir lieben das" rather than 😐 „keiner hat was dagegen".
// Direct plays are the round's revealed preference and count heavily — a family
// that put a game on the table twelve times has said something at least as
// strong as four ratings.
//
// #894 shipped 1,0 and asserted a ceiling with it („plays alone can never make
// a game read as 🤩"); #928 raised it and dropped that claim KNOWINGLY. A
// never-rated game played 12× now reads ≈ 4,7 and outranks one rated {5,5,5,5}
// (4,0). What survives is the weaker property that still bounds the dial:
// `gamePrior` is strictly below PRIOR_DEFAULT + PLAY_LIFT = 5,0, so plays alone
// can never reach a full 5,0 however often a game is played.
const PLAY_LIFT = 2.0;

// Plays at which half the lift is earned. A SATURATING curve, never a clamp: it
// is strictly increasing forever, so twelve plays still outrank six on an active
// shelf. And it is ABSOLUTE rather than relative-to-the-most-played (which is
// what lib/recommend.js's own play bonus uses), because a displayed number must
// not move because a DIFFERENT game got played.
const PLAY_HALF = 2;

// How much of the play lift `plays` nights have earned: 1 -> 0,33 · 2 -> 0,50 ·
// 3 -> 0,60 · 10 -> 0,83 · 20 -> 0,91. Zero for a game never put on the table,
// which is what keeps a never-played, never-rated game scoreless below.
function playCredit(plays) {
  const n = Number.isFinite(plays) && plays > 0 ? plays : 0;
  return n ? n / (n + PLAY_HALF) : 0;
}

/* The prior for ONE game: the neutral expectation, raised by how often the
   group actually chose it. Takes no shelf and no round — see the header.

   A play does not add points to a score — it raises the expectation the score is
   shrunk TOWARD, which is what makes it strictly one-directional:
   d(shrunk)/d(prior) = m/(n+m) > 0, so more plays can only ever raise a number
   and never lower one.

   The pseudo-vote form (play credit in the numerator AND denominator at a fixed
   tile value) was rejected for exactly that: it lowers any game already scoring
   above the play value, so a beloved staple played weekly would score below a
   beloved game played once. */
function gamePrior(plays) {
  return PRIOR_DEFAULT + PLAY_LIFT * playCredit(plays);
}

/* The shrinkage itself: (n·score + m·prior) / (n + m). With no votes the answer
   is the prior — the caller decides whether that is a number worth showing.

   This one still TAKES its prior, unlike `shelfScore` and `gamePrior` above: it
   is the arithmetic, not the policy, and lib/recommend.js legitimately shrinks
   without the play lift (the play signal already reaches its profile through
   `W_PLAYS`, and applying both would count it twice). Callers pass
   `PRIOR_DEFAULT`; nobody derives one. */
function shrinkScore(score, n, prior) {
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(score)) return prior;
  return (n * score + SHRINK_M * prior) / (n + SHRINK_M);
}

/* The number the shelf shows: a game's own score, shrunk toward a fixed prior
   its own plays have lifted.

   The null contract is the load-bearing part. A game with neither ratings nor
   plays has NO evidence at all, so it stays null and every `score !== null`
   guard already on screen keeps hiding it. A game with plays but no ratings —
   the direct-pick round, which writes `votes: {}` and can never collect a rating
   afterwards — gets the lifted prior, and that is the whole reason §7 exists:
   without it such a round has a shelf where nothing is ranked and nothing ever
   will be, however often they play. */
function shelfScore(score, n, plays) {
  const c = gamePrior(plays);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(score)) {
    return playCredit(plays) > 0 ? c : null;
  }
  return shrinkScore(score, n, c);
}

/* How often each game was actually put on the table, over the round's own
   sessions.

   A play is a NON-CANCELLED session with a `chosenGameId`, finished or not: a
   game chosen tonight was chosen. Both start modes write that field, so a direct
   pick and a drawn-and-chosen game count the same. A split evening counts once
   per table, since each child session carries its own `chosenGameId` — the
   reading lib/feed.js already states.

   It lives HERE rather than in lib/recommend.js (where it was written, #778)
   because the shelf score and the recommender must count plays identically:
   nothing validates that across the boundary, so a drifted copy would simply
   make the Regal and the recommender disagree about how often a game was
   played, with no error anywhere
   (.claude/rules/shared-constants-across-the-stack.md).

   The `cancelled` guard is belt-and-braces — lib/routes/sessions.js already
   refuses to cancel a session that has a chosen game — and is kept anyway to
   match `partyDistribution`, which reads the same sessions for the same reason. */
function playCounts(round) {
  const counts = new Map();
  ((round && round.sessions) || []).forEach((s) => {
    if (s.cancelled) return;
    const gid = s.chosenGameId;
    if (!gid) return;
    counts.set(gid, (counts.get(gid) || 0) + 1);
  });
  return counts;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TILE_VALUE, SCORE_MIN, tileValue, scoreRatings, scoreTally,
    SHRINK_M, PRIOR_DEFAULT, PLAY_LIFT, PLAY_HALF,
    playCredit, gamePrior, shrinkScore, shelfScore, playCounts,
  };
}
