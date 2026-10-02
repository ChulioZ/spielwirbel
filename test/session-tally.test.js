'use strict';

/*
 * The two counts over a round's sessions that the Pokale card and Das
 * Programmheft's share card share (public/js/session-tally.js, #1381).
 * The Pokale's own rendering of the streak stays covered by its view specs;
 * this pins the rule itself, so both callers are held to one definition.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { winStreak, sessionNumber } = require('../public/js/session-tally');
const { sessionEnding } = require('../public/js/session-outcome');
const { sessionPartyCount } = require('../public/js/session-people');

const DEPS = { sessionEnding, sessionPartyCount };
const round = { members: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] };
let seq = 0;
const s = (winnerIds, extra = {}) => ({
  id: `s${++seq}`, createdAt: `2026-09-${String(10 + seq).padStart(2, '0')}T20:00:00Z`,
  finished: true, winnerIds, ...extra,
});

test('the streak counts back from the latest win, in createdAt order', () => {
  const list = [s(['b']), s(['a']), s(['a']), s(['a'])];
  const run = winStreak(round, [...list].reverse(), DEPS);
  assert.deepEqual({ ...run, memberIds: [...run.memberIds] }, { memberIds: ['a'], n: 3, lastId: list[3].id });
});

test('a shared win continues it for each winner (#1421); a loss or somebody else’s win breaks it', () => {
  assert.equal(winStreak(round, [s(['a']), s(['a', 'b']), s(['a'])], DEPS).n, 3);
  assert.equal(winStreak(round, [s(['a']), s([], { ending: 'lost' }), s(['a'])], DEPS).n, 1);
  assert.equal(winStreak(round, [s(['a']), s(['b']), s(['a'])], DEPS).n, 1);
  const none = winStreak(round, [s(['a']), s([], { ending: 'lost' })], DEPS);
  assert.deepEqual([...none.memberIds], []);
  assert.equal(none.n, 0);
});

test('the answer is the longest run still going, and everyone who holds it', () => {
  // a alone twice, then level with b: a is on 3, b on 1 — only the longest is reported.
  const longest = winStreak(round, [s(['a']), s(['a']), s(['a', 'b'])], DEPS);
  assert.deepEqual([...longest.memberIds], ['a']);
  assert.equal(longest.n, 3);
  // a and b won the last two together: they hold it jointly.
  const joint = winStreak(round, [s(['c']), s(['a', 'b']), s(['b', 'a'])], DEPS);
  assert.deepEqual([...joint.memberIds].sort(), ['a', 'b']);
  assert.equal(joint.n, 2);
});

test('guest wins, solo nights and nights that were no contest are skipped, not counted', () => {
  // Built in chronological order: `s()` stamps createdAt as it is called.
  const list = [
    s(['a']),
    s(['g1'], { guests: [{ id: 'g1', name: 'Gast' }] }),
    s(['a']),
    s(['b'], { memberIds: ['b'] }),
    s([], { ending: 'noWinner' }),
    s([], { ending: 'ongoing' }),
  ];
  const run = winStreak(round, list, DEPS);
  assert.deepEqual([...run.memberIds], ['a']);
  assert.equal(run.n, 2, 'the four skipped nights neither break nor extend it');
  assert.equal(run.lastId, list[2].id, 'the streak ends at the last night that COUNTED');
});

test('a session’s number counts the finished ones up to it, itself included whether stored finished or not', () => {
  const a = s(['a']);
  const b = s(['b']);
  const open = s([], { finished: false });
  const later = s(['a']);
  const r = { ...round, sessions: [later, open, b, a] };
  assert.equal(sessionNumber(r, a), 1);
  assert.equal(sessionNumber(r, b), 2);
  assert.equal(sessionNumber(r, { ...later, finished: false }), 3, 'the unfinished one before it does not count');
  assert.equal(sessionNumber(r, open), 3);
});
