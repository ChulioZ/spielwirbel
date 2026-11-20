'use strict';

/*
 * „Wie war's?" (#1838) through the real routes on the JSON backend:
 *  - PUT …/sessions/:sid/verdicts/:pid sets, replaces and clears one seated
 *    person's verdict on the PLAYED game, and answers who has answered — never
 *    what;
 *  - an unfinished or cancelled session, another game, a person who did not
 *    sit at the table and an off-scale rating are refused;
 *  - a seat holding only a verdict has history, so it cannot be deleted.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

async function addGame(rid, title) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8' })) req.field(k, v);
  return (await req).body;
}
const verdict = (rid, sid, pid, body) =>
  request(app).put(`/api/rounds/${rid}/sessions/${sid}/verdicts/${pid}`).send(body);
const sessionOf = async (rid, sid) => (await request(app).get(`/api/rounds/${rid}`)).body.sessions.find((s) => s.id === sid);

// Alice and Bob sit at the table; Cleo is in the round but did not join.
async function played({ finish = true } = {}) {
  const round = await createRound(request, { members: ['Alice', 'Bob', 'Cleo'] });
  const [alice, bob, cleo] = round.members;
  const game = await addGame(round.id, 'Azul');
  const other = await addGame(round.id, 'Carcassonne');
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id, memberIds: [alice.id, bob.id] });
  assert.equal(res.status, 201);
  const session = res.body.session;
  if (finish) {
    const done = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/finish`).send({ winnerIds: [] });
    assert.equal(done.status, 200);
  }
  return { round, game, other, session, alice, bob, cleo };
}

test('a seated player sets, replaces and clears a verdict; the answer names who, never what', async () => {
  const { round, game, session, alice, bob } = await played();
  const a = await verdict(round.id, session.id, alice.id, { gameId: game.id, rating: 4 });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, { answered: [alice.id] }, 'ids only — the value is not echoed');

  await verdict(round.id, session.id, bob.id, { gameId: game.id, rating: 2 });
  await verdict(round.id, session.id, alice.id, { gameId: game.id, rating: 5 });
  assert.deepEqual((await sessionOf(round.id, session.id)).verdicts, {
    [alice.id]: { [game.id]: { rating: 5 } },
    [bob.id]: { [game.id]: { rating: 2 } },
  });

  const cleared = await verdict(round.id, session.id, bob.id, { gameId: game.id, rating: null });
  assert.deepEqual(cleared.body, { answered: [alice.id] });
});

test('only a played session, only its played game, only its seats, only a tile', async () => {
  const open = await played({ finish: false });
  const r1 = await verdict(open.round.id, open.session.id, open.alice.id, { gameId: open.game.id, rating: 4 });
  assert.equal(r1.status, 400, 'an unfinished session takes no verdict');

  const { round, game, other, session, alice, cleo } = await played();
  assert.equal((await verdict(round.id, session.id, alice.id, { gameId: other.id, rating: 4 })).status, 400,
    'a game that was not played');
  assert.equal((await verdict(round.id, session.id, cleo.id, { gameId: game.id, rating: 4 })).status, 404,
    'a member who did not sit at the table');
  assert.equal((await verdict(round.id, session.id, 'nobody', { gameId: game.id, rating: 4 })).status, 404);
  for (const rating of [0, 6, 3.5, '4', true]) {
    assert.equal((await verdict(round.id, session.id, alice.id, { gameId: game.id, rating })).status, 400,
      `rating ${JSON.stringify(rating)}`);
  }
  assert.equal('verdicts' in await sessionOf(round.id, session.id), false, 'nothing refused was stored');
});

test('a seat whose only trace is a verdict has history and is not deletable', async () => {
  const { round, game, session, bob, cleo } = await played();
  // Bob joined a direct pick: no votes, no win — deletable until he says how it was.
  await verdict(round.id, session.id, bob.id, { gameId: game.id, rating: 3 });
  const res = await request(app).delete(`/api/rounds/${round.id}/members/${bob.id}`);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'member_has_history');
  assert.equal((await request(app).delete(`/api/rounds/${round.id}/members/${cleo.id}`)).status, 204,
    'the guard still lets a seat with nothing go');
});
