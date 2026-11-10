'use strict';

// #1777 — the opt-in draw boost for the member whose favourites reach the table
// least. Exercises lib/draw-boost.js directly under a seeded RNG; the route
// wiring and the round setting are test/draw-boost-route.test.js's subject.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { DRAW_BOOST_WEIGHT, boostedMember, drawGames } = require('../lib/draw-boost');
const { shuffle } = require('../lib/draw');
const { TASTE_SHARE_FROM_SESSIONS } = require('../public/js/taste-share');
const { RATING_MAX } = require('../public/js/rating-faces');

// mulberry32 — a tiny deterministic RNG, so every number below is reproducible.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const top = { rating: RATING_MAX };
const SEATS = ['ana', 'ben', 'cem'];
const GAMES = Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, title: `G${i}` }));

/* Ben's favourites are g1/g2 and never reached the table; Ana's (g3/g4) and
   Cem's (g5/g6) did, three evenings each. So Ben is STRICTLY behind (0 vs 3/3). */
function fixture({ played = TASTE_SHARE_FROM_SESSIONS, chosen } = {}) {
  const picks = chosen || ['g3', 'g5', 'g3', 'g5', 'g3', 'g5', 'g3', 'g5'].slice(0, played);
  const sessions = picks.map((gid, i) => ({
    id: `s${i}`, finished: true, memberIds: SEATS, chosenGameId: gid, votes: {},
  }));
  sessions[0].votes = {
    ana: { g3: top, g4: top },
    ben: { g1: top, g2: top },
    cem: { g5: top, g6: top },
  };
  return {
    members: SEATS.map((id) => ({ id, name: id })),
    games: GAMES,
    sessions,
  };
}

test('the weight is pinned: a favourite is exactly twice as likely to be drawn', () => {
  assert.equal(DRAW_BOOST_WEIGHT, 2);
});

test('boostedMember: the one seated member strictly behind, else nobody', () => {
  assert.equal(boostedMember(fixture(), SEATS), 'ben');
  // Ben not seated: Ana and Cem tie at three evenings, so nobody is behind.
  assert.equal(boostedMember(fixture(), ['ana', 'cem']), null);
  // Alone at the table there is nobody to be behind.
  assert.equal(boostedMember(fixture(), ['ben']), null);
  // A young round reads as noise, the Rückblick's own bar.
  assert.equal(boostedMember(fixture({ played: TASTE_SHARE_FROM_SESSIONS - 1 }), SEATS), null);
  // Everyone tied (Ben's favourites played as often as the others'): no boost.
  const tied = fixture({ chosen: ['g1', 'g3', 'g5', 'g1', 'g3', 'g5'] });
  assert.equal(boostedMember(tied, SEATS), null);
  // A member with a single favourite has no taste to fall behind on.
  const single = fixture();
  single.sessions[0].votes.ben = { g1: top };
  assert.equal(boostedMember(single, SEATS), null);
});

test('boost OFF is byte-identical to the plain shuffle under the same seed', () => {
  const round = fixture();
  for (const seed of [1, 42, 1777]) {
    const plain = shuffle(GAMES.slice(), seeded(seed)).slice(0, 3);
    const off = drawGames(round, GAMES, 3, { boost: false, seatedIds: SEATS, rng: seeded(seed) });
    assert.deepEqual(off, { picked: plain, boostMemberId: null });
    // On, but nobody behind, takes the same path.
    const none = drawGames(round, GAMES, 3, { boost: true, seatedIds: ['ana', 'cem'], rng: seeded(seed) });
    assert.deepEqual(none, { picked: plain, boostMemberId: null });
  }
});

test('boost ON reports the member only when it can change the draw', () => {
  const round = fixture();
  assert.equal(drawGames(round, GAMES, 3, { boost: true, seatedIds: SEATS, rng: seeded(1) }).boostMemberId, 'ben');
  // Every game drawn anyway: no extra chance to speak of.
  assert.equal(drawGames(round, GAMES, 10, { boost: true, seatedIds: SEATS, rng: seeded(1) }).boostMemberId, null);
  // None of Ben's favourites in the pool.
  const pool = GAMES.filter((g) => g.id !== 'g1' && g.id !== 'g2');
  assert.equal(drawGames(round, pool, 3, { boost: true, seatedIds: SEATS, rng: seeded(1) }).boostMemberId, null);
});

test('boost ON: a single draw picks each favourite ~2x as often as any other game', () => {
  const round = fixture();
  const rng = seeded(1777);
  const N = 12000;
  const hits = new Map(GAMES.map((g) => [g.id, 0]));
  for (let i = 0; i < N; i++) {
    const { picked } = drawGames(round, GAMES, 1, { boost: true, seatedIds: SEATS, rng });
    hits.set(picked[0].id, hits.get(picked[0].id) + 1);
  }
  // Weights 2,2 + eight 1s = 12, so a favourite is 1/6 and the rest 1/12 each.
  const fav = (hits.get('g1') + hits.get('g2')) / 2 / N;
  const rest = GAMES.filter((g) => g.id !== 'g1' && g.id !== 'g2')
    .reduce((n, g) => n + hits.get(g.id), 0) / 8 / N;
  assert.ok(Math.abs(fav - 1 / 6) < 0.012, `favourite share ${fav}`);
  assert.ok(Math.abs(fav / rest - DRAW_BOOST_WEIGHT) < 0.2, `ratio ${fav / rest}`);
});

test('boost ON: in a three-game draw the favourites come up measurably more often', () => {
  const round = fixture();
  const N = 6000;
  const rate = (boost) => {
    const rng = seeded(7);
    let n = 0;
    for (let i = 0; i < N; i++) {
      const { picked } = drawGames(round, GAMES, 3, { boost, seatedIds: SEATS, rng });
      n += picked.filter((g) => g.id === 'g1' || g.id === 'g2').length;
    }
    return n / (2 * N);
  };
  const off = rate(false);
  const on = rate(true);
  assert.ok(Math.abs(off - 0.3) < 0.02, `baseline ${off}`); // 3 of 10
  assert.ok(on > off * 1.4, `boosted ${on} vs ${off}`);
});
