'use strict';

/*
 * A session's real playing time (#1770), through the real routes on the JSON
 * backend:
 *  - „Jetzt spielen" (played now) and choosing a game stamp `startedPlayingAt`;
 *    clearing the choice drops it; a logged evening has no timer;
 *  - the finish transition records the elapsed minutes, a winner tap afterwards
 *    re-POSTs /finish and leaves them alone, and so does an un-finish + re-finish;
 *  - PUT …/duration sets, replaces and clears them; bad values and running
 *    sessions are 400s;
 *  - a logged evening takes typed minutes on create, and only a logged one.
 * The server clock is mocked (Date only) so the elapsed time is exact.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const { DURATION_MAX } = require('../public/js/session-duration');

const T0 = Date.UTC(2026, 10, 8, 19, 0);
const MIN = 60000;
const PAST = '2026-03-01T20:00:00.000Z';

async function addGame(rid, title) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8' })) req.field(k, v);
  return (await req).body;
}
const finish = (rid, sid, body = {}) => request(app).post(`/api/rounds/${rid}/sessions/${sid}/finish`).send({ winnerIds: [], ...body });
const duration = (rid, sid, durationMinutes) => request(app).put(`/api/rounds/${rid}/sessions/${sid}/duration`).send({ durationMinutes });
const sessionOf = async (rid, sid) => (await request(app).get(`/api/rounds/${rid}`)).body.sessions.find((s) => s.id === sid);

async function playNow(t, extra = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const round = await createRound(request);
  const game = await addGame(round.id, 'Azul');
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ gameId: game.id, ...extra });
  assert.equal(res.status, 201);
  return { round, game, session: res.body.session };
}

test('„Jetzt spielen" starts the timer, and finishing records the elapsed minutes', async (t) => {
  const { round, session } = await playNow(t);
  assert.equal(session.startedPlayingAt, new Date(T0).toISOString());
  assert.equal('durationMinutes' in session, false);
  t.mock.timers.tick(110 * MIN + 20000);
  const res = await finish(round.id, session.id);
  assert.equal(res.status, 200);
  assert.equal(res.body.durationMinutes, 110);
  assert.equal((await sessionOf(round.id, session.id)).durationMinutes, 110);
});

test('a winner tap later, or an un-finish and re-finish, keeps the recorded minutes', async (t) => {
  const { round, session } = await playNow(t);
  t.mock.timers.tick(45 * MIN);
  await finish(round.id, session.id);
  t.mock.timers.tick(30 * MIN);
  const tap = await finish(round.id, session.id, { winnerIds: [round.members[0].id] });
  assert.equal(tap.body.durationMinutes, 45);
  await finish(round.id, session.id, { finished: false });
  t.mock.timers.tick(30 * MIN);
  const again = await finish(round.id, session.id);
  assert.equal(again.body.durationMinutes, 45);
});

test('a play shorter than the timer floor records nothing', async (t) => {
  const { round, session } = await playNow(t);
  t.mock.timers.tick(2 * MIN);
  const res = await finish(round.id, session.id);
  assert.equal('durationMinutes' in res.body, false);
});

test('choosing a game starts the timer and clearing the choice drops it', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const round = await createRound(request);
  await addGame(round.id, 'Azul');
  await addGame(round.id, 'Carcassonne');
  const drawn = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 2 })).body.session;
  assert.equal('startedPlayingAt' in drawn, false, 'a draw is not a game in play');
  t.mock.timers.tick(20 * MIN);
  const chose = await request(app).post(`/api/rounds/${round.id}/sessions/${drawn.id}/choice`).send({ gameId: drawn.gameIds[0] });
  assert.equal(chose.body.startedPlayingAt, new Date(T0 + 20 * MIN).toISOString());
  const cleared = await request(app).post(`/api/rounds/${round.id}/sessions/${drawn.id}/choice`).send({ gameId: null });
  assert.equal('startedPlayingAt' in cleared.body, false);
  await request(app).post(`/api/rounds/${round.id}/sessions/${drawn.id}/choice`).send({ gameId: drawn.gameIds[1] });
  t.mock.timers.tick(70 * MIN);
  const res = await finish(round.id, drawn.id);
  assert.equal(res.body.durationMinutes, 70, 'timed from the second choice, not the first');
});

test('PUT …/duration sets, replaces and clears the minutes of a played session', async (t) => {
  const { round, session } = await playNow(t);
  await finish(round.id, session.id); // under the floor: nothing recorded
  const set = await duration(round.id, session.id, 95);
  assert.equal(set.status, 200);
  assert.equal(set.body.durationMinutes, 95);
  assert.equal((await duration(round.id, session.id, DURATION_MAX)).body.durationMinutes, DURATION_MAX);
  const cleared = await duration(round.id, session.id, null);
  assert.equal(cleared.status, 200);
  assert.equal('durationMinutes' in (await sessionOf(round.id, session.id)), false);
});

test('PUT …/duration refuses bad values and a session still in play', async (t) => {
  const { round, session } = await playNow(t);
  assert.equal((await duration(round.id, session.id, 60)).status, 400, 'still running');
  await finish(round.id, session.id);
  for (const bad of [0, -1, DURATION_MAX + 1, 12.5, '60', true, undefined]) {
    assert.equal((await duration(round.id, session.id, bad)).status, 400, String(bad));
  }
  assert.equal((await request(app).put(`/api/rounds/${round.id}/sessions/nope/duration`).send({ durationMinutes: 5 })).status, 404);
});

test('a logged evening has no timer and takes typed minutes on create', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'Azul');
  const plain = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ gameId: game.id, playedOn: PAST });
  assert.equal(plain.status, 201);
  assert.equal('startedPlayingAt' in plain.body.session, false);
  assert.equal('durationMinutes' in plain.body.session, false);
  const timed = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ gameId: game.id, playedOn: PAST, durationMinutes: 80 });
  assert.equal(timed.body.session.durationMinutes, 80);
});

test('typed minutes on create need a logged evening and a valid figure', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'Azul');
  const now = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ gameId: game.id, durationMinutes: 80 });
  assert.equal(now.status, 400);
  const bad = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ gameId: game.id, playedOn: PAST, durationMinutes: 0 });
  assert.equal(bad.status, 400);
});
