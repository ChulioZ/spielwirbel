'use strict';

/* The twenty Abzeichen #1464 added to public/js/achievements.js — one spec per
   condition, each with the case that earns it and the negative that decides it.
   The 21 original entries live in test/achievements.test.js; this file exists
   because both would not fit one spec under the token budget.

   Same discipline as that file: the siblings are the REAL modules, injected as
   lib/user-stats.js injects them, and every fixture states its own dates. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const people = require('../public/js/session-people');
const outcome = require('../public/js/session-outcome');
const voteScore = require('../public/js/vote-score');
const { computePlaces } = require('../public/js/ranking');
const { isActiveGame } = require('../public/js/draw-pool');
const {
  roundBadges, newSince, accountBadges,
  BADGE_WINDOW_HOURS, BADGE_VINTAGE_MONTHS, BADGE_REDISCOVERED_DAYS, BADGE_TIDE_MIN_GAMES,
} = require('../public/js/achievements');

const DEPS = {
  sessionPeople: people.sessionPeople,
  sessionPartyGroups: people.sessionPartyGroups,
  isContestSession: people.isContestSession,
  sessionEnding: outcome.sessionEnding,
  sessionHasVotes: outcome.sessionHasVotes,
  scoreRatings: voteScore.scoreRatings,
  TILE_VALUE: voteScore.TILE_VALUE,
  SCORE_MIN: voteScore.SCORE_MIN,
  computePlaces,
  isActiveGame,
};
const TOP = voteScore.TILE_VALUE.length - 1;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-01-01T19:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

// Every session is dated explicitly: `at` is hours after T0, so a spec about a
// window or a gap reads its own numbers.
let seq = 0;
function sess(at, over = {}) {
  seq += 1;
  return {
    id: `s${seq}`, createdAt: iso(T0 + at * HOUR), memberIds: ['a', 'b'], gameIds: ['g1'], chosenGameId: 'g1',
    votes: {}, finished: true, winnerIds: [], ...over,
  };
}
// One session per day, starting at day `from`.
const daily = (n, over = {}, from = 0) => Array.from({ length: n }, (_, i) => sess((from + i) * 24, typeof over === 'function' ? over(i) : over));
// The tables of one split: children sharing a parent and its moment.
const split = (at, tables) => {
  const parent = `p${++seq}`;
  return tables.map((over) => sess(at, { parentSessionId: parent, ...over }));
};

const game = (id, over = {}) => ({ id, title: id, retired: false, completed: false, wish: false, createdAt: iso(T0), ...over });
const mkRound = ({ members, games, sessions } = {}) => ({
  id: 'r1',
  members: members || [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bo' }],
  games: games || [game('g1'), game('g2'), game('g3')],
  sessions: sessions || [],
});

const all = (round, opts = {}) => roundBadges(round, { deps: DEPS, now: T0 + 30 * DAY, ...opts });
const mine = (round, key, mid = 'a', opts) => all(round, opts).members[mid].find((e) => e.key === key);
const ours = (round, key, opts) => all(round, opts).round.find((e) => e.key === key);
const W = (mid = 'a') => ({ winnerIds: [mid] });
const solo = (mid = 'a') => ({ memberIds: [mid], winnerIds: [mid] });

// --- A. member, visible ------------------------------------------------------------

test('Gründungsmitglied: at the round\'s first evening; a later joiner is not, a split first evening counts at either table', () => {
  const ss = [sess(0), sess(24, { memberIds: ['a', 'b', 'c'] })];
  const members = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  assert.equal(mine(mkRound({ members, sessions: ss }), 'founder').earnedAt.sessionId, ss[0].id);
  // Cleo missed the first evening: she can never earn it, so it is not shown at all.
  assert.equal(mine(mkRound({ members, sessions: ss }), 'founder', 'c'), undefined);
  assert.equal(all(mkRound({ members, sessions: ss })).members.c.length, 17, 'her row simply has one entry fewer');
  // Before any evening it is open to everyone.
  assert.equal(mine(mkRound({ members }), 'founder', 'c').state, 'locked');
  // Deleting the first session replays from the next: Cleo was at that one.
  assert.equal(mine(mkRound({ members, sessions: ss.slice(1) }), 'founder', 'c').earnedAt.sessionId, ss[1].id);
  const tables = split(0, [{ memberIds: ['a'] }, { memberIds: ['b'] }]);
  assert.equal(mine(mkRound({ sessions: tables }), 'founder', 'b').earnedAt.sessionId, tables[1].id, 'dated at her own table');
});

test('Erste Wahl 5 · 10 · 25: the played game rated top; a direct pick or a top for another game misses', () => {
  const top = { gameIds: ['g1', 'g2'], votes: { a: { g1: { rating: TOP }, g2: { rating: 1 } }, b: { g1: { rating: 2 } } } };
  for (const [n, tier, of] of [[4, null, 5], [5, 5, 10], [9, 5, 10], [10, 10, 25]]) {
    const e = mine(mkRound({ sessions: daily(n, top) }), 'firstChoice');
    assert.deepEqual([e.tier, e.count, e.of], [tier, n, of], `${n} sessions`);
  }
  const direct = daily(5);
  assert.equal(mine(mkRound({ sessions: direct }), 'firstChoice').state, 'locked', 'a direct pick asked nobody');
  const other = daily(5, { gameIds: ['g1', 'g2'], votes: { a: { g1: { rating: 2 }, g2: { rating: TOP } } } });
  assert.equal(mine(mkRound({ sessions: other }), 'firstChoice').state, 'locked', 'her top went to a game nobody played');
});

test('Spezialist 5 · 10 · 25: the most wins with ONE game, every win counting; no game named', () => {
  const five = mine(mkRound({ sessions: daily(5, solo()) }), 'specialist');
  assert.deepEqual([five.state, five.tier], ['earned', 5], 'a solo win counts, like Vielseitig');
  assert.equal('gameId' in five, false, 'only Dauerbrenner names its game');
  const spread = [...daily(4, W()), ...daily(3, { ...W(), chosenGameId: 'g2' }, 10)];
  const e = mine(mkRound({ sessions: spread }), 'specialist');
  assert.deepEqual([e.state, e.count, e.of], ['progress', 4, 5], 'four with g1 and three with g2 are not five');
});

test('Immer dabei 10 · 25 · 50: the best run of round evenings; a three-table split is ONE evening, at any of its tables', () => {
  const ten = mine(mkRound({ sessions: daily(10) }), 'present');
  assert.deepEqual([ten.tier, ten.count, ten.of], [10, null, null], 'a best run is no counted progress');
  const missed = [...daily(5), sess(5 * 24, { memberIds: ['b'] }), ...daily(9, {}, 6)];
  assert.equal(mine(mkRound({ sessions: missed }), 'present').state, 'locked', 'an evening without her breaks the run');
  const members = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const tables = split(4 * 24, [{ memberIds: ['a'] }, { memberIds: ['b'] }, { memberIds: ['c'] }]);
  const withSplit = [...daily(4), ...tables, ...daily(5, {}, 5)];
  const e = mine(mkRound({ members, sessions: withSplit }), 'present');
  assert.equal(e.tier, 10, 'her one table of the split keeps the run going and counts once');
  assert.equal(mine(mkRound({ members, sessions: withSplit }), 'present', 'b').tier, 10, 'so does his');
});

test('Querbeet 10 · 25 · 50: distinct games played; nine misses', () => {
  const games = Array.from({ length: 10 }, (_, i) => game(`q${i}`));
  const play = (n) => daily(n, (i) => ({ chosenGameId: `q${i}`, gameIds: [`q${i}`] }));
  assert.equal(mine(mkRound({ games, sessions: play(10) }), 'variety').tier, 10);
  const nine = mine(mkRound({ games, sessions: [...play(9), sess(500, { chosenGameId: 'q0' })] }), 'variety');
  assert.deepEqual([nine.state, nine.count, nine.of], ['progress', 9, 10]);
});

test('Titelverteidiger: two contested wins of one game in a row; a loss between, or a solo play, does not defend', () => {
  const ss = [sess(0, W()), sess(24, { ...W(), chosenGameId: 'g2' }), sess(48, W())];
  assert.equal(mine(mkRound({ sessions: ss }), 'defender').earnedAt.sessionId, ss[2].id, 'another game between is fine');
  assert.equal(mine(mkRound({ sessions: [sess(0, W()), sess(24, W('b')), sess(48, W())] }), 'defender').state, 'locked');
  assert.equal(mine(mkRound({ sessions: [sess(0, solo()), sess(24, W())] }), 'defender').state, 'locked', 'a solo win is no title');
});

// --- B. member, secret ---------------------------------------------------------------

test('Anfängerglück: a contested win at the round\'s first play of that game; a later play or a solo debut misses', () => {
  const first = sess(0, W());
  assert.equal(mine(mkRound({ sessions: [first] }), 'beginnersLuck').earnedAt.sessionId, first.id);
  assert.equal(mine(mkRound({ sessions: [sess(0, W('b')), sess(24, W())] }), 'beginnersLuck').state, 'secret');
  assert.equal(mine(mkRound({ sessions: [sess(0, solo())] }), 'beginnersLuck').state, 'secret', 'a solo debut is no contest');
  // Both tables of a split debut are that first play.
  const members = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }];
  const tables = split(0, [{ memberIds: ['a', 'b'], winnerIds: ['b'] }, { memberIds: ['c', 'd'], winnerIds: ['d'] }]);
  assert.equal(mine(mkRound({ members, sessions: tables }), 'beginnersLuck', 'd').state, 'earned');
});

test('Revanche: lost a game, won it at the NEXT round evening; a gap evening or a solo second play misses', () => {
  const ss = [sess(0, W('b')), sess(24, W())];
  assert.equal(mine(mkRound({ sessions: ss }), 'rematch').earnedAt.sessionId, ss[1].id);
  const gap = [sess(0, W('b')), sess(24, { chosenGameId: 'g2' }), sess(48, W())];
  assert.equal(mine(mkRound({ sessions: gap }), 'rematch').state, 'secret', 'the evenings must be consecutive');
  const away = [sess(0, W('b')), sess(24, { memberIds: ['b'] }), sess(48, W())];
  assert.equal(mine(mkRound({ sessions: away }), 'rematch').state, 'secret', 'an evening she missed still sits between');
  assert.equal(mine(mkRound({ sessions: [sess(0, W('b')), sess(24, solo())] }), 'rematch').state, 'secret');
  // The tables of one split are one evening: the next evening follows the split.
  const members = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const tables = split(0, [{ memberIds: ['a', 'b'], winnerIds: ['b'] }, { memberIds: ['c', 'b'], chosenGameId: 'g2' }]);
  assert.equal(mine(mkRound({ members, sessions: [...tables, sess(24, W())] }), 'rematch').state, 'earned');
});

test(`Doppelschlag: two contested wins within ${BADGE_WINDOW_HOURS} hours; 13 hours or a solo win misses`, () => {
  const ss = [sess(0, W()), sess(BADGE_WINDOW_HOURS, W())];
  assert.equal(mine(mkRound({ sessions: ss }), 'double').earnedAt.sessionId, ss[1].id, 'exactly 12 hours counts');
  assert.equal(mine(mkRound({ sessions: [sess(0, W()), sess(13, W())] }), 'double').state, 'secret');
  assert.equal(mine(mkRound({ sessions: [sess(0, W()), sess(1, solo())] }), 'double').state, 'secret');
});

// --- C. round, visible -----------------------------------------------------------------

test('Offenes Haus 5 · 10 · 25: sessions with a guest; four misses', () => {
  const g = { guests: [{ id: 'q', name: 'Q' }] };
  assert.equal(ours(mkRound({ sessions: daily(5, g) }), 'openHouse').tier, 5);
  const four = ours(mkRound({ sessions: [...daily(4, g), sess(200)] }), 'openHouse');
  assert.deepEqual([four.state, four.count, four.of], ['progress', 4, 5]);
});

test('Zwei Tische: the first split, dated at its first finished table; no split, no mark', () => {
  const tables = split(48, [{ memberIds: ['a'] }, { memberIds: ['b'] }]);
  const e = ours(mkRound({ sessions: [sess(0), ...tables] }), 'twoTables');
  assert.deepEqual(e.earnedAt, { sessionId: tables[0].id, at: tables[0].createdAt });
  assert.equal(ours(mkRound({ sessions: daily(3) }), 'twoTables').state, 'locked');
});

test('Kampagne 5 · 10 · 25: sessions ended „Fortsetzung folgt"; another ending does not count', () => {
  assert.equal(ours(mkRound({ sessions: daily(5, { ending: 'ongoing' }) }), 'campaign').tier, 5);
  const e = ours(mkRound({ sessions: [...daily(4, { ending: 'ongoing' }), sess(200, { ending: 'noWinner' })] }), 'campaign');
  assert.deepEqual([e.state, e.count], ['progress', 4]);
});

test('Gemeinsam gewonnen: everyone at the table won, guests included; solo, or one guest short, misses', () => {
  const guests = [{ id: 'q', name: 'Q' }];
  const yes = sess(0, { guests, winnerIds: ['a', 'b', 'q'] });
  assert.equal(ours(mkRound({ sessions: [yes] }), 'allWin').earnedAt.sessionId, yes.id);
  assert.equal(ours(mkRound({ sessions: [sess(0, { guests, winnerIds: ['a', 'b'] })] }), 'allWin').state, 'locked');
  assert.equal(ours(mkRound({ sessions: [sess(0, solo())] }), 'allWin').state, 'locked', 'a solo play is not „gemeinsam"');
});

test(`Jahrgang: a finished session in each of ${BADGE_VINTAGE_MONTHS} consecutive calendar months; a skipped month restarts`, () => {
  const month = (y, m, d = 15) => sess(0, { createdAt: new Date(Date.UTC(y, m, d, 19)).toISOString() });
  const year = Array.from({ length: 12 }, (_, m) => month(2025, m + 3)); // April 2025 … March 2026
  const e = ours(mkRound({ sessions: [month(2025, 3, 2), ...year] }), 'vintage');
  assert.equal(e.earnedAt.sessionId, year[11].id, 'two in one month are one month');
  const gap = [...year.slice(0, 6), ...Array.from({ length: 6 }, (_, i) => month(2025, 10 + i))];
  assert.equal(ours(mkRound({ sessions: gap }), 'vintage').state, 'locked');
});

test('Jubiläum 1 · 2 · 3: whole years since the first finished session, by opts.now, never attributed to a session', () => {
  const first = sess(0);
  const r = mkRound({ sessions: [first, sess(24)] });
  const at = (ms) => ours(r, 'anniversary', { now: ms });
  const year = Date.parse(first.createdAt) + 365 * DAY; // 2027 is not a leap year
  assert.deepEqual([at(year - 1).tier, at(year - 1).count, at(year - 1).of], [null, 0, 1]);
  assert.deepEqual(at(year).earnedAt, { sessionId: null, at: iso(year) });
  assert.equal(at(Date.parse(first.createdAt) + 3 * 366 * DAY).tier, 3);
  assert.ok(newSince(r, first.id, { deps: DEPS, now: year }).every((x) => x.key !== 'anniversary'));
  assert.equal(ours(mkRound(), 'anniversary').state, 'locked', 'no session, no clock to start');
});

// --- D. round, secret ---------------------------------------------------------------------

test(`Marathon: three evenings within ${BADGE_WINDOW_HOURS} hours; a three-table split is one evening`, () => {
  const ss = [sess(0), sess(5), sess(BADGE_WINDOW_HOURS)];
  assert.equal(ours(mkRound({ sessions: ss }), 'marathon').earnedAt.sessionId, ss[2].id);
  assert.equal(ours(mkRound({ sessions: [sess(0), sess(6), sess(13)] }), 'marathon').state, 'secret');
  const members = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const tables = split(0, [{ memberIds: ['a'] }, { memberIds: ['b'] }, { memberIds: ['c'] }]);
  assert.equal(ours(mkRound({ members, sessions: tables }), 'marathon').state, 'secret', 'one split is no Marathon');
  assert.equal(ours(mkRound({ members, sessions: [...tables, sess(4)] }), 'marathon').state, 'secret', 'nor a split and one more');
});

test(`Wiederentdeckt: ${BADGE_REDISCOVERED_DAYS} days since the game's last play (or since it joined); 364 misses`, () => {
  const replay = (days) => ours(mkRound({ sessions: [sess(0), sess(days * 24)] }), 'rediscovered');
  const games = [game('g1', { createdAt: iso(T0) })];
  const at = (days) => ours(mkRound({ games, sessions: [sess(0), sess(days * 24)] }), 'rediscovered');
  assert.equal(at(364).state, 'secret');
  assert.equal(at(365).state, 'earned');
  assert.equal(replay(365).state, 'earned');
  // Never played: counted from the day it joined the shelf.
  const old = [game('g1', { createdAt: iso(T0 - 365 * DAY) })];
  assert.equal(ours(mkRound({ games: old, sessions: [sess(0)] }), 'rediscovered').state, 'earned');
  const fresh = [game('g1', { createdAt: iso(T0 - 364 * DAY) })];
  assert.equal(ours(mkRound({ games: fresh, sessions: [sess(0)] }), 'rediscovered').state, 'secret');
});

test(`Gegen den Strom: the played game came last of at least ${BADGE_TIDE_MIN_GAMES} ranked; two ranked, a direct pick or an all-tie misses`, () => {
  const vote = (r1, r2, r3) => ({ a: { g1: { rating: r1 }, g2: { rating: r2 }, g3: { rating: r3 } } });
  const three = { gameIds: ['g1', 'g2', 'g3'] };
  const last = sess(0, { ...three, votes: vote(1, 4, 5) });
  assert.equal(ours(mkRound({ sessions: [last] }), 'againstTheTide').earnedAt.sessionId, last.id);
  assert.equal(ours(mkRound({ sessions: [sess(0, { ...three, votes: vote(1, 1, 5) })] }), 'againstTheTide').state, 'earned', 'a shared last place is last');
  assert.equal(ours(mkRound({ sessions: [sess(0, { ...three, votes: vote(4, 1, 5) })] }), 'againstTheTide').state, 'secret', 'the middle is no tide');
  const two = sess(0, { gameIds: ['g1', 'g2'], votes: { a: { g1: { rating: 1 }, g2: { rating: 5 } } } });
  assert.equal(ours(mkRound({ sessions: [two] }), 'againstTheTide').state, 'secret');
  assert.equal(ours(mkRound({ sessions: [sess(0, three)] }), 'againstTheTide').state, 'secret', 'a direct pick ranked nothing');
  assert.equal(ours(mkRound({ sessions: [sess(0, { ...three, votes: vote(3, 3, 3) })] }), 'againstTheTide').state, 'secret', 'all level is no tide');
});

test('Vollständig: the ROUND played every shelf game, with no one person at all of them; a later addition does not un-earn', () => {
  const ss = [sess(0, { memberIds: ['a'] }), sess(24, { memberIds: ['b'], chosenGameId: 'g2' }), sess(48, { memberIds: ['a'], chosenGameId: 'g3' })];
  const later = game('g9', { createdAt: iso(T0 + 1000 * DAY) });
  const r = mkRound({ games: [game('g1'), game('g2'), game('g3'), later], sessions: ss });
  assert.equal(ours(r, 'complete').earnedAt.sessionId, ss[2].id);
  assert.equal(mine(r, 'allPlayed').state, 'progress', 'nobody played them all, the round did');
  assert.equal(ours(mkRound({ sessions: ss.slice(0, 2) }), 'complete').state, 'secret');
});

// --- E. account --------------------------------------------------------------------------

test('account Spiele 10 · 25 · 50 · 100: distinct games played, both sides of each tier', () => {
  const at = (n) => accountBadges({ gamesPlayed: n }, null, T0).find((e) => e.key === 'accountGames');
  for (const [n, tier, of] of [[9, null, 10], [10, 10, 25], [24, 10, 25], [25, 25, 50], [49, 25, 50], [50, 50, 100], [99, 50, 100], [100, 100, null]]) {
    assert.deepEqual([at(n).tier, at(n).of], [tier, of], `${n} games`);
  }
  assert.equal(accountBadges({}, null, T0).find((e) => e.key === 'accountGames').state, 'locked');
});
