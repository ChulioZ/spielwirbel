'use strict';

/* The draw boost (#1777) end to end over HTTP: the round setting, and that the
 * session route actually consults it. The weighting itself is unit-tested in
 * test/draw-boost.test.js, which cannot tell whether the ROUTE passes the
 * setting and the seats in at all. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, store, createRound } = require('./helpers');
const { TASTE_SHARE_FROM_SESSIONS } = require('../public/js/taste-share');
const { RATING_MAX } = require('../public/js/rating-faces');

async function addGame(rid, title) {
  return (await request(app).post(`/api/rounds/${rid}/games`)
    .field('title', title).field('minPlayers', '1').field('maxPlayers', '8')).body;
}

/* Three seats; Cem's two favourites never reached the table, Alice's and Bob's
   did, so Cem is strictly behind. Seeded straight into the JSON store, since
   six played evenings over HTTP would be the test's whole length. */
async function seededRound() {
  const round = await createRound(request, { members: ['Alice', 'Bob', 'Cem'] });
  const [alice, bob, cem] = round.members;
  const g = [];
  for (let i = 0; i < 8; i++) g.push(await addGame(round.id, `G${i}`));
  const top = { rating: RATING_MAX };
  const stored = store.data.rounds.find((r) => r.id === round.id);
  const seats = [alice.id, bob.id, cem.id];
  for (let i = 0; i < TASTE_SHARE_FROM_SESSIONS; i++) {
    stored.sessions.push({
      id: `seed${i}`, createdAt: new Date(2026, 0, i + 1).toISOString(), memberIds: seats,
      gameIds: [], chosenGameId: i % 2 ? g[2].id : g[4].id, finished: true, cancelled: false, done: true,
      winnerIds: [],
      votes: i ? {} : {
        [alice.id]: { [g[2].id]: top, [g[3].id]: top },
        [bob.id]: { [g[4].id]: top, [g[5].id]: top },
        [cem.id]: { [g[0].id]: top, [g[1].id]: top },
      },
    });
  }
  store.saveData();
  return { round, seats, cem };
}

test('PATCH …/draw-boost switches the round setting; off by default (#1777)', async () => {
  const round = await createRound(request);
  assert.equal('drawBoost' in (await request(app).get(`/api/rounds/${round.id}`)).body, false);

  const on = await request(app).patch(`/api/rounds/${round.id}/draw-boost`).send({ on: true });
  assert.equal(on.status, 200);
  assert.deepEqual(on.body, { drawBoost: true });
  assert.equal((await request(app).get(`/api/rounds/${round.id}`)).body.drawBoost, true);

  // Strict: a toggle has no shape to guess from.
  assert.equal((await request(app).patch(`/api/rounds/${round.id}/draw-boost`).send({ on: 'yes' })).status, 400);
  assert.equal((await request(app).patch('/api/rounds/nope/draw-boost').send({ on: true })).status, 404);

  await request(app).patch(`/api/rounds/${round.id}/draw-boost`).send({ on: false });
  assert.equal('drawBoost' in (await request(app).get(`/api/rounds/${round.id}`)).body, false);
});

test('a draw records whose favourites were boosted — only with the setting on (#1777)', async () => {
  const { round, seats, cem } = await seededRound();
  const draw = () => request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 3, memberIds: seats });

  const off = await draw();
  assert.equal(off.status, 201);
  assert.equal('drawBoostMemberId' in off.body.session, false, 'off: the blob grows no key');

  await request(app).patch(`/api/rounds/${round.id}/draw-boost`).send({ on: true });
  const on = await draw();
  assert.equal(on.status, 201);
  assert.equal(on.body.session.drawBoostMemberId, cem.id);
  assert.equal(on.body.games.length, 3);

  // Cem not at the table: Alice and Bob are level, so nobody is behind.
  const without = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 3, memberIds: seats.slice(0, 2) });
  assert.equal('drawBoostMemberId' in without.body.session, false);
});
