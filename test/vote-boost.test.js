'use strict';

// #1830 — „Wer zu kurz kommt, ist dran" as a rating-based boost. The accrual,
// the favourites and the per-session weights, run through the real sibling
// modules (the server's own BOOST_DEPS), so the spec exercises exactly what
// lib/draw-boost.js and lib/session-split.js call.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  BOOST_STEP, memberBoosts, favouritesByMember, sessionVoteWeights, boostedSeatIds,
} = require('../public/js/vote-boost');
const { BOOST_DEPS } = require('../lib/draw-boost');
const { scoreRatings, scoreWeightedRatings } = require('../public/js/vote-score');

const SEATS = ['ana', 'ben', 'cem'];
const members = (ids = SEATS) => ids.map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) }));
const GAMES = ['g1', 'g2', 'g3', 'g4'].map((id) => ({ id, title: id }));
let day = 1;
const stamp = () => `2026-01-${String(day++).padStart(2, '0')}T20:00:00.000Z`;

// A played session where each person in `ratings` rated the played game.
function played(gid, ratings, extra = {}) {
  const votes = {};
  Object.entries(ratings).forEach(([pid, r]) => { votes[pid] = { [gid]: { rating: r } }; });
  return { id: `s${day}`, createdAt: stamp(), memberIds: SEATS, gameIds: [gid], chosenGameId: gid, finished: true, votes, ...extra };
}
const roundOf = (sessions, extra = {}) => ({ id: 'r', members: members(), games: GAMES, sessions, ...extra });
const boostsOf = (round, session = null) => Object.fromEntries(memberBoosts(round, session, BOOST_DEPS));

test('the step table: 3/2/1 add 10/25/50, 4 and 5 reset', () => {
  assert.deepEqual(BOOST_STEP, [null, 50, 25, 10, 0, 0]);
  for (const [r, want] of [[1, 50], [2, 25], [3, 10], [4, 0], [5, 0]]) {
    const round = roundOf([played('g1', { ana: 1 }), played('g2', { ana: r })]);
    // A first 1 sets +50, so a 4/5 visibly RESETS rather than merely adding 0.
    const expect = r >= 4 ? 0 : 50 + want;
    assert.equal(boostsOf(round).ana, expect, `rating ${r}`);
  }
});

test('boosts stack uncapped: 1 then 2 is +75; three 1s are +150', () => {
  assert.equal(boostsOf(roundOf([played('g1', { ana: 1 }), played('g2', { ana: 2 })])).ana, 75);
  assert.equal(boostsOf(roundOf([played('g1', { ana: 1 }), played('g2', { ana: 1 }), played('g3', { ana: 1 })])).ana, 150);
});

test('an absent member carries their boost unchanged', () => {
  const round = roundOf([
    played('g1', { ben: 2 }),
    played('g2', { ana: 5 }, { memberIds: ['ana', 'cem'] }),
  ]);
  assert.equal(boostsOf(round).ben, 25);
});

test('a cancelled draw, an open session and a split parent accrue nothing', () => {
  const cancelled = played('g1', { ana: 1 }, { finished: false, cancelled: true });
  const open = played('g2', { ana: 1 }, { finished: false });
  const parent = played('g3', { ana: 1 }, { childSessionIds: ['c1'] });
  assert.equal(boostsOf(roundOf([cancelled, open, parent])).ana, 0);
});

test('split tables: each member follows their OWN table, read through the parent vote', () => {
  // Parent vote: ana hates g1, ben hates g2. Ana sits at the g2 table, Ben at g1.
  const parent = {
    id: 'p', createdAt: stamp(), memberIds: SEATS, gameIds: ['g1', 'g2'], finished: false,
    childSessionIds: ['c1', 'c2'],
    votes: { ana: { g1: { rating: 1 }, g2: { rating: 5 } }, ben: { g1: { rating: 5 }, g2: { rating: 2 } } },
  };
  const at = stamp();
  const c1 = { id: 'c1', parentSessionId: 'p', createdAt: at, memberIds: ['ana'], chosenGameId: 'g2', finished: true, votes: {} };
  const c2 = { id: 'c2', parentSessionId: 'p', createdAt: at, memberIds: ['ben'], chosenGameId: 'g1', finished: true, votes: {} };
  const b = boostsOf(roundOf([parent, c1, c2]));
  assert.equal(b.ana, 0, 'ana played g2, which she rated 5');
  assert.equal(b.ben, 0, 'ben played g1, which he rated 5');
  // Swap the tables and both are boosted by what THEY rated their own game.
  const s1 = { ...c1, chosenGameId: 'g1' };
  const s2 = { ...c2, chosenGameId: 'g2' };
  const swapped = boostsOf(roundOf([parent, s1, s2]));
  assert.equal(swapped.ana, 50);
  assert.equal(swapped.ben, 25);
});

test('no own vote: the rounded mean of EARLIER ratings of that game, else carry', () => {
  // Earlier: ana rated g1 2 and 3 → mean 2.5 → face 3 → +10 on a direct-play g1.
  const r1 = played('g2', { ana: 4 });
  r1.votes.ana.g1 = { rating: 2 };
  const r2 = played('g3', { ana: 4 });
  r2.votes.ana.g1 = { rating: 3 };
  const direct = played('g1', {});
  assert.equal(boostsOf(roundOf([r1, r2, direct])).ana, 10);
  // Nothing earlier at all → the boost carries (here: stays 0).
  assert.equal(boostsOf(roundOf([played('g1', {})])).ana, 0);
});

test('"strictly before": a LATER vote never rewrites an earlier session', () => {
  const direct = played('g1', {}); // ana has no rating of g1 yet → carry (0)
  const later = played('g2', { ana: 3 });
  later.votes.ana.g1 = { rating: 1 }; // rated after the direct-play evening
  // 10 from the later 3 alone. Reading the later 1 into the earlier evening
  // would make it +60.
  assert.equal(boostsOf(roundOf([direct, later])).ana, 10);
});

test('sessions fold in DATE order, not array order (a hand-dated session, #1616)', () => {
  const late = played('g1', { ana: 5 });
  const early = played('g2', { ana: 1 });
  early.createdAt = '2025-06-01T20:00:00.000Z'; // logged later, played earlier
  // By date: +50, then the 5 resets → 0. By array order it would end on +50.
  assert.equal(boostsOf(roundOf([late, early])).ana, 0);
});

test('a session’s boosts fold only the played sessions BEFORE it', () => {
  const a = played('g1', { ana: 1 });
  const b = played('g2', { ana: 5 });
  const round = roundOf([a, b]);
  assert.equal(boostsOf(round, b).ana, 50, 'b itself is not part of its own fold');
  assert.equal(boostsOf(round, a).ana, 0);
  assert.equal(boostsOf(round, null).ana, 0, 'the draw folds everything');
});

test('guests are never boosted; retired members get no entry', () => {
  const round = roundOf([played('g1', { ana: 1, x1: 1 }, { guests: [{ id: 'x1', name: 'Gast' }] })]);
  round.members[0].retired = true;
  const b = boostsOf(round);
  assert.equal('x1' in b, false);
  assert.equal('ana' in b, false);
});

test('favourites: the top face, tie-aware, retired games and guests excluded', () => {
  const s = played('g1', {}, { guests: [{ id: 'x1', name: 'Gast' }] });
  s.votes = {
    ana: { g1: { rating: 5 }, g2: { rating: 5 }, g3: { rating: 4 }, g4: { rating: 5 } },
    x1: { g3: { rating: 5 } },
  };
  const s2 = played('g2', {});
  s2.votes = { ana: { g2: { rating: 4 } } }; // g2 mean 4.5 → face 5 (rounds up) → still a favourite
  const games = GAMES.map((g) => (g.id === 'g4' ? { ...g, retired: true } : g));
  const favs = favouritesByMember(roundOf([s, s2], { games }), BOOST_DEPS);
  assert.deepEqual([...favs.get('ana')].sort(), ['g1', 'g2']);
  assert.equal(favs.has('x1'), false);
});

test('session weights: null unless flagged AND someone is boosted', () => {
  const hist = played('g1', { ana: 2 });
  const tonight = { id: 'now', createdAt: stamp(), memberIds: SEATS, gameIds: ['g2'], votes: {} };
  const round = roundOf([hist, tonight]);
  assert.equal(sessionVoteWeights(round, tonight, BOOST_DEPS), null, 'not flagged');
  const flagged = { ...tonight, voteBoost: true };
  round.sessions[1] = flagged;
  const w = sessionVoteWeights(round, flagged, BOOST_DEPS);
  assert.deepEqual(Object.fromEntries(w), { ana: 125, ben: 100, cem: 100 });
  for (const v of w.values()) assert.ok(Number.isInteger(v));
  assert.deepEqual(boostedSeatIds(round, flagged, BOOST_DEPS), ['ana']);
  // Nobody boosted → null even when flagged, so callers keep today's arithmetic.
  const calm = roundOf([played('g1', { ana: 5 }), flagged]);
  assert.equal(sessionVoteWeights(calm, flagged, BOOST_DEPS), null);
  assert.deepEqual(boostedSeatIds(calm, flagged, BOOST_DEPS), []);
});

test('a guest weighs 100; a team gets one weight, its people\'s rounded mean', () => {
  const hist = played('g1', { ana: 1 });
  const tonight = {
    id: 'now', createdAt: stamp(), memberIds: SEATS, gameIds: ['g2'], votes: {}, voteBoost: true,
    guests: [{ id: 'x1', name: 'Gast' }],
    teams: [{ id: 't', personIds: ['ana', 'ben'], sharedSeat: true }],
  };
  const w = Object.fromEntries(sessionVoteWeights(roundOf([hist, tonight]), tonight, BOOST_DEPS));
  assert.equal(w.ana, 125, 'ana +50 and ben +0 → the team weighs 125 each');
  assert.equal(w.ben, 125);
  assert.equal(w.cem, 100);
  assert.equal(w.x1, 100);
});

test('scoreWeightedRatings: equal weights equal scoreRatings; a weight can flip the order', () => {
  const ratings = [5, 2, 4, 1, 3];
  assert.deepEqual(scoreWeightedRatings(ratings.map((r) => ({ rating: r, weight: 100 }))), scoreRatings(ratings));
  // Ana (250, i.e. +150 after three bad evenings) loves A and dislikes B; Ben
  // and Cem (100) the reverse. Unweighted B wins 2.67 to 1.67; weighted A, 2.78 to 1.78.
  const a = scoreWeightedRatings([{ rating: 5, weight: 250 }, { rating: 2, weight: 100 }, { rating: 2, weight: 100 }]);
  const b = scoreWeightedRatings([{ rating: 2, weight: 250 }, { rating: 4, weight: 100 }, { rating: 4, weight: 100 }]);
  assert.ok(a.score > b.score, `${a.score} > ${b.score}`);
  assert.ok(scoreRatings([5, 2, 2]).score < scoreRatings([2, 4, 4]).score, 'unweighted the order is the reverse');
  assert.equal(b.count, 3, 'count stays people');
  assert.equal(scoreWeightedRatings([{ rating: 1, weight: 150 }]).vetoes, 1, 'vetoes stay a count');
  assert.equal(scoreWeightedRatings([]), null);
});

test('without deps under Node it throws rather than computing something else', () => {
  assert.throws(() => memberBoosts(roundOf([]), null), ReferenceError);
});
