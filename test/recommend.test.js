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
  buildPlayScale,
  buildShelfIndex,
  representativePlaytime,
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
  W_PLAYS,
  PLAY_SCALE_FLOOR,
  A_RETIRED,
  A_NEUTRAL,
  RATED_FLOOR,
  UNRATED_HALF,
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
  // BOTH bounds, always: the scorer reads the band (`representativePlaytime`),
  // so an override giving only `maxPlaytime` means a 60-to-X game and not the
  // X-minute game it reads as. State the length you mean (#1141).
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

// One term's raw value, which is what a tolerance actually shapes. `delta` cannot
// see a tolerance change on its own: the isolation fixtures put their "wrong"
// candidate far enough out to saturate at 0 under any tolerance, so the gap stays
// the full weight however the curve is retuned (#975 Part C).
const termValue = (profile, candidate, term) =>
  Math.round(scoreCandidate(profile, candidate).terms.find((t) => t.term === term).value * 1e6) / 1e6;

/*
 * What `lib/routes/sessions.js` writes for a direct pick (#778): the game is
 * chosen up front, there is no voting phase, so `votes` stays empty and the
 * session is born `done`. That empty `votes` is the whole defect — `ownRating`
 * finds nothing, so the game lands on the unrated rung no matter how many
 * evenings it saw.
 */
const directPick = (id, gameId, over = {}) => ({
  id,
  gameIds: [gameId],
  memberIds: ['m1', 'm2', 'm3', 'm4'],
  votes: {},
  chosenGameId: gameId,
  chosenAt: '2026-08-19T00:00:00.000Z',
  finished: true,
  done: true,
  cancelled: false,
  ...over,
});

// One mechanic on the played game, another on the rest of the shelf, so the two
// blocks' profile mass can be compared directly.
const playCorpus = () => [
  entry('o1', { info: info({ mechanics: ['Played'] }) }),
  ...Array.from({ length: MIN_PROFILE_GAMES - 1 }, (_, i) => entry(`o${i + 2}`, { info: info({ mechanics: ['Shelf'] }) })),
];

/* -------------------------------- affinities ------------------------------- */

test('a game state outranks its ratings, and the ladder is retired < rated-low < unrated < rated-high', () => {
  const round = {
    members: [],
    sessions: [
      {
        id: 's1',
        gameIds: ['gr', 'ghigh', 'gmid', 'glow'],
        memberIds: ['m1'],
        votes: { m1: { gr: { rating: 5 }, ghigh: { rating: 5 }, gmid: { rating: 3 }, glow: { rating: 1 } } },
      },
    ],
    members2: null,
  };
  round.members = [{ id: 'm1', name: 'A' }];
  const g = (id, over) => ({ id, title: id, ...over });
  // The shelf the prior is read over. It was implicit before #894 — `ownRating`
  // walked the sessions and never asked what else was on the shelf — and is now
  // an input, so the fixture has to state it.
  round.games = [g('gr', { retired: true }), g('ghigh'), g('gmid'), g('glow'), g('gnone')];

  // Nothing in this round was ever put on the table, so the play bonus is zero
  // throughout and each rung shows its bare value. Built by the real helper
  // rather than hand-rolled: `playScale` has no default on purpose (#778), and a
  // literal here would stop exercising the shape the production caller passes.
  const idle = buildPlayScale(round);
  const shelf = buildShelfIndex(round);
  // Every rating here rests on ONE voter, so shrinkage pulls each rung four
  // fifths of the way to the prior — these are no longer the bare ladder
  // values. Since #928 that prior is the fixed `PRIOR_DEFAULT` of 3 rather than
  // anything this fixture's own shelf says, so the numbers below depend only on
  // each game's own votes.
  const aff = (game) => Math.round(gameAffinity(game, idle, shelf) * 100) / 100;

  // A retired game usually carries votes; letting them speak would make "we
  // threw this out" read as an ordinary five-star opinion.
  assert.equal(aff(g('gr', { retired: true })), -1, 'retired -> -1.0, ahead of any rating');
  assert.equal(aff(g('ghigh')), 0.8, 'rated 5 by one voter -> shrunk to 3.4, so 0.6 + 0.2');
  assert.equal(aff(g('gmid')), 0.6, 'rated 3 by one voter -> exactly the prior, so exactly A_NEUTRAL');
  // Since #893 a lone „gar nicht" scores −5; shrinkage lifts it to 1.4, which
  // the #1227 anchor prices at 0.6 + (1.4 - 3) / 2. Negative, because the round
  // said so — and still above `A_RETIRED`, which is the invariant the floor
  // exists for: a game they own and dislike must not outrank-in-reverse one they
  // actually threw out.
  assert.equal(aff(g('glow')), -0.2, 'rated 1 by one voter -> shrunk to 1.4, so 0.6 - 0.8');
  // ONE evening of history, so the rung has already ticked off A_NEUTRAL:
  // 0.6 x 25/26. That it is not 0.6 here is the decay, visible at n = 1.
  assert.equal(aff(g('gnone')), 0.58, 'owned, unrated -> the round\'s effective rung, not the constant');
  // Completed is deliberately NOT a state: the game was played through, so its
  // ratings still count.
  assert.equal(aff(g('ghigh', { completed: true })), 0.8);

  /* #894's own interaction, pinned as a RELATION rather than a row: one neutral
     vote must never rank a game below never having been rated.

     #894 needed a derived floor (`UNRATED_EQUIV`) to guarantee this, because a
     gloomy shelf could drag the prior below what the ladder pays for no verdict
     at all — measured, the inversion started under a prior of 2,0. #928 removed
     both the shelf-relative prior and that floor: `PRIOR_DEFAULT` is 3, which is
     above the break-even by construction, so the floor could never bind again.
     What is asserted is therefore the PROPERTY, which is what mattered — the
     mechanism guaranteeing it changed underneath. */
  // Against the round's EFFECTIVE rung, not the bare constant: since #1227 the
  // rated rung is anchored AT `A_NEUTRAL`, so a neutral vote ties the constant
  // exactly and only beats the rung a round with history actually carries. A
  // spec left pointing at `A_NEUTRAL` would assert 0.6 > 0.6 and fail for the
  // right reading of the wrong number.
  assert.ok(aff(g('gmid')) > shelf.unrated, 'one 😐 vote must beat no vote at all');

  // The RELATION, not the literals (#799): a shelf entry nobody has voted on is
  // a real signal but a weaker one than any game the round has formed an opinion
  // about — and still stronger than a game it actively disliked. Two bare
  // literals would go green on any future re-tune that inverted this.
  const unrated = aff(g('gnone'));
  assert.ok(unrated < aff(g('gmid')), `unrated ${unrated} must rank below rated 3.0`);
  assert.ok(unrated > aff(g('glow')), `unrated ${unrated} must rank above rated 1.0`);
  // And "we got rid of it" outweighs "we own it and never played it".
  assert.ok(Math.abs(aff(g('gr', { retired: true }))) > unrated);

  /*
   * The play bonus is ADDITIVE on top of those rungs, never a rung of its own
   * (#778). Same round, now with a history: the retired game saw five nights and
   * two shelf games three each, so the denominator is 3 — set by the games that
   * can RECEIVE the bonus, which is why five plays of a retired game do not
   * raise it.
   */
  const played = {
    ...round,
    games: [g('gr', { retired: true }), g('ghigh'), g('gnone'), g('gmid')],
    sessions: [
      ...round.sessions,
      ...Array.from({ length: 5 }, (_, i) => directPick(`pr${i}`, 'gr')),
      ...Array.from({ length: 3 }, (_, i) => directPick(`ph${i}`, 'ghigh')),
      ...Array.from({ length: 3 }, (_, i) => directPick(`pn${i}`, 'gnone')),
    ],
  };
  const scale = buildPlayScale(played);
  const playedShelf = buildShelfIndex(played);
  const pAff = (game) => Math.round(gameAffinity(game, scale, playedShelf) * 100) / 100;
  assert.equal(scale.denominator, 3, 'the retired game must not set the scale');

  // The state arm short-circuits BEFORE the bonus is read: twenty nights do not
  // soften "we got rid of it".
  assert.equal(pAff(g('gr', { retired: true })), A_RETIRED, 'retired stays -1.0 however often played');
  // This round's shelf drops `glow`, so only two games carry a score and the
  // round falls below PRIOR_MIN_GAMES — it shrinks toward PRIOR_DEFAULT. That
  // makes `gmid` the cleanest possible illustration of the ramp: a game rated
  // exactly the prior is shrunk to exactly itself, so its rung is untouched.
  assert.equal(pAff(g('ghigh')), 1.8, 'rated 5 at max plays -> 0.8 + the full bonus');
  // Twelve played evenings here, so the rung is 0.6 x 25/37 = 0.41 — the same
  // game is worth less to the profile than in the idle round above, which is
  // the whole of #1227 part 2.
  assert.equal(pAff(g('gnone')), 1.41, 'unrated at max plays -> the faded rung + 1.0');
  assert.equal(pAff(g('gmid')), 0.6, 'rated 3 on a shelf whose prior IS 3 -> exactly A_NEUTRAL');

  // Stated as the composition too, so a future re-tune of either constant keeps
  // a spec that says what the arithmetic IS rather than what it happened to be.
  // The unrated rung is the one #894 leaves untouched — there is no score to
  // shrink — so it still reads as the two constants added.
  assert.equal(pAff(g('gnone')), Math.round((playedShelf.unrated + W_PLAYS) * 100) / 100);
  // The revealed-preference point, and the reason W_PLAYS is set as high as it
  // is: a game the round keeps putting on the table outranks an unplayed shelf
  // entry even when nobody has rated it above the middle of the scale. This is
  // what #894 §0 measured and could NOT preserve by lifting the shrinkage prior
  // instead, which is why W_PLAYS survives that issue (its §0 fallback b).
  assert.ok(pAff(g('gnone')) > pAff(g('gmid')));
});

test('lowering the unrated rung shifts profile mass onto the games the round RATED (#799)', () => {
  /*
   * Three rated-5 games (affinity 2.0) carrying one mechanic, five unrated ones
   * carrying another — the collection-import shape, where the unrated majority
   * used to dominate a profile built mostly of games nobody has said anything
   * about.
   *
   * Asserted as the RATIO of the two components, which the L2 normalisation
   * divides by a common scalar and so cannot move — it states the rung directly,
   * where a bare normalised value also folds in the vector length: 3x2.0 against
   * 5x0.6 is exactly 2:1, where the old 5x1.0 gave 1.2:1 — the unrated block
   * came within a fifth of the rated one despite the round rating nothing else.
   */
  const games = [];
  for (let i = 1; i <= 3; i += 1) games.push({ id: `r${i}`, title: `Rated ${i}`, source: { provider: 'bgg', externalId: `or${i}` } });
  for (let i = 1; i <= 5; i += 1) games.push({ id: `u${i}`, title: `Unrated ${i}`, source: { provider: 'bgg', externalId: `ou${i}` } });
  /* ONE TABLE VOTES, not one person, and that is load-bearing since #928. The
     rung this case is about is what a game rated 5 earns — but the affinity it
     actually reads is SHRUNK, so with a single voter each rated game sits four
     fifths of the way back to the prior and the ratio would be measuring
     `SHRINK_M` rather than the unrated rung. `SHRINK_M` is "roughly one table's worth
     of votes", so four voters is exactly the fixture that lets the rung speak:
     {5,5,5,5} shrinks to 4,0, i.e. affinity 1,5.

     Before #928 this fixture happened to escape the question — the prior was the
     round's own shelf, which held nothing but 5s, so shrinkage was a silent
     no-op and one voter looked like enough. */
  const members = ['m1', 'm2', 'm3', 'm4'];
  const allFive = Object.fromEntries(members.map((m) => [m, {
    r1: { rating: 5 }, r2: { rating: 5 }, r3: { rating: 5 },
  }]));
  const round = shelfRound({
    games,
    sessions: [{ id: 's1', gameIds: ['r1', 'r2', 'r3'], memberIds: members, votes: allFive }],
  });
  const corpus = [
    ...[1, 2, 3].map((i) => entry(`or${i}`, { info: info({ mechanics: ['Rated'] }) })),
    ...[1, 2, 3, 4, 5].map((i) => entry(`ou${i}`, { info: info({ mechanics: ['Unrated'] }) })),
  ];
  const profile = profileOf(round, corpus);
  const ratio = profile.mechanics.Rated / profile.mechanics.Unrated;
  /* {5,5,5,5} shrinks to 4,0, which the #1227 anchor prices at 0,6 + (4 − 3)/2 =
     1,1; the round has one evening behind it, so the unrated rung has already
     ticked to 0,6 × 25/26 = 0,577. That is 3 × 1,1 against 5 × 0,577 — 1,144:1.

     The number to hold it against is what the PRE-#799 rung would give on the
     identical fixture: 3 × 1,1 against 5 × 1,0 is 0,66:1 — the unrated block
     would actually OUTWEIGH the rated one, which is the defect #799 fixed. So
     this literal is on the correct side of 1 and the alternative is on the wrong
     side of it, which is what makes it a test of the rung rather than of the
     fixture. #1227 compressed both rungs (1,5 → 1,1 and 0,6 → 0,577) and left
     that property intact, which is the thing to re-check when either moves. */
  assert.equal(Math.round(ratio * 1e6) / 1e6, 1.144, `rated:unrated mass was ${ratio}:1`);
  // …and the same thing said in the normalised units the cosine actually reads.
  // The pre-#799 rung inverts BOTH of these on this fixture — 0,55 / 0,84 — so
  // neither bound can be satisfied by it.
  assert.ok(profile.mechanics.Rated > 0.7, `rated component ${profile.mechanics.Rated}`);
  assert.ok(profile.mechanics.Unrated < 0.7, `unrated component ${profile.mechanics.Unrated}`);
  assert.ok(profile.mechanics.Rated > profile.mechanics.Unrated, 'the rated block leads');
});

/* ------------------------- the #1227 affinity ladder ------------------------ */

/*
 * The ladder's own arithmetic, measured at the five tiles x five voter counts.
 *
 * A HAND-BUILT ROUND rather than `shelfRound`, because the thing under test is
 * the ladder and nothing else: the game is never chosen, so the play bonus is
 * zero throughout and each cell shows its bare rung.
 */
const unanimous = (tile, voters) => {
  const members = Array.from({ length: voters }, (_, i) => ({ id: `m${i}`, name: `M${i}` }));
  const votes = {};
  members.forEach((m) => { votes[m.id] = { gx: { rating: tile } }; });
  return {
    members,
    games: [{ id: 'gx', title: 'X' }],
    sessions: [{ id: 's1', gameIds: ['gx'], memberIds: members.map((m) => m.id), votes }],
  };
};
const tileAffinity = (tile, voters) => {
  const r = unanimous(tile, voters);
  return Math.round(gameAffinity(r.games[0], buildPlayScale(r), buildShelfIndex(r)) * 100) / 100;
};

test('a verdict below the neutral tile is NEGATIVE once the evidence is in (#1227)', () => {
  /*
   * The defect this issue exists for. `gameAffinity` read `(score - 1) / 2`,
   * which was right while `ownRating` returned the raw mean of 1–5 ratings — 1
   * was unanimous „gar nicht" and therefore affinity 0. #893 moved it to the
   * Spielwirbel-Score over `TILE_VALUE` ([-5, 1, 3, 4, 5]) and the formula
   * stayed, so the zero crossing silently became unanimous „nicht so":
   * `TILE_VALUE[2]` is exactly the 1 being subtracted. Measured on the old
   * anchor, twenty people agreeing they did not enjoy a game left it at +0,17 —
   * still pulling the profile toward games like it.
   *
   * „passt schon" reading +1,00 under BOTH anchors is the coincidence that hid
   * it, which is why this case is written at „nicht so" and not at the tile the
   * two scales happen to agree on.
   */
  assert.equal(tileAffinity(2, 20), -0.23, 'twenty „nicht so" must pull AWAY — it read +0.17');
  assert.equal(tileAffinity(1, 20), -0.5, 'twenty „gar nicht" sit on RATED_FLOOR');
  assert.equal(tileAffinity(3, 20), 0.6, 'twenty „passt schon" land exactly on A_NEUTRAL');
  assert.equal(tileAffinity(4, 20), 1.02, 'twenty „gut"');
  assert.equal(tileAffinity(5, 20), 1.43, 'twenty „begeistert"');
});

test('the neutral tile, the neutral rung and a fresh round are ONE number (#1227)', () => {
  /*
   * `vote-score.js` sets `PRIOR_DEFAULT` precisely so „wir wissen es noch nicht"
   * and „keiner hat was dagegen" are the same number. The old anchor broke that
   * by 67 %: `A_UNRATED` 0,6 corresponded to a score of 2,2 while the neutral
   * VOTE scored 3 and earned +1,00, so „everyone shrugged" outweighed „nobody
   * has an opinion". Asserted in literals, and as the identity rather than as
   * three separate numbers that happen to coincide.
   */
  const fresh = buildShelfIndex({ games: [], sessions: [] });
  assert.equal(A_NEUTRAL, 0.6);
  assert.equal(fresh.unrated, 0.6, 'a round with no history sits exactly on A_NEUTRAL');
  assert.equal(tileAffinity(3, 20), fresh.unrated, 'and a unanimous „passt schon" ties it');
});

test('no rated verdict, at any evidence, ever reaches A_RETIRED (#1227)', () => {
  /*
   * „We got rid of it" must stay the round's sharpest negative — a game they own
   * and dislike sits between that and „no opinion", never below it. `RATED_FLOOR`
   * is what guarantees it; the slope is the dial that would break it (measured:
   * at `/ 1` a unanimous „nicht so" reaches −1,07 and inverts this).
   *
   * Swept rather than spot-checked, because the binding cell is not obvious in
   * advance — it is the lowest tile at the highest evidence, and a future
   * re-tune moves which one that is.
   */
  for (const tile of [1, 2, 3, 4, 5]) {
    for (const voters of [1, 2, 4, 12, 20]) {
      const a = tileAffinity(tile, voters);
      assert.ok(a > A_RETIRED, `tile ${tile} x ${voters} voters read ${a}, at or under A_RETIRED`);
    }
  }
  assert.equal(RATED_FLOOR, -0.5, 'and the floor itself is above A_RETIRED by half a rung');
  assert.ok(RATED_FLOOR > A_RETIRED);
});

test('shrinkage still protects a single bad evening (#1227)', () => {
  /*
   * The property to CHECK rather than assume: re-anchoring the ladder must not
   * turn one person's bad night into the round's verdict. One „gar nicht" reads
   * −0,20 — negative, but well off the floor twenty of them reach — and one
   * „nicht so" stays positive, below the rung a fresh round pays for no opinion
   * at all.
   *
   * A unanimous „nicht so" reaches EXACTLY zero at the sixth voter — shrinkage
   * puts the score on 1,8 there, which the anchor prices at 0,6 − 0,6 — and
   * turns negative at the seventh. (#1227 says "crosses zero at the sixth";
   * measured, six is the zero itself, which is the sharper fact and the one
   * worth pinning: it is where the round stops being merely unenthusiastic.)
   */
  assert.equal(tileAffinity(1, 1), -0.2, 'one „gar nicht" must not reach RATED_FLOOR');
  const oneMeh = tileAffinity(2, 1);
  assert.equal(oneMeh, 0.4);
  assert.ok(oneMeh > 0, 'one „nicht so" is not yet a negative verdict');
  assert.ok(oneMeh < A_NEUTRAL, 'but it already ranks below never having been rated');
  assert.ok(tileAffinity(2, 5) > 0, 'five „nicht so" are still a positive signal');
  assert.equal(tileAffinity(2, 6), 0, 'the sixth lands exactly on zero');
  assert.ok(tileAffinity(2, 7) < 0, 'and the seventh turns the verdict negative');
});

/* ------------------- the unrated rung fades with history -------------------- */

// `n` played evenings, each a direct pick of the same game, so the only thing
// that varies is the session COUNT.
const withSessions = (n, over = {}) => ({
  members: [{ id: 'm1', name: 'A' }],
  games: [{ id: 'g1', title: 'One' }],
  sessions: Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, gameIds: ['g1'], memberIds: ['m1'], votes: {},
    chosenGameId: 'g1', finished: true, done: true, cancelled: false,
  })),
  ...over,
});

test('the unrated rung is A_NEUTRAL at zero sessions and halves at the half-life (#1227)', () => {
  /*
   * THE CURVE IN LITERALS, never in terms of `UNRATED_HALF`
   * (.claude/rules/recommendation-scoring.md §14): written as
   * `A_NEUTRAL * (UNRATED_HALF / (UNRATED_HALF + n))` the assertion holds at
   * every value of the constant and pins nothing at all.
   *
   * 25 evenings is exactly half, 75 exactly a quarter — the two points that say
   * it is a hyperbola with THIS half-life rather than any decaying shape.
   */
  assert.equal(UNRATED_HALF, 25, 'the half-life the literals below are read at');
  assert.equal(buildShelfIndex(withSessions(0)).unrated, 0.6);
  assert.equal(buildShelfIndex(withSessions(25)).unrated, 0.3);
  assert.equal(buildShelfIndex(withSessions(75)).unrated, 0.15);
  // …and monotone in between, which no three points can say on their own.
  let previous = Infinity;
  for (let n = 0; n <= 120; n += 1) {
    const rung = buildShelfIndex(withSessions(n)).unrated;
    assert.ok(rung < previous, `the rung rose at n = ${n}`);
    previous = rung;
  }
});

test('cancelled evenings and split parents do not age the shelf rung (#1227)', () => {
  /*
   * `playedSessionCount`'s two exclusions, in literals so the decay cannot be
   * satisfied by a count that merely LOOKS right. Both are `partyDistribution`'s
   * and both are load-bearing: a cancelled night never happened, and a split
   * parent (#796) is one evening whose children carry the real tables — counting
   * it too would age the rung faster than the round actually plays.
   *
   * Twenty-five real evenings put the rung on exactly half, which is the value
   * every arm below has to reproduce.
   */
  const half = 0.3;
  assert.equal(buildShelfIndex(withSessions(25)).unrated, half);

  const withCancelled = withSessions(25);
  withCancelled.sessions.push(...Array.from({ length: 40 }, (_, i) => ({
    id: `c${i}`, gameIds: ['g1'], memberIds: ['m1'], votes: {}, cancelled: true,
  })));
  assert.equal(buildShelfIndex(withCancelled).unrated, half, '40 cancelled nights are not history');

  const withSplit = withSessions(25);
  withSplit.sessions.push(...Array.from({ length: 40 }, (_, i) => ({
    id: `p${i}`, gameIds: ['g1'], memberIds: ['m1'], votes: {},
    childSessionIds: [`p${i}a`, `p${i}b`], finished: true,
  })));
  assert.equal(buildShelfIndex(withSplit).unrated, half, 'a split parent is counted by its children');
});

test('a round with a history is profiled by what it PLAYS, not by what it owns (#1227)', () => {
  /*
   * Part 2's whole point, asserted as the profile's COMPOSITION rather than as
   * an overlap between two recommendation lists.
   *
   * WHY NOT THE LISTS. The issue's own measurement is a shared-title count in a
   * top-24, and it does not survive being rebuilt: on three independently
   * constructed corpora the old code separated two disjoint histories just as
   * completely as the new one, because a cosine ranking over 600 graded
   * candidates reorders entirely on any tilt at all, however small. So an
   * overlap assertion would have been green against the very code this issue
   * replaces — the .claude/rules/break-the-code-on-purpose.md trap, reached by
   * following the spec. The composition is the claim the issue actually argues
   * from ("47 % shelf share that barely moves"), and it is fixture-stable.
   *
   * Eight games the round plays and rates against thirty-two it merely owns.
   * Under the old constant rung the two blocks FROZE at 0,77 : 0,64 — the shelf
   * keeping a permanent grip on a round that had played 160 evenings.
   */
  const shelf = Array.from({ length: 40 }, (_, i) => ({
    id: `g${i + 1}`, title: `Owned ${i + 1}`, source: { provider: 'bgg', externalId: `o${i + 1}` },
  }));
  const table = ['m1', 'm2', 'm3', 'm4'];
  const corpus = new Map(Array.from({ length: 40 }, (_, i) => {
    const e = entry(`o${i + 1}`, { info: info({ mechanics: [i < 8 ? 'Played' : 'Shelf'] }) });
    return [e.externalId, e];
  }));
  const round = (n) => ({
    id: 'r1', name: 'R', members: table.map((id) => ({ id, name: id })), games: shelf,
    sessions: Array.from({ length: n }, (_, k) => {
      const gid = `g${(k % 8) + 1}`;
      return {
        id: `s${k}`, gameIds: [gid], memberIds: table,
        votes: Object.fromEntries(table.map((m) => [m, { [gid]: { rating: 5 } }])),
        chosenGameId: gid, finished: true, done: true, cancelled: false,
      };
    }),
  });
  const at = (n) => buildProfile(round(n), corpus).mechanics;
  const r2 = (x) => Math.round(x * 100) / 100;

  // A round with NO history is untouched: the shelf is all it knows.
  assert.equal(r2(at(0).Played), 0.24);
  assert.equal(r2(at(0).Shelf), 0.97);
  // By the half-life the games they play have taken the lead…
  assert.ok(at(24).Played > at(24).Shelf, `24 evenings: ${r2(at(24).Played)} vs ${r2(at(24).Shelf)}`);
  // …and it keeps widening, which is the half the old constant could not do.
  assert.ok(at(160).Shelf < at(64).Shelf, 'the shelf must keep receding, not settle');
  assert.ok(r2(at(160).Shelf) < 0.2, `160 evenings still read Shelf ${r2(at(160).Shelf)} — it used to freeze at 0.63`);
});

test('a collection-import round is scored EXACTLY as it was before #1227', () => {
  /*
   * The young-round path is the thing both halves had to leave alone: a round
   * that imported a shelf and has never played is all unrated games, and
   * dropping the rung outright (measured and rejected in the issue) would have
   * collapsed it to no profile at all.
   *
   * Pinned as the literal list the PRE-#1227 code produced on this fixture,
   * captured before the change — scores to the thousandth, which is what the
   * route rounds to. Either half leaking into this case moves them.
   */
  const games = Array.from({ length: 8 }, (_, i) => ({
    id: `g${i + 1}`, title: `Owned ${i + 1}`, source: { provider: 'bgg', externalId: `o${i + 1}` },
  }));
  const corpus = [
    ...Array.from({ length: 8 }, (_, i) => entry(`o${i + 1}`, { info: info({ mechanics: ['M1'] }) })),
    ...Array.from({ length: 20 }, (_, i) => entry(`c${i + 1}`, {
      rank: 100 + i,
      info: info({ mechanics: i % 2 ? ['M1'] : ['M2'], weight: 2 + (i % 4) * 0.5 }),
    })),
  ];
  const out = recommend(
    { id: 'r1', name: 'R', members: [{ id: 'm1', name: 'A' }], games, sessions: [] },
    corpus,
    { limit: 6 },
  );
  assert.deepEqual(out.recommendations.map((r) => [r.externalId, r.score]), [
    ['c3', 0.585], ['c7', 0.585], ['c11', 0.585], ['c15', 0.585], ['c19', 0.585], ['c4', 0.548],
  ]);
});

test('a DIRECT-PICK round is still profiled from its plays (#778 stays served)', () => {
  /*
   * The case the rejected "drop the rung to 0" alternative would have improved
   * and the decay must not break: those evenings write no votes (`votes: {}`),
   * so every game they play most lands on the UNRATED rung — the one #1227 is
   * fading. The plays are additive, so it survives; measured, the played block
   * overtakes the shelf at around the half-life, where it used to freeze
   * permanently BELOW it (0,56 : 0,83 from 24 evenings onward).
   */
  const shelf = Array.from({ length: 40 }, (_, i) => ({
    id: `g${i + 1}`, title: `Owned ${i + 1}`, source: { provider: 'bgg', externalId: `o${i + 1}` },
  }));
  const corpus = new Map(Array.from({ length: 40 }, (_, i) => {
    const e = entry(`o${i + 1}`, { info: info({ mechanics: [i < 8 ? 'Played' : 'Shelf'] }) });
    return [e.externalId, e];
  }));
  const round = (n) => ({
    id: 'r1', name: 'R', members: ['m1', 'm2', 'm3', 'm4'].map((id) => ({ id, name: id })),
    games: shelf,
    sessions: Array.from({ length: n }, (_, k) => directPick(`s${k}`, `g${(k % 8) + 1}`)),
  });
  const at = (n) => buildProfile(round(n), corpus).mechanics;
  assert.ok(at(8).Played > at(0).Played, 'direct picks still reach the profile');
  assert.ok(at(64).Played > at(64).Shelf, `64 direct-pick evenings: ${at(64).Played} vs ${at(64).Shelf}`);
  assert.ok(at(160).Played > at(64).Played, 'and the play signal keeps growing');
});

/* ---------------------------------- plays ---------------------------------- */

test('a history of DIRECT PICKS shapes the profile — it used to leave no trace at all (#778)', () => {
  /*
   * The free Route-1 red (.claude/rules/break-the-code-on-purpose.md): before
   * this change the two profiles below were identical in every taste term, so
   * a round that runs its evenings by direct pick — the mode for groups who
   * already know what they want to play — had a completely flat profile.
   *
   * Asserted on the taste terms ONLY, never as a deepEqual over the profile:
   * `partyDistribution` already counted these evenings (16% of the score), so a
   * whole-object comparison would have gone green today for a reason that has
   * nothing to do with plays.
   */
  const played = shelfRound({ sessions: [1, 2, 3].map((i) => directPick(`s${i}`, 'g1')) });
  const corpus = playCorpus();

  const withPlays = profileOf(played, corpus);
  const without = profileOf(shelfRound(), corpus);
  assert.ok(
    withPlays.mechanics.Played > without.mechanics.Played,
    `direct picks must move the profile: ${withPlays.mechanics.Played} vs ${without.mechanics.Played}`,
  );
});

test('plays move the profile mass by the exact ratio the bonus implies (#778)', () => {
  /*
   * The ratio, not the normalised value: L2 divides both components by a common
   * scalar and so cannot move it, where a bare component also folds in the
   * vector length.
   *
   * Three played evenings, so since #1227 the unrated rung has faded to
   * 0,6 × 25/28 = 0,5357. The played game reaches that plus the full bonus —
   * 1,5357 — against seven unplayed shelfmates at 0,5357 each, i.e. 3,75. The
   * bonus is unchanged; what moved is the rung both sides are measured in, and
   * the ratio RISES (0,381 → 0,410) because the denominator faded while the
   * numerator kept its 1,0.
   */
  const played = shelfRound({ sessions: [1, 2, 3].map((i) => directPick(`s${i}`, 'g1')) });
  const profile = profileOf(played, playCorpus());
  const ratio = profile.mechanics.Played / profile.mechanics.Shelf;
  assert.equal(Math.round(ratio * 1e6) / 1e6, 0.409524, `played:shelf mass was ${ratio}`);
});

test('plays pull the complexity and time targets toward what the round actually plays (#778)', () => {
  // A heavy, long game played every week against seven light, short shelf
  // entries. `weightedMean` reads the same affinity the vectors do, so the
  // targets have to follow the bonus.
  const sessions = [1, 2, 3].map((i) => directPick(`s${i}`, 'g1'));
  const corpus = [
    entry('o1', { info: info({ weight: 4.5, minPlaytime: 180, maxPlaytime: 180 }) }),
    ...Array.from({ length: MIN_PROFILE_GAMES - 1 }, (_, i) => entry(`o${i + 2}`, { info: info({ weight: 2, minPlaytime: 30, maxPlaytime: 30 }) })),
  ];
  const idle = profileOf(shelfRound(), corpus);
  const played = profileOf(shelfRound({ sessions }), corpus);
  assert.ok(played.targetWeight > idle.targetWeight, `targetWeight ${played.targetWeight} vs ${idle.targetWeight}`);
  assert.ok(played.targetTime > idle.targetTime, `targetTime ${played.targetTime} vs ${idle.targetTime}`);
});

test('a single evening is not a favourite — the play scale has a floor (#778)', () => {
  /*
   * Purely relative, a round whose entire history is ONE night would hand that
   * game the maximum play signal available. `PLAY_SCALE_FLOOR` is the answer:
   * one play out of a denominator of three is a third of the bonus, so the
   * signal grows with the evidence instead of maxing out on the first evening.
   */
  const round = shelfRound({ sessions: [directPick('s1', 'g1')] });
  const scale = buildPlayScale(round);
  assert.equal(scale.denominator, PLAY_SCALE_FLOOR, 'one play must not set the denominator to 1');
  const shelf1 = buildShelfIndex(round);
  assert.equal(gameAffinity(round.games[0], scale, shelf1), shelf1.unrated + W_PLAYS / PLAY_SCALE_FLOOR);
});

test('a RETIRED game does not set the play denominator, however often it was played (#778)', () => {
  /*
   * The maximum is taken over games that can RECEIVE the bonus. A retired game
   * short-circuits to -1.0 and gets none, so letting one they threw out set the
   * denominator would shrink every other game's bonus toward nothing — the
   * naive `Math.max(...counts.values())` reddens exactly here.
   */
  const games = [
    { id: 'gold', title: 'Thrown out', retired: true, source: { provider: 'bgg', externalId: 'oold' } },
    ...shelfRound().games,
  ];
  const round = shelfRound({
    games,
    sessions: [
      ...Array.from({ length: 20 }, (_, i) => directPick(`old${i}`, 'gold')),
      ...[1, 2, 3].map((i) => directPick(`s${i}`, 'g1')),
    ],
  });
  const scale = buildPlayScale(round);
  assert.equal(scale.denominator, 3, 'the retired game must not set the scale');
  const shelf20 = buildShelfIndex(round);
  assert.equal(gameAffinity(round.games[1], scale, shelf20), shelf20.unrated + W_PLAYS, 'g1 still earns the full bonus');
  assert.equal(gameAffinity(round.games[0], scale, shelf20), A_RETIRED, 'and 20 plays do not soften the retirement');
});

test('a WISHED game does not set the play denominator either (#778)', () => {
  /*
   * NOT a dead branch, though it looks like one after #776 — plays are history
   * and the wish flag is current. `POST …/games/:gid/wish { wish: true }` moves
   * an owned game the round has played for years back onto the Wunschliste (the
   * UI only ever sends `wish: false`, but "the other direction comes free"), and
   * from then on it never reaches `gameAffinity` at all. Letting its plays set
   * the denominator would shrink every remaining game's bonus with no signal
   * behind it.
   */
  const games = [
    { id: 'gsold', title: 'Sold, want again', wish: true, source: { provider: 'bgg', externalId: 'osold' } },
    ...shelfRound().games,
  ];
  const round = shelfRound({
    games,
    sessions: [
      ...Array.from({ length: 12 }, (_, i) => directPick(`w${i}`, 'gsold')),
      ...[1, 2, 3].map((i) => directPick(`s${i}`, 'g1')),
    ],
  });
  assert.equal(buildPlayScale(round).denominator, 3);
});

test('a cancelled evening and a deleted game contribute no plays (#778)', () => {
  /*
   * Two different mechanisms, both worth pinning. A cancelled session is
   * dropped by `playCounts`, matching `partyDistribution` — and a session whose
   * `chosenGameId` names a game the round has since deleted can never be read,
   * because the denominator loop walks `round.games` rather than the counts.
   * Both breaks show up as a collapsed denominator rather than as an error.
   */
  const round = shelfRound({
    sessions: [
      ...Array.from({ length: 15 }, (_, i) => directPick(`c${i}`, 'g2', { cancelled: true })),
      ...Array.from({ length: 30 }, (_, i) => directPick(`d${i}`, 'ggone')),
      ...[1, 2, 3].map((i) => directPick(`s${i}`, 'g1')),
    ],
  });
  const scale = buildPlayScale(round);
  assert.equal(scale.denominator, 3, 'neither a cancelled evening nor a deleted game may set the scale');
  assert.equal(scale.counts.get('g2') || 0, 0, 'a cancelled evening is not a play');
  const shelfC = buildShelfIndex(round);
  assert.equal(gameAffinity(round.games[1], scale, shelfC), shelfC.unrated, 'g2 saw 15 cancelled nights and earns nothing');
});

test('a DRAWN winner counts as a play exactly like a direct pick (#778)', () => {
  // Both start modes write `chosenGameId`, and they count the same on purpose:
  // the defect is that direct picks counted ZERO, not that they should outrank
  // a drawn win — and a drawn winner also carries the ratings a direct pick
  // never gets, so it is already ahead on the ladder.
  const drawn = {
    id: 'sd',
    gameIds: ['g1', 'g2', 'g3'],
    memberIds: ['m1'],
    votes: { m1: { g1: { rating: 4 } } },
    chosenGameId: 'g1',
    finished: true,
  };
  const round = shelfRound({ sessions: [drawn] });
  assert.equal(buildPlayScale(round).counts.get('g1'), 1);
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
  // Rounded, not pinned: the weighted mean over eight games at affinity 0.6 lands
  // on 3.0000000000000004, and the term below reads it through the same `delta`
  // rounding anyway. The claim is "the target IS the shelf's own weight".
  assert.equal(Math.round(profile.targetWeight * 1e6) / 1e6, 3);
  const centre = entry('x', { info: info({ weight: 3 }) });
  const heavy = entry('y', { info: info({ weight: 4.2 }) }); // saturated: twice the tolerance out
  const light = entry('z', { info: info({ weight: 1.8 }) });
  assert.equal(delta(profile, centre, heavy), W_COMPLEXITY);
  assert.equal(delta(profile, centre, light), W_COMPLEXITY);
  assert.equal(delta(profile, heavy, light), 0, 'the same distance either side');
});

test('COMPLEXITY pays nothing 0.6 from the target, and exactly NEUTRAL at half of that', () => {
  const profile = profileOf(shelfRound(), shelfCorpus());
  assert.equal(Math.round(profile.targetWeight * 1e6) / 1e6, 3);
  const at = (weight) => termValue(profile, entry('x', { info: info({ weight }) }), 'complexity');

  // LITERALS, never WEIGHT_TOLERANCE: a curve test written in terms of the
  // constant it guards holds at every value of that constant, which is the
  // vacuous shape .claude/rules/break-the-code-on-purpose.md is about. These
  // numbers are what 0.6 means, and they are wrong for 1.2 (which pays 0.75 at
  // 3.3 and still pays 0.5 at 3.6).
  assert.equal(at(3), 1, 'the target itself');
  assert.equal(at(3.3), NEUTRAL, 'half the tolerance out is worth exactly an undocumented game');
  assert.equal(at(2.7), NEUTRAL, 'and symmetrically on the light side');
  assert.equal(at(3.6), 0, 'the full tolerance out pays nothing');
  assert.equal(at(2.4), 0);

  // NEUTRAL is also the reason gate, so this is the width of the band a
  // complexity line may be spoken from: ±0.3, not ±0.6.
  assert.ok(at(3.29) > NEUTRAL, 'just inside the gate');
  assert.ok(at(3.31) < NEUTRAL, 'just outside it');
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
  // A retired game contributes affinity -1.0, so the profile vector can hold
  // negative components — and a candidate can always avoid one by carrying a
  // mechanic the round has never met, which scores 0. So the best a k-mechanic
  // candidate can do is the k largest NON-NEGATIVE components; counting a
  // negative one into the ceiling lowers it, and everything above it clamps.
  const round = shelfRound();
  round.games.push({ id: 'gr', title: 'Retired', retired: true, source: { provider: 'bgg', externalId: 'orx' } });
  const corpus = [...shelfCorpus({ mechanics: ['Loved'] }), entry('orx', { info: info({ mechanics: ['Hated'] }) })];
  const profile = profileOf(round, corpus);
  // The rung reaches the VECTOR, not just the ladder (#799): a mechanic only the
  // retired game carries ends up negative, which is how "we threw this out"
  // influences anything at all.
  assert.ok(profile.mechanics.Hated < 0, `retired-only mechanic scored ${profile.mechanics.Hated}`);
  assert.ok(profile.mechanics.Loved > 0);
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
        minPlaytime: 30 + (i % 6) * 30,
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
        minPlaytime: 60,
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
  const fits = entry('x', { info: info({ minPlaytime: 60, maxPlaytime: 60 }) });
  const marathon = entry('y', { info: info({ minPlaytime: 120, maxPlaytime: 120 }) });
  assert.equal(delta(profile, fits, marathon), W_TIME);
});

test('TIME\'s window is a SHARE of the shelf, so it scales instead of costing the same everywhere', () => {
  const shelfAt = (minutes) =>
    profileOf(shelfRound(), shelfCorpus({ minPlaytime: minutes, maxPlaytime: minutes }));
  const short = shelfAt(40);
  const long = shelfAt(120);
  assert.equal(Math.round(short.targetTime * 1e6) / 1e6, 40);
  assert.equal(Math.round(long.targetTime * 1e6) / 1e6, 120);
  const at = (profile, minutes) =>
    termValue(profile, entry('x', { info: info({ minPlaytime: minutes, maxPlaytime: minutes }) }), 'time');

  assert.equal(at(short, 40), 1, 'each shelf still peaks at its own target');
  assert.equal(at(long, 120), 1);

  // THE ASSERTION NO FIXED TOLERANCE CAN SATISFY, at any value it could be given:
  // half credit is reached 10 minutes out on the 40-minute shelf and 30 minutes
  // out on the 120-minute one. A constant would have to be 20 and 60 at once.
  // This is the whole point of the change — a narrowed fixed constant passes
  // every other assertion in this test.
  assert.equal(at(short, 50), NEUTRAL);
  assert.equal(at(long, 150), NEUTRAL);

  // And the zero points, which are that same claim at the edge of the window.
  assert.equal(at(short, 60), 0, 'a 60-minute game says nothing to a filler shelf');
  assert.equal(at(long, 180), 0);
  // The same candidate, read by two rounds: 70 minutes is off the 40-minute
  // shelf's scale entirely and still earns credit on the 120-minute one.
  assert.equal(at(short, 70), 0);
  assert.ok(at(long, 70) > 0);
});

test('a game\'s length is ONE number: the midpoint, unless the band is a campaign', () => {
  const cases = [
    [60, 120, 90, 'an ordinary band is its midpoint'],
    [60, 60, 60, 'a degenerate band is unchanged'],
    [20, 600, 20, 'ratio 30 is a campaign, not a range — the single sitting'],
    [30, 300, 165, 'ratio 10 is NOT past the threshold, so it is still a midpoint'],
    [30, 301, 30, 'one minute past 10x flips it'],
    [null, 90, 90, 'whichever bound exists'],
    [45, null, 45, 'ditto, from the other side'],
    [null, null, null, 'no claim at all'],
  ];
  for (const [min, max, want, why] of cases) {
    assert.equal(representativePlaytime({ minPlaytime: min, maxPlaytime: max }), want, why);
  }
  // `toPositiveInt()` in lib/providers/bgg.js normalises BGG's "0 = no data" to
  // null, so the ratio can never divide by zero — asserted rather than assumed.
  assert.equal(representativePlaytime({ minPlaytime: 0, maxPlaytime: 90 }), 90, 'a 0 bound is no bound');
  assert.equal(representativePlaytime({}), null);
  assert.equal(representativePlaytime({ minPlaytime: 'x', maxPlaytime: '90' }), null);
});

test('the scorer, the shelf target and the reason line all read the SAME figure', () => {
  // The shelf sits at 60 minutes flat, and the candidate's band 30-90 has its
  // midpoint exactly on it while its maximum is 30 minutes away. So a scorer
  // still reading `maxPlaytime` cannot reach a perfect time term...
  const profile = profileOf(shelfRound(), shelfCorpus());
  assert.equal(profile.targetTime, 60);
  const cand = entry('cand', { info: info({ minPlaytime: 30, maxPlaytime: 90 }) });
  assert.equal(termValue(profile, cand, 'time'), 1, 'scored on the midpoint, which IS the target');

  // ...and the reason line must name the figure it was scored on, not the bound.
  // Wiring two of the three sites and leaving this one is the miss a spec that
  // only checks the score cannot see (#1141).
  const reason = scoreCandidate(profile, cand).terms.find((t) => t.term === 'time');
  assert.equal(reason.minutes, representativePlaytime(cand.info));
  assert.equal(reason.minutes, 60);
});

test('the shelf TARGET is the mean of those figures, so a wide band no longer inflates it', () => {
  // Every shelf game runs 30-90: a target read off `maxPlaytime` would be 90.
  const profile = profileOf(shelfRound(), shelfCorpus({ minPlaytime: 30, maxPlaytime: 90 }));
  assert.equal(profile.targetTime, 60);
  // And a campaign on the shelf contributes the sitting, not the arc: seven of
  // the eight shelf games at 60 flat plus one 20-600 is (7*60 + 20) / 8 = 55,
  // where reading the bound would have dragged it UP to 127.5.
  const corpus = shelfCorpus();
  corpus[0].info = info({ minPlaytime: 20, maxPlaytime: 600 });
  const withCampaign = profileOf(shelfRound(), corpus);
  assert.equal(withCampaign.targetTime, 55, 'a campaign pulls the target DOWN, not up');
});

test('an UNKNOWN attribute scores neutral, not zero', () => {
  const profile = profileOf(shelfRound(), shelfCorpus());
  // A row BGG knows nothing about beyond its rank must not be buried under a row
  // that is a documented bad match; it has simply made no claim.
  const silent = entry('x', { info: info({ weight: null, minPlaytime: null, maxPlaytime: null }) });
  const wrong = entry('y', { info: info({ weight: 4.2, minPlaytime: 120, maxPlaytime: 120 }) });
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

/*
 * The FOURTH hard filter (#900): a reimplementation of something the round
 * already owns.
 *
 * Every case below records the `boardgameimplementation` link on ONE side only.
 * BGG usually writes it on both items, and a fixture that does the same passes
 * against a one-directional implementation — which is exactly how the bug behind
 * .claude/rules/recommendation-scoring.md §3 was found. The two directions read
 * two different sets, so they get two tests.
 */
test('a candidate NAMING an owned game as its predecessor is filtered out, not merely penalised', () => {
  const round = shelfRound();
  const corpus = shelfCorpus();
  // The owned row itself names nothing — only the candidate carries the link.
  corpus[0].name = 'Owned classic';
  // Outscores everything on quality alone, so it can only be missing because it
  // was filtered, never because it lost.
  const reprint = entry('reprint', { rank: 1, bayesRating: 9.5, info: info({ implementations: ['Owned classic'] }) });
  const fresh = entry('fresh', { rank: 2, info: info() });
  const out = recommend(round, [...corpus, reprint, fresh]);
  assert.deepEqual(out.recommendations.map((r) => r.externalId), ['fresh']);
});

test('a candidate an OWNED row names as a reimplementation is filtered out too', () => {
  const round = shelfRound();
  const corpus = shelfCorpus();
  // The reverse direction, and the candidate carries no link of its own: this is
  // the common older-edition case — they own the classic, the candidate is the
  // reprint, and BGG recorded it on the classic only.
  corpus[0].info.implementations = ['Game reimpl'];
  const reimpl = entry('reimpl', { rank: 1, bayesRating: 9.5, info: info() });
  const fresh = entry('fresh', { rank: 2, info: info() });
  const out = recommend(round, [...corpus, reimpl, fresh]);
  assert.deepEqual(out.recommendations.map((r) => r.externalId), ['fresh']);
});

test('a RETIRED game\'s reimplementation is filtered too', () => {
  // The sharpest of the states: they explicitly got rid of it, so recommending
  // the reprint back is the same defect as recommending the game itself.
  const round = shelfRound();
  round.games.push({ id: 'gr', title: 'Thrown out', retired: true, source: { provider: 'bgg', externalId: 'x-retired' } });
  const corpus = [...shelfCorpus(), entry('x-retired', { name: 'Retired classic', info: info() })];
  const reprint = entry('reprint', { rank: 1, bayesRating: 9.5, info: info({ implementations: ['Retired classic'] }) });
  const fresh = entry('fresh', { rank: 2, info: info() });
  const out = recommend(round, [...corpus, reprint, fresh]);
  assert.deepEqual(out.recommendations.map((r) => r.externalId), ['fresh']);
});

test('a candidate reimplementing a WISHED game is still recommended, and still scores no penalty', () => {
  const round = shelfRound();
  round.games.push(wishGame());
  const corpus = [...shelfCorpus(), wishRow()];
  // A reimplementation of something on the WUNSCHLISTE is not "you already own
  // this in different clothes" — it is a second route to a game they still want.
  // The filter inherits the wish exclusion for free: `ownedNames` and
  // `implementations` are built from the profiled (owned, non-wish) rows only.
  const reprint = entry('reprint', { rank: 1, info: info({ implementations: ['Wished classic'] }) });
  const out = recommend(round, [...corpus, reprint]);
  assert.deepEqual(out.recommendations.map((r) => r.externalId), ['reprint']);

  // And the soft penalty is not standing in for the filter either.
  const profile = profileOf(round, corpus);
  assert.equal(delta(profile, entry('d', { info: info() }), reprint), 0);
});

test('a candidate SHARING a predecessor with an owned game is filtered too', () => {
  // The third clause of the link check, and the one with no test before #900: the
  // candidate names neither an owned game nor is named by one — both simply point
  // at the same third title, which is BGG's shape for two editions of one family.
  // It was inherited verbatim from the penalty, and promoting that penalty to a
  // hard drop is exactly what makes an untested clause worth pinning.
  const round = shelfRound();
  const corpus = shelfCorpus();
  corpus[0].info.implementations = ['Shared ancestor'];
  const sibling = entry('sibling', { rank: 1, bayesRating: 9.5, info: info({ implementations: ['Shared ancestor'] }) });
  const fresh = entry('fresh', { rank: 2, info: info() });
  const out = recommend(round, [...corpus, sibling, fresh]);
  assert.deepEqual(out.recommendations.map((r) => r.externalId), ['fresh']);
});

/*
 * The within-list dedupe (#900), which is the other half: nothing compared
 * candidates against EACH OTHER, so a round whose taste points at a family of
 * reimplemented classics got several editions of one game in one list.
 *
 * Both fixtures keep the duplicate well INSIDE the limit. One ranked past the
 * cutoff would be absent anyway and the case would pass against a build that
 * does no deduping at all.
 */
test('two candidates linked to each other appear once, and the higher-scoring one survives', () => {
  const round = shelfRound();
  const corpus = shelfCorpus();

  // The loser names the survivor…
  const strong = entry('strong', { rank: 1, bayesRating: 8.5, info: info() });
  const weak = entry('weak', { rank: 2, bayesRating: 5.5, info: info({ implementations: ['Game strong'] }) });
  assert.deepEqual(
    recommend(round, [...corpus, strong, weak]).recommendations.map((r) => r.externalId),
    ['strong'],
  );

  // …and the other way round: the survivor names the loser.
  const namer = entry('namer', { rank: 1, bayesRating: 8.5, info: info({ implementations: ['Game named'] }) });
  const named = entry('named', { rank: 2, bayesRating: 5.5, info: info() });
  assert.deepEqual(
    recommend(round, [...corpus, namer, named]).recommendations.map((r) => r.externalId),
    ['namer'],
  );
});

test('neither reimplementation filter SHORTENS the list while the pool can still fill it', () => {
  const round = shelfRound();
  const corpus = shelfCorpus();
  corpus[0].name = 'Owned classic';
  const candidates = [
    entry('c1', { rank: 1, bayesRating: 9.0, info: info() }),
    // Dropped by the shelf filter, and ranked high enough that a list which
    // merely sliced first would come back one short.
    entry('c2', { rank: 2, bayesRating: 8.8, info: info({ implementations: ['Owned classic'] }) }),
    entry('c3', { rank: 3, bayesRating: 8.6, info: info() }),
    // Dropped by the dedupe, against c3 above it.
    entry('c4', { rank: 4, bayesRating: 8.4, info: info({ implementations: ['Game c3'] }) }),
    entry('c5', { rank: 5, bayesRating: 8.2, info: info() }),
  ];
  const out = recommend(round, [...corpus, ...candidates], { limit: 3 });
  assert.deepEqual(out.recommendations.map((r) => r.externalId), ['c1', 'c3', 'c5']);
});

test('a filtered candidate does not shift the per-term statistics behind the reason lines', () => {
  // The filter sits with the other three, BEFORE `scoreCandidate`, so a row that
  // can never be shown must not feed the z-scores that order the reasons of the
  // rows that are. Asserted as an equivalence: a filtered row is as if it were
  // not in the corpus at all.
  const round = shelfRound();
  const corpus = shelfCorpus();
  corpus[0].name = 'Owned classic';
  const keeper = entry('keeper', { rank: 1, bayesRating: 7.4, info: info() });
  const filler = entry('filler', { rank: 2, bayesRating: 6.0, info: info({ weight: 4.5 }) });

  const clean = recommend(round, [...corpus, keeper, filler]);
  // Ten reprints of the owned classic, every one of them a quality outlier: if
  // they reached `observeTerms` the quality mean would jump and the keeper's
  // quality z would collapse below its other terms, reordering its reasons.
  const noisy = recommend(round, [
    ...corpus,
    keeper,
    filler,
    ...Array.from({ length: 10 }, (_, i) =>
      entry(`reprint${i}`, { rank: 100 + i, bayesRating: 9.9, info: info({ implementations: ['Owned classic'] }) })),
  ]);

  assert.deepEqual(noisy.recommendations.map((r) => r.externalId), ['keeper', 'filler']);
  assert.deepEqual(noisy.recommendations[0].reasons, clean.recommendations[0].reasons);
});

test('a dismissed title is a THIRD hard filter — gone from the list, absent from the profile (#782)', () => {
  const round = shelfRound({ dismissedRecommendations: [{ externalId: 'nope', title: 'Not for us', at: '2026-08-20T10:00:00.000Z' }] });
  const corpus = [...shelfCorpus(), entry('nope', { bayesRating: 9.5, info: info() }), entry('free', { info: info() })];

  const out = recommend(round, corpus);
  // 'nope' outscores everything on quality alone, so it can only be missing
  // because it was filtered — not because it lost.
  assert.deepEqual(out.recommendations.map((r) => r.externalId), ['free']);

  // A dismissal is NOT an owned game and must not act like one: the profile
  // counts are what §6's empty states are picked from, so a dismissal leaking
  // into them would send a round to the wrong screen.
  const clean = recommend(shelfRound(), corpus);
  assert.equal(out.profileGames, clean.profileGames);
  assert.equal(out.linkedGames, clean.linkedGames);
  // …and the whole corpus is still reported, exactly like the un-enriched filter.
  assert.equal(out.corpusRows, corpus.length);

  // The list rides along on the answer so the screen can offer the undo without
  // a second read.
  assert.deepEqual(out.dismissed, round.dismissedRecommendations);
});

test('the dismissed list is reported even when the profile is too thin to score (#782)', () => {
  // A round below the floor returns early — but the reader must still be able to
  // find and restore what they ignored, so the list cannot ride behind that gate.
  const thin = { id: 'r1', name: 'R', members: [], games: [], sessions: [], dismissedRecommendations: [{ externalId: '1', title: 'X', at: '2026-08-20T10:00:00.000Z' }] };
  const out = recommend(thin, shelfCorpus());
  assert.deepEqual(out.recommendations, []);
  assert.deepEqual(out.dismissed, thin.dismissedRecommendations);
});

test('a round that has never dismissed anything reports an empty list, not undefined (#782)', () => {
  assert.deepEqual(recommend(shelfRound(), shelfCorpus()).dismissed, []);
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

test('the complexity and time reasons carry the ROUND\'s number alongside the candidate\'s (#975)', () => {
  const round = shelfRound();
  // Everything but complexity and time is pushed under the gate on purpose, so
  // both survive the three-line slice: bottom-of-the-band rating, foreign
  // mechanics and categories, and a poll with nothing to say.
  const cand = entry('cand', {
    bayesRating: 5.5,
    info: info({ weight: 2.8, minPlaytime: 50, maxPlaytime: 50, mechanics: ['ZZ'], categories: ['ZZ'], bestWith: [], recommendedWith: [] }),
  });
  const [rec] = recommend(round, [...shelfCorpus(), cand]).recommendations;

  // The shelf sits at 3.0 / 60 min and the candidate at 2.8 / 50, so a `target`
  // wired to the candidate's own value — the copy-paste this shape invites —
  // cannot pass. The pre-#975 payload had no `target` at all, and the line read
  // „Gewicht 2,8" with an unjudgeable claim attached.
  assert.deepEqual(rec.reasons.find((r) => r.term === 'complexity'), { term: 'complexity', weight: 2.8, target: 3 });
  assert.deepEqual(rec.reasons.find((r) => r.term === 'time'), { term: 'time', minutes: 50, target: 60 });
});

test('the time reason ROUNDS its minutes — a midpoint can be a half (#1141)', () => {
  const round = shelfRound();
  // A 45-70 band: its midpoint is 57.5, which is what the term is scored on and
  // what „Rund 57.5 Minuten" would have said — with a decimal point `t()` does
  // not localise, in a sentence whose „Rund" promises a round number.
  const cand = entry('cand', {
    bayesRating: 5.5,
    info: info({ weight: 3, minPlaytime: 45, maxPlaytime: 70, mechanics: ['ZZ'], categories: ['ZZ'], bestWith: [], recommendedWith: [] }),
  });
  const corpus = [...shelfCorpus(), cand];
  assert.equal(representativePlaytime(cand.info), 57.5, 'the fixture must actually land on a half');

  const profile = profileOf(round, corpus);
  const term = scoreCandidate(profile, cand).terms.find((t) => t.term === 'time');
  assert.equal(term.minutes, 57.5, 'the SCORER keeps the exact figure');

  const [rec] = recommend(round, corpus).recommendations;
  assert.deepEqual(rec.reasons.find((r) => r.term === 'time'), { term: 'time', minutes: 58, target: 60 });
});

/* ------------------------------- wished games ------------------------------ */
/*
 * A wish is a want, not a statement about what the group likes to PLAY (#776).
 * It used to sit at the TOP of the affinity ladder (1.5, above every rated
 * game), so the list a round saw was steered hardest by games it does not own —
 * on a screen whose entire premise is "games you do not own".
 *
 * The cases below are one behaviour seen from several sides, because this file
 * fails by ranking: the profile, the reason lines and the counts are all derived
 * from the same list, and a wish leaking back into any of them produces a
 * plausible wrong list rather than an error. The novelty side moved up to the
 * reimplementation-filter block (#900), where the wish exclusion now has to hold
 * against a FILTER rather than a 3% penalty.
 */

// One wished game the shelf resembles in NOTHING — a foreign mechanic, a foreign
// category, twice the complexity and four times the length. Any leak into the
// profile moves all four at once.
const WISH_ID = 'x-wish';
const wishGame = () => ({ id: 'gw', title: 'Wished', wish: true, source: { provider: 'bgg', externalId: WISH_ID } });
const wishRow = (over = {}) =>
  entry(WISH_ID, {
    name: 'Wished classic',
    info: info({ mechanics: ['M-wish'], categories: ['C-wish'], weight: 5, minPlaytime: 240, maxPlaytime: 240, ...over }),
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
  const candidate = entry('c', { info: info({ mechanics: ['M-wish'], categories: ['C-wish'], weight: 5, minPlaytime: 240, maxPlaytime: 240 }) });
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
  // The shelf is RATED, and that is a re-measure rather than scenery (#799).
  // At the -1.0 retired rung a candidate carrying M1 plus the two mechanics only
  // the discarded game has no longer clears the `> NEUTRAL` gate off an unrated
  // shelf — correctly, but it would make this case pass for the wrong reason,
  // exactly like the missing shared M1 the comment below warns about.
  const round = shelfRound({
    sessions: [{
      id: 's1',
      gameIds: Array.from({ length: MIN_PROFILE_GAMES }, (_, i) => `g${i + 1}`),
      memberIds: ['m1'],
      votes: { m1: Object.fromEntries(Array.from({ length: MIN_PROFILE_GAMES }, (_, i) => [`g${i + 1}`, { rating: 5 }])) },
    }],
  });
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
  /*
   * Owned 1 is rated AND played, for the same reason as the sibling above
   * (#799): M-x is carried by exactly two games — Owned 1 and the retired one at
   * −1.0 — so unless Owned 1 clears that, the component is NEGATIVE, no mechanics
   * reason fires at all, and the case stops testing the filter it is named for.
   *
   * One voter used to be enough; since #1227 it is not. A lone „begeistert"
   * shrinks to 3,4 and the re-anchored rung prices that at 0,8, which loses to
   * −1,0. A full table (shrunk to 4,0 → 1,1) plus the play bonus puts it at 2,1,
   * which is a margin rather than a coin-flip — and the fixture now says out
   * loud that it depends on one.
   */
  const table = ['m1', 'm2', 'm3', 'm4'];
  const round = shelfRound({
    sessions: [
      {
        id: 's1',
        gameIds: ['g1'],
        memberIds: table,
        votes: Object.fromEntries(table.map((m) => [m, { g1: { rating: 5 } }])),
      },
      ...[1, 2, 3].map((i) => directPick(`p${i}`, 'g1')),
    ],
  });
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
// g1 sits at affinity 0.5 and g2 at 2.0 — the two rungs both tests below are
// written around. Since #893 that takes TWO voters on g1: the Spielwirbel-Score
// curve is worth 1 at the 2-tile, so a lone 2 would score 1.0 -> affinity 0.0,
// and a zero-affinity game contributes nothing at all rather than contributing
// weakly, which would leave these tests with a single contributor and nothing
// to order. `{2, 3}` scores (1 + 3) / 2 = 2.0, i.e. exactly the old rung.
/*
 * Two rated games with a WIDE affinity gap, which is what both reason-ordering
 * tests below need in order to demonstrate anything.
 *
 * All four members vote, deliberately: since #894 a verdict is shrunk toward the
 * round's prior in proportion to how thin it is, so a one-voter fixture
 * compresses the very gap these tests exist to exercise (measured: the two games
 * landed 0,83 and 1,20 apart, at which the product ordering in the second test
 * no longer inverts and it passed for the wrong reason). Four votes is
 * `SHRINK_M`, so each game keeps half its own say.
 */
const ratedPairRound = () => shelfRound({
  sessions: [{
    id: 's1',
    gameIds: ['g1', 'g2'],
    memberIds: ['m1', 'm2', 'm3', 'm4'],
    votes: Object.fromEntries(
      ['m1', 'm2', 'm3', 'm4'].map((m) => [m, { g1: { rating: 2 }, g2: { rating: 5 } }])
    ),
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
  // pre-fix code fell back to shelf order. Owned 2 is rated 5 by everyone
  // (shrunk to 4,0 -> affinity 1.5), Owned 1 rated 2 (shrunk to 2,0 -> 0.5).
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
  // shares one and is rated 5 -> 1 x 1.5 = 1.5. So the ranking is the PRODUCT,
  // not `shared` with affinity as a tie-break — under a tie-break the shared
  // count would decide first and Owned 1 would still lead.
  assert.deepEqual(mechanics.games, ['Owned 2', 'Owned 1']);
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
    entry('cand', { bayesRating: 5.5, info: info({ weight: 4.9, minPlaytime: 400, maxPlaytime: 400, mechanics: ['Engine Building'], categories: [] }) }),
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
    entry('cand', { bayesRating: 5.5, info: info({ weight: 4.9, minPlaytime: 400, maxPlaytime: 400, mechanics: ['ZZ'], categories: ['ZZ'], bestWith: [9] }) }),
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
   * mechanic carried solely by a retired (-1.0) and a rated-1 (0.0) game scores 0.
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
