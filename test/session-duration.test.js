'use strict';

/*
 * The shared rules of a session's playing time (#1770), on their own:
 *  - the bounds the result's field and the route agree on;
 *  - the timer's reading and the finish-transition stamp (floor, ceiling,
 *    never over a recorded figure, never on an already-finished session);
 *  - the Spielepass median: two sessions minimum, rounded to 5, played and
 *    un-cancelled sessions of that game only.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DURATION_MIN, DURATION_MAX, DURATION_TIMER_FLOOR,
  isValidDuration, elapsedMinutes, settlePlayDuration, roundGameDuration,
} = require('../public/js/session-duration');
const { buildChildSessions } = require('../lib/session-split');

const at = (min) => new Date(Date.UTC(2026, 10, 8, 19, 0) + min * 60000).toISOString();

test('the bounds are whole minutes from one minute to a day', () => {
  assert.equal(isValidDuration(DURATION_MIN), true);
  assert.equal(isValidDuration(DURATION_MAX), true);
  for (const bad of [0, -5, DURATION_MAX + 1, 90.5, '90', null, undefined, NaN]) {
    assert.equal(isValidDuration(bad), false, String(bad));
  }
});

test('elapsedMinutes floors whole minutes and refuses a backwards or broken span', () => {
  assert.equal(elapsedMinutes(at(0), at(110)), 110);
  assert.equal(elapsedMinutes(at(0), new Date(Date.parse(at(3)) + 59000).toISOString()), 3);
  assert.equal(elapsedMinutes(at(10), at(0)), null);
  assert.equal(elapsedMinutes(null, at(0)), null);
  assert.equal(elapsedMinutes('garbage', at(0)), null);
});

test('settlePlayDuration stamps the timer on the finish transition', () => {
  const s = { finished: false, startedPlayingAt: at(0) };
  settlePlayDuration(s, at(95));
  assert.equal(s.durationMinutes, 95);
});

test('settlePlayDuration records nothing under the floor or past a day', () => {
  const short = { finished: false, startedPlayingAt: at(0) };
  settlePlayDuration(short, at(DURATION_TIMER_FLOOR - 1));
  assert.equal('durationMinutes' in short, false);
  const atFloor = { finished: false, startedPlayingAt: at(0) };
  settlePlayDuration(atFloor, at(DURATION_TIMER_FLOOR));
  assert.equal(atFloor.durationMinutes, DURATION_TIMER_FLOOR);
  const forgotten = { finished: false, startedPlayingAt: at(0) };
  settlePlayDuration(forgotten, at(DURATION_MAX + 1));
  assert.equal('durationMinutes' in forgotten, false);
});

test('settlePlayDuration never overwrites a figure, re-stamps a finished session, or runs without a start', () => {
  const typed = { finished: false, startedPlayingAt: at(0), durationMinutes: 40 };
  settlePlayDuration(typed, at(200));
  assert.equal(typed.durationMinutes, 40);
  // A winner tap on a finished session re-POSTs /finish: the stamp is the transition only.
  const done = { finished: true, startedPlayingAt: at(0) };
  settlePlayDuration(done, at(200));
  assert.equal('durationMinutes' in done, false);
  const untimed = { finished: false };
  settlePlayDuration(untimed, at(200));
  assert.equal('durationMinutes' in untimed, false);
});

test('roundGameDuration needs two timed sessions and rounds the median to 5', () => {
  const play = (min, extra = {}) => ({ finished: true, chosenGameId: 'g1', durationMinutes: min, ...extra });
  assert.equal(roundGameDuration([play(110)], 'g1'), null);
  assert.deepEqual(roundGameDuration([play(100), play(121)], 'g1'), { minutes: 110, count: 2 });
  assert.deepEqual(roundGameDuration([play(50), play(112), play(300)], 'g1'), { minutes: 110, count: 3 });
  // Never below 5, even for a very short game.
  assert.deepEqual(roundGameDuration([play(1), play(2)], 'g1'), { minutes: 5, count: 2 });
});

test('roundGameDuration counts only played, un-cancelled, timed sessions of that game', () => {
  const sessions = [
    { finished: true, chosenGameId: 'g1', durationMinutes: 60 },
    { finished: true, chosenGameId: 'g2', durationMinutes: 300 },
    { finished: false, chosenGameId: 'g1', durationMinutes: 300 },
    { finished: true, cancelled: true, chosenGameId: 'g1', durationMinutes: 300 },
    { finished: true, chosenGameId: 'g1' },
    { finished: true, chosenGameId: 'g1', durationMinutes: 0 },
  ];
  assert.equal(roundGameDuration(sessions, 'g1'), null);
  sessions.push({ finished: true, chosenGameId: 'g1', durationMinutes: 70 });
  assert.deepEqual(roundGameDuration(sessions, 'g1'), { minutes: 65, count: 2 });
});

test('each table of a split session starts its own clock when the split creates it', () => {
  const round = { members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }] };
  const parent = { id: 'p', memberIds: ['m1', 'm2'], gameIds: ['g1', 'g2'] };
  const before = Date.now();
  const tables = buildChildSessions(round, parent, [{ gameId: 'g1', personIds: ['m1'] }, { gameId: 'g2', personIds: ['m2'] }], { type: 'started' });
  assert.equal(tables.length, 2);
  for (const tb of tables) {
    assert.ok(Date.parse(tb.startedPlayingAt) >= before, 'stamped at the split');
    assert.equal(tb.startedPlayingAt, tb.chosenAt, 'the same instant the table took its game');
  }
});
