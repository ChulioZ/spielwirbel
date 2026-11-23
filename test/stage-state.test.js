'use strict';

/* stageState (#1854): where a round stands, as the Start tab's stage says it.
   One case per row of the issue's table, plus the three it names on top —
   two open sessions, a split parent with open tables, a cancelled newest one —
   and the voter line's three shapes. Pure: the two siblings it reads come in
   as `deps`, exactly as the frontend passes them (hub-stage-say.js). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { stageState, stageVoters, STAGE_VOTER_NAMES } = require('../public/js/stage-state');
const { sessionOutcome } = require('../public/js/session-outcome');
const { newestSessionsFirst } = require('../public/js/session-order');

const DEPS = { sessionOutcome, newestSessionsFirst };
const games = [{ id: 1, title: 'Azul' }, { id: 2, title: 'Just One' }, { id: 3, title: 'Codenames' }];
const at = (d) => `2026-11-${String(d).padStart(2, '0')}T20:00:00.000Z`;
const played = (id, d, extra = {}) => ({ id, createdAt: at(d), done: true, finished: true, gameIds: [1, 2], chosenGameId: 1, ...extra });
const voting = (id, d, extra = {}) => ({ id, createdAt: at(d), done: false, finished: false, cancelled: false, gameIds: [1, 2, 3], ...extra });
const onTable = (id, d, extra = {}) => ({ id, createdAt: at(d), done: true, finished: false, cancelled: false, gameIds: [2], chosenGameId: 2, ...extra });
const of = (sessions, shelf = games) => stageState({ games, sessions }, shelf, DEPS);

test('empty: no active game', () => {
  const st = of([], []);
  assert.equal(st.kind, 'empty');
  assert.equal(st.session, null);
});

test('young: games, nothing drawn — and a cancelled draw keeps it young', () => {
  assert.equal(of([]).kind, 'young');
  const st = of([{ ...played('c', 3), finished: false, cancelled: true }]);
  assert.equal(st.kind, 'young');
  assert.equal(st.counts.games, 3);
  assert.deepEqual(st.games.map((g) => g.id), [1, 2, 3], 'the covers the stage lays out');
});

test('normal: nothing open, one played', () => {
  const st = of([played('p', 4)]);
  assert.equal(st.kind, 'normal');
  assert.equal(st.session, null, 'the last session is the design\'s own „Zuletzt" element, not the stage\'s');
});

test('running: the newest session is still being voted on, and carries no game', () => {
  const st = of([played('p', 4), voting('v', 9)]);
  assert.equal(st.kind, 'running');
  assert.equal(st.session.id, 'v');
  assert.equal(st.game, null, 'a running vote must name no game — the draw is secret');
  assert.equal(st.counts.games, 3);
});

test('table: the newest session is voted and its result not entered', () => {
  const st = of([played('p', 4), onTable('t', 9)]);
  assert.equal(st.kind, 'table');
  assert.equal(st.game.title, 'Just One');
  // A voted session with no game chosen yet still speaks — without a game.
  assert.equal(of([onTable('t', 9, { chosenGameId: null })]).game, null);
});

test('two open sessions: the stage speaks for the NEWEST, whatever its kind', () => {
  assert.equal(of([onTable('t', 8), voting('v', 9)]).session.id, 'v');
  const st = of([voting('v', 8), onTable('t', 9)]);
  assert.equal(st.kind, 'table');
  assert.equal(st.session.id, 't');
});

test('a split parent is resolved, and its open tables stay tickets: the stage does not speak for one table', () => {
  const parent = played('sp', 5, { finished: false, done: true, childSessionIds: ['a', 'b'] });
  const tables = [onTable('a', 5, { parentSessionId: 'sp' }), onTable('b', 5, { parentSessionId: 'sp' })];
  const st = of([parent, ...tables]);
  assert.equal(st.kind, 'normal', 'the evening is underway at its tables — the stage asks what is next');
  assert.equal(st.session, null);
});

test('a cancelled newest session is not open: the stage speaks for the open one under it', () => {
  const st = of([voting('v', 7), { ...voting('x', 9), cancelled: true }]);
  assert.equal(st.kind, 'running');
  assert.equal(st.session.id, 'v');
  assert.equal(of([played('p', 4), { ...voting('x', 9), cancelled: true }]).kind, 'normal');
});

test('the voter line: names up to the cap, a count past it, none when nobody voted', () => {
  const people = ['Anna', 'Ben', 'Cem', 'Dana', 'Emil'].map((name, i) => ({ id: 'm' + i, name }));
  assert.deepEqual(stageVoters(people, []), { kind: 'none', voters: [] });
  assert.deepEqual(stageVoters(people, undefined).kind, 'none');
  const two = stageVoters(people, ['m1', 'm0']);
  assert.equal(two.kind, 'names');
  assert.deepEqual(two.voters.map((p) => p.name), ['Anna', 'Ben'], 'in the session\'s own order, not the vote order');
  const ids = people.slice(0, STAGE_VOTER_NAMES).map((p) => p.id);
  assert.equal(stageVoters(people, ids).kind, 'names', 'the cap itself is still names');
  assert.deepEqual(stageVoters(people, [...ids, 'm4']), { kind: 'count', n: STAGE_VOTER_NAMES + 1, of: 5 });
  // An id nobody at the session holds does not count as a voter.
  assert.equal(stageVoters(people, ['ghost']).kind, 'none');
});
