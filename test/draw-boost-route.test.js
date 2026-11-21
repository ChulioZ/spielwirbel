'use strict';

/* „Wer zu kurz kommt, ist dran" (#1777, redefined by #1830) end to end over HTTP: the round setting, and that the
 * session route actually consults it. The weighting itself is unit-tested in
 * test/draw-boost.test.js, which cannot tell whether the ROUTE passes the
 * setting and the seats in at all. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, store, createRound } = require('./helpers');

async function addGame(rid, title) {
  return (await request(app).post(`/api/rounds/${rid}/games`)
    .field('title', title).field('minPlayers', '1').field('maxPlayers', '8')).body;
}

/* Three seats; Cem sat through a game he rated 1, so he is boosted (+50).
   Seeded straight into the JSON store. */
async function seededRound() {
  const round = await createRound(request, { members: ['Alice', 'Bob', 'Cem'] });
  const [alice, bob, cem] = round.members;
  const g = [];
  for (let i = 0; i < 8; i++) g.push(await addGame(round.id, `G${i}`));
  const stored = store.data.rounds.find((r) => r.id === round.id);
  const seats = [alice.id, bob.id, cem.id];
  stored.sessions.push({
    id: 'seed', createdAt: new Date(2026, 0, 1).toISOString(), memberIds: seats,
    gameIds: [g[2].id], chosenGameId: g[2].id, finished: true, cancelled: false, done: true,
    winnerIds: [],
    votes: { [cem.id]: { [g[2].id]: { rating: 1 }, [g[0].id]: { rating: 5 } } },
  });
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

test('a draw started with the setting on carries voteBoost; off grows no key (#1830)', async () => {
  const { round, seats } = await seededRound();
  const draw = () => request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 3, memberIds: seats });

  const off = await draw();
  assert.equal(off.status, 201);
  assert.equal('voteBoost' in off.body.session, false, 'off: the blob grows no key');

  await request(app).patch(`/api/rounds/${round.id}/draw-boost`).send({ on: true });
  const on = await draw();
  assert.equal(on.status, 201);
  assert.equal(on.body.session.voteBoost, true);
  assert.equal(on.body.games.length, 3);
  // The old #1777 field is never written again.
  assert.equal('drawBoostMemberId' in on.body.session, false);
  // The flag survives a re-read of the round.
  const stored = (await request(app).get(`/api/rounds/${round.id}`)).body.sessions.find((s) => s.id === on.body.session.id);
  assert.equal(stored.voteBoost, true);
});
