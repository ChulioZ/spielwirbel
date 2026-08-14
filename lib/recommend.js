'use strict';

/*
 * "Das könnte euch auch gefallen" (issue #682) — games the round does NOT own,
 * scored from the licensed BGG corpus (#681) against a taste profile built from
 * the round's own Regal and its own session data.
 *
 * DETERMINISTIC ARITHMETIC, NO MODEL. Every weight below is a constant a human
 * set, and every recommendation is a real corpus row with a real BGG id — so it
 * cannot hallucinate a game, and it can show its work. That is not only a
 * product choice: BGG's XML API terms forbid using the data to train an AI or
 * LLM system, which rules out the embedding / collaborative-filtering approach
 * every open-source BGG recommender takes. Weighted arithmetic over stored
 * attributes is not training and is unaffected.
 *
 * PURE, and exported function by function, the shape lib/draw.js took: the
 * profile and the score are testable without HTTP, which matters here because a
 * term wired to the wrong field shifts a ranking nobody can eyeball rather than
 * throwing (.claude/rules/break-the-code-on-purpose.md).
 *
 * NO NEW LEGAL SURFACE, checked in both directions
 * (.claude/rules/keep-legal-docs-current.md): everything is computed
 * server-side from the round's own data plus public game metadata already
 * stored. No new processor, no new personal-data category, no on-device
 * storage, no outbound call of any kind.
 */

// `sessionPeople` for the per-game ratings and `sessionPartyCount` for the
// round's real table sizes — the frontend module both the vote screens and the
// draw already resolve people through, required out of public/js/ on purpose
// (.claude/rules/shared-constants-across-the-stack.md). Re-deriving either here
// would drop guests and flatten teams (.claude/rules/session-teams.md §2).
const { sessionPeople, sessionPartyCount } = require('../public/js/session-people');

/* ------------------------------- the weights ------------------------------- */
/*
 * Fractions of the final score. These are approved STARTING values, not a
 * finished tuning — adjusting a number is expected, changing the SET of terms is
 * a scope change. The reasoning per term is on the constant, because a weight
 * with no argument next to it is a guess with a decimal point on it.
 */

// BGG's BAYES average, never the raw one: the raw mean lets twelve people rating
// a game 10 outrank a classic, and the corpus stores both.
const W_QUALITY = 0.35;
// Distance from the group's own complexity centre, symmetric on purpose — too
// heavy and too light are both wrong.
const W_COMPLEXITY = 0.2;
// How much of the round's real party-size distribution BGG's own poll says the
// game plays well at. Not the box's min/max, which routinely lies.
const W_PLAYERS = 0.16;
// Cosine similarity to the group's mechanic vector — the strongest taste signal
// after complexity, and the one people cannot articulate themselves.
const W_MECHANICS = 0.13;
// The same over categories: what players name out loud, and the weakest
// predictor of whether they will actually enjoy a game.
const W_CATEGORIES = 0.07;
// Evening length. Low because it is the easiest thing for a group to work
// around, and because the corpus's playtime bounds are noisy.
const W_TIME = 0.06;
// SUBTRACTED from a candidate that is really something the round already owns in
// different clothes — a reimplementation, or the same designer plus most of the
// same mechanics. Don't recommend Catan to people who own Catan.
const W_NOVELTY_PENALTY = -0.03;

// Complexity within this much of the target still scores 1.0 at the centre and
// decays linearly to 0 at the edge. ~1.2 of BGG's 1–5 scale is about "one step".
const WEIGHT_TOLERANCE = 1.2;
// Same shape for playing time, in minutes.
const TIME_TOLERANCE = 60;

// The band BGG's bayesaverage actually occupies: ~5.5 at the bottom of the
// ranked list, ~8.5 at the very top. Normalising over 0–10 instead would squash
// every candidate into a third of the range and make the heaviest term nearly
// constant.
const QUALITY_MIN = 5.5;
const QUALITY_MAX = 8.5;

// What an unknown value scores. Not 0: a corpus row missing a playtime has said
// nothing about its evening length, and scoring that as "maximally wrong" would
// systematically bury every thinly-documented game. Same reasoning as the
// absent-value rule in .claude/rules/provider-metadata-is-a-filter-not-a-tag.md
// §2, one layer up — there it means "passes the filter", here "makes no claim".
const NEUTRAL = 0.5;

// Below this many BGG-linked games that the corpus actually knows, the profile
// is too thin to be honest and the screen says so instead of guessing. This is
// the direct answer to #264's "thin rating data" verdict — a thin profile
// produces confident nonsense.
const MIN_PROFILE_GAMES = 8;

// How many recommendations one request answers. A list nobody scrolls to the end
// of is the same as a shorter list, and every entry costs the reader a decision.
const DEFAULT_LIMIT = 24;

// How many owned games a "similar mechanics to X and Y" reason may name.
const REASON_GAMES = 2;

// A candidate is only novel-penalised on the designer path if it shares at least
// this share of its mechanics with the owned game. Below it, two games by the
// same designer are just two games by the same designer.
const NOVELTY_MECHANIC_SHARE = 0.6;

/* ------------------------------- the profile ------------------------------- */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// One decimal is what the reason line and the card can honestly state: BGG's
// weight and bayes average are noisy in the second.
const round1 = (v) => (isNum(v) ? Math.round(v * 10) / 10 : null);

// A game's BGG id, or null. `source.provider` is checked because a round may
// link games to more than one provider over its life, and a Steam id joined
// against a BGG corpus would match an unrelated game.
function bggIdOf(game) {
  const s = game && game.source;
  return s && s.provider === 'bgg' && s.externalId ? String(s.externalId) : null;
}

// The group's own verdict on one of its games, on the 1–5 rating scale, or null
// when nobody has rated it. Computed on demand from the sessions, exactly like
// `gameStats` in core.js — sessions are the single source of truth, so a deleted
// session stops influencing the profile with no bookkeeping anywhere.
function ownRating(round, gameId) {
  const ratings = [];
  (round.sessions || []).forEach((s) => {
    if (!(s.gameIds || []).includes(gameId)) return;
    sessionPeople(round, s).forEach((p) => {
      const v = ((s.votes || {})[p.id] || {})[gameId];
      if (v && isNum(v.rating)) ratings.push(v.rating);
    });
  });
  if (!ratings.length) return null;
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
}

/*
 * How much one owned game should shape the profile.
 *
 * The STATE is read before the ratings, and that ordering is the decision worth
 * stating: a retired game usually carries plenty of votes, and letting those
 * votes speak would make "we threw this out" read as an ordinary opinion. A
 * wished game has no votes at all — it is a want, which is a stronger signal
 * than a game merely sitting on the shelf unplayed.
 *
 *   retired   -0.5   an explicit negative: they got rid of it
 *   wished     1.5   an explicit want with no play data
 *   rated       0..2 (avg-1)/2 — 0.0 at 1, 1.0 at 3, 2.0 at 5
 *   otherwise   1.0  owned, no votes yet — neutral
 *
 * A completed game is deliberately NOT a state here: it was played through, the
 * opinions stand, and it keeps counting like any other rated game — the same
 * distinction .claude/rules/active-games-filter-sites.md draws for taste stats.
 */
function gameAffinity(round, game) {
  if (game.retired) return -0.5;
  if (game.wish) return 1.5;
  const avg = ownRating(round, game.id);
  if (avg === null) return 1;
  return (avg - 1) / 2;
}

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

// Cosine similarity between the profile vector and a candidate's (binary) one.
// Clamped at 0: the profile may hold negative components from a retired game, and
// a negative similarity would quietly turn this term into a second penalty with
// a weight that was never chosen for one.
function cosine(profileVector, values) {
  const list = (Array.isArray(values) ? values : []).filter((v) => typeof v === 'string' && v);
  if (!list.length) return null;
  const len = Math.sqrt(list.length);
  let dot = 0;
  list.forEach((v) => {
    dot += profileVector[v] || 0;
  });
  return clamp01(dot / len);
}

function weightedMean(pairs) {
  let sum = 0;
  let total = 0;
  pairs.forEach(([value, weight]) => {
    if (!isNum(value) || weight <= 0) return;
    sum += value * weight;
    total += weight;
  });
  return total > 0 ? sum / total : null;
}

/*
 * The round's taste profile.
 *
 * `corpusById` joins each owned game to its corpus row, and the row is what the
 * attributes come from rather than the game's own imported metadata (#724): the
 * candidates are scored against corpus values, so building the target out of a
 * different source would compare two subtly different measurements of the same
 * thing. The game's stored values are the fallback for a shelf game the corpus
 * does not carry.
 */
function buildProfile(round, corpusById) {
  const games = round.games || [];
  const linked = [];
  // EVERY state counts as "already known", including retired: a game they threw
  // out is the last thing to recommend back to them.
  const ownedIds = new Set();
  games.forEach((g) => {
    const id = bggIdOf(g);
    if (!id) return;
    ownedIds.add(id);
    linked.push({ game: g, externalId: id, entry: corpusById.get(id) || null });
  });

  const profiled = linked.filter((x) => x.entry && x.entry.info);
  const mechanics = {};
  const categories = {};
  const weightPairs = [];
  const timePairs = [];
  // What the novelty penalty compares against — collected from the same join so
  // it costs no second pass.
  const implementations = new Set();
  const ownedNames = new Set();
  const designers = new Map();

  profiled.forEach((x) => {
    const info = x.entry.info;
    // BGG's own name for the owned game, never the round's title for it: an
    // implementation link points at the former, and a renamed shelf entry
    // ("Catan (Julians Kiste)") would silently stop matching.
    if (x.entry.name) ownedNames.add(x.entry.name);
    const affinity = gameAffinity(round, x.game);
    accumulate(mechanics, info.mechanics, affinity);
    accumulate(categories, info.categories, affinity);
    // Only positive-affinity games set the targets. A retired game pulling the
    // group's complexity centre toward itself would aim the whole list at what
    // they got rid of.
    const w = Math.max(0, affinity);
    weightPairs.push([info.weight, w]);
    timePairs.push([info.maxPlaytime, w]);
    (Array.isArray(info.implementations) ? info.implementations : []).forEach((v) => implementations.add(v));
    (Array.isArray(info.designers) ? info.designers : []).forEach((d) => {
      if (!designers.has(d)) designers.set(d, []);
      designers.get(d).push(x);
    });
  });

  return {
    ownedIds,
    ownedNames,
    linkedGames: linked.length,
    profileGames: profiled.length,
    games: profiled,
    mechanics: normalize(mechanics),
    categories: normalize(categories),
    targetWeight: weightedMean(weightPairs),
    targetTime: weightedMean(timePairs),
    parties: partyDistribution(round),
    implementations,
    designers,
  };
}

/*
 * How often the round actually sits down at n parties, as shares summing to 1.
 *
 * PARTIES, not bodies: six people in three pairs are looking for a three-player
 * game, which is often exactly why they teamed up. Falls back to the round's
 * member count for a round that has never played — the honest guess, and the one
 * the seat picker would default to.
 */
function partyDistribution(round) {
  const counts = new Map();
  (round.sessions || []).forEach((s) => {
    if (s.cancelled) return;
    const n = sessionPartyCount(round, s);
    if (!Number.isInteger(n) || n < 1) return;
    counts.set(n, (counts.get(n) || 0) + 1);
  });
  if (!counts.size) {
    const n = (round.members || []).length;
    return n >= 1 ? [{ players: n, share: 1 }] : [];
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return [...counts.entries()]
    .map(([players, n]) => ({ players, share: n / total }))
    .sort((a, b) => b.share - a.share || a.players - b.players);
}

/* -------------------------------- the score -------------------------------- */

// Symmetric linear decay: 1.0 at the target, 0 at `tolerance` away, on both
// sides. Neutral when either side is unknown.
function proximity(value, target, tolerance) {
  if (!isNum(value) || !isNum(target)) return null;
  return clamp01(1 - Math.abs(value - target) / tolerance);
}

// The share of the round's real party sizes the candidate's own poll calls Best
// (1.0) or merely Recommended (0.6). A game the poll has nothing to say about
// scores neutral rather than 0 — an unanswered poll is not a verdict.
function playerFit(info, parties) {
  const best = new Set(Array.isArray(info.bestWith) ? info.bestWith : []);
  const rec = new Set(Array.isArray(info.recommendedWith) ? info.recommendedWith : []);
  if (!best.size && !rec.size) return { value: null, players: null };
  let value = 0;
  let top = null;
  parties.forEach((p) => {
    const hit = best.has(p.players) ? 1 : rec.has(p.players) ? 0.6 : 0;
    value += hit * p.share;
    if (hit > 0 && top === null) top = p.players;
  });
  return { value: clamp01(value), players: top };
}

// Whether the candidate is really something the round already has. Two shapes,
// both of which produce a list that looks varied and is not: BGG's own
// reimplementation links, and same-designer-plus-most-of-the-same-mechanics for
// the cases BGG has not linked.
function noveltyPenalty(profile, entry) {
  const info = entry.info;
  const name = entry.name;
  const impl = Array.isArray(info.implementations) ? info.implementations : [];
  // BOTH directions of the link, and they read different sets — a
  // `boardgameimplementation` link is stored as the names it points at, so the
  // owned row naming this candidate and this candidate naming an owned game are
  // two separate lookups. BGG usually records the link on both items, but not
  // always; checking only one side leaves the older-edition case (the group owns
  // the classic, the candidate is the reprint) unpenalised.
  if (
    impl.some((x) => profile.implementations.has(x) || profile.ownedNames.has(x)) ||
    profile.implementations.has(name)
  ) {
    return 1;
  }

  const mine = (Array.isArray(info.mechanics) ? info.mechanics : []).filter(Boolean);
  if (!mine.length) return 0;
  const designers = Array.isArray(info.designers) ? info.designers : [];
  return designers.some((d) => {
    const owned = profile.designers.get(d) || [];
    return owned.some((x) => {
      const theirs = new Set((x.entry.info.mechanics || []).filter(Boolean));
      if (!theirs.size) return false;
      const shared = mine.filter((m) => theirs.has(m)).length;
      return shared / mine.length >= NOVELTY_MECHANIC_SHARE;
    });
  })
    ? 1
    : 0;
}

// The owned games that contributed most to a list-valued term — what the reason
// line names ("similar mechanics to Ark Nova and Wingspan"). Derived from the
// same attribute the term scored, so the sentence can never name a game that had
// nothing to do with the placement.
function topContributors(profile, key, values) {
  const wanted = new Set((Array.isArray(values) ? values : []).filter(Boolean));
  if (!wanted.size) return [];
  return profile.games
    .map((x) => ({
      title: x.game.title,
      shared: ((x.entry.info[key] || []).filter((v) => wanted.has(v))).length,
    }))
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, REASON_GAMES)
    .map((x) => x.title);
}

/*
 * Score ONE corpus row against the profile. Returns the score plus every term's
 * value and contribution, which is what the reason line is derived from — a
 * ranked list with no reasons is indistinguishable from #264's hallucinated one
 * from the user's side.
 */
function scoreCandidate(profile, entry) {
  const info = entry.info || {};
  const quality = isNum(entry.bayesRating)
    ? clamp01((entry.bayesRating - QUALITY_MIN) / (QUALITY_MAX - QUALITY_MIN))
    : null;
  const complexity = proximity(info.weight, profile.targetWeight, WEIGHT_TOLERANCE);
  const players = playerFit(info, profile.parties);
  const time = proximity(info.maxPlaytime, profile.targetTime, TIME_TOLERANCE);
  const mechanics = cosine(profile.mechanics, info.mechanics);
  const categories = cosine(profile.categories, info.categories);

  const terms = [
    { term: 'quality', weight: W_QUALITY, value: quality, rating: entry.bayesRating },
    { term: 'complexity', weight: W_COMPLEXITY, value: complexity, weightValue: info.weight },
    { term: 'players', weight: W_PLAYERS, value: players.value, players: players.players },
    { term: 'mechanics', weight: W_MECHANICS, value: mechanics },
    { term: 'categories', weight: W_CATEGORIES, value: categories },
    { term: 'time', weight: W_TIME, value: time, minutes: info.maxPlaytime },
  ];

  let score = 0;
  terms.forEach((t) => {
    // A term with nothing to say contributes its neutral share, so a
    // thinly-documented game is ranked below a well-matched one without being
    // pushed under every badly-matched one.
    t.contribution = t.weight * (t.value === null ? NEUTRAL : t.value);
    score += t.contribution;
  });
  const novelty = noveltyPenalty(profile, entry);
  score += W_NOVELTY_PENALTY * novelty;

  return { score, terms, novelty };
}

// The two terms that actually earned the placement, phrased as data the client
// turns into a sentence. Only terms that BEAT their neutral share qualify — a
// term scoring below neutral did not contribute, and naming it would be an
// invented compliment.
function reasonsFrom(profile, entry, scored) {
  return scored.terms
    .filter((t) => t.value !== null && t.value > NEUTRAL)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2)
    .map((t) => {
      if (t.term === 'quality') return { term: 'quality', rating: round1(t.rating) };
      if (t.term === 'complexity') return { term: 'complexity', weight: round1(t.weightValue) };
      if (t.term === 'players') return { term: 'players', players: t.players };
      if (t.term === 'time') return { term: 'time', minutes: t.minutes };
      return { term: t.term, games: topContributors(profile, t.term, (entry.info || {})[t.term]) };
    })
    // A mechanics/categories reason whose contributors have all left the shelf
    // would render as an empty sentence; drop it rather than phrase it.
    .filter((r) => !('games' in r) || r.games.length > 0);
}

/*
 * The recommendations for one round.
 *
 * HARD FILTERS FIRST, before any scoring: a candidate already in the round in
 * ANY state (owned, wished, completed or retired — retired is the sharpest,
 * they explicitly got rid of it) and any row the enrichment pass has not reached
 * are dropped outright. An un-enriched row carries no attributes at all, so it
 * could be neither scored nor explained; the corpus filters expansions and
 * thinly-rated rows at ingest, so those never arrive here.
 */
function recommend(round, corpus, { limit = DEFAULT_LIMIT } = {}) {
  const entries = Array.isArray(corpus) ? corpus : [];
  const corpusById = new Map(entries.map((e) => [String(e.externalId), e]));
  const profile = buildProfile(round, corpusById);
  // `topContributors` needs the round to weigh a contributor; keeping it on the
  // profile avoids threading it through four call sites.
  profile.round = round;

  const result = {
    profileGames: profile.profileGames,
    linkedGames: profile.linkedGames,
    minProfileGames: MIN_PROFILE_GAMES,
    corpusRows: entries.length,
    parties: profile.parties,
    recommendations: [],
  };
  if (profile.profileGames < MIN_PROFILE_GAMES) return result;

  const scored = [];
  entries.forEach((entry) => {
    if (!entry.info) return;
    if (profile.ownedIds.has(String(entry.externalId))) return;
    const s = scoreCandidate(profile, entry);
    scored.push({ entry, scored: s });
  });
  scored.sort((a, b) => b.scored.score - a.scored.score || a.entry.rank - b.entry.rank);

  result.recommendations = scored.slice(0, Math.max(0, limit)).map(({ entry, scored: s }) => ({
    externalId: String(entry.externalId),
    title: entry.name,
    year: entry.year ?? null,
    rank: entry.rank,
    rating: round1(entry.bayesRating),
    weight: round1((entry.info || {}).weight),
    minPlayers: (entry.info || {}).minPlayers ?? null,
    maxPlayers: (entry.info || {}).maxPlayers ?? null,
    minPlaytime: (entry.info || {}).minPlaytime ?? null,
    maxPlaytime: (entry.info || {}).maxPlaytime ?? null,
    score: Math.round(s.score * 1000) / 1000,
    reasons: reasonsFrom(profile, entry, s),
  }));
  return result;
}

module.exports = {
  recommend,
  buildProfile,
  scoreCandidate,
  gameAffinity,
  partyDistribution,
  MIN_PROFILE_GAMES,
  DEFAULT_LIMIT,
  NEUTRAL,
  W_QUALITY,
  W_COMPLEXITY,
  W_PLAYERS,
  W_MECHANICS,
  W_CATEGORIES,
  W_TIME,
  W_NOVELTY_PENALTY,
};
