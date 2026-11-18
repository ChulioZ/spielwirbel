/* Spielwirbel – the taste-vector math (#1839): affinity-weighted frequency over
   a list-valued game attribute (mechanics, categories, designers), L2
   normalisation, and the cosine rescaled against what the profile makes
   reachable at all.

   SHARED by two callers that must agree on what "similar" means: the
   recommender (lib/recommend.js, #682) and the vote card's taste hint
   (vote-hint.js). It lived inside lib/recommend.js until #1839 moved it here,
   rather than the hint growing a second copy that would drift
   (.claude/rules/shared-constants-across-the-stack.md). The comments below are
   the recommender's measurements and still hold for both callers.

   Pure and dependency-free; loaded as a shared-scope script by index.html and
   required by the route side through the module.exports guard. */

'use strict';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Affinity-weighted frequency over a list-valued corpus attribute, then L2
// -normalised so `cosine` below is a plain dot product.
function accumulate(vector, values, affinity) {
  (Array.isArray(values) ? values : []).forEach((v) => {
    if (typeof v !== 'string' || !v) return;
    vector[v] = (vector[v] || 0) + affinity;
  });
}

function normalize(vector) {
  const len = Math.sqrt(Object.values(vector).reduce((n, v) => n + v * v, 0));
  if (!len) return {};
  const out = {};
  Object.keys(vector).forEach((k) => {
    out[k] = vector[k] / len;
  });
  return out;
}

/*
 * The profile's POSITIVE components sorted high to low, as a prefix-sum table —
 * what `attainable` below reads to answer "how good could a candidate of this
 * size possibly be against this shelf?". Computed once per profile, not per
 * candidate: the sort is O(n log n) over the round's own mechanics, the lookup is
 * O(1) over 17k candidates.
 *
 * NEGATIVE COMPONENTS ARE DROPPED, and that is a correctness fix rather than
 * tidying. A retired game contributes affinity -1.0, so a mechanic only its games
 * carry ends up negative — but a candidate can always avoid it by carrying a
 * mechanic the round has never met, which scores 0. So the best a k-value
 * candidate can reach is the k largest non-negative components, and folding a
 * negative one in lowers the ceiling until everything above it clamps to 1.0.
 * Measured: with one retired game on the shelf, a candidate carrying a loved
 * mechanic PLUS one from the game they got rid of scored exactly the same 1.0 as
 * one carrying the loved mechanic plus a harmless unknown.
 */
function prefixSums(vector) {
  const sorted = Object.values(vector).filter((v) => v > 0).sort((a, b) => b - a);
  const prefix = [0];
  sorted.forEach((v, i) => prefix.push(prefix[i] + v));
  return prefix;
}

/*
 * The largest cosine a candidate carrying `k` values could reach: the k biggest
 * profile components over the same sqrt(k) the candidate's own binary vector
 * contributes. `k` may exceed the profile's component count, in which case every
 * component is attainable and the divisor still grows — a candidate listing
 * twenty mechanics is genuinely a worse match than one listing the round's four.
 *
 * PROFILE-relative, never candidate-relative, and that is the constraint the
 * whole rescale lives under: normalising against the observed candidate
 * distribution instead would make the ranking depend on which rows happen to be
 * in the corpus, breaking .claude/rules/recommendation-scoring.md §7.
 *
 * DELIBERATELY NOT DEFENSIVE about a missing `prefix`. Guarding it would fall
 * back to the unscaled cosine — i.e. silently restore the very bug this function
 * exists to fix, in the one file where every mistake is a plausible wrong list
 * rather than an error. `buildProfile` is the only way a profile is made and it
 * always sets both ceilings (they are never cached or persisted), so an absent
 * one is a programming error and should throw on the first candidate.
 */
function attainable(prefix, k) {
  const sum = prefix[Math.min(k, prefix.length - 1)];
  return sum > 0 ? sum / Math.sqrt(k) : 0;
}

/*
 * Cosine similarity between the profile vector and a candidate's (binary) one,
 * rescaled against what this profile makes reachable at all.
 *
 * WITHOUT the rescale the term cannot pass its own naming threshold (#772): raw
 * cosine compares an L2-normalised profile spread over dozens of mechanics
 * against a candidate's handful, so it only approaches 1.0 if the round's entire
 * taste IS those few mechanics — which no real shelf is. Measured: a candidate
 * whose every mechanic was a round favourite scored 0.536 against a 0.5
 * threshold, while complexity, players and time all saturated at 0.98–1.0. So
 * the two taste terms delivered roughly half their nominal weight, and neither
 * could ever be named as a reason.
 *
 * Clamped at 0: the profile may hold negative components from a retired game, and
 * a negative similarity would quietly turn this term into a second penalty with
 * a weight that was never chosen for one. A profile with no positive component
 * at all has no ceiling to divide by, so it falls back to the unscaled value —
 * which is 0 there anyway, since every component it could match is negative.
 */
function cosine(profileVector, values, prefix) {
  const list = (Array.isArray(values) ? values : []).filter((v) => typeof v === 'string' && v);
  if (!list.length) return null;
  const len = Math.sqrt(list.length);
  let dot = 0;
  list.forEach((v) => {
    dot += profileVector[v] || 0;
  });
  const ceiling = attainable(prefix, list.length);
  return clamp01(ceiling > 0 ? dot / len / ceiling : dot / len);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { clamp01, accumulate, normalize, prefixSums, attainable, cosine };
}
