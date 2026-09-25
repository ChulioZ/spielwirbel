'use strict';

/*
 * The three spotlight variants behind the recommendations screen (#1228) —
 * split out of lib/recommend.js, which does the one corpus pass and calls in
 * here per candidate. Everything in this file is a pure function of a base score,
 * a profile's target or the corpus snapshot; none of it scores a candidate, so the
 * six weights stay one readable block over there.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/*
 * Three tiles above the list (#1228), one game each, picked by re-scoring the
 * same candidates with ONE term deliberately altered. Each answers a question
 * the main list structurally cannot, because the main list only ever optimises
 * for "most like you":
 *
 *   different   the two taste cosines INVERTED (1 - value): a game that plays
 *               nothing like the shelf, while quality, complexity, players and
 *               time stay intact — so it is still one they could actually play
 *   complexity  `targetWeight` shifted half a step, in the direction the round's
 *               own centre leaves room for (see `complexityDirection`)
 *   hidden      the candidate pool restricted to rows BGG's crowd has barely
 *               rated — the only one of the three that corrects a BIAS (quality
 *               is 35 % of the score and reads `bayesRating`, so the head of every
 *               round's list is pulled toward the same global favourites) rather
 *               than re-slicing the same ranking
 *
 * THE MAIN LIST IS UNTOUCHED. Every variant is derived from the base score or
 * from a shallow copy of the profile; `scoreCandidate` has no variant branch and
 * `test/recommend-spotlight.test.js` pins the base list byte-for-byte against
 * the pre-#1228 output. A `if (variant === …)` inside the scorer is how the six
 * weights would stop being one readable block.
 *
 * A spotlight is a recommendation and gets NO exemptions: every hard filter and
 * the dismissal list run before it is offered anything, because they run before
 * the base score is computed at all.
 */

// Half a step of BGG's 1–5 weight — the smallest move a reader notices, and
// comfortably outside the base term's ±0.3 effective window (#975), so the tile
// really does surface something the main list suppresses.
const SPOTLIGHT_COMPLEXITY_STEP = 0.5;
// The round's centre at which the tile turns round. Below it the round has room
// to go heavier, at or above it the tile goes lighter: a fixed "+0.5" at a
// centre of 4.2 would ask for a 4.7 game, of which the corpus holds almost none,
// and the tile would return whatever noise clears the other terms.
const SPOTLIGHT_COMPLEXITY_PIVOT = 3;
/*
 * The Geheimtipp's pool: rows whose `usersRated` is BELOW this quantile of the
 * enriched corpus the instance actually holds.
 *
 * A QUANTILE OF THE SNAPSHOT, not a fixed count, and that is a decision rather
 * than a convenience. `BGG_CORPUS_MIN_RATINGS` (100) is the ingest floor, so every
 * row already clears some bar; the tile needs a second, much higher one — and the
 * right number depends on how deep the instance's corpus goes. At the default
 * `BGG_CORPUS_SIZE` of 5000 the cap keeps only the best-ranked rows (the 5000th
 * game is already a widely-played one), while a corpus sized above the 17,483
 * eligible rows docs/configuration.md measured reaches down to the 100-rating
 * floor. A fixed count right for one would leave the other with an empty tile or
 * a tile of famous games.
 *
 * NOT MEASURED ON A REAL DUMP YET. No BGG ranks CSV is committed to the repo (it
 * needs a logged-in BGG session to download) and production data is off limits,
 * so the median is a chosen starting value — "the less-rated half of what this
 * instance knows" — with the same standing as the six weights. Re-measure the
 * real `usersRated` distribution before retuning it.
 *
 * It is the one CORPUS-relative quantity this file lets near a candidate pool,
 * and §7's invariance is why it may only ever touch this tile: it decides which
 * rows the hidden tile may consider, never how any row scores. The main list's
 * ranking still cannot move when the corpus grows.
 */
const HIDDEN_QUANTILE = 0.5;
// The tiles, in display order — which is also the order a candidate two tiles
// both want is resolved in.
const SPOTLIGHT_ORDER = ['different', 'complexity', 'hidden'];

// Which way the complexity tile points for a round centred at `target`. The KEY
// is what the client captions the tile with, so the direction is data, not two
// code paths.
function complexityDirection(target) {
  if (!isNum(target)) return null;
  return target < SPOTLIGHT_COMPLEXITY_PIVOT
    ? { key: 'complexityUp', shift: SPOTLIGHT_COMPLEXITY_STEP }
    : { key: 'complexityDown', shift: -SPOTLIGHT_COMPLEXITY_STEP };
}

/*
 * The `usersRated` below which a row counts as barely found — computed ONCE per
 * corpus snapshot, not per request. `lib/corpus-cache.js` hands every request
 * the same array until it reloads, so the WeakMap turns the extra walk and the
 * sort into a one-off per snapshot; a request pays it only on the first read
 * after a reload.
 *
 * Only enriched rows with a real count take part: an un-enriched row can never
 * be recommended, and a missing count is not a low one — scoring it as "hidden"
 * would promise a reader something BGG never said.
 */
const hiddenThresholds = new WeakMap();
function hiddenRatingsThreshold(entries) {
  if (!Array.isArray(entries)) return null;
  if (hiddenThresholds.has(entries)) return hiddenThresholds.get(entries);
  const counts = [];
  entries.forEach((e) => {
    if (e && e.info && isNum(e.usersRated)) counts.push(e.usersRated);
  });
  counts.sort((a, b) => a - b);
  // Two rows is the least a "below the median" can mean anything over.
  const threshold = counts.length >= 2 ? counts[Math.floor(HIDDEN_QUANTILE * (counts.length - 1))] : null;
  hiddenThresholds.set(entries, threshold);
  return threshold;
}

// The base score with the two taste terms INVERTED. A term with nothing to say
// stays neutral either way (1 - 0.5 = 0.5), so an undocumented game gains
// nothing from the inversion.
//
// A TRANSFORM OF THE BASE TERMS, NOT A PROFILE, and the reason is arithmetic: a
// derived profile cannot express 1 - value. The term is a rescaled cosine
// clamped at 0, so the literal "inverted vector" (every component negated)
// scores 0 for every candidate — a flat term, not an inverted one. Reading the
// base terms back is also free: it costs no second scoring of the candidate.
const TASTE_TERMS = new Set(['mechanics', 'categories']);
function invertedTasteScore(scored) {
  let score = scored.score;
  scored.terms.forEach((t) => {
    if (!TASTE_TERMS.has(t.term) || t.value === null) return;
    score += t.weight * ((1 - t.value) - t.value);
  });
  return score;
}

// One variant's running shortlist, kept sorted and bounded. Bounded rather than
// a single running best because a spotlight may not repeat a title the main list
// shows, and the main list is only known after the pass — so each variant keeps
// enough runners-up to fall through `limit` collisions and still have one left.
// Most candidates lose to the shortlist's last entry and cost one comparison.
const better = (a, b) => b.score - a.score || a.entry.rank - b.entry.rank;
function offer(board, size, item) {
  if (size <= 0) return;
  if (board.length >= size && better(item, board[board.length - 1]) >= 0) return;
  let i = board.length;
  while (i > 0 && better(item, board[i - 1]) < 0) i -= 1;
  board.splice(i, 0, item);
  if (board.length > size) board.pop();
}

// Could a candidate whose score is at most `ceiling` still enter this board?
// The epsilon absorbs float noise between a ceiling computed by subtraction and
// the score scoreCandidate sums term by term — a prune must never be tighter
// than the thing it skips, and ties are then settled by `offer` on BGG rank.
function mayEnter(board, size, ceiling) {
  if (size <= 0) return false;
  return board.length < size || ceiling + 1e-9 >= board[board.length - 1].score;
}

// The base terms minus the ones a tile must not claim. The reasons come from
// `reasonsFrom` as they are, under the tile's own caption — never a vocabulary
// invented per variant:
//   different   drops BOTH taste terms: it was picked for playing UNLIKE the
//               shelf, so „Ähnliche Mechaniken wie …" would state the opposite of
//               why it is there
//   complexity  drops complexity: that line compares against the round's centre,
//               which is precisely what this tile set out to leave
//   hidden      drops nothing — it is scored normally, only its pool differs
const SPOTLIGHT_DROPPED_REASONS = {
  different: TASTE_TERMS,
  complexity: new Set(['complexity']),
  hidden: new Set(),
};
function spotlightTerms(variant, scored) {
  const dropped = SPOTLIGHT_DROPPED_REASONS[variant];
  return { ...scored, terms: scored.terms.filter((t) => !dropped.has(t.term)) };
}

module.exports = {
  SPOTLIGHT_ORDER,
  SPOTLIGHT_COMPLEXITY_STEP,
  SPOTLIGHT_COMPLEXITY_PIVOT,
  HIDDEN_QUANTILE,
  complexityDirection,
  hiddenRatingsThreshold,
  invertedTasteScore,
  offer,
  mayEnter,
  spotlightTerms,
};
