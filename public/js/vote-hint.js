/* Spielwirbel – the vote card's taste hint (#1839): „Könnte dir gefallen – wie
   Azul und Patchwork", on a game the voter has never rated or played, when its
   mechanics, categories and designers look like the games THEY like.

   A PURE derivation over the round object, computed on demand like every other
   rating statistic — nothing is stored, nothing leaves the device.

   THE PROFILE is the voter's own per-game AVERAGE rating (`tasteAverages`,
   taste-neighbour.js — per game, not per vote, for the reason given there),
   nameable games only. Each rated game pulls the profile by `avg - NEUTRAL`: a
   loved game towards its mechanics, a disliked one away from them, a neutral
   one not at all. When post-session verdicts (#1838) land they are more rows in
   `tasteAverages`, so this file needs no change to hear them.

   THE MATCH is the recommender's own cosine (taste-vector.js, shared with
   lib/recommend.js so the two cannot disagree about "similar"), per attribute,
   weighted by TASTE_HINT_WEIGHTS over the attributes the candidate actually carries.
   Only mechanics, categories and designers: BGG quality, table size and length
   describe the GAME, not what this person likes.

   WHEN IT SAYS NOTHING — and it says nothing far more often than not:
   - the voter is not a round member (a guest has no history here);
   - the game has no mechanics and no categories;
   - the voter has rated or played the game (they can judge it themselves);
   - the voter has rated fewer than TASTE_HINT_MIN_RATED games with metadata, or none
     of them above the neutral face;
   - the match is below TASTE_HINT_MIN_MATCH, or no liked game shares a single value
     with it (a hint that cannot name its reason is not shown).
   There is no negative hint at all: the line exists to help with a game the
   voter cannot judge, never to talk them out of one.

   WORDS ONLY on the card: the match orders and gates, it is never printed
   (#1530, the voting stance). The names are the round's own game titles.

   `deps` is injected with a global fallback (`voteHintDeps`), the
   tasteNeighbours shape, so the function also runs under Node, where a
   public/js file cannot require its siblings. Dependency-free otherwise. */

'use strict';

// The neutral face: a game rated exactly here neither pulls nor pushes.
const TASTE_HINT_NEUTRAL = 3;
// Games the voter must have rated (with metadata) before any hint appears —
// the taste-neighbour floor, for the same reason: below it one lucky rating
// would speak for a whole taste.
const TASTE_HINT_MIN_RATED = 5;
// The weighted match a game must reach. Rescaled cosine, so 1 is "every value
// it carries is among this voter's strongest", 0 "shares nothing they like".
const TASTE_HINT_MIN_MATCH = 0.5;
// How much each attribute speaks for a taste. Mechanics say most about how a
// game plays; a designer is a strong but rare signal.
const TASTE_HINT_WEIGHTS = { mechanics: 0.5, categories: 0.3, designers: 0.2 };
// Liked games the line may name.
const TASTE_HINT_NAMES = 2;

const TASTE_HINT_KEYS = Object.keys(TASTE_HINT_WEIGHTS);

// The siblings this file reads, resolved at CALL time (they load earlier, but a
// load-time read would still bind the hint to the load order).
const voteHintDeps = () => ({
  tasteAverages, isNameableGame, creditedDesigners, accumulate, normalize, prefixSums, cosine,
});

function hintValues(game, key, credited) {
  const raw = key === 'designers' ? credited(game.designers) : game[key];
  return (Array.isArray(raw) ? raw : []).filter((v) => typeof v === 'string' && v);
}

function hasTasteMetadata(game) {
  return ['mechanics', 'categories'].some((k) => Array.isArray(game[k]) && game[k].some((v) => typeof v === 'string' && v));
}

/* Whether the voter already knows the game: a rating in any session, or a seat
   at an evening where it was the game played. */
function voterKnowsGame(round, mid, gid) {
  return (round.sessions || []).some((s) => {
    if (s.votes && s.votes[mid] && s.votes[mid][gid]) return true;
    return !s.cancelled && s.chosenGameId === gid && (s.memberIds || []).includes(mid);
  });
}

/* The voter's taste profile, or null below the evidence floor. */
function voterTasteProfile(round, mid, deps) {
  const d = deps || voteHintDeps();
  const avg = d.tasteAverages(round, mid, d.isNameableGame);
  const rated = round.games.filter((g) => g.id in avg && hasTasteMetadata(g));
  if (rated.length < TASTE_HINT_MIN_RATED) return null;
  // No `if (!liked.length) return null` here, deliberately: with nothing above
  // the neutral face the profile has no positive component, so every match is 0
  // and the threshold already says nothing. A second guard for the same case
  // made each untestable (.claude/rules/redundant-guards-make-each-other-untestable.md;
  // measured, removing it left the spec green).
  const liked = rated.filter((g) => avg[g.id] > TASTE_HINT_NEUTRAL);
  const vectors = {};
  TASTE_HINT_KEYS.forEach((key) => {
    const raw = {};
    rated.forEach((g) => d.accumulate(raw, hintValues(g, key, d.creditedDesigners), avg[g.id] - TASTE_HINT_NEUTRAL));
    const vec = d.normalize(raw);
    vectors[key] = { vec, prefix: d.prefixSums(vec) };
  });
  return { avg, liked, vectors };
}

/* The weighted match of `game` against a profile, over the attributes the game
   carries (renormalised over those, so a game BGG lists no designer for is not
   marked down for it), or null when it carries none of them. */
function tasteMatch(profile, game, d) {
  let sum = 0;
  let weight = 0;
  TASTE_HINT_KEYS.forEach((key) => {
    const values = hintValues(game, key, d.creditedDesigners);
    if (!values.length) return;
    const { vec, prefix } = profile.vectors[key];
    sum += TASTE_HINT_WEIGHTS[key] * d.cosine(vec, values, prefix);
    weight += TASTE_HINT_WEIGHTS[key];
  });
  return weight ? sum / weight : null;
}

/* The liked games that share the most with `game`: weighted shared values,
   then the higher average, then the round's own order. */
function hintNamedGames(profile, game, credited) {
  const own = {};
  TASTE_HINT_KEYS.forEach((key) => { own[key] = new Set(hintValues(game, key, credited)); });
  return profile.liked
    .map((g, i) => ({
      g,
      i,
      overlap: TASTE_HINT_KEYS.reduce((n, key) =>
        n + TASTE_HINT_WEIGHTS[key] * hintValues(g, key, credited).filter((v) => own[key].has(v)).length, 0),
    }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || profile.avg[b.g.id] - profile.avg[a.g.id] || a.i - b.i)
    .slice(0, TASTE_HINT_NAMES)
    .map((x) => x.g);
}

/* The liked games to name for `game`, or null when no hint applies. */
function voteTasteHint(round, mid, game, deps) {
  const d = deps || voteHintDeps();
  if (!round || !game || !mid || !(round.members || []).some((m) => m.id === mid)) return null;
  if (!hasTasteMetadata(game) || voterKnowsGame(round, mid, game.id)) return null;
  const profile = voterTasteProfile(round, mid, d);
  if (!profile) return null;
  const match = tasteMatch(profile, game, d);
  if (match === null || match < TASTE_HINT_MIN_MATCH) return null;
  const named = hintNamedGames(profile, game, d.creditedDesigners);
  return named.length ? named : null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TASTE_HINT_NEUTRAL, TASTE_HINT_MIN_RATED, TASTE_HINT_MIN_MATCH, TASTE_HINT_WEIGHTS, TASTE_HINT_NAMES,
    hasTasteMetadata, voterKnowsGame, voterTasteProfile, tasteMatch, voteTasteHint,
  };
}
