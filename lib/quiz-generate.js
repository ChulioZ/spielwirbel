'use strict';

/*
 * The weekly quiz's generator (#743) — a PURE function from corpus rows (#681)
 * and a week key to that week's questions. No I/O: lib/quiz.js reads the corpus,
 * stores the result and serves it; this file only decides what is asked.
 *
 * DETERMINISTIC under a PRNG seeded on the week key, so two overlapping
 * processes (every Railway deploy overlaps two, .claude/rules/deploy-invariants-are-pinned-in-code.md)
 * compute the same round from the same corpus. The store stays the source of
 * truth regardless: the write is idempotent on the week key.
 *
 * THE LICENCE SHAPES THE CHOICES. BGG's data may not be modified (#117, #681),
 * so a category, mechanic or designer choice is the stored value VERBATIM — in
 * English, in every UI language. That is not a missing i18n key: a translated
 * `boardgamecategory` would be a modified BGG value. Only the question sentence
 * is ours (an i18n template the client fills with the game's name).
 *
 * THE FAIRNESS CONDITION, per type: exactly one choice is true, read off the
 * row. Every distractor is chosen so it CANNOT be true — a band the value is
 * not in, a range that is not the box's, a category the game does not carry —
 * rather than merely "probably different". test/quiz-generate.test.js checks it
 * over every question of forty generated weeks.
 */

const { WEIGHT_CHOICES, PLAYTIME_CHOICES } = require('../public/js/draw-pool');
const { creditedDesigners } = require('../public/js/provider-info-fields');

const TYPES = ['weight', 'players', 'playtime', 'year', 'category', 'mechanic', 'designer', 'duel'];

// A round needs at least this many questions to exist at all; below it the
// corpus is too thin to make a week worth opening (and "not a zero-question
// round" is the acceptance criterion this enforces).
const MIN_ROUND = 3;
// A weight is only believable once enough people have weighted the game.
const MIN_WEIGHT_VOTES = 30;
// Within this much of a band edge, BGG's own two-decimal display can round a
// weight onto the neighbouring band (2.996 shows as 3.00) — not a fair question.
const WEIGHT_EDGE_MARGIN = 0.05;
// The ranking duel's four games must be at least this many places apart, so the
// answer does not hinge on a re-rank between dumps.
const DUEL_GAP = 10;
// Year distractors: never the neighbouring year, which is a coin toss.
const YEAR_OFFSETS = [-7, -5, -3, -2, 2, 3, 5, 7];
// Box ranges past this are party games printed "2–99"; nothing to ask about.
const MAX_BOX_PLAYERS = 12;

/* ------------------------------ seeded random ------------------------------ */

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// mulberry32: small, fast and identical on every Node version.
function seeded(seed) {
  let a = hash(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(next() * list.length)];
  const shuffle = (list) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return { pick, shuffle };
}

/* ---------------------------------- bands ---------------------------------- */

// Whole steps of the Regal filter's weight ladder (public/js/draw-pool.js), so
// the quiz names the same bands the filter and the draw preview already use.
const WEIGHT_EDGES = WEIGHT_CHOICES.filter((v) => Number.isInteger(v));
const WEIGHT_BANDS = WEIGHT_EDGES.slice(0, -1).map((min, i) => ({ min, max: WEIGHT_EDGES[i + 1] }));

function weightBand(weight) {
  if (typeof weight !== 'number' || !Number.isFinite(weight)) return null;
  const top = WEIGHT_EDGES[WEIGHT_EDGES.length - 1];
  if (weight < WEIGHT_EDGES[0] || weight > top) return null;
  if (WEIGHT_EDGES.slice(1, -1).some((edge) => Math.abs(weight - edge) < WEIGHT_EDGE_MARGIN)) return null;
  const band = weight === top
    ? WEIGHT_BANDS[WEIGHT_BANDS.length - 1]
    : WEIGHT_BANDS.find((b) => weight >= b.min && weight < b.max);
  return { ...band };
}

// The playtime ladder's steps as closed integer bands: „bis 30", „31–45", …,
// „über 180". A box time is a whole number of minutes, so the bands tile it.
const PLAYTIME_BANDS = [
  { min: null, max: PLAYTIME_CHOICES[0] },
  ...PLAYTIME_CHOICES.slice(1).map((max, i) => ({ min: PLAYTIME_CHOICES[i] + 1, max })),
  { min: PLAYTIME_CHOICES[PLAYTIME_CHOICES.length - 1] + 1, max: null },
];

function playtimeBand(minutes) {
  if (!Number.isInteger(minutes) || minutes <= 0) return null;
  const band = PLAYTIME_BANDS.find((b) => (b.min == null || minutes >= b.min) && (b.max == null || minutes <= b.max));
  return { ...band };
}

/* --------------------------------- builders -------------------------------- */

const strings = (list) => (Array.isArray(list) ? list.filter((v) => typeof v === 'string' && v.trim()) : []);
const subjectOf = (row) => ({
  externalId: row.externalId,
  name: row.name,
  imageUrl: (row.info && typeof row.info.imageUrl === 'string') ? row.info.imageUrl : null,
});

// A question whose choices are already in display order (an ordered scale);
// the answer is wherever the truth sits.
const ordered = (type, row, choices, truthIndex) => ({ type, subject: subjectOf(row), choices, answer: truthIndex });

// A question whose choices have no natural order: shuffled, answer tracked.
function shuffled(type, row, truth, distractors, rnd) {
  const choices = rnd.shuffle([truth, ...distractors]);
  return { type, subject: subjectOf(row), choices, answer: choices.indexOf(truth) };
}

// Which rows a type can ask about, and how to build the question for one.
const BUILDERS = {
  weight: {
    eligible: (r) => !!r.info && (r.info.numWeights || 0) >= MIN_WEIGHT_VOTES && !!weightBand(r.info.weight),
    build: (r) => {
      const band = weightBand(r.info.weight);
      return ordered('weight', r, WEIGHT_BANDS.map((b) => ({ ...b })), WEIGHT_BANDS.findIndex((b) => b.min === band.min));
    },
  },
  playtime: {
    eligible: (r) => !!r.info && !!playtimeBand(r.info.maxPlaytime),
    build: (r, rnd) => {
      const truth = PLAYTIME_BANDS.findIndex((b) => b.min === playtimeBand(r.info.maxPlaytime).min);
      const starts = [];
      for (let s = Math.max(0, truth - 3); s <= Math.min(truth, PLAYTIME_BANDS.length - 4); s += 1) starts.push(s);
      const start = rnd.pick(starts);
      return ordered('playtime', r, PLAYTIME_BANDS.slice(start, start + 4).map((b) => ({ ...b })), truth - start);
    },
  },
  players: {
    eligible: (r) => !!r.info && Number.isInteger(r.info.minPlayers) && Number.isInteger(r.info.maxPlayers)
      && r.info.minPlayers >= 1 && r.info.maxPlayers >= r.info.minPlayers && r.info.maxPlayers <= MAX_BOX_PLAYERS,
    build: (r, rnd) => {
      const { minPlayers: min, maxPlayers: max } = r.info;
      const near = [];
      for (let a = min - 1; a <= min + 1; a += 1) {
        for (let b = max - 2; b <= max + 2; b += 1) {
          if (a >= 1 && b >= a && b <= MAX_BOX_PLAYERS && !(a === min && b === max)) near.push({ min: a, max: b });
        }
      }
      if (near.length < 3) return null;
      const choices = [{ min, max }, ...rnd.shuffle(near).slice(0, 3)]
        .sort((x, y) => x.min - y.min || x.max - y.max);
      return ordered('players', r, choices, choices.findIndex((c) => c.min === min && c.max === max));
    },
  },
  year: {
    eligible: (r) => Number.isInteger(r.year) && r.year >= 1900,
    build: (r, rnd, ctx) => {
      const near = YEAR_OFFSETS.map((o) => r.year + o).filter((y) => y <= ctx.currentYear);
      if (near.length < 3) return null;
      const choices = [r.year, ...rnd.shuffle(near).slice(0, 3)].sort((a, b) => a - b);
      return ordered('year', r, choices, choices.indexOf(r.year));
    },
  },
  category: listBuilder('category', (r) => strings(r.info && r.info.categories)),
  mechanic: listBuilder('mechanic', (r) => strings(r.info && r.info.mechanics)),
  // BGG's „(Uncredited)" sentinel is stored on the row and dropped here, so it is
  // never asked about and never offered as a name.
  designer: listBuilder('designer', (r) => creditedDesigners(strings(r.info && r.info.designers))),
};

// „Which X does this game have?": one value the game carries, three from the
// pool-wide set that it does NOT carry — non-membership is the whole condition.
function listBuilder(type, valuesOf) {
  return {
    eligible: (r) => valuesOf(r).length > 0,
    build: (r, rnd, ctx) => {
      const own = new Set(valuesOf(r));
      const others = [...ctx.valueSet(type, valuesOf)].filter((v) => !own.has(v));
      if (others.length < 3) return null;
      return shuffled(type, r, rnd.pick([...own]), rnd.shuffle(others).slice(0, 3), rnd);
    },
  };
}

// The ranking duel: four games, ranks clearly apart, best-ranked is right. It
// has no single subject — each choice is a game.
function buildDuel(ctx, rnd) {
  const taken = [];
  for (const r of rnd.shuffle(ctx.free())) {
    if (taken.every((t) => Math.abs(t.rank - r.rank) >= DUEL_GAP)) taken.push(r);
    if (taken.length === 4) break;
  }
  if (taken.length < 4) return null;
  const best = taken.reduce((a, b) => (b.rank < a.rank ? b : a));
  const choices = taken.map(subjectOf);
  return { type: 'duel', subject: null, choices, answer: taken.indexOf(best), gamesUsed: taken };
}

function buildQuestion(type, ctx, rnd) {
  if (type === 'duel') {
    const q = buildDuel(ctx, rnd);
    if (!q) return null;
    q.gamesUsed.forEach((r) => ctx.used.add(r.externalId));
    delete q.gamesUsed;
    return q;
  }
  const b = BUILDERS[type];
  const candidates = ctx.free().filter(b.eligible);
  // A few attempts, because one row's neighbours can be too thin (a 1980 game
  // has fewer year distractors left than a 2010 one) while another's are fine.
  for (const r of rnd.shuffle(candidates).slice(0, 8)) {
    const q = b.build(r, rnd, ctx);
    if (q) {
      ctx.used.add(r.externalId);
      return q;
    }
  }
  return null;
}

/*
 * The week's round: `perRound` questions of DIFFERENT types, plus one unscored
 * sample question for the logged-out landing page, built from games the scored
 * questions do not use — so the public endpoint can never hand out the answer
 * key of what friends are ranked on. Null when the corpus cannot carry a round.
 */
function buildRound(rows, {
  week, currentYear, recentSubjects = new Set(), perRound = 5, poolSize = 500,
} = {}) {
  const pool = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.externalId === 'string' && Number.isInteger(r.rank) && r.rank > 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, poolSize);
  const used = new Set();
  const sets = new Map();
  const ctx = {
    used,
    currentYear: currentYear || new Date().getUTCFullYear(),
    free: () => pool.filter((r) => !used.has(r.externalId) && !recentSubjects.has(r.externalId)),
    valueSet: (type, valuesOf) => {
      if (!sets.has(type)) sets.set(type, new Set(pool.flatMap(valuesOf)));
      return sets.get(type);
    },
  };

  const rnd = seeded(String(week));
  const want = Math.min(perRound, TYPES.length);
  const questions = [];
  for (const type of rnd.shuffle(TYPES)) {
    if (questions.length >= want) break;
    const q = buildQuestion(type, ctx, rnd);
    if (q) questions.push(q);
  }
  if (questions.length < Math.min(MIN_ROUND, want)) return null;

  const rndSample = seeded(`${week}:sample`);
  let sample = null;
  for (const type of rndSample.shuffle(TYPES)) {
    sample = buildQuestion(type, ctx, rndSample);
    if (sample) break;
  }
  return { questions, sample };
}

// The games a question is about — what the cooldown remembers.
const gamesOf = (q) => (q.type === 'duel' ? q.choices.map((c) => c.externalId) : [q.subject.externalId]);

module.exports = {
  buildRound, gamesOf, weightBand, playtimeBand, TYPES, WEIGHT_BANDS, PLAYTIME_BANDS,
};
