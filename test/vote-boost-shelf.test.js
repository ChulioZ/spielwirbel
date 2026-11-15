'use strict';

/* #1830 — the boost acts only INSIDE a session. A round whose history boosts a
 * member, with every session flagged, must score its shelf exactly as the same
 * round with no flags: the Regal pill/sort (`roundScoreIndex`), the game's own
 * stats (`gameStats`) and the per-session figure the Chronik and the Spielepass
 * print (`gameStatsForSession`) all read the raw stored votes. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const SEATS = ['m1', 'm2', 'm3'];
const session = (id, day, gid, votes, extra = {}) => ({
  id, createdAt: `2026-06-${day}T20:00:00.000Z`, gameIds: ['g1', 'g2', 'g3'], memberIds: SEATS,
  votes, chosenGameId: gid, finished: true, cancelled: false, done: true, winnerIds: [], events: [], ...extra,
});

function roundOf(flag) {
  const f = flag ? { voteBoost: true } : {};
  return {
    id: 'r1', name: 'R', members: SEATS.map((id) => ({ id, name: id })),
    games: ['g1', 'g2', 'g3'].map((id) => ({ id, title: id, tagIds: [] })),
    sessions: [
      // m1 sits through two games they rate 1: +100, weight 200 from here on.
      session('a', '01', 'g3', { m1: { g3: { rating: 1 } }, m2: { g3: { rating: 4 } } }, f),
      session('b', '02', 'g3', { m1: { g3: { rating: 1 } }, m2: { g3: { rating: 5 } } }, f),
      session('c', '03', 'g1', {
        m1: { g1: { rating: 5 }, g2: { rating: 1 } },
        m2: { g1: { rating: 2 }, g2: { rating: 4 } },
        m3: { g1: { rating: 2 }, g2: { rating: 5 } },
      }, f),
    ],
  };
}

test('shelf, game stats and per-session stats are identical with the boost on and off', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const read = (expr, flag) => dom.run(`JSON.stringify((() => { const round = ${JSON.stringify(roundOf(flag))}; return ${expr}; })())`);
  // The flagged round really does weight its result — or this spec proves nothing.
  const weights = dom.run(`JSON.stringify([...sessionVoteWeights(${JSON.stringify(roundOf(true))}, ${JSON.stringify(roundOf(true).sessions[2])})])`);
  assert.equal(weights, JSON.stringify([['m1', 200], ['m2', 100], ['m3', 100]]));
  for (const expr of [
    "roundScoreIndex(round, round.games).byGame",
    "['g1', 'g2', 'g3'].map((g) => gameStats(round, g))",
    "round.sessions.map((s) => gameStatsForSession(round, s, 'g1'))",
    "round.sessions.map((s) => gameStatsForSession(round, s, 'g2'))",
  ]) {
    assert.equal(read(expr, true), read(expr, false), expr);
  }
});
