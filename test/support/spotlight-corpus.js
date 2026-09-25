'use strict';

/*
 * A deterministic, VARIED corpus for the spotlight specs (#1228).
 *
 * The fixtures in test/recommend.test.js are built to isolate one term at a
 * time, which is exactly why they cannot pin a whole ranking: most of their
 * candidates tie on everything but the attribute under test. The byte-identical
 * base-ranking spec needs the opposite — a pool where every term varies at once,
 * so a variant leaking into the base score would reorder something or move a
 * score in the third decimal. Seeded, so the pinned literal list stays valid.
 */

// mulberry32 — a tiny seeded PRNG; Math.random would make the pinned list flaky.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MECHANICS = ['M-a', 'M-b', 'M-c', 'M-d', 'M-e', 'M-f', 'M-g', 'M-h', 'M-x', 'M-y', 'M-z', 'M-q'];
const CATEGORIES = ['C-a', 'C-b', 'C-c', 'C-d', 'C-x', 'C-y'];

const row = (id, over) => ({
  externalId: String(id),
  name: `Game ${id}`,
  year: 2015,
  rank: 1,
  rating: 7.5,
  bayesRating: 7,
  usersRated: 5000,
  enrichedAt: '2026-08-14T00:00:00.000Z',
  ...over,
});

const baseInfo = (over) => ({
  weight: 2.4,
  minPlayers: 2,
  maxPlayers: 4,
  minPlaytime: 45,
  maxPlaytime: 60,
  minAge: 10,
  categories: [],
  mechanics: [],
  families: [],
  designers: [],
  implementations: [],
  bestWith: [],
  recommendedWith: [],
  ...over,
});

// Ten owned games leaning on the first four mechanics, centred on weight ~2.4 —
// below the 3.0 pivot, so the complexity spotlight points UP on this shelf.
function spotlightShelf() {
  const rows = [];
  const games = [];
  for (let i = 0; i < 10; i += 1) {
    const id = `own${i}`;
    rows.push(row(id, {
      rank: 50 + i,
      bayesRating: 7.2,
      info: baseInfo({
        weight: 2.1 + (i % 4) * 0.2,
        mechanics: [MECHANICS[i % 4], MECHANICS[(i + 1) % 4], MECHANICS[4 + (i % 2)]],
        categories: [CATEGORIES[i % 3]],
        bestWith: [4],
        recommendedWith: [3, 5],
      }),
    }));
    games.push({ id: `g${i}`, title: `Owned ${i}`, source: { provider: 'bgg', externalId: id } });
  }
  const round = {
    id: 'r-spot',
    name: 'Spotlight round',
    members: [{ id: 'm1', name: 'A' }, { id: 'm2', name: 'B' }, { id: 'm3', name: 'C' }, { id: 'm4', name: 'D' }],
    games,
    sessions: [],
  };
  return { round, rows };
}

// `n` candidates, every term varying independently.
function spotlightCandidates(n = 160, seed = 1228) {
  const rnd = prng(seed);
  const pickN = (list, k) => {
    const out = new Set();
    while (out.size < k) out.add(list[Math.floor(rnd() * list.length)]);
    return [...out];
  };
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const lo = 15 + Math.floor(rnd() * 8) * 15;
    rows.push(row(`c${i}`, {
      rank: 100 + i,
      bayesRating: Math.round((5.6 + rnd() * 2.8) * 100) / 100,
      usersRated: 120 + Math.floor(rnd() * rnd() * 40000),
      info: baseInfo({
        weight: Math.round((1.2 + rnd() * 3.4) * 100) / 100,
        minPlaytime: lo,
        maxPlaytime: lo + Math.floor(rnd() * 4) * 15,
        mechanics: pickN(MECHANICS, 2 + Math.floor(rnd() * 3)),
        categories: pickN(CATEGORIES, 1 + Math.floor(rnd() * 2)),
        bestWith: rnd() < 0.5 ? [4] : rnd() < 0.5 ? [2] : [],
        recommendedWith: rnd() < 0.6 ? [3, 4, 5] : [],
      }),
    }));
  }
  return rows;
}

module.exports = { spotlightShelf, spotlightCandidates, row, baseInfo, MECHANICS, CATEGORIES };
