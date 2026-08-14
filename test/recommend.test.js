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

const profileOf = (round, corpus) => {
  const p = buildProfile(round, new Map(corpus.map((e) => [String(e.externalId), e])));
  p.round = round;
  return p;
};

// The score difference between two candidates that differ in exactly one
// attribute. Rounded to kill float noise without hiding a real drift.
const delta = (profile, a, b) =>
  Math.round((scoreCandidate(profile, a).score - scoreCandidate(profile, b).score) * 1e6) / 1e6;

/* -------------------------------- affinities ------------------------------- */

test('a game state outranks its ratings, and the ladder is retired < owned < rated-high < wished', () => {
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
  assert.equal(gameAffinity(round, g('gw', { wish: true })), 1.5);
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
