'use strict';

/*
 * A finished session's per-player points (#1630), through the real routes on
 * the JSON backend:
 *  - PUT …/scores stores them, logs `scored`, and an empty object clears them;
 *  - a winner tap afterwards (POST …/finish, re-sent on every tap) leaves them
 *    alone — the reason the points have a route of their own;
 *  - the seats are the session's PARTIES: a guest scores, a team scores, a
 *    teamed person's own id is refused, an id from outside the session too;
 *  - decimals, strings and out-of-range values are 400s, negatives and zero
 *    are fine;
 *  - a running session is refused;
 *  - removing a person drops their points;
 *  - a game's „lower score wins" flag goes through PATCH and clears to absence.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const { POINTS_MIN, POINTS_MAX } = require('../public/js/point-records');

async function addGame(rid, title = 'Azul') {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8' })) req.field(k, v);
  return (await req).body;
}

const PAST = '2026-03-01T20:00:00.000Z';
const scores = (rid, sid, body) => request(app).put(`/api/rounds/${rid}/sessions/${sid}/scores`).send(body);
const roundOf = (rid) => request(app).get(`/api/rounds/${rid}`).then((r) => r.body);

async function loggedSession(extra = {}) {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id, playedOn: PAST, ...extra });
  assert.equal(res.status, 201);
  return { round, game, session: res.body.session };
}

test('points are stored, logged, and cleared by an empty object', async () => {
  const { round, session } = await loggedSession();
  const [alice, bob] = round.members;
  const res = await scores(round.id, session.id, { scores: { [alice.id]: 42, [bob.id]: 0 } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.scores, { [alice.id]: 42, [bob.id]: 0 });
  assert.equal(res.body.events.at(-1).type, 'scored');

  const cleared = await scores(round.id, session.id, { scores: {} });
  assert.equal(cleared.status, 200);
  assert.equal('scores' in cleared.body, false);
  assert.equal('scores' in (await roundOf(round.id)).sessions[0], false);
});

test('a winner tap afterwards does not touch the points', async () => {
  const { round, session } = await loggedSession();
  const [alice] = round.members;
  await scores(round.id, session.id, { scores: { [alice.id]: 17 } });
  const tap = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/finish`)
    .send({ finished: true, winnerIds: [alice.id] });
  assert.equal(tap.status, 200);
  assert.deepEqual(tap.body.scores, { [alice.id]: 17 });
});

test('the seats are the parties: guests and teams score, a teamed person does not', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const [alice, bob] = round.members;
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({
    gameId: game.id, playedOn: PAST, guests: ['Dana'],
    teams: [{ memberIds: [alice.id], guestIndices: [0] }],
  });
  assert.equal(res.status, 201);
  const s = res.body.session;
  const team = s.teams[0];
  assert.ok(team && team.id);

  const ok = await scores(round.id, s.id, { scores: { [team.id]: 30, [bob.id]: 25 } });
  assert.equal(ok.status, 200, 'a team and the person playing beside it both score');

  const teamed = await scores(round.id, s.id, { scores: { [alice.id]: 30 } });
  assert.equal(teamed.status, 400, 'a teamed person scores through the team');
  assert.equal(teamed.body.error, 'Unknown seat');

  const stranger = await scores(round.id, s.id, { scores: { nobody: 1 } });
  assert.equal(stranger.status, 400);

  // A plain session: the guest is a seat of their own.
  const plain = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id, playedOn: PAST, guests: ['Eli'] });
  const guestId = plain.body.session.guests[0].id;
  const guest = await scores(round.id, plain.body.session.id, { scores: { [guestId]: -4 } });
  assert.equal(guest.status, 200);
  assert.deepEqual(guest.body.scores, { [guestId]: -4 });
});

test('only whole numbers inside the bounds are accepted', async () => {
  const { round, session } = await loggedSession();
  const [alice] = round.members;
  for (const bad of [1.5, '12', null, true, POINTS_MIN - 1, POINTS_MAX + 1]) {
    const res = await scores(round.id, session.id, { scores: { [alice.id]: bad } });
    assert.equal(res.status, 400, `refuses ${JSON.stringify(bad)}`);
  }
  for (const good of [POINTS_MIN, -1, 0, POINTS_MAX]) {
    const res = await scores(round.id, session.id, { scores: { [alice.id]: good } });
    assert.equal(res.status, 200, `accepts ${good}`);
  }
  const shape = await scores(round.id, session.id, { scores: [1, 2] });
  assert.equal(shape.status, 400, 'a list is not a seat map');
});

test('a running session is refused', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ gameId: game.id });
  const s = res.body.session;
  assert.equal(s.finished, false);
  const put = await scores(round.id, s.id, { scores: { [round.members[0].id]: 3 } });
  assert.equal(put.status, 400);
  assert.equal((await scores(round.id, 'missing', { scores: {} })).status, 404);
});

test('removing a person drops their points', async () => {
  const { round, session } = await loggedSession();
  const [alice, bob] = round.members;
  await scores(round.id, session.id, { scores: { [alice.id]: 10, [bob.id]: 12 } });
  const del = await request(app).delete(`/api/rounds/${round.id}/sessions/${session.id}/people/${bob.id}`);
  assert.equal(del.status, 200);
  assert.deepEqual(del.body.scores, { [alice.id]: 10 });
});

test('a game takes „lower score wins" and clears it back to absence', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const on = await request(app).patch(`/api/rounds/${round.id}/games/${game.id}`).send({ lowScoreWins: true });
  assert.equal(on.status, 200);
  assert.equal(on.body.lowScoreWins, true);
  const off = await request(app).patch(`/api/rounds/${round.id}/games/${game.id}`).send({ lowScoreWins: false });
  assert.equal(off.status, 200);
  assert.equal('lowScoreWins' in off.body, false);
  const bad = await request(app).patch(`/api/rounds/${round.id}/games/${game.id}`).send({ lowScoreWins: 'yes' });
  assert.equal(bad.status, 400);
});
