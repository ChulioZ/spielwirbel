'use strict';

/*
 * Personal bests and group records derived from session points (#1630) —
 * public/js/point-records.js, driven with the real sibling modules it is
 * handed in the browser.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gamePointRecords, sessionPointLines, memberPointRecords, isValidPoints, pointsBeat, POINTS_MIN, POINTS_MAX } =
  require('../public/js/point-records');
const { sessionPartyGroups } = require('../public/js/session-people');
const { sortSessionsByDate } = require('../public/js/session-order');

const deps = { sessionPartyGroups, sortSessionsByDate };
const members = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cem' }];
const game = { id: 'g', title: 'Azul' };

let n = 0;
const play = (day, scores, extra = {}) => ({
  id: `s${++n}`, createdAt: `2026-03-${String(day).padStart(2, '0')}T20:00:00.000Z`,
  gameIds: ['g'], chosenGameId: 'g', finished: true, cancelled: false,
  memberIds: ['a', 'b', 'c'], votes: {}, winnerIds: [], scores, ...extra,
});
const roundOf = (sessions, g = game) => ({ members, games: [g], sessions });
const marks = (records) => records.plays.map((p) => p.lines.filter((l) => l.newRecord).map((l) => l.party.id));

test('the bounds and the comparison', () => {
  assert.equal(isValidPoints(0), true);
  assert.equal(isValidPoints(POINTS_MIN), true);
  assert.equal(isValidPoints(POINTS_MAX), true);
  for (const bad of [1.5, '3', null, undefined, NaN, POINTS_MIN - 1, POINTS_MAX + 1]) assert.equal(isValidPoints(bad), false);
  assert.equal(pointsBeat(5, 3, false), true);
  assert.equal(pointsBeat(5, 3, true), false);
  assert.equal(pointsBeat(3, 3, false), false, 'a tie beats nothing');
});

test('a first score is not a record, a tie is not either, beating the best is', () => {
  const r = gamePointRecords(roundOf([
    play(1, { a: 40, b: 50 }),
    play(2, { a: 40, b: 30 }),
    play(3, { a: 45, b: 49 }),
  ]), game, deps);
  assert.deepEqual(marks(r), [[], [], ['a']]);
  assert.equal(r.bests.get('a').points, 45);
  assert.equal(r.bests.get('b').points, 50);
  assert.equal(r.record.points, 50);
  assert.equal(r.record.party.id, 'b');
  // Lines are best first.
  assert.deepEqual(r.plays[0].lines.map((l) => l.party.id), ['b', 'a']);
});

test('lower score wins flips bests, records and order', () => {
  const low = { ...game, lowScoreWins: true };
  const r = gamePointRecords(roundOf([play(1, { a: 72, b: 80 }), play(2, { a: 70, b: 85 })], low), low, deps);
  assert.deepEqual(marks(r), [[], ['a']]);
  assert.equal(r.record.points, 70);
  assert.deepEqual(r.plays[1].lines.map((l) => l.party.id), ['a', 'b']);
});

test('"earlier" is by session DATE, not by insertion order', () => {
  // The March-1 evening was logged last (#1616): inserted after March 5.
  const late = play(5, { a: 60 });
  const logged = play(1, { a: 50 });
  const r = gamePointRecords(roundOf([late, logged]), game, deps);
  assert.deepEqual(r.plays.map((p) => p.session.id), [logged.id, late.id]);
  assert.deepEqual(marks(r), [[], ['a']], 'the later evening beat the earlier one');
});

test('deleting the session that set a best moves it back', () => {
  const s1 = play(1, { a: 10 });
  const s2 = play(2, { a: 20 });
  assert.equal(gamePointRecords(roundOf([s1, s2]), game, deps).bests.get('a').points, 20);
  const after = gamePointRecords(roundOf([s1]), game, deps);
  assert.equal(after.bests.get('a').points, 10);
  assert.equal(after.record.points, 10);
});

test('a team score holds the record but is nobody’s personal best; a guest neither', () => {
  const teamPlay = play(1, { t1: 99, c: 20 }, { teams: [{ id: 't1', personIds: ['a', 'b'] }] });
  const guestPlay = play(2, { g1: 120, a: 30 }, { guests: [{ id: 'g1', name: 'Dana' }] });
  const solo = play(3, { a: 35 });
  const r = gamePointRecords(roundOf([teamPlay, guestPlay, solo]), game, deps);
  assert.equal(r.bests.has('t1'), false);
  assert.equal(r.bests.has('g1'), false, 'a guest has no personal best');
  assert.equal(r.record.party.id, 'g1', 'but can hold the group record');
  // Anna's first OWN score is 30 (the team's 99 does not count), so 35 is a record.
  assert.deepEqual(marks(r), [[], [], ['a']]);
});

test('unfinished, cancelled, other-game and score-less sessions are skipped', () => {
  const r = gamePointRecords(roundOf([
    play(1, { a: 90 }, { finished: false }),
    play(2, { a: 91 }, { cancelled: true }),
    play(3, { a: 92 }, { chosenGameId: 'other' }),
    play(4, undefined),
    play(5, { a: 'x', zz: 4 }),
    play(6, { a: 5 }),
  ]), game, deps);
  assert.equal(r.plays.length, 1);
  assert.equal(r.record.points, 5);
});

test('sessionPointLines reads one session with marks from the whole history', () => {
  const s1 = play(1, { a: 10, b: 12 });
  const s2 = play(2, { a: 11 });
  const round = roundOf([s1, s2]);
  const lines = sessionPointLines(round, s2, deps);
  assert.deepEqual(lines.map((l) => [l.party.id, l.points, l.newRecord]), [['a', 11, true]]);
  assert.deepEqual(sessionPointLines(round, play(9, undefined), deps), []);
  assert.deepEqual(sessionPointLines(round, { id: 'x', chosenGameId: 'nope' }, deps), []);
});

// --- #1631: the group-record mark and one member's record book ------------------

const groupMarks = (records) => records.plays.map((p) => p.lines.filter((l) => l.groupRecord).map((l) => l.party.id));

test('groupRecord marks the line that broke the round record — never the first play, never a tie', () => {
  const r = gamePointRecords(roundOf([
    play(1, { a: 40, b: 50 }),
    play(2, { a: 50, c: 20 }),
    play(3, { a: 60, b: 55 }),
    play(4, { b: 61, c: 61 }),
  ]), game, deps);
  assert.deepEqual(groupMarks(r), [[], [], ['a'], ['b', 'c']]);
});

test('groupRecord follows the game direction', () => {
  const low = { ...game, lowScoreWins: true };
  const r = gamePointRecords(roundOf([play(1, { a: 72 }), play(2, { b: 70 }), play(3, { a: 71 })], low), low, deps);
  assert.deepEqual(groupMarks(r), [[], ['b'], []]);
});

test('memberPointRecords: bests per game, records held and broken, bests bettered', () => {
  const chess = { id: 'h', title: 'Hive' };
  const team = { teams: [{ id: 't1', personIds: ['a', 'b'] }] };
  const round = {
    members,
    games: [game, chess],
    sessions: [
      play(1, { a: 10, b: 20 }),
      play(2, { a: 30, b: 5 }),                     // a breaks the record, a betters own best
      play(3, { t1: 50, c: 1 }, team),              // the team breaks it: counts for a AND b
      { ...play(4, { a: 7 }), chosenGameId: 'h' },  // first Hive play: a best, no record
      { ...play(5, { c: 9 }), chosenGameId: 'h' },  // c takes the Hive record
    ],
  };
  const a = memberPointRecords(round, 'a', deps);
  assert.deepEqual(a.bests.map((b) => [b.game.id, b.points]), [['g', 30], ['h', 7]], 'a team score is no personal best');
  assert.deepEqual(a.held, ['g'], 'Azul via the team, not Hive');
  assert.deepEqual(a.records.map((e) => e.session.id), [round.sessions[1].id, round.sessions[2].id]);
  assert.deepEqual(a.bettered.map((e) => e.session.id), [round.sessions[1].id]);

  const b = memberPointRecords(round, 'b', deps);
  assert.deepEqual(b.held, ['g'], 'the team record is b\'s too');
  assert.deepEqual(b.records.map((e) => e.session.id), [round.sessions[2].id]);
  assert.deepEqual(b.bettered, []);

  const c = memberPointRecords(round, 'c', deps);
  assert.deepEqual(c.held, ['h']);
  assert.deepEqual(c.records.map((e) => e.gameId), ['h']);

  assert.deepEqual(memberPointRecords(roundOf([play(1, undefined)]), 'a', deps),
    { bests: [], held: [], records: [], bettered: [] });
});

test('memberPointRecords lists records oldest first across games, by session date', () => {
  const other = { id: 'h', title: 'Hive' };
  const round = {
    members,
    games: [game, other],
    sessions: [
      play(10, { a: 1 }), play(11, { a: 2 }),                                       // Azul: record 11th
      { ...play(3, { b: 1 }), chosenGameId: 'h' }, { ...play(5, { a: 2 }), chosenGameId: 'h' }, // Hive: 5th
    ],
  };
  assert.deepEqual(memberPointRecords(round, 'a', deps).records.map((e) => e.gameId), ['h', 'g']);
});

test('memberPointRecords: a tie at the record within the session that set it is held by both', () => {
  const round = roundOf([play(1, { a: 10 }), play(2, { b: 20, c: 20, a: 5 }), play(3, { a: 20 })]);
  assert.deepEqual(memberPointRecords(round, 'b', deps).held, ['g']);
  assert.deepEqual(memberPointRecords(round, 'c', deps).held, ['g'], 'the second party tied in the record session holds it too');
  assert.deepEqual(memberPointRecords(round, 'a', deps).held, [], 'a later tie is not a record — the earliest reach holds it');
});
