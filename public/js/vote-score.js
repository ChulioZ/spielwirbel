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
  let sum = 0;
  let count = 0;
  let low = null;
  let vetoes = 0;
  let retires = 0;
  list.forEach((r) => {
    const v = tileValue(r);
    if (v === null) return;
    sum += v;
    count++;
    if (low === null || r < low) low = r;
    if (r === 1) vetoes++;
    if (r === 0) retires++;
  });
  if (!count) return null;
  return { score: sum / count, count, low, vetoes, retires };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TILE_VALUE, SCORE_MIN, tileValue, scoreRatings };
}
