'use strict';

/* The recommendation scoring (#682).
 *
 * Every weighted term gets a case that ISOLATES it: two candidates identical
 * except for the one attribute, asserted against the exact weight the term
 * carries. That shape is deliberate — a term wired to the wrong field shifts a
 * ranking nobody can eyeball, so a test that only checks "the better game came
 * first" stays green against half the mistakes this file can make
 * (.claude/rules/break-the-code-on-purpose.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  recommend,
  buildProfile,
  scoreCandidate,
  reasonsFrom,
  gameAffinity,
  partyDistribution,
  MIN_PROFILE_GAMES,
  NEUTRAL,
  REASON_LINES,
  W_QUALITY,
  W_COMPLEXITY,
  W_PLAYERS,
  W_MECHANICS,
  W_CATEGORIES,
  W_TIME,
  W_NOVELTY_PENALTY,
} = require('../lib/recommend');

/* --------------------------------- fixtures -------------------------------- */

const entry = (id, over = {}) => ({
  externalId: String(id),
  name: `Game ${id}`,
  year: 2015,
  rank: Number(id),
  rating: 7.5,
  bayesRating: 7,
  usersRated: 5000,
  enrichedAt: '2026-08-14T00:00:00.000Z',
  info: null,
  ...over,
});

const info = (over = {}) => ({
  weight: 3,
  minPlayers: 2,
  maxPlayers: 4,
  minPlaytime: 60,
  maxPlaytime: 60,
  minAge: 12,
  categories: ['C1'],
  mechanics: ['M1'],
  families: [],
  designers: [],
  implementations: [],
  bestWith: [],
  recommendedWith: [],
  ...over,
});

// A shelf big enough to clear the profile floor, every game linked to BGG and
// present in the corpus, all with the same taste: weight 3, 60 minutes, M1/C1.
function shelfRound(over = {}) {
  const games = [];
  for (let i = 1; i <= MIN_PROFILE_GAMES; i += 1) {
    games.push({ id: `g${i}`, title: `Owned ${i}`, source: { provider: 'bgg', externalId: `o${i}` } });
  }
  return {
    id: 'r1',
    name: 'Round',
    members: [{ id: 'm1', name: 'A' }, { id: 'm2', name: 'B' }, { id: 'm3', name: 'C' }, { id: 'm4', name: 'D' }],
    games,
    sessions: [],
    ...over,
  };
}

function shelfCorpus(infoOver = {}) {
  const rows = [];
  for (let i = 1; i <= MIN_PROFILE_GAMES; i += 1) rows.push(entry(`o${i}`, { info: info(infoOver) }));
  return rows;
}

/*
 * A shelf with a REAL taste spread, which the single-mechanic `shelfCorpus`
 * above cannot express: eight mechanics, each carried by three owned games, so
 * the normalised profile holds eight components of 1/sqrt(8) rather than one
 * component of 1.0.
 *
 * That distinction is the whole of #772. Against a one-mechanic profile a
 * perfect match scores 1.0 either way, so every isolation case in this file was
 * measuring the term at a spread it never sees in production — where a candidate
 * matching four favourites out of eight scored 0.707 and the term silently
 * delivered ~70% of the weight the constant claims.
 */
const TASTE_MECHANICS = ['M-a', 'M-b', 'M-c', 'M-d', 'M-e', 'M-f', 'M-g', 'M-h'];
const TASTE_CATEGORIES = ['C-a', 'C-b', 'C-c', 'C-d'];
const pick = (list, i, n) => Array.from({ length: n }, (_, k) => list[(i + k * 3) % list.length]);

function tasteCorpus() {
  const rows = [];
  for (let i = 0; i < MIN_PROFILE_GAMES; i += 1) {
    rows.push(entry(`o${i + 1}`, {
      info: info({ mechanics: pick(TASTE_MECHANICS, i, 3), categories: pick(TASTE_CATEGORIES, i, 2) }),
    }));
  }
  return rows;
}

const profileOf = (round, corpus) =>
  buildProfile(round, new Map(corpus.map((e) => [String(e.externalId), e])));

// The score difference between two candidates that differ in exactly one
// attribute. Rounded to kill float noise without hiding a real drift.
const delta = (profile, a, b) =>
  Math.round((scoreCandidate(profile, a).score - scoreCandidate(profile, b).score) * 1e6) / 1e6;

/* -------------------------------- affinities ------------------------------- */

test('a game state outranks its ratings, and the ladder is retired < rated-low < owned < rated-high', () => {
  const round = {
    members: [],
    sessions: [
      {
        id: 's1',
        gameIds: ['gr', 'ghigh', 'glow'],
        memberIds: ['m1'],
        votes: { m1: { gr: { rating: 5 }, ghigh: { rating: 5 }, glow: { rating: 1 } } },
      },
    ],
    members2: null,
  };
  round.members = [{ id: 'm1', name: 'A' }];
  const g = (id, over) => ({ id, title: id, ...over });

  // A retired game usually carries votes; letting them speak would make "we
  // threw this out" read as an ordinary five-star opinion.
  assert.equal(gameAffinity(round, g('gr', { retired: true })), -0.5);
  assert.equal(gameAffinity(round, g('ghigh')), 2, 'rated 5 -> 2.0');
  assert.equal(gameAffinity(round, g('glow')), 0, 'rated 1 -> 0.0');
  assert.equal(gameAffinity(round, g('gnone')), 1, 'owned, unrated -> neutral 1.0');
  // Completed is deliberately NOT a state: the game was played through, so its
  // ratings still count.
  assert.equal(gameAffinity(round, g('ghigh', { completed: true })), 2);
});

test('the party distribution counts PARTIES per session, and falls back to the member count', () => {
  const round = shelfRound();
  assert.deepEqual(partyDistribution(round), [{ players: 4, share: 1 }], 'never played -> the seats');

  const played = shelfRound({
    sessions: [
      // Four people, two of them a team -> three parties.
      { id: 's1', gameIds: [], memberIds: ['m1', 'm2', 'm3', 'm4'], teams: [{ id: 't', personIds: ['m1', 'm2'] }], votes: {} },
      { id: 's2', gameIds: [], memberIds: ['m1', 'm2', 'm3'], votes: {} },
      { id: 's3', gameIds: [], memberIds: ['m1', 'm2', 'm3'], votes: {} },
      // A cancelled evening is not a table size the group plays at.
      { id: 's4', gameIds: [], memberIds: ['m1', 'm2'], cancelled: true, votes: {} },
    ],
  });
  assert.deepEqual(partyDistribution(played), [{ players: 3, share: 1 }]);
});

/* ------------------------- one case per weighted term ----------------------- */

test('QUALITY is scored from the BAYES average, over the band BGG actually uses', () => {
  const profile = profileOf(shelfRound(), shelfCorpus());
  // Nothing else differs, so the whole gap is the quality term at full swing.
  const top = entry('x', { bayesRating: 8.5, info: info() });
  const bottom = entry('y', { bayesRating: 5.5, info: info() });
  assert.equal(delta(profile, top, bottom), W_QUALITY);
  // The raw `rating` must not be what is read: swapping it alone changes nothing.
  const loudMinority = entry('z', { bayesRating: 5.5, rating: 10, info: info() });
  assert.equal(delta(profile, loudMinority, bottom), 0);
});

test('COMPLEXITY is symmetric — too heavy and too light are equally wrong', () => {
  const profile = profileOf(shelfRound(), shelfCorpus());
  assert.equal(profile.targetWeight, 3);
  const centre = entry('x', { info: info({ weight: 3 }) });
  const heavy = entry('y', { info: info({ weight: 4.2 }) }); // exactly the tolerance
  const light = entry('z', { info: info({ weight: 1.8 }) });
  assert.equal(delta(profile, centre, heavy), W_COMPLEXITY);
  assert.equal(delta(profile, centre, light), W_COMPLEXITY);
  assert.equal(delta(profile, heavy, light), 0, 'the same distance either side');
});

test('PLAYERS scores the poll against the round\'s real party sizes, Best over Recommended', () => {
  const profile = profileOf(shelfRound(), shelfCorpus());
  assert.deepEqual(profile.parties, [{ players: 4, share: 1 }]);
  const best = entry('x', { info: info({ bestWith: [4], recommendedWith: [3, 4, 5] }) });
  const rec = entry('y', { info: info({ bestWith: [2], recommendedWith: [4] }) });
  const wrong = entry('z', { info: info({ bestWith: [7], recommendedWith: [7] }) });
  assert.equal(delta(profile, best, wrong), W_PLAYERS);
  assert.equal(delta(profile, rec, wrong), Math.round(W_PLAYERS * 0.6 * 1e6) / 1e6);
  // The BOX's range must not be what is read — it routinely lies, which is the
  // whole reason the poll is preferred.
  const boxOnly = entry('b', { info: info({ minPlayers: 4, maxPlayers: 4, bestWith: [7], recommendedWith: [7] }) });
  assert.equal(delta(profile, boxOnly, wrong), 0);
});

/*
 * #805 — the reason line SAYS "am besten", so it may only ever NAME a count
 * BGG's poll calls Best. Whether a Recommended count still SCORES is a separate
 * question and deliberately unchanged, which is why both halves are pinned in
 * the same test: the variant that also drops Recommended from the score passes
 * every "no players reason" assertion on its own.
 */
test('the players reason names a BEST count only, never a merely Recommended one (#805)', () => {
  const profile = profileOf(shelfRound(), shelfCorpus());
  assert.deepEqual(profile.parties, [{ players: 4, share: 1 }]);
  const term = (e) => scoreCandidate(profile, e).terms.find((t) => t.term === 'players');

  const recOnly = term(entry('x', { info: info({ bestWith: [2], recommendedWith: [4] }) }));
  // It clears the gate — which is precisely why it used to render a sentence
  // asserting a verdict BGG never gave.
  assert.ok(recOnly.value > NEUTRAL, `scored ${recOnly.value}`);
  assert.equal(recOnly.players, null, 'nothing to name: BGG called 4 Recommended, not Best');
  assert.equal(recOnly.value, 0.6, 'the SCORE keeps the Recommended hit at 0.6');

  const both = term(entry('y', { info: info({ bestWith: [4], recommendedWith: [3, 4, 5] }) }));
  assert.equal(both.players, 4);
  assert.equal(both.value, 1);

  // An unanswered poll is not a verdict either way: neutral, not 0, and nothing
  // to name.
  const silent = term(entry('z', { info: info() }));
  assert.equal(silent.value, null);
  assert.equal(silent.players, null);
});

test('among the counts it names, BEST beats the size the round plays most (#805)', () => {
  const mixed = shelfRound({
    members: [1, 2, 3, 4, 5].map((i) => ({ id: `m${i}`, name: `P${i}` })),
    sessions: [1, 2, 3].map((i) => ({ id: `s${i}`, gameIds: [], memberIds: ['m1', 'm2', 'm3', 'm4', 'm5'], votes: {} }))
      .concat([4, 5].map((i) => ({ id: `s${i}`, gameIds: [], memberIds: ['m1', 'm2', 'm3', 'm4'], votes: {} }))),
  });
  const profile = profileOf(mixed, shelfCorpus());
  assert.deepEqual(profile.parties, [{ players: 5, share: 0.6 }, { players: 4, share: 0.4 }]);
  const term = (e) => scoreCandidate(profile, e).terms.find((t) => t.term === 'players');

  // The round sits down at five more often than at four, and `parties` is
  // sorted by share — so the most-played hit is the one that used to win.
  const split = term(entry('x', { info: info({ bestWith: [4], recommendedWith: [5] }) }));
  assert.equal(split.players, 4, 'names the Best count, not the one played more often');
  assert.equal(Math.round(split.value * 1e6) / 1e6, 0.76, 'both hits still score, at 1.0 and 0.6');

  // Among SEVERAL Best counts the most-played one still wins — that tie-break
  // is the current intent and does not change.
  assert.equal(term(entry('y', { info: info({ bestWith: [4, 5] }) })).players, 5);
});

test('a players reason with nothing to name frees its line for the next term (#805)', () => {
  const round = shelfRound();
  // Qualifying terms, by contribution: quality (0.34), complexity (0.20),
  // players (0.096) and time (0.06). Mechanics and categories both miss the
  // gate, so `time` is the fourth in line and the one that must move up.
  const cand = (poll) => entry('cand', {
    bayesRating: 8.4,
    info: info({ mechanics: ['ZZ'], categories: ['ZZ'], ...poll }),
  });

  const named = recommend(round, [...shelfCorpus(), cand({ bestWith: [4] })]).recommendations[0];
  assert.deepEqual(named.reasons.map((r) => r.term), ['quality', 'complexity', 'players']);

  const withheld = recommend(round, [...shelfCorpus(), cand({ bestWith: [2], recommendedWith: [4] })]).recommendations[0];
  // Three lines still, with `time` promoted — the drop happens BEFORE the slice,
  // so the freed line goes to the next qualifying term instead of being lost.
  assert.equal(withheld.reasons.length, REASON_LINES);
  assert.deepEqual(withheld.reasons.map((r) => r.term), ['quality', 'complexity', 'time']);
});

test('MECHANICS and CATEGORIES are cosine similarity against the affinity-weighted vector', () => {
  const profile = profileOf(shelfRound(), shelfCorpus());
  const match = entry('x', { info: info({ mechanics: ['M1'], categories: ['C1'] }) });
  const mechOnly = entry('y', { info: info({ mechanics: ['M1'], categories: ['ZZ'] }) });
  const catOnly = entry('z', { info: info({ mechanics: ['ZZ'], categories: ['C1'] }) });
  const neither = entry('w', { info: info({ mechanics: ['ZZ'], categories: ['ZZ'] }) });
  assert.equal(delta(profile, mechOnly, neither), W_MECHANICS);
  assert.equal(delta(profile, catOnly, neither), W_CATEGORIES);
  assert.equal(delta(profile, match, neither), Math.round((W_MECHANICS + W_CATEGORIES) * 1e6) / 1e6);
  // The two are weighted apart on purpose: categories are what people name out
  // loud and the weakest predictor of what they enjoy.
  assert.ok(W_MECHANICS > W_CATEGORIES);
});

test('a match on the round\'s FAVOURITE mechanics scores near 1.0, not half (#772)', () => {
  const profile = profileOf(shelfRound(), tasteCorpus());
  // Four of the round's eight mechanics — as good as a candidate of this size
  // can possibly be against this shelf.
  const loved = entry('x', { info: info({ mechanics: TASTE_MECHANICS.slice(0, 4), categories: TASTE_CATEGORIES.slice(0, 2) }) });
  const [mech, cat] = ['mechanics', 'categories'].map(
    (name) => scoreCandidate(profile, loved).terms.find((t) => t.term === name).value,
  );
  // Raw cosine puts both at 0.707 here: it compares a profile vector spread over
  // eight mechanics against a binary candidate one, so it can only approach 1.0
  // if the round's entire taste IS those four. Complexity, players and time all
  // saturate at 1.0 on the same fixture, which is what made the two taste terms
  // worth half their stated weight.
  assert.ok(mech > 0.99, `mechanics scored ${mech}, expected ~1.0`);
  assert.ok(cat > 0.99, `categories scored ${cat}, expected ~1.0`);

  // …and a lesser match still ranks below it, or the rescale would have flattened
  // the term into a constant instead of fixing its range.
  const partial = entry('y', { info: info({ mechanics: [TASTE_MECHANICS[0], 'ZZ', 'YY', 'XX'] }) });
  const partialValue = scoreCandidate(profile, partial).terms.find((t) => t.term === 'mechanics').value;
  assert.ok(partialValue > 0 && partialValue < mech, `one-of-four scored ${partialValue}`);
});

test('the rescale ceiling ignores NEGATIVE profile components (#772)', () => {
  // A retired game contributes affinity -0.5, so the profile vector can hold
  // negative components — and a candidate can always avoid one by carrying a
  // mechanic the round has never met, which scores 0. So the best a k-mechanic
  // candidate can do is the k largest NON-NEGATIVE components; counting a
  // negative one into the ceiling lowers it, and everything above it clamps.
  const round = shelfRound();
  round.games.push({ id: 'gr', title: 'Retired', retired: true, source: { provider: 'bgg', externalId: 'orx' } });
  const corpus = [...shelfCorpus({ mechanics: ['Loved'] }), entry('orx', { info: info({ mechanics: ['Hated'] }) })];
  const profile = profileOf(round, corpus);
  const value = (mechanics) =>
    scoreCandidate(profile, entry('x', { info: info({ mechanics }) })).terms.find((t) => t.term === 'mechanics').value;

  assert.equal(value(['Loved']), 1, 'the round\'s own mechanic is a perfect match');
  assert.equal(value(['Loved', 'Unknown']), 1, 'plus an unknown is still the best a pair can do');
  // The real assertion: carrying a mechanic from the game they GOT RID OF is
  // strictly worse than carrying one they have never seen, and must score lower.
  // With the negative folded into the ceiling all three clamp to 1.0 instead.
  assert.ok(value(['Loved', 'Hated']) < 1, `a retired-game mechanic scored ${value(['Loved', 'Hated'])}`);
  assert.ok(value(['Loved', 'Hated']) < value(['Loved', 'Unknown']));
});

test('the taste terms move a score by their FULL weight, on a real taste spread (#772)', () => {
  const profile = profileOf(shelfRound(), tasteCorpus());
  // The §1 isolation shape, on the fixture that exposes the shortfall: these two
  // differ in mechanics alone, so the gap IS the term.
  const loved = entry('x', { info: info({ mechanics: TASTE_MECHANICS.slice(0, 4), categories: [] }) });
  const alien = entry('y', { info: info({ mechanics: ['ZZ1', 'ZZ2', 'ZZ3', 'ZZ4'], categories: [] }) });
  assert.equal(delta(profile, loved, alien), W_MECHANICS);

  const lovedCats = entry('a', { info: info({ mechanics: [], categories: TASTE_CATEGORIES.slice(0, 2) }) });
  const alienCats = entry('b', { info: info({ mechanics: [], categories: ['ZZ1', 'ZZ2'] }) });
  assert.equal(delta(profile, lovedCats, alienCats), W_CATEGORIES);
});

test('the ranking does not move when the corpus grows (#772 keeps §7\'s invariance)', () => {
  // The rescale normalises against what the PROFILE makes attainable, never
  // against the observed candidate distribution — so a bigger pool may only add
  // candidates, never re-order the ones already there. The standout statistics
  // that rank the reason LINES are corpus-relative on purpose and deliberately
  // do not feed the score; this is the assertion that keeps those two apart.
  const round = shelfRound();
  const base = tasteCorpus();
  // Each candidate carries four mechanics, of which `i % 5` are the round's —
  // so the term takes every value from 0 to 1.0 across the pool. Drawing them
  // ALL from the taste set would give every candidate exactly 1.0, because this
  // profile is uniform: the standard deviation would be zero and the assertion
  // below could not see anything at all (measured — it did not).
  const truncated = [];
  for (let i = 0; i < 20; i += 1) {
    const loved = TASTE_MECHANICS.slice(0, i % 5);
    truncated.push(entry(`c${i}`, {
      rank: 1000 + i,
      bayesRating: 5.5 + (i % 7) * 0.5,
      info: info({
        weight: 2 + (i % 5) * 0.5,
        maxPlaytime: 30 + (i % 6) * 30,
        mechanics: [...loved, ...Array.from({ length: 4 - loved.length }, (_, k) => `Z${i}-${k}`)],
        categories: pick(TASTE_CATEGORIES, i, 1 + (i % 3)),
        bestWith: i % 3 === 0 ? [4] : [2],
      }),
    }));
  }
  /*
   * The rows the bigger corpus ADDS are a deliberately different population —
   * every one of them a strong taste match — so the per-term mean and standard
   * deviation genuinely move between the two runs.
   *
   * This is the difference between a test and a decoration. The first version of
   * this fixture generated all 40 rows from one periodic formula, so both
   * corpora carried the SAME distribution: the statistics did not move, and a
   * deliberate corpus-relative term in the score changed nothing at three
   * different strengths. It was green for want of a difference to detect.
   */
  const extra = [];
  for (let i = 0; i < 20; i += 1) {
    extra.push(entry(`x${i}`, {
      rank: 2000 + i,
      bayesRating: 7 + (i % 4) * 0.3,
      info: info({
        weight: 3,
        maxPlaytime: 60,
        mechanics: TASTE_MECHANICS.slice(0, 3 + (i % 3)),
        categories: TASTE_CATEGORIES.slice(0, 2),
        bestWith: [4],
      }),
    }));
  }
  const candidates = [...truncated, ...extra];
  const small = recommend(round, [...base, ...truncated], { limit: 100 }).recommendations;
  const large = recommend(round, [...base, ...candidates], { limit: 100 }).recommendations;

  // The SCORE is the assertion that bites. Order alone is far too robust to see
  // this: a corpus-relative term only re-weights an axis, so a fixture's ranking
  // can survive one intact and report a clean bill of health — measured, against
  // a deliberate break at three different strengths. A score that moves because
  // OTHER rows joined the corpus is the defect itself, whether or not this
  // particular fixture reorders.
  const byId = new Map(large.map((r) => [r.externalId, r]));
  let shared = 0;
  small.forEach((rec) => {
    const grown = byId.get(rec.externalId);
    if (!grown) return;
    shared += 1;
    assert.equal(grown.score, rec.score, `${rec.externalId} scored differently in a bigger corpus`);
  });
  assert.equal(shared, truncated.length, 'the fixture must actually compare every truncated row');

  // …and the user-visible half: the large corpus may interleave new rows
  // anywhere, it may not re-order the ones the small corpus already ranked.
  const order = (list) => list.map((r) => r.externalId);
  assert.deepEqual(order(large).filter((id) => order(small).includes(id)), order(small));
});

test('TIME is the distance from the group\'s own evening length', () => {
  const profile = profileOf(shelfRound(), shelfCorpus());
  assert.equal(profile.targetTime, 60);
  const fits = entry('x', { info: info({ maxPlaytime: 60 }) });
  const marathon = entry('y', { info: info({ maxPlaytime: 120 }) });
  assert.equal(delta(profile, fits, marathon), W_TIME);
});

test('the NOVELTY penalty fires on a reimplementation link in either direction', () => {
  const round = shelfRound();
  const corpus = shelfCorpus();
  // The owned row names the candidate as a relative…
  corpus[0].info.implementations = ['Game reimpl'];
  const profile = profileOf(round, corpus);
  const same = entry('reimpl', { info: info() });
  const other = entry('fresh', { info: info() });
  assert.equal(delta(profile, other, same), Math.abs(W_NOVELTY_PENALTY));

  // …and the other way round: the candidate names something owned.
  const corpus2 = shelfCorpus();
  corpus2[0].name = 'Owned classic';
  const profile2 = profileOf(round, corpus2);
  const child = entry('c', { info: info({ implementations: ['Owned classic'] }) });
  assert.equal(delta(profile2, entry('d', { info: info() }), child), Math.abs(W_NOVELTY_PENALTY));
});

test('an UNKNOWN attribute scores neutral, not zero', () => {
  const profile = profileOf(shelfRound(), shelfCorpus());
  // A row BGG knows nothing about beyond its rank must not be buried under a row
  // that is a documented bad match; it has simply made no claim.
  const silent = entry('x', { info: info({ weight: null, maxPlaytime: null }) });
  const wrong = entry('y', { info: info({ weight: 4.2, maxPlaytime: 120 }) });
  assert.equal(delta(profile, silent, wrong), Math.round((W_COMPLEXITY + W_TIME) * NEUTRAL * 1e6) / 1e6);
});

/* --------------------------- the whole recommendation ---------------------- */

test('a round below the profile floor gets NO recommendations, however full the corpus', () => {
  const thin = shelfRound();
  thin.games = thin.games.slice(0, MIN_PROFILE_GAMES - 1);
  const corpus = [...shelfCorpus(), entry('cand', { info: info() })];
  const out = recommend(thin, corpus);
  assert.deepEqual(out.recommendations, []);
  assert.equal(out.profileGames, MIN_PROFILE_GAMES - 1);
  assert.equal(out.linkedGames, MIN_PROFILE_GAMES - 1);
  assert.equal(out.minProfileGames, MIN_PROFILE_GAMES);
});

test('a game already in the round is excluded in EVERY state, retired included', () => {
  const round = shelfRound();
  // One of each off-shelf state, all linked to rows that are in the corpus.
  round.games.push(
    { id: 'gr', title: 'Retired', retired: true, source: { provider: 'bgg', externalId: 'x-retired' } },
    { id: 'gw', title: 'Wished', wish: true, source: { provider: 'bgg', externalId: 'x-wish' } },
    { id: 'gc', title: 'Done', completed: true, source: { provider: 'bgg', externalId: 'x-done' } },
  );
  const corpus = [
    ...shelfCorpus(),
    entry('x-retired', { info: info() }),
    entry('x-wish', { info: info() }),
    entry('x-done', { info: info() }),
    entry('free', { info: info() }),
  ];
  const out = recommend(round, corpus);
  assert.deepEqual(out.recommendations.map((r) => r.externalId), ['free']);
});

test('an un-enriched corpus row is never recommended — it could not be explained', () => {
  const corpus = [...shelfCorpus(), entry('bare'), entry('rich', { info: info() })];
  const out = recommend(shelfRound(), corpus);
  assert.deepEqual(out.recommendations.map((r) => r.externalId), ['rich']);
  assert.equal(out.corpusRows, corpus.length, 'the count still reports the whole corpus');
});

test('each recommendation names up to three terms that actually earned it', () => {
  const round = shelfRound();
  const corpus = shelfCorpus();
  const out = recommend(round, [
    ...corpus,
    entry('cand', { bayesRating: 8.4, info: info({ mechanics: ['M1'], categories: ['ZZ'], bestWith: [4] }) }),
  ]);
  const [rec] = out.recommendations;
  assert.equal(rec.externalId, 'cand');
  // Five terms qualify here and the card shows three. It is the only candidate
  // in the pool, so no value is unusual relative to anything and the standout
  // ranking falls back to weighted contribution.
  assert.equal(rec.reasons.length, REASON_LINES);
  assert.deepEqual(rec.reasons.map((r) => r.term), ['quality', 'complexity', 'players']);
  assert.equal(rec.reasons[0].rating, 8.4);
  assert.equal(rec.reasons[1].weight, 3);
  assert.equal(rec.reasons[2].players, 4);
});

/* ------------------------------- wished games ------------------------------ */
/*
 * A wish is a want, not a statement about what the group likes to PLAY (#776).
 * It used to sit at the TOP of the affinity ladder (1.5, above every rated
 * game), so the list a round saw was steered hardest by games it does not own —
 * on a screen whose entire premise is "games you do not own".
 *
 * The four cases below are one behaviour seen from four sides, because this file
 * fails by ranking: the profile, the reason lines, the novelty penalty and the
 * counts are all derived from the same list, and a wish leaking back into any of
 * them produces a plausible wrong list rather than an error.
 */

// One wished game the shelf resembles in NOTHING — a foreign mechanic, a foreign
// category, twice the complexity and four times the length. Any leak into the
// profile moves all four at once.
const WISH_ID = 'x-wish';
const wishGame = () => ({ id: 'gw', title: 'Wished', wish: true, source: { provider: 'bgg', externalId: WISH_ID } });
const wishRow = (over = {}) =>
  entry(WISH_ID, {
    name: 'Wished classic',
    info: info({ mechanics: ['M-wish'], categories: ['C-wish'], weight: 5, maxPlaytime: 240, ...over }),
  });

test('a WISHED game shapes nothing in the profile — vectors, targets or counts', () => {
  const without = profileOf(shelfRound(), shelfCorpus());
  const round = shelfRound();
  round.games.push(wishGame());
  const withWish = profileOf(round, [...shelfCorpus(), wishRow()]);

  assert.deepEqual(withWish.mechanics, without.mechanics, 'no mechanic vector component');
  assert.deepEqual(withWish.categories, without.categories, 'no category vector component');
  assert.equal(withWish.targetWeight, without.targetWeight, 'no pull on the complexity target');
  assert.equal(withWish.targetTime, without.targetTime, 'no pull on the playtime target');
  assert.equal(withWish.linkedGames, without.linkedGames, 'linkedGames excludes the wish');
  assert.equal(withWish.profileGames, without.profileGames, 'profileGames excludes the wish');

  // The consequence that matters: the ranking is identical, term for term. A
  // candidate built out of the WISH's attributes is the sharpest probe — it is
  // the one a leaked wish would promote hardest.
  const candidate = entry('c', { info: info({ mechanics: ['M-wish'], categories: ['C-wish'], weight: 5, maxPlaytime: 240 }) });
  assert.equal(scoreCandidate(withWish, candidate).score, scoreCandidate(without, candidate).score);

  // …but it is still known, so it is still never recommended back. That filter
  // is the one thing a wish must keep doing.
  assert.ok(withWish.ownedIds.has(WISH_ID));
});

test('a reason line can never name a wished game', () => {
  const round = shelfRound();
  round.games.push(wishGame());
  // The wish shares BOTH mechanics with the candidate where every owned game
  // shares one, so `topContributors` ranked it first and the card read
  // „Ähnliche Mechaniken wie Wished" — naming a game the round does not have, on
  // a screen whose whole list is games the round does not have.
  //
  // The shared M1 is load-bearing, not scenery: a candidate carrying the wish's
  // mechanic ALONE scores ~0.19 after the rescale, fails the `> NEUTRAL`
  // admission gate (§2), and emits no mechanics reason at all — so the
  // assertion would pass against the unfixed code for a reason that has nothing
  // to do with wishes. Measured while writing this.
  const out = recommend(round, [
    ...shelfCorpus(),
    wishRow({ mechanics: ['M1', 'M-wish'], categories: ['C1'] }),
    entry('cand', { info: info({ mechanics: ['M1', 'M-wish'], categories: ['C1'] }) }),
  ]);
  const [rec] = out.recommendations.filter((r) => r.externalId === 'cand');
  const mechanics = rec.reasons.find((r) => r.term === 'mechanics');
  assert.ok(mechanics, 'the mechanics reason still fires — this case is about WHO it names');
  assert.deepEqual(mechanics.games, ['Owned 1', 'Owned 2']);
  assert.deepEqual(rec.reasons.flatMap((r) => r.games || []).filter((g) => g === 'Wished'), []);
});

test('a reason line can never name a RETIRED game', () => {
  const round = shelfRound();
  round.games.push({ id: 'gr', title: 'Thrown out', retired: true, source: { provider: 'bgg', externalId: 'orx' } });
  /*
   * The sibling of the wish case above, one state over — and the reason #776's
   * fix does not cover it. A wished game could simply leave `profile.games`; a
   * retired one CANNOT, because its negative affinity is exactly how „we threw
   * this out" reaches the mechanics/categories vectors. So it has to be gated
   * where the naming happens instead.
   *
   * The retired row shares all THREE mechanics with the candidate where every
   * owned game shares one, so ranking by `shared` alone put it first and the
   * card read „Ähnliche Mechaniken wie Thrown out" — the game they got rid of,
   * named as the reason to consider a new one.
   *
   * The shared M1 is load-bearing for the same reason it is in the wish sibling:
   * without a mechanic the OWNED shelf also carries, the term never clears the
   * `> NEUTRAL` admission gate, no mechanics reason is emitted at all, and the
   * assertion would pass against the unfixed code for a reason that has nothing
   * to do with retiring.
   */
  const out = recommend(round, [
    ...shelfCorpus(),
    entry('orx', { info: info({ mechanics: ['M1', 'M-ret1', 'M-ret2'] }) }),
    entry('cand', { info: info({ mechanics: ['M1', 'M-ret1', 'M-ret2'] }) }),
  ]);
  const [rec] = out.recommendations.filter((r) => r.externalId === 'cand');
  const mechanics = rec.reasons.find((r) => r.term === 'mechanics');
  assert.ok(mechanics, 'the mechanics reason still fires — this case is about WHO it names');
  assert.deepEqual(mechanics.games, ['Owned 1', 'Owned 2']);
  assert.deepEqual(rec.reasons.flatMap((r) => r.games || []).filter((g) => g === 'Thrown out'), []);
});

test('a retired game is FILTERED OUT, not merely outranked, when a slot is free', () => {
  const round = shelfRound();
  round.games.push({ id: 'gr', title: 'Thrown out', retired: true, source: { provider: 'bgg', externalId: 'orx' } });
  /*
   * The sibling above does NOT cover the `rank > 0` filter clause, and this is
   * the measurement that says so: with the clause deleted and the `rank` sort
   * kept, the whole file stays green. Ten positive contributors at rank 1 fill
   * both REASON_GAMES slots, so the retired game at rank 0 sorts to the back and
   * is sliced away for a reason that has nothing to do with the filter.
   *
   * The clause only bites when FEWER than REASON_GAMES contributors qualify —
   * exactly one owned game carries the mechanic here — because then the slice
   * has a free slot and would fill it with a rank-0 game. Without the clause
   * this card reads „Ähnliche Mechaniken wie Owned 1 und Thrown out".
   */
  const corpus = shelfCorpus({ mechanics: [] });
  corpus[0].info.mechanics = ['M-x'];
  const out = recommend(round, [
    ...corpus,
    entry('orx', { info: info({ mechanics: ['M-x'] }) }),
    entry('cand', { info: info({ mechanics: ['M-x'] }) }),
  ]);
  const mechanics = out.recommendations
    .find((r) => r.externalId === 'cand').reasons.find((r) => r.term === 'mechanics');

  assert.ok(mechanics, 'the mechanics reason still fires — the shelf game carries it');
  assert.deepEqual(mechanics.games, ['Owned 1'], 'one name, not a free slot filled with the discarded game');
});

// A shelf where exactly two owned games carry the candidate's mechanics, rated
// so that the SECOND is the loved one — the natural stable order names Owned 1
// first, so only a real affinity ranking can produce the expected list.
const ratedPairRound = () => shelfRound({
  sessions: [{
    id: 's1',
    gameIds: ['g1', 'g2'],
    memberIds: ['m1', 'm2', 'm3', 'm4'],
    votes: { m1: { g1: { rating: 2 }, g2: { rating: 5 } } },
  }],
});

test('reason contributors sharing the SAME count are ranked by affinity', () => {
  const round = ratedPairRound();
  const corpus = shelfCorpus({ mechanics: [] });
  corpus[0].info.mechanics = ['M-x'];
  corpus[1].info.mechanics = ['M-x'];
  const out = recommend(round, [...corpus, entry('cand', { info: info({ mechanics: ['M-x'] }) })]);
  const mechanics = out.recommendations
    .find((r) => r.externalId === 'cand').reasons.find((r) => r.term === 'mechanics');

  // Both share the one mechanic, so `shared` alone cannot order them and the
  // pre-fix code fell back to shelf order. Owned 2 is rated 5 (affinity 2.0),
  // Owned 1 rated 2 (affinity 0.5).
  assert.deepEqual(mechanics.games, ['Owned 2', 'Owned 1']);
});

test('a reason contributor sharing FEWER attributes can outrank one sharing more', () => {
  const round = ratedPairRound();
  const corpus = shelfCorpus({ mechanics: [] });
  corpus[0].info.mechanics = ['M-x', 'M-y'];
  corpus[1].info.mechanics = ['M-x'];
  const out = recommend(round, [...corpus, entry('cand', { info: info({ mechanics: ['M-x', 'M-y'] }) })]);
  const mechanics = out.recommendations
    .find((r) => r.externalId === 'cand').reasons.find((r) => r.term === 'mechanics');

  // Owned 1 shares BOTH mechanics but is rated 2 -> 2 x 0.5 = 1.0; Owned 2
  // shares one and is rated 5 -> 1 x 2.0 = 2.0. So the ranking is the PRODUCT,
  // not `shared` with affinity as a tie-break — under a tie-break the shared
  // count would decide first and Owned 1 would still lead.
  assert.deepEqual(mechanics.games, ['Owned 2', 'Owned 1']);
});

test('the NOVELTY penalty does not fire against a wished game', () => {
  const round = shelfRound();
  round.games.push(wishGame());
  const profile = profileOf(round, [...shelfCorpus(), wishRow()]);
  // A reimplementation of something on the WUNSCHLISTE is not "you already own
  // this in different clothes" — it is a second route to a game they still want.
  const reprint = entry('c', { info: info({ implementations: ['Wished classic'] }) });
  assert.equal(delta(profile, entry('d', { info: info() }), reprint), 0);
});

test('a shelf of mostly wishes falls UNDER the profile floor rather than profiling the wishes', () => {
  const round = shelfRound();
  // Two owned games and six wishes: eight BGG-linked games, of which only two
  // say anything about what this round plays.
  round.games = round.games.map((g, i) => (i < 2 ? g : { ...g, wish: true }));
  const out = recommend(round, [...shelfCorpus(), entry('cand', { info: info() })]);

  assert.deepEqual(out.recommendations, [], 'better nothing than a list built from games they do not own');
  assert.equal(out.linkedGames, 2);
  assert.equal(out.profileGames, 2);
  // BOTH counts matter, and this is why: recEmptyKey() (public/js/views-recommend.js)
  // reads `linkedGames` first. Had the wishes stayed counted there, 8 >= 8 would
  // have sent the reader to `unknownGames` — "the database does not know your
  // shelf" — when the true answer is `fewGames`, the one state carrying the
  // BGG-import button (.claude/rules/recommendation-scoring.md §6).
  assert.ok(out.linkedGames < out.minProfileGames, 'the fewGames state, not unknownGames');
});

test('a mechanics reason NAMES the owned games it was derived from', () => {
  const round = shelfRound();
  const corpus = shelfCorpus({ mechanics: [] });
  // Only two owned games carry the mechanic, so only they may be named.
  corpus[0].info.mechanics = ['Engine Building'];
  corpus[1].info.mechanics = ['Engine Building'];
  const out = recommend(round, [
    ...corpus,
    // Weak everywhere else, so mechanics is the reason that survives.
    entry('cand', { bayesRating: 5.5, info: info({ weight: 4.9, maxPlaytime: 400, mechanics: ['Engine Building'], categories: [] }) }),
  ]);
  const reason = out.recommendations[0].reasons.find((r) => r.term === 'mechanics');
  assert.deepEqual(reason.games, ['Owned 1', 'Owned 2']);
});

/*
 * A corpus where the player fit is ORDINARY and one candidate's mechanics are
 * exceptional — the shape the whole reason half of #772 is about. Most games
 * suit the round's table size, so naming that tells the reader nothing; a
 * mechanics match nobody else in the pool comes close to is the sentence worth
 * printing, and under the old `weight × value` sort it could never win.
 */
function standoutCorpus() {
  const rows = tasteCorpus();
  for (let i = 0; i < 30; i += 1) {
    // Ordinary: fits the table, says nothing about taste.
    rows.push(entry(`f${i}`, { rank: 500 + i, info: info({ mechanics: ['ZZ'], categories: [], bestWith: [4] }) }));
  }
  for (let i = 0; i < 3; i += 1) {
    rows.push(entry(`w${i}`, { rank: 700 + i, info: info({ mechanics: ['ZZ'], categories: [], bestWith: [9] }) }));
  }
  return rows;
}

test('a reason line is ranked by how UNUSUAL the value is, not by its weight (#772)', () => {
  const out = recommend(shelfRound(), [
    ...standoutCorpus(),
    entry('star', { rank: 1, info: info({ mechanics: TASTE_MECHANICS.slice(0, 4), categories: [], bestWith: [4] }) }),
  ]);
  const [top] = out.recommendations;
  assert.equal(top.externalId, 'star');
  const terms = top.reasons.map((r) => r.term);
  // Both qualify — the candidate really does fit four players — but 33 of the 36
  // scored candidates fit four players too, while nothing else in the pool comes
  // near its mechanics. Under the old sort players (0.16) always beat mechanics
  // (0.13 maximum) and mechanics could not appear at all.
  assert.ok(terms.includes('mechanics'), `named ${terms.join(', ')}`);
  assert.ok(terms.indexOf('mechanics') < terms.indexOf('players'), `named ${terms.join(', ')} — mechanics must lead`);
});

test('a merely well-rated candidate still names its rating — nothing is forced onto a card', () => {
  const out = recommend(shelfRound(), [
    ...standoutCorpus(),
    // Unremarkable on every taste axis, and genuinely well rated. The standout
    // ranking must not invent a taste reason for it, nor drop the one true thing
    // it has going for it.
    entry('rated', { rank: 1, bayesRating: 8.4, info: info({ mechanics: ['ZZ'], categories: [], bestWith: [4] }) }),
  ]);
  const [top] = out.recommendations;
  assert.equal(top.externalId, 'rated');
  const quality = top.reasons.find((r) => r.term === 'quality');
  assert.ok(quality, `named ${top.reasons.map((r) => r.term).join(', ')}`);
  assert.equal(quality.rating, 8.4);
  assert.equal(top.reasons.find((r) => r.term === 'mechanics'), undefined, 'no taste reason it did not earn');
});

test('a term at or below neutral is never claimed as a reason', () => {
  const round = shelfRound();
  const out = recommend(round, [
    ...shelfCorpus(),
    // Bad on every axis: an honest answer names nothing rather than inventing a
    // compliment for a game that only got in because the shelf is short.
    entry('cand', { bayesRating: 5.5, info: info({ weight: 4.9, maxPlaytime: 400, mechanics: ['ZZ'], categories: ['ZZ'], bestWith: [9] }) }),
  ]);
  assert.deepEqual(out.recommendations[0].reasons, []);
});

/* ------------------- at most one taste reason per card (#775) -------------- */
/*
 * BGG categories correlate heavily with mechanics and `topContributors` derives
 * both lines from the same shelf by the same "most shared values" rule, so once
 * #772 made the two terms reachable they surfaced TOGETHER, naming the same owned
 * games: two of a card's three lines spent on one piece of information.
 *
 * The fixture below varies the two terms' DISTRIBUTIONS, not just the candidate's
 * two values, and that distinction is the whole of this block. Over a spike
 * distribution — one candidate above a floor of zeros — the z-score is
 * value-INDEPENDENT: measured 5.477226 for a 0.75 candidate and 5.477226 for a
 * 1.0 one, bit-identical. So a fixture that only moves the values produces an
 * exact tie, and a spec asserting "the higher standout survives" would be
 * vacuously green against a rule that always keeps mechanics.
 */
const PAIR_MECHANICS = ['M-a', 'M-b', 'M-c', 'M-d', 'M-e', 'M-f', 'M-g', 'M-h'];
const PAIR_CATEGORIES = ['C-a', 'C-b', 'C-c', 'C-d', 'C-e', 'C-f', 'C-g', 'C-h'];

/*
 * An owned shelf spread over BOTH taste axes, plus 30 ordinary fillers that fit
 * the table and say nothing about taste. Exactly `sharers` of those fillers also
 * carry the candidate's mechanics — which is what makes a perfect mechanics match
 * ORDINARY (low standout) while a weaker category match stays unusual.
 */
function twoAxisCorpus(sharers = 0) {
  const rows = [];
  for (let i = 0; i < MIN_PROFILE_GAMES; i += 1) {
    rows.push(entry(`o${i + 1}`, {
      info: info({ mechanics: pick(PAIR_MECHANICS, i, 3), categories: pick(PAIR_CATEGORIES, i, 3) }),
    }));
  }
  for (let i = 0; i < 30; i += 1) {
    rows.push(entry(`f${i}`, {
      rank: 500 + i,
      info: info({
        bestWith: [4],
        mechanics: i < sharers ? PAIR_MECHANICS.slice(0, 4) : ['ZZ'],
        categories: ['YY'],
      }),
    }));
  }
  return rows;
}

const tasteTerms = (rec) => rec.reasons.map((r) => r.term).filter((t) => t === 'mechanics' || t === 'categories');

test('a card never names BOTH taste reasons — the more unusual one survives (#775)', () => {
  const cand = entry('cand', {
    rank: 1,
    // Mechanics is a PERFECT match (1.0) that three other candidates also make,
    // so it is ordinary: z 2.598. Categories is only 0.75, but nothing else in
    // the pool comes near it: z 5.477.
    info: info({
      bestWith: [4],
      mechanics: PAIR_MECHANICS.slice(0, 4),
      categories: [...PAIR_CATEGORIES.slice(0, 3), 'YY'],
    }),
  });
  const out = recommend(shelfRound(), [...twoAxisCorpus(3), cand]);
  const [top] = out.recommendations.filter((r) => r.externalId === 'cand');

  // Discriminating in three directions at once: mechanics carries the higher
  // VALUE (1.0 vs 0.75), the higher WEIGHT (0.13 vs 0.07) and nearly 2.5x the
  // contribution (0.130 vs 0.053), so "keep mechanics", "keep the stronger match"
  // and "keep the bigger contributor" all pick the wrong one here. Only the
  // standout ordering — the one everything else in `reasonsFrom` uses — picks
  // categories.
  assert.deepEqual(tasteTerms(top), ['categories'], `named ${top.reasons.map((r) => r.term).join(', ')}`);

  // The freed line is BACKFILLED rather than lost: the card still carries three
  // reasons, the third being the next qualifying term.
  assert.equal(top.reasons.length, REASON_LINES);
  assert.deepEqual(top.reasons.map((r) => r.term), ['categories', 'complexity', 'players']);
});

test('on an exact standout tie the taste line is mechanics (#775)', () => {
  const cand = entry('cand', {
    rank: 1,
    // Both terms are pure spikes here, so their z-scores are bit-identical
    // (5.477226) even though categories scores 1.0 against mechanics' 0.75. The
    // standout ranking cannot separate them, and the tie goes to the stronger
    // taste signal — the one carrying the higher weight.
    info: info({
      bestWith: [4],
      mechanics: [...PAIR_MECHANICS.slice(0, 3), 'ZZ'],
      categories: PAIR_CATEGORIES.slice(0, 4),
    }),
  });
  const out = recommend(shelfRound(), [...twoAxisCorpus(0), cand]);
  const [top] = out.recommendations.filter((r) => r.externalId === 'cand');

  assert.deepEqual(tasteTerms(top), ['mechanics'], `named ${top.reasons.map((r) => r.term).join(', ')}`);
  assert.equal(top.reasons.length, REASON_LINES);
});

test('a card where only ONE taste term qualifies is untouched (#775)', () => {
  const cand = entry('cand', {
    rank: 1,
    // Categories matches nothing the round owns, so it never qualifies and there
    // is nothing to exclude. The card must look exactly as it did before.
    info: info({ bestWith: [4], mechanics: PAIR_MECHANICS.slice(0, 4), categories: ['YY'] }),
  });
  const out = recommend(shelfRound(), [...twoAxisCorpus(0), cand]);
  const [top] = out.recommendations.filter((r) => r.externalId === 'cand');
  assert.deepEqual(top.reasons.map((r) => r.term), ['mechanics', 'complexity', 'players']);
});

test('the exclusion is PRESENTATION only — both terms still score (#775)', () => {
  const cand = entry('cand', {
    rank: 1,
    info: info({
      bestWith: [4],
      mechanics: PAIR_MECHANICS.slice(0, 4),
      categories: [...PAIR_CATEGORIES.slice(0, 3), 'YY'],
    }),
  });
  const corpus = [...twoAxisCorpus(3), cand];
  const out = recommend(shelfRound(), corpus);
  const [top] = out.recommendations.filter((r) => r.externalId === 'cand');

  // The dropped line must not cost the candidate any of its score: both taste
  // terms still clear the admission gate and both still contribute their weight,
  // and the score the card reports is `scoreCandidate`'s untouched.
  const profile = profileOf(shelfRound(), corpus);
  const s = scoreCandidate(profile, cand);
  const byTerm = Object.fromEntries(s.terms.map((t) => [t.term, t]));
  assert.ok(byTerm.mechanics.value > NEUTRAL, 'mechanics still qualifies on the score side');
  assert.ok(byTerm.categories.value > NEUTRAL, 'categories still qualifies on the score side');
  assert.equal(byTerm.mechanics.contribution, W_MECHANICS * byTerm.mechanics.value);
  assert.equal(byTerm.categories.contribution, W_CATEGORIES * byTerm.categories.value);
  assert.equal(top.score, Math.round(s.score * 1000) / 1000);
});

test('a taste reason with no contributors left costs the card no line (#775)', () => {
  /*
   * DEFENSIVE, and deliberately built by hand: end to end a qualifying taste term
   * always HAS a contributor, so this state is unreachable through `recommend()`
   * and can only be expressed by handing `reasonsFrom` a profile whose games and
   * vectors disagree.
   *
   * #798 narrowed the argument without breaking it. It used to be enough that the
   * vector is built from `profile.games` itself; the contributors are now only
   * that list's POSITIVE-affinity subset, so matching a profiled game no longer
   * suffices. What still holds: clearing the `> NEUTRAL` gate needs a positive dot
   * product, which needs a positive component, which only a positive-affinity game
   * can accumulate — and that game is itself a qualifying contributor. Measured: a
   * mechanic carried solely by a retired (-0.5) and a rated-1 (0.0) game scores 0.
   *
   * It is pinned anyway because what it guards is the ORDERING: the empty-games
   * filter has to run BEFORE the slice, or dropping the line costs a slot that a
   * qualifying term would have filled. With the filter last this card gets two
   * reasons; with it before the slice, three.
   */
  const profile = { games: [] };
  const stats = new Map(); // no observations -> every standout is 0, so contribution orders
  const term = (t, value, weight, over = {}) => ({ term: t, value, weight, contribution: weight * value, ...over });
  const scored = {
    terms: [
      // Every value must clear the `> NEUTRAL` gate to be ranked at all.
      term('quality', 0.7, W_QUALITY, { rating: 8.4 }), // 0.245
      term('mechanics', 1, W_MECHANICS), // 0.130 — ranks second, and names nobody
      term('complexity', 0.6, W_COMPLEXITY, { weightValue: 3 }), // 0.108
      term('time', 0.9, W_TIME, { minutes: 60 }), // 0.081
    ],
  };
  const reasons = reasonsFrom(profile, { info: { mechanics: ['M1'] } }, scored, stats);
  // Ranked quality, mechanics, complexity, time. Mechanics names nobody and goes;
  // `time` moves up into the slot it vacated instead of the card losing a line.
  assert.deepEqual(reasons.map((r) => r.term), ['quality', 'complexity', 'time']);
  assert.equal(reasons.length, REASON_LINES, 'the dropped taste line is backfilled, not lost');
});

test('the list is ranked by score, then by BGG rank, and bounded by the limit', () => {
  const round = shelfRound();
  const corpus = [
    ...shelfCorpus(),
    entry('mid', { rank: 5, bayesRating: 7, info: info() }),
    entry('best', { rank: 900, bayesRating: 8.5, info: info() }),
    // Same score as `mid` in every term; the better BGG rank breaks the tie.
    entry('tie', { rank: 2, bayesRating: 7, info: info() }),
  ];
  const out = recommend(round, corpus);
  assert.deepEqual(out.recommendations.map((r) => r.externalId), ['best', 'tie', 'mid']);
  assert.equal(recommend(round, corpus, { limit: 2 }).recommendations.length, 2);
});

test('an empty corpus answers an empty list and the counts that explain it', () => {
  const out = recommend(shelfRound(), []);
  assert.deepEqual(out.recommendations, []);
  assert.equal(out.corpusRows, 0);
  // Every shelf game is linked, but the corpus knows none of them — which is a
  // different state from "this round has barely any games", and the screen says
  // so rather than telling people to import a collection they already have.
  assert.equal(out.linkedGames, MIN_PROFILE_GAMES);
  assert.equal(out.profileGames, 0);
});

test('a game linked to another provider is not joined against BGG ids', () => {
  const round = shelfRound();
  round.games[0].source = { provider: 'steam', externalId: 'o1' };
  const out = recommend(round, shelfCorpus());
  assert.equal(out.linkedGames, MIN_PROFILE_GAMES - 1);
  assert.equal(out.profileGames, MIN_PROFILE_GAMES - 1);
});

test('the NOVELTY penalty also fires on same designer + most of the same mechanics', async () => {
  // BGG does not link every re-skin, so the second path exists for the cases its
  // `boardgameimplementation` links miss. It needs BOTH halves: the same designer
  // alone is not a reason to bury a game.
  const round = shelfRound();
  const corpus = shelfCorpus({ designers: ['Uwe R.'], mechanics: ['Worker Placement', 'Farming'] });
  const profile = profileOf(round, corpus);

  // Each pair below differs ONLY in the designer, so the gap is the penalty and
  // nothing else. Comparing across different mechanics instead would measure the
  // MECHANICS term (-0.1 on this fixture) and report a penalty that is not there.
  const SHARED = ['Worker Placement', 'Farming'];
  const APART = ['Roll and Write', 'Trick Taking'];
  const reskin = entry('a', { info: info({ designers: ['Uwe R.'], mechanics: SHARED }) });
  const sameFeel = entry('c', { info: info({ designers: ['Someone Else'], mechanics: SHARED }) });
  assert.equal(delta(profile, sameFeel, reskin), Math.abs(W_NOVELTY_PENALTY));

  // The same designer ALONE is not a reason to bury a game — two games by one
  // designer are just that, which is why the predicate needs both halves.
  const sameHand = entry('b', { info: info({ designers: ['Uwe R.'], mechanics: APART }) });
  const stranger = entry('d', { info: info({ designers: ['Someone Else'], mechanics: APART }) });
  assert.equal(delta(profile, stranger, sameHand), 0, 'the designer alone is not a penalty');
});
