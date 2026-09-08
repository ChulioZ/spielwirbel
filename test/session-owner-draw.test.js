'use strict';

/* Ownership's effect on a REAL draw (#971), end to end over HTTP.
 *
 * Its own spec rather than more of test/sessions.test.js: that file is about the
 * session lifecycle and was at its 700-line budget, and this is a distinct
 * concern — the unit tests in test/draw.test.js exercise `drawPool` directly,
 * which cannot tell whether the ROUTE passes the joining seats in at all. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Game', minPlayers: '1', maxPlayers: '8', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  return (await req).body;
}

// End-to-end proof that the shared predicate is actually reached from the route:
// the unit tests in test/draw.test.js exercise `drawPool` directly, which cannot
// tell whether the route passes the joining seats in at all.
async function addOwned(rid, title, ownerIds) {
  const req = request(app).post(`/api/rounds/${rid}/games`)
    .field('title', title).field('minPlayers', '1').field('maxPlayers', '8');
  ownerIds.forEach((x) => req.field('ownerIds', x));
  return (await req).body;
}

test('a draw skips a game whose owners are all away, and keeps ownerless ones (#971)', async () => {
  const round = await createRound(request);
  const [alice, bob] = round.members;
  await addOwned(round.id, 'Alices', [alice.id]);
  await addOwned(round.id, 'Bobs', [bob.id]);
  await addOwned(round.id, 'Both', [alice.id, bob.id]);
  await addGame(round.id, { title: 'Unmarked' });

  const solo = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 9, memberIds: [alice.id] });
  assert.equal(solo.status, 201);
  assert.deepEqual(solo.body.games.map((g) => g.title).sort(), ['Alices', 'Both', 'Unmarked']);

  // Everyone joining brings every box back.
  const all = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 9, memberIds: [alice.id, bob.id] });
  assert.equal(all.body.games.length, 4);
});

// The empty-memberIds fallback means "the whole round", so it must not read as
// "nobody is here" and empty the shelf.
test('a draw with no memberIds falls back to the whole round, owners and all (#971)', async () => {
  const round = await createRound(request);
  await addOwned(round.id, 'Alices', [round.members[0].id]);
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 9 });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.games.map((g) => g.title), ['Alices']);
});
