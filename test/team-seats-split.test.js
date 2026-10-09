'use strict';

/* Multi-table splits (#796) measure a table in SEATS since #1610: a team sharing
   one hand takes one seat, an own-seat team its headcount — while the PARTY stays
   the atom, so a team still never spans two tables.

   Every fixture here holds a three-person own-seat team. With every party one
   seat — the only shape before #1610 — "count parties" and "count seats" are the
   same number, and a spec over that shape is green against a search that ignores
   the weight entirely. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

global.t = (key, params) => `${key}:${JSON.stringify(params || {})}`;

const { proposeTableSplits } = require('../public/js/table-split');
const { tileValue } = require('../public/js/vote-score');
const { fitsPlayerCount } = require('../public/js/draw-pool');
const { validateSplitTables, buildChildSessions } = require('../lib/session-split');

const game = (id, min, max) => ({ id, minPlayers: min, maxPlayers: max });

// Seven people: one own-seat team of three plus four on their own.
const TEAM = { id: 'T', personIds: ['a', 'b', 'c'], seats: 3 };
const SOLOS = ['d', 'e', 'f', 'g'].map((id) => ({ id, personIds: [id], seats: 1 }));
const PARTIES = [TEAM, ...SOLOS];
const VOTES = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((p) => [p, { x: { rating: 4 }, y: { rating: 4 } }]));

test('the search sizes tables in seats, and never splits the team', () => {
  // x seats exactly 4, y exactly 3: the only split is the team plus one solo at
  // x, and the other three solos at y. Counted in PARTIES the team's table would
  // be two and no split would exist at all.
  const proposals = proposeTableSplits({
    parties: PARTIES, games: [game('x', 4, 4), game('y', 3, 3)], votes: VOTES, seed: 's', tileValue, fitsPlayerCount,
  });
  assert.equal(proposals.length, 1);
  const tables = proposals[0].tables;
  const atX = tables.find((tb) => tb.gameId === 'x').personIds;
  const atY = tables.find((tb) => tb.gameId === 'y').personIds;
  assert.equal(atX.length, 4);
  assert.equal(atY.length, 3);
  assert.ok(['a', 'b', 'c'].every((p) => atX.includes(p)), 'the team sits together, at the four-seat game');
});

test('a party with no seats field weighs one — every split before #1610 is unchanged', () => {
  const unweighted = PARTIES.map((p) => { const q = { ...p }; delete q.seats; return q; });
  const weighted = PARTIES.map((p) => ({ ...p, seats: 1 }));
  const run = (parties) => proposeTableSplits({
    parties, games: [game('x', 3, 4), game('y', 3, 4)], votes: VOTES, seed: 's', tileValue, fitsPlayerCount,
  });
  assert.deepEqual(run(unweighted), run(weighted));
});

/* ---- the confirm route's validation, and the children it builds ---- */

const round = {
  members: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id, name: id.toUpperCase() })),
  games: [game('x', 4, 4), game('y', 3, 3), game('z', 2, 2)],
};
const session = {
  id: 'p',
  memberIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  gameIds: ['x', 'y', 'z'],
  votes: {},
  teams: [{ id: 'T', personIds: ['a', 'b', 'c'], sharedSeat: false }],
};

test('validation counts the own-seat team at its headcount', () => {
  assert.equal(validateSplitTables(round, session, [
    { gameId: 'x', personIds: ['a', 'b', 'c', 'd'] },
    { gameId: 'y', personIds: ['e', 'f', 'g'] },
  ]), null);
  // The same people at a two-player game and a five-seat table: refused, where
  // a party count (team + one = 2) would have let the first table through.
  assert.equal(validateSplitTables(round, session, [
    { gameId: 'z', personIds: ['a', 'b', 'c', 'd'] },
    { gameId: 'y', personIds: ['e', 'f', 'g'] },
  ]), 'table_out_of_range');
});

test('a shared-seat team of three takes one seat at its table', () => {
  const shared = { ...session, teams: [{ id: 'T', personIds: ['a', 'b', 'c'], sharedSeat: true }] };
  // team (1) + d (1) = 2 seats: a two-player game, but below the three-seat floor.
  assert.equal(validateSplitTables(round, shared, [
    { gameId: 'z', personIds: ['a', 'b', 'c', 'd'] },
    { gameId: 'y', personIds: ['e', 'f', 'g'] },
  ]), 'table_too_small');
});

// A child's team is stored with an EXPLICIT flag: here the parent's partial,
// shared-seat team becomes the whole of its child's table, where an absent key
// would be inferred as own seats.
test('children carry the team\'s seat choice explicitly', () => {
  const legacy = { ...session, teams: [{ id: 'T', personIds: ['a', 'b', 'c'] }] }; // partial -> shared
  const children = buildChildSessions(round, legacy, [
    { gameId: 'x', personIds: ['d', 'e', 'f', 'g'] },
    { gameId: 'y', personIds: ['a', 'b', 'c'] },
  ], { type: 'started' });
  const teamed = children.find((c) => c.teams);
  assert.equal(teamed.teams[0].sharedSeat, true);
});

// CodeRabbit on #1615: the greedy seed put the heavy party where IT liked best
// and stranded the rest. Weights 3,2,2 over a three-seat and a four-seat game
// split only one way — the team of three at the three-seat game — and the team
// prefers the other one, so a preference-only placement fails on every restart.
test('the seed backtracks when the preferred table leaves a later party nowhere to sit', () => {
  const parties = [
    { id: 'T', personIds: ['a', 'b', 'c'], seats: 3 },
    { id: 'P', personIds: ['d', 'e'], seats: 2 },
    { id: 'Q', personIds: ['f', 'g'], seats: 2 },
  ];
  const votes = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((p) => [p, { x: { rating: 5 }, y: { rating: 2 } }]));
  const [proposal] = proposeTableSplits({
    parties, games: [game('x', 4, 4), game('y', 3, 3)], votes, seed: 's', tileValue, fitsPlayerCount,
  });
  assert.ok(proposal, 'a feasible split got no proposal');
  const atY = proposal.tables.find((tb) => tb.gameId === 'y').personIds;
  assert.deepEqual(atY.slice().sort(), ['a', 'b', 'c']);
});
