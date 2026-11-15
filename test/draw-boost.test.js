'use strict';

// #1830 — the draw half of „Wer zu kurz kommt, ist dran": every seated, boosted
// member pushes their favourites by 100 + Σ boost. Exercises lib/draw-boost.js
// under a seeded RNG; the route wiring is test/draw-boost-route.test.js's.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { drawGames, drawWeights } = require('../lib/draw-boost');
const { shuffle } = require('../lib/draw');

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

const SEATS = ['ana', 'ben', 'cem'];
const GAMES = Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, title: `G${i}` }));
const top = { rating: 5 };

/* Favourites (rated 5 in an earlier vote): Ana g1, Ben g2 + g3, Cem g4.
   Played history: Ana sat through g9, which she rated 1 (+50); Ben through g8,
   rated 2 (+25). Cem enjoyed his (g7, a 4). */
function fixture() {
  return {
    members: SEATS.map((id) => ({ id, name: id })),
    games: GAMES,
    sessions: [
      { id: 'v', createdAt: '2026-01-01T20:00:00.000Z', memberIds: SEATS, finished: false, cancelled: true,
        votes: { ana: { g1: top }, ben: { g2: top, g3: top }, cem: { g4: top } } },
      { id: 'a', createdAt: '2026-01-02T20:00:00.000Z', memberIds: SEATS, finished: true, chosenGameId: 'g9',
        votes: { ana: { g9: { rating: 1 } } } },
      { id: 'b', createdAt: '2026-01-03T20:00:00.000Z', memberIds: SEATS, finished: true, chosenGameId: 'g8',
        votes: { ben: { g8: { rating: 2 } }, cem: { g8: { rating: 4 } } } },
    ],
  };
}

test('draw weights are 100 + Σ boost over the seated members who favour the game', () => {
  const w = Object.fromEntries(drawWeights(fixture(), GAMES, SEATS));
  assert.equal(w.g1, 150, 'Ana +50');
  assert.equal(w.g2, 125, 'Ben +25');
  assert.equal(w.g3, 125);
  assert.equal(w.g4, 100, 'Cem is not boosted');
  assert.equal(w.g0, 100);
  for (const v of Object.values(w)) assert.ok(Number.isInteger(v), `integer weight ${v}`);
  // An unseated member pushes nothing.
  assert.equal(drawWeights(fixture(), GAMES, ['ben', 'cem']).get('g1'), 100);
});

test('a game two boosted members favour adds both boosts', () => {
  const round = fixture();
  round.sessions[0].votes.ana.g2 = top;
  assert.equal(drawWeights(round, GAMES, SEATS).get('g2'), 175);
});

test('nothing to change is the plain shuffle, byte for byte, with the same RNG calls', () => {
  const round = fixture();
  const noFavsInPool = GAMES.filter((g) => !['g1', 'g2', 'g3'].includes(g.id));
  for (const seed of [1, 42, 1830]) {
    const plain = shuffle(GAMES.slice(), seeded(seed)).slice(0, 3);
    const cases = [
      ['off', GAMES, { boost: false, seatedIds: SEATS }],
      ['nobody boosted seated', GAMES, { boost: true, seatedIds: ['cem'] }],
      ['whole pool', GAMES, { boost: true, seatedIds: SEATS }, 10],
    ];
    for (const [label, pool, opts, n = 3] of cases) {
      const want = shuffle(pool.slice(), seeded(seed)).slice(0, Math.min(n, pool.length));
      assert.deepEqual(drawGames(round, pool, n, { ...opts, rng: seeded(seed) }), { picked: want }, label);
    }
    const p2 = shuffle(noFavsInPool.slice(), seeded(seed)).slice(0, 3);
    assert.deepEqual(drawGames(round, noFavsInPool, 3, { boost: true, seatedIds: SEATS, rng: seeded(seed) }), { picked: p2 }, 'no boosted favourite in the pool');
    assert.equal(plain.length, 3);
  }
});

test('boosted, a single draw picks each game in proportion to its weight', () => {
  const round = fixture();
  const rng = seeded(1830);
  const N = 20000;
  const hits = new Map(GAMES.map((g) => [g.id, 0]));
  for (let i = 0; i < N; i++) {
    const { picked } = drawGames(round, GAMES, 1, { boost: true, seatedIds: SEATS, rng });
    hits.set(picked[0].id, hits.get(picked[0].id) + 1);
  }
  // 150 + 125 + 125 + seven × 100 = 1100.
  assert.ok(Math.abs(hits.get('g1') / N - 150 / 1100) < 0.01, `g1 ${hits.get('g1') / N}`);
  assert.ok(Math.abs(hits.get('g2') / N - 125 / 1100) < 0.01, `g2 ${hits.get('g2') / N}`);
  assert.ok(Math.abs(hits.get('g0') / N - 100 / 1100) < 0.01, `g0 ${hits.get('g0') / N}`);
});
