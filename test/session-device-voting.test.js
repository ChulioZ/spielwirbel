'use strict';

/*
 * Per-device voting (#209): a session that collects each person's votes as they
 * submit them, from whatever device they are holding, instead of one hot-seat
 * closure POSTing the whole map at the end.
 *
 * The two properties worth testing hardest are the ones that fail SILENTLY:
 * an incremental write must not clobber the column somebody else already wrote,
 * and an open session must not ship the votes it has collected to the people who
 * have not voted yet.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

async function addGame(rid, title) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8' })) {
    req.field(k, String(v));
  }
  return (await req).body;
}

// A round with two games and the two default members, drawn as a per-device
// session. Returns everything a test needs to address one person's column.
async function setup(over = {}) {
  const round = await createRound(request);
  const a = await addGame(round.id, 'A');
  const b = await addGame(round.id, 'B');
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 5, deviceVoting: true, ...over });
  return { round, a, b, session: res.body.session, guests: res.body.guests, res };
}

const getRound = (rid) => request(app).get(`/api/rounds/${rid}`).then((r) => r.body);
const sessionOf = (round, sid) => round.sessions.find((s) => s.id === sid);

test('an ordinary session grows no deviceVoting key at all (absent-key parity)', async () => {
  const round = await createRound(request);
  await addGame(round.id, 'A');
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  assert.equal(res.status, 201);
  assert.equal('deviceVoting' in res.body.session, false);
});

test('a per-device draw stores deviceVoting: true', async () => {
  const { session } = await setup();
  assert.equal(session.deviceVoting, true);
});

// Direct-pick skips the vote phase entirely, so there is no voting to open.
test('direct-pick ignores deviceVoting', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'A');
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id, deviceVoting: true });
  assert.equal(res.status, 201);
  assert.equal('deviceVoting' in res.body.session, false);
});

// The core of the feature: two people, two devices, two separate requests —
// and both columns survive. A merge done client-side would lose one of them.
test('two people write their own columns without clobbering each other', async () => {
  const { round, a, b, session } = await setup();
  const [alice, bob] = round.members;

  const first = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 5, retire: false }, [b.id]: { rating: 2, retire: false } } });
  assert.equal(first.status, 200);

  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${bob.id}`)
    .send({ votes: { [a.id]: { rating: 3, retire: false } } });

  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});

  const stored = sessionOf(await getRound(round.id), session.id);
  assert.equal(stored.votes[alice.id][a.id].rating, 5);
  assert.equal(stored.votes[alice.id][b.id].rating, 2);
  assert.equal(stored.votes[bob.id][a.id].rating, 3);
});

// The sequential case above proves the columns are independent; this one is the
// case that actually happens at a table — four phones submitting at once. The
// guarantee comes from `withSession` being a single read-modify-write per row
// (Postgres takes FOR UPDATE), so this spec is what makes the `postgres` CI job
// exercise it against a real database rather than only against the JSON backend.
test('four people submitting at the same moment all land', async () => {
  const round = await createRound(request, { members: ['A', 'B', 'C', 'D'] });
  const game = await addGame(round.id, 'G');
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 1, deviceVoting: true });
  const sid = res.body.session.id;

  // Fired together, deliberately not awaited in turn.
  await Promise.all(
    round.members.map((m, i) =>
      request(app)
        .post(`/api/rounds/${round.id}/sessions/${sid}/votes/${m.id}`)
        .send({ votes: { [game.id]: { rating: i + 1, retire: false } } })
    )
  );

  await request(app).post(`/api/rounds/${round.id}/sessions/${sid}/close`).send({});
  const stored = sessionOf(await getRound(round.id), sid);
  assert.equal(Object.keys(stored.votes).length, 4, 'every column must survive');
  round.members.forEach((m, i) => assert.equal(stored.votes[m.id][game.id].rating, i + 1));
});

// The write is the only route a mid-session voter's device calls, so its
// response must not carry what the round read redacts.
test('the vote write does not echo the session back', async () => {
  const { round, a, session } = await setup();
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${round.members[0].id}`)
    .send({ votes: { [a.id]: { rating: 4, retire: false } } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

// Vote secrecy. Without the redaction the second voter's client receives the
// first voter's ratings in the ordinary round payload.
test('an open per-device session ships no vote values, only who has voted', async () => {
  const { round, a, session } = await setup();
  const [alice, bob] = round.members;
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 5, retire: false } } });

  const open = sessionOf(await getRound(round.id), session.id);
  assert.deepEqual(open.votes, {}, 'vote values must not leave the server while voting is open');
  assert.deepEqual(open.votedIds, [alice.id]);
  assert.equal(open.votedIds.includes(bob.id), false);
});

test('closing voting reveals the collected votes', async () => {
  const { round, a, session } = await setup();
  const alice = round.members[0];
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 5, retire: false } } });

  const closed = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/close`)
    .send({});
  assert.equal(closed.status, 200);
  assert.equal(closed.body.done, true);

  const after = sessionOf(await getRound(round.id), session.id);
  assert.equal(after.votes[alice.id][a.id].rating, 5);
  assert.equal('votedIds' in after, false, 'votedIds is a redaction artefact, not stored data');
});

// A hot-seat session is untouched by all of this: its votes are in a closure
// until the end, so there is nothing to hide and nothing to redact.
test('an ordinary session is never redacted', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'A');
  const started = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  const sid = started.body.session.id;
  const alice = round.members[0];
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${sid}/results`)
    .send({ votes: { [alice.id]: { [game.id]: { rating: 4, retire: false } } } });

  const stored = sessionOf(await getRound(round.id), sid);
  assert.equal(stored.votes[alice.id][game.id].rating, 4);
});

test('an ordinary session refuses an incremental vote write', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'A');
  const started = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${started.body.session.id}/votes/${round.members[0].id}`)
    .send({ votes: { [game.id]: { rating: 4, retire: false } } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'not_device_voting');
});

// The destructive one: /results REPLACES the whole map, so letting a stale
// client call it on a per-device session would discard everyone else's votes.
test('the bulk results write refuses a per-device session', async () => {
  const { round, a, session } = await setup();
  const [alice, bob] = round.members;
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 5, retire: false } } });

  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/results`)
    .send({ votes: { [bob.id]: { [a.id]: { rating: 1, retire: false } } } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'device_voting');

  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});
  const stored = sessionOf(await getRound(round.id), session.id);
  assert.equal(stored.votes[alice.id][a.id].rating, 5, "Alice's vote must have survived");
});

test('voting after the session is closed is refused', async () => {
  const { round, a, session } = await setup();
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${round.members[0].id}`)
    .send({ votes: { [a.id]: { rating: 5, retire: false } } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'voting_closed');
});

test('voting in a cancelled session is refused', async () => {
  const { round, a, session } = await setup();
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/cancel`).send({});
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${round.members[0].id}`)
    .send({ votes: { [a.id]: { rating: 5, retire: false } } });
  assert.equal(res.status, 400);
});

test('a person who did not join this session cannot vote in it', async () => {
  const { round, a, session } = await setup({ memberIds: [] });
  const other = await createRound(request);
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${other.members[0].id}`)
    .send({ votes: { [a.id]: { rating: 5, retire: false } } });
  assert.equal(res.status, 404);
});

// A vote for a game this session never drew would land in gameStats() and move
// a rating average with nothing on any screen to explain it.
test('votes for games outside the session are dropped', async () => {
  const { round, a, session } = await setup();
  const stray = await addGame(round.id, 'Not drawn');
  const alice = round.members[0];
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 4, retire: false }, [stray.id]: { rating: 5, retire: false } } });
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});

  const stored = sessionOf(await getRound(round.id), session.id);
  assert.deepEqual(Object.keys(stored.votes[alice.id]), [a.id]);
});

test('out-of-range ratings are dropped, a retire flag alone is kept', async () => {
  const { round, a, b, session } = await setup();
  const alice = round.members[0];
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 99, retire: true }, [b.id]: { rating: 0, retire: false } } });
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});

  const stored = sessionOf(await getRound(round.id), session.id);
  assert.deepEqual(stored.votes[alice.id], { [a.id]: { rating: null, retire: true } });
});

// #458: a guest rates the game but does not get to vote it off the group's
// shelf, so the flag is stripped rather than trusted from the wire.
test("a guest's retire flag is dropped, matching the hot-seat path", async () => {
  const { round, a, session, guests } = await setup({ guests: ['Chris'] });
  assert.equal(guests.length, 1);
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${guests[0].id}`)
    .send({ votes: { [a.id]: { rating: 4, retire: true } } });
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});

  const stored = sessionOf(await getRound(round.id), session.id);
  assert.deepEqual(stored.votes[guests[0].id], { [a.id]: { rating: 4 } });
});

// The wizard seeds votes[personId] = {} for everyone, so key presence proves
// nothing — only a non-empty map means somebody actually voted.
test('an empty submission does not count as having voted', async () => {
  const { round, session } = await setup();
  const alice = round.members[0];
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${alice.id}`)
    .send({ votes: {} });

  const open = sessionOf(await getRound(round.id), session.id);
  assert.deepEqual(open.votedIds, []);
});

// Two people tapping "close" at the same moment is expected, not an error.
test('closing an already-closed session is idempotent', async () => {
  const { round, session } = await setup();
  const first = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});
  const second = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.done, true);
});

test('closing an ordinary session is refused', async () => {
  const round = await createRound(request);
  await addGame(round.id, 'A');
  const started = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${started.body.session.id}/close`)
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'not_device_voting');
});

test('a per-device session in an unknown round 404s', async () => {
  const { session } = await setup();
  const res = await request(app)
    .post(`/api/rounds/nope/sessions/${session.id}/votes/whoever`)
    .send({ votes: {} });
  assert.equal(res.status, 404);
});
