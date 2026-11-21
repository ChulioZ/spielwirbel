'use strict';

/* The challenge derivation (#1779, public/js/challenges.js): every preset's
 * progress against a fixture, including a split evening, a deleted session, a
 * session dated before the start and the deadline passing with no scheduler. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  challengeProgress, challengeRunning, challengeHistory, currentChallenge,
  challengeStartError, challengeDeadlineInstant, challengeDaysLeft,
} = require('../public/js/challenges');
const { isActiveGame } = require('../public/js/draw-pool');

const opts = { isActive: isActiveGame };
const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-03-01T12:00:00.000Z');
const at = (d) => new Date(START + d * DAY).toISOString();
let seq = 0;
const played = (gid, d, extra = {}) => ({ id: `s${++seq}`, createdAt: at(d), chosenGameId: gid, finished: true, cancelled: false, done: true, ...extra });
const games = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id.toUpperCase() }));
const ch = (kind, extra = {}) => ({ kind, startedAt: at(0), deadline: at(30), ...extra });
const round = (sessions, extra = {}) => ({ id: 'r', games: games.concat(extra.games || []), sessions });

test('sessions: a split evening is ONE session; before-start, open and cancelled ones do not count', () => {
  const sessions = [
    played('a', -2), // before the start
    played('a', 1),
    played('b', 2, { parentSessionId: 'p' }), played('c', 2, { parentSessionId: 'p' }), // one split evening
    { id: 'p', createdAt: at(2), childSessionIds: ['x', 'y'], done: true }, // the split parent itself
    { id: 'open', createdAt: at(3), chosenGameId: 'd', finished: false, done: true },
    { id: 'gone', createdAt: at(3), cancelled: true },
    played('d', 31), // after the deadline
  ];
  const p = challengeProgress(round(sessions), ch('sessions', { n: 3 }), START + 40 * DAY, opts);
  assert.equal(p.count, 2);
  assert.equal(p.of, 3);
  assert.equal(p.state, 'expired');
  assert.equal(p.completedAt, null);
});

test('sessions: reaching the goal completes it at that session, and completion outlives the deadline', () => {
  const a = played('a', 1); const b = played('b', 5);
  const p = challengeProgress(round([a, b, played('c', 6)]), ch('sessions', { n: 2 }), START + 99 * DAY, opts);
  assert.equal(p.state, 'completed');
  assert.deepEqual(p.completedAt, { sessionId: b.id, at: b.createdAt });
  assert.equal(p.count, 2, 'count is capped at the target');
  assert.deepEqual(p.steps.map((s) => s.sessionId), [a.id, b.id, p.steps[2].sessionId]);
});

test('deleting a session corrects the count — nothing is stored', () => {
  const s1 = played('a', 1); const s2 = played('b', 2);
  const c = ch('distinctGames', { n: 2 });
  assert.equal(challengeProgress(round([s1, s2]), c, START + DAY * 3, opts).state, 'completed');
  const after = challengeProgress(round([s1]), c, START + DAY * 3, opts);
  assert.equal(after.state, 'running');
  assert.equal(after.count, 1);
});

test('distinctGames: a game played twice counts once; guest games do not count', () => {
  const r = round([played('a', 1), played('a', 2), played('g', 3)], { games: [{ id: 'g', title: 'G', guestGame: true }] });
  assert.equal(challengeProgress(r, ch('distinctGames', { n: 5 }), START + DAY, opts).count, 1);
});

test('newGames: only games with no play at or before the start; one bought later counts', () => {
  const r = round([played('a', -5), played('a', 1), played('b', 2), played('e', 3)], { games: [{ id: 'e', title: 'E' }] });
  const p = challengeProgress(r, ch('newGames', { n: 3 }), START + 4 * DAY, opts);
  assert.equal(p.count, 2, 'b and the later purchase e, never a');
  assert.equal(p.state, 'running');
});

test('wholeShelf: the snapshot is the target; deleted games drop out, a retired one stays only if played', () => {
  const c = ch('wholeShelf', { shelfSnapshot: ['a', 'b', 'c', 'gone'] });
  const r = { id: 'r', games: [{ id: 'a' }, { id: 'b', retired: true }, { id: 'c', retired: true }, { id: 'd' }], sessions: [played('a', 1), played('b', 2), played('d', 3)] };
  const p = challengeProgress(r, c, START + 4 * DAY, opts);
  assert.equal(p.of, 2, 'a, plus b (retired but played); c retired unplayed and the deleted game drop out');
  assert.equal(p.count, 2);
  assert.equal(p.state, 'completed');
});

test('an early end closes the window and reads as ended', () => {
  const c = ch('sessions', { n: 5, endedAt: at(2) });
  const p = challengeProgress(round([played('a', 1), played('b', 3)]), c, START + 3 * DAY, opts);
  assert.equal(p.count, 1);
  assert.equal(p.state, 'ended');
});

test('running is derived from the clock: the deadline passing makes it expired', () => {
  const r = { ...round([]), challenge: ch('sessions', { n: 1 }) };
  assert.equal(challengeRunning(r, START + DAY, opts), true);
  assert.equal(challengeRunning(r, START + 31 * DAY, opts), false);
  assert.equal(currentChallenge(r, START + 31 * DAY, opts).state, 'expired');
  assert.equal(currentChallenge(round([]), START, opts), null);
  assert.deepEqual(challengeHistory({ ...r, challengeHistory: [ch('sessions', { n: 1 })] }, START + 31 * DAY, opts).map((h) => h.state), ['expired']);
});

test('challengeStartError validates kind, n and deadline', () => {
  const now = START;
  const ok = { kind: 'sessions', n: 3, deadline: at(10) };
  assert.equal(challengeStartError(ok, now), null);
  assert.equal(challengeStartError({ kind: 'wholeShelf', deadline: at(10) }, now), null);
  assert.equal(challengeStartError({ ...ok, kind: 'nope' }, now), 'Invalid kind');
  assert.equal(challengeStartError({ ...ok, n: 0 }, now), 'Invalid n');
  assert.equal(challengeStartError({ ...ok, n: 2.5 }, now), 'Invalid n');
  assert.equal(challengeStartError({ ...ok, n: 101 }, now), 'Invalid n');
  assert.equal(challengeStartError({ kind: 'wholeShelf', n: 3, deadline: at(10) }, now), 'Invalid n');
  assert.equal(challengeStartError({ ...ok, deadline: at(-1) }, now), 'Invalid deadline');
  assert.equal(challengeStartError({ ...ok, deadline: at(800) }, now), 'Invalid deadline');
  assert.equal(challengeStartError({ ...ok, deadline: '2026-03-05' }, now), 'Invalid deadline');
  assert.equal(challengeStartError(null, now), 'Invalid kind');
});

test('the deadline is the end of the picked LOCAL day; days left count today', () => {
  const iso = challengeDeadlineInstant('2026-03-31');
  const d = new Date(iso);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 2, 31, 23, 59]);
  assert.equal(challengeDeadlineInstant('31.3.2026'), null);
  assert.equal(challengeDaysLeft({ deadline: at(2) }, START), 2);
  assert.equal(challengeDaysLeft({ deadline: at(0.5) }, START), 1);
  assert.equal(challengeDaysLeft({ deadline: at(-1) }, START), 0);
});
