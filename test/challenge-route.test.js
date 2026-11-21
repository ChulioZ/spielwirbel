'use strict';

/* The group challenge (#1779) over HTTP: start, one-running-at-a-time, the
 * shelf snapshot taken by the SERVER, ending early, and archiving a finished
 * one when the next starts. The derivation is unit-tested in challenges.test.js. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, store, createRound } = require('./helpers');

const DAY = 24 * 60 * 60 * 1000;
const future = (d) => new Date(Date.now() + d * DAY).toISOString();
const base = (rid) => `/api/rounds/${rid}/challenge`;
async function addGame(rid, title) {
  return (await request(app).post(`/api/rounds/${rid}/games`).field('title', title).field('minPlayers', '1').field('maxPlayers', '8')).body;
}

test('POST starts a challenge; a second one is refused while it runs; DELETE ends it early', async () => {
  const round = await createRound(request);
  const res = await request(app).post(base(round.id)).send({ kind: 'sessions', n: 3, deadline: future(10) });
  assert.equal(res.status, 201);
  assert.equal(res.body.challenge.kind, 'sessions');
  assert.equal(res.body.challenge.n, 3);
  assert.ok(Date.parse(res.body.challenge.startedAt) <= Date.now());
  assert.deepEqual(res.body.challengeHistory, []);
  assert.deepEqual((await request(app).get(`/api/rounds/${round.id}`)).body.challenge, res.body.challenge);

  assert.equal((await request(app).post(base(round.id)).send({ kind: 'distinctGames', n: 2, deadline: future(5) })).status, 409);

  const ended = await request(app).delete(base(round.id));
  assert.equal(ended.status, 200);
  assert.equal(ended.body.challenge, null);
  assert.equal(ended.body.challengeHistory.length, 1);
  assert.ok(ended.body.challengeHistory[0].endedAt, 'a running one is stamped as ended early');
  assert.equal((await request(app).delete(base(round.id))).status, 404);
});

test('a finished challenge moves into the history when the next one starts, unstamped', async () => {
  const round = await createRound(request);
  const stored = store.data.rounds.find((r) => r.id === round.id);
  // Expired: the deadline passed with nothing played — derived, never written.
  stored.challenge = { kind: 'sessions', n: 1, startedAt: future(-10), deadline: future(-1) };
  store.saveData();
  const res = await request(app).post(base(round.id)).send({ kind: 'sessions', n: 2, deadline: future(10) });
  assert.equal(res.status, 201);
  assert.equal(res.body.challengeHistory.length, 1);
  assert.equal(res.body.challengeHistory[0].endedAt, undefined, 'an expired one keeps its outcome');
});

test('wholeShelf: the server snapshots the active shelf and refuses an empty one', async () => {
  const round = await createRound(request);
  assert.equal((await request(app).post(base(round.id)).send({ kind: 'wholeShelf', deadline: future(10) })).status, 400);
  const a = await addGame(round.id, 'A');
  const b = await addGame(round.id, 'B');
  await request(app).post(`/api/rounds/${round.id}/games/${b.id}/retire`);
  const res = await request(app).post(base(round.id))
    .send({ kind: 'wholeShelf', deadline: future(10), shelfSnapshot: ['forged'] });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.challenge.shelfSnapshot, [a.id], 'active games only, never the client\'s list');
});

test('invalid bodies 400 and an unknown round 404s', async () => {
  const round = await createRound(request);
  assert.equal((await request(app).post(base(round.id)).send({ kind: 'sessions', deadline: future(3) })).status, 400);
  assert.equal((await request(app).post(base(round.id)).send({ kind: 'sessions', n: 3, deadline: future(-1) })).status, 400);
  assert.equal((await request(app).post(base('nope')).send({ kind: 'sessions', n: 3, deadline: future(3) })).status, 404);
  assert.equal((await request(app).delete(base('nope'))).status, 404);
});
