'use strict';

/*
 * The counts over a round's sessions that the Pokale card and Das
 * Programmheft's share card share (public/js/session-tally.js, #1381), and the
 * longest streak Die Brücke's „Längste Serie" plate reads (#1422).
 * The Pokale's own rendering of the streak stays covered by its view specs;
 * this pins the rule itself, so both callers are held to one definition.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { winStreak, longestStreak, sessionNumber } = require('../public/js/session-tally');
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

// --- the longest streak ever (#1422, Die Brücke's „Längste Serie") ----------

test('the longest streak is the longest run at ANY point, not the one still going', () => {
  // a three times, then b twice and still going: the record is a's 3.
  const list = [s(['a']), s(['a']), s(['a']), s(['b']), s(['b'])];
  const rec = longestStreak(round, [...list].reverse(), DEPS);
  assert.deepEqual([...rec.memberIds], ['a']);
  assert.equal(rec.n, 3);
  assert.equal(rec.from, list[0].createdAt, 'the run starts at its first night');
  assert.equal(rec.to, list[2].createdAt, 'and ends at its last');
  assert.equal(winStreak(round, list, DEPS).n, 2, 'the current streak is still the other figure');
});

test('a shared win extends every winner’s run; a joint run is one run with one span', () => {
  const list = [s(['c']), s(['a', 'b']), s(['b', 'a']), s(['c'])];
  const rec = longestStreak(round, list, DEPS);
  assert.deepEqual([...rec.memberIds].sort(), ['a', 'b']);
  assert.equal(rec.n, 2);
  assert.equal(rec.from, list[1].createdAt);
  assert.equal(rec.to, list[2].createdAt);
});

test('two separate runs of the record length name both holders and no span', () => {
  const list = [s(['a']), s(['a']), s(['b']), s(['b']), s(['c'])];
  const rec = longestStreak(round, list, DEPS);
  assert.deepEqual([...rec.memberIds], ['a', 'b']);
  assert.equal(rec.n, 2);
  assert.equal(rec.from, null, 'two runs have no one span to print');
  assert.equal(rec.to, null);
});

test('the longest streak skips the same nights the current one does', () => {
  const list = [
    s(['a']),
    s(['g1'], { guests: [{ id: 'g1', name: 'Gast' }] }),
    s(['b'], { memberIds: ['b'] }),
    s([], { ending: 'noWinner' }),
    s(['a']),
    s([], { ending: 'lost' }),
    s(['a']),
  ];
  const rec = longestStreak(round, list, DEPS);
  assert.deepEqual([...rec.memberIds], ['a']);
  assert.equal(rec.n, 2, 'skipped nights neither break nor extend it; a lost night breaks it');
  assert.deepEqual({ ...longestStreak(round, [], DEPS), memberIds: [] }, { memberIds: [], n: 0, from: null, to: null });
});
