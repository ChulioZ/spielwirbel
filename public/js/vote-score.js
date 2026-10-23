/* Spielwirbel – what a SET of votes on a game is worth: the Spielwirbel-Score
   (#893).

   Callers feed in the 1–5 ratings their votes carry and this answers what the
   collection of them is worth. (It had a sibling, vote-scale.js, answering what
   ONE vote was worth while a retirement proposal was the zero of a 0–5 scale;
   #909 removed that option, so a vote is now just its rating and the sibling is
   gone.)

   WHY THIS EXISTS. The raw arithmetic mean discards the one fact a group
   actually decides on. `{5,5,4,4,1}` and `{4,4,4,4,3}` both read Ø 3,8 — in the
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
   require. Load order: see index.html — before core.js. */

'use strict';

/* What each tile is worth once a vote is scored. Index IS the rating, which is
   why slot 0 is a `null` hole rather than the array starting at 1: every caller
   indexes this and the per-tile histogram by the rating itself, and re-basing
   them would put an off-by-one between the two backends, the SQL aggregate and
   six screens to save one array element. `null` reads as "not a tile" and
   `tileValue`/`scoreTally` both skip it (#909 — it used to be the trash tile
   at -6).

   INTEGERS ON PURPOSE: `scoreSplit` compares sums lexicographically and its
   determinism argument ("two runs of the same search cannot disagree") rests on
   exact integer arithmetic. Keep them integers when retuning.

     1 😢 gar nicht     -3     4 🙂  4
     2 🙁                0     5 🤩  5
     3 😐                3

   THE SHAPE (#1706): every step below „wäre okay" costs 3, every step above it
   earns 1. The cliff sits AT the neutral face, so both bottom faces are an
   unhappy vote — the same line the table split already draws, whose
   `VIOLATION_MAX = 2` (table-split.js) counts a 1 and a 2 alike as an unhappy
   seating. Until #1706 the curve was `[-5, 1, 3, 4, 5]`, with the cliff between
   1 and 2; field reports showed a „gar nicht" given where „eher nicht" was meant
   deciding the evening on its own, so the bottom face got softer and the one
   above it heavier.

   FOUR PROPERTIES ARE DELIBERATE — preserve them when retuning:

   1. A game nobody rated below 3 scores exactly its raw average. The score only
      ever diverges from the familiar number when there is something to say.
   2. f(3) = 3 and f(5) = 5, so „alle 3en" still reads 3,0 and „alle 5en" 5,0.
   3. THE CALIBRATION ANCHOR: three people at 5 and one at 1 scores exactly the
      same as four people at 3 — „drei Leute, die es unbedingt wollen, heben
      genau eine Person auf, die gar nicht will." In general f(1) = 3 − 2k, where
      k is the number of 5s that cancel one 1; k = 3. That sentence is the value
      judgement, and `TILE_VALUE[1]` is the number to move if a group disagrees.
   4. ONE 1 WEIGHS EXACTLY TWO 2s against the neutral face (−6 = 2 × −3), which
      is the shape above stated as an equation.

   The 1 is the bottom of the scale since #909, which removed the trash tile
   that used to sit one rung below it.

   These are starting values chosen to be retuned from real use. Changing a
   number is expected; changing the SHAPE (where the cliff sits, whether the top
   is super-linear) is a scope change. test/vote-score.test.js pins both, so a
   retune that breaks an anchor fails differently from one that shifts a
   magnitude.

   Why a lookup table and not a set of λ weights: any stack of per-level share
   penalties and bonuses collapses algebraically to `mean(f(rᵢ))` with
   `f(k) = k − λₖ + μₖ`. The whole design is five numbers, and it is still a mean
   — just not of the tile numerals. Do not reintroduce separate λ terms; they
   cannot express anything this table cannot, and they make tuning and testing
   much harder. */
const TILE_VALUE = [null, -3, 0, 3, 4, 5];

// The displayed floor. The score can go negative — a game five people vetoed
// scores −3 — and a negative reads as broken rather than as bad, so screens
// clamp. Ranking uses the UNCLAMPED value, so two genuinely different disasters
// still sort; only what is printed is floored.
const SCORE_MIN = 0;

/* What one tile is worth, or null when the argument is not a tile at all.

   Integer-only: a fractional "rating" is not a tile the card can produce, and
   admitting one would silently interpolate a curve that is deliberately a step
   function.

   The range check is the ARRAY's bounds (`0 <= r < length`), not the scale's.
   The scale's bottom is expressed once, by slot 0 holding `null` — writing
   `r >= 1` here as well reads like a second guard and is dead code, because
   `TILE_VALUE[0]` is already null: measured on #909, changing it back to
   `r >= 0` reddens nothing at all. Two overlapping guards where one cannot fail
   is worse than one that can, so there is exactly one place that says a 0 is
   not a tile. */
function tileValue(r) {
  return Number.isInteger(r) && r >= 0 && r < TILE_VALUE.length ? TILE_VALUE[r] : null;
}

/* Score a list of 1–5 ratings.

   Returns null for an empty list, matching what `avg` has always been in that
   case, so every `st.avg !== null` guard already on screen transfers unchanged.

   `low` and `vetoes` come back with the score because the reason line
   („2,2 · 1× gar nicht") needs them at the same moment, and computing them in a
   second pass at each call site is how the two would drift.

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
   `sum(CASE …)` over the tile values there — would hand-restate every
   TILE_VALUE number in a place that can never be kept in step, and the header
   above says those numbers are *expected* to be retuned. That copy would freeze
   the public podium on the old curve, silently, on the one surface a logged-out
   visitor sees (.claude/rules/shared-constants-across-the-stack.md). A histogram
   carries no curve at all — only which tile a vote landed on, which is the
   SCALE, and the scale is restated in that SQL because it must be.

   A non-integer or negative bucket is treated as empty rather than trusted:
   `count` is a divisor here, and a stray value would paint every podium NaN. */
function scoreTally(tiles) {
  const counts = Array.isArray(tiles) ? tiles : [];
  let sum = 0;
  let count = 0;
  let low = null;
  let vetoes = 0;
  for (let r = 0; r < TILE_VALUE.length; r++) {
    // Through `tileValue`, never `TILE_VALUE[r]` directly: "what is a tile" is
    // then one decision in one place, so slot 0's `null` hole and the `r >= 1`
    // bound cannot come to disagree — and either of them breaking is visible in
    // a test, which two overlapping guards would not be.
    const v = tileValue(r);
    const n = counts[r];
    if (v === null || !Number.isInteger(n) || n <= 0) continue;
    sum += v * n;
    count += n;
    if (low === null) low = r;
    if (r === 1) vetoes = n;
  }
  if (!count) return null;
  return { score: sum / count, count, low, vetoes };
}

/* ------------------------------------------------------------- #894 / #1721 --
   SHELF SCOPE: how much of its own score a game has actually earned.

   Everything above answers "what are these votes worth". This half answers a
   second question the shelf asks and one evening does not: "how much should we
   believe them yet". A game three people rated 5,5,5 on the one night it was
   played used to sit above every staple the round had actually formed a view
   on — permanently, and at the top of the Regal, which is where it is most
   visible. #893 made that worse rather than neutral: the most one voter can
   move a score is (top - bottom) / n, which the curve raises from 4/n on the
   tile numerals to 8/n (it was 10/n under #893's original `[-5, 1, 3, 4, 5]`,
   until #1706), so a single vote's leverage on a thin-data game doubles.

   THE UNIT OF EVIDENCE IS AN EVENING (#1721). For one game, over the round's
   sessions:

   - a RATED evening is a session in which the game received at least one
     rating; it contributes that evening's own score R_s (the curve above, over
     that session's ratings);
   - a PLAY is what `playCounts` below counts; it contributes `pick`, the value
     of "somebody chose this game on purpose";
   - a voted-and-chosen evening counts as BOTH (operator decision, 2026-10-23).

     pick  = max(PICK_VALUE, mean of the R_s)     (PICK_VALUE when none)
     score = (PRIOR_DEFAULT · PRIOR_EVENINGS + Σ R_s + plays · pick)
             / (PRIOR_EVENINGS + ratedEvenings + plays)

   Until #1721 the unit was a VOTE: `(n·score + 4·prior) / (n + 4)` over the
   individual ratings, with plays only lifting the prior. Three things followed,
   all measured against the shipped code. One voting evening outweighed many
   plays: a game rated once 5-5-4-1 and then picked four more times read 3,34,
   below a never-rated game played once (3,67), and no value of the play dials
   could fix that without softening every rating everywhere. Votes counted per
   person and plays per evening, so a six-person evening weighed 1,5× a
   four-person one. And winning the vote counted twice, as votes plus a lift on
   a prior the votes then diluted. Counting evenings answers all three, and for
   a four-player round that always votes and never chose the game the number is
   EXACTLY the old one: four votes were one evening's weight then too.

   `pick = max(PICK_VALUE, own mean)` IS LOAD-BEARING. It keeps the property the
   shelf has promised since #894 — more plays can only raise a score — because
   every input to the weighted mean is then at most `pick`, so adding one more
   pick can never pull the mean down. A fixed 4,5 would: {5,5,5,5} chosen ten
   times reads 4,667 and would fall to 4,659 after one more pick, below the same
   votes that lost all ten draws. That is also what separates this from the
   pseudo-vote form rejected in #894 (a fixed play value in the numerator and
   denominator), whose flaw was exactly that drag on a game above the value.

   THE PRIOR IS FIXED, AND THAT IS THE WHOLE POINT (#928). Every input to a
   game's shelf score is a fact about THAT game — its own evenings, its own
   plays — so two rounds holding identical histories print the identical
   number, by construction rather than by discipline. `shelfScore` takes no
   prior parameter for exactly that reason: "which prior did this screen use" is
   not a question the code can express, so it cannot drift into two answers.

   IT SHIPPED SHELF-RELATIVE FIRST, AND THAT WAS WRONG TWICE OVER. #894 shrank
   toward a prior computed from the round's own shelf, reasoning that "what does
   a game here usually turn out to be worth" is the honest expectation for a
   newcomer. Both halves failed:

   1. THE UNITS DID NOT MATCH. `PRIOR_DEFAULT` is the value of one neutral VOTE;
      the shelf-relative prior was a mean over GAME SCORES, and #893's curve is
      deeply asymmetric (`TILE_VALUE[1]` was -5 then). A game carrying one „gar
      nicht" scored -5 and entered that mean as one full data point, weighing exactly
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

   SESSION SCOPE IS DELIBERATELY UNTOUCHED. Tonight's podium reads
   `gameStatsForSession`, and none of this applies there: it IS one evening, so
   the whole electorate is in and there is nothing to shrink.

   ACCEPTED CONSEQUENCE: shrinkage softens a veto on thin data. `{5,5,1}` rated
   once and never chosen reads 2,7 rather than 2,3. That is intended, not a bug
   to fix later — one person's veto on one evening should not permanently sink a
   game the round has otherwise formed no view on, and the veto keeps its full
   force exactly where it decides something, on tonight's unshrunk podium.

   A FLOOR (`max(shrunk, prior)`) was considered and REJECTED. It reads well
   („plays set a floor, ratings only exceed it") and it destroys the veto signal
   #893 exists to surface: a game everybody rates 1 would read 3,0 on every
   shelf. The pick value does lift such a game the more it is chosen — {1,1,1,1}
   rated once and picked twelve times reads 3,9 — and that is the revealed
   preference speaking, not a floor: they keep choosing it. */

// How much evidence the prior is worth, in EVENINGS: a game earns its place on
// the shelf after about one evening of its own. A STARTING VALUE, expected to be
// retuned from real use like TILE_VALUE above. It replaced `SHRINK_M = 4` votes
// at the shelf (#1721) with the same intent, minus the group size.
const PRIOR_EVENINGS = 1;

// What we assume about a game before its own evidence speaks. It is the neutral
// face's value under TILE_VALUE, so „wir wissen es noch nicht" and „keiner hat
// was dagegen" are literally the same number — and it is a CONSTANT, never
// derived from the shelf, which is what makes the score comparable between
// rounds (#928, and the unit mismatch in §1 of the header above).
const PRIOR_DEFAULT = 3;

// What one play is worth: somebody chose this game on purpose, so it sits
// between „gern" and „unbedingt". A game with plays and no ratings therefore
// stays strictly below 4,5 however often it is played — the bound that replaced
// #928's "strictly below 5,0" for plays alone.
const PICK_VALUE = 4.5;

// The vote-weighted shrink the RECOMMENDER still uses (lib/recommend.js): its
// taste profile weighs ratings, not evenings, and the shelf's evening unit is a
// display decision that does not transfer (#1721 left it out of scope).
// Roughly one four-player table of votes.
const SHRINK_M = 4;

/* The shrinkage itself, per VOTE: (n·score + m·prior) / (n + m). With no votes
   the answer is the prior. Only lib/recommend.js calls this since #1721 — the
   shelf counts evenings through `shelfScore` below. Callers pass
   `PRIOR_DEFAULT`; nobody derives one. */
function shrinkScore(score, n, prior) {
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(score)) return prior;
  return (n * score + SHRINK_M * prior) / (n + SHRINK_M);
}

/* Fold a list of per-evening scores into the two numbers `shelfScore` takes.
   Each entry is what `scoreRatings` / `scoreTally` returned for ONE session's
   ratings of the game; a `null` (nobody rated it that evening) is not a rated
   evening and is skipped. Shared so the Regal, the Chronik's period card and
   the Discover podium count evenings the one same way. */
function eveningEvidence(perEvening) {
  let sum = 0;
  let evenings = 0;
  (Array.isArray(perEvening) ? perEvening : []).forEach((sc) => {
    if (!sc || !Number.isFinite(sc.score)) return;
    sum += sc.score;
    evenings += 1;
  });
  return { sum, evenings };
}

/* The number the shelf shows (#1721): a game's rated evenings and its plays,
   shrunk toward a fixed prior worth one evening.

   The null contract is the load-bearing part. A game with neither rated
   evenings nor plays has NO evidence at all, so it stays null and every
   `score !== null` guard already on screen keeps hiding it. A game with plays
   but no ratings — the direct-pick round, which writes `votes: {}` and can never
   collect a rating afterwards — still gets a number, which is what gives such a
   round a ranked shelf at all. */
function shelfScore(eveningSum, ratedEvenings, plays) {
  const rated = Number.isInteger(ratedEvenings) && ratedEvenings > 0 && Number.isFinite(eveningSum)
    ? ratedEvenings : 0;
  const picks = Number.isFinite(plays) && plays > 0 ? plays : 0;
  if (!rated && !picks) return null;
  const sum = rated ? eveningSum : 0;
  const pick = rated ? Math.max(PICK_VALUE, sum / rated) : PICK_VALUE;
  return (PRIOR_DEFAULT * PRIOR_EVENINGS + sum + picks * pick) / (PRIOR_EVENINGS + rated + picks);
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
    SHRINK_M, PRIOR_DEFAULT, PRIOR_EVENINGS, PICK_VALUE,
    shrinkScore, eveningEvidence, shelfScore, playCounts,
  };
}
