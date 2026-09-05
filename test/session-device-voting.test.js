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
    .send({ count: 5, ...over });
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

// Direct-pick has no voting phase at all — it is born `done` — which is what
// keeps it out of the lobby now that every DRAWN session lands there (#655).
test('direct-pick opens no voting phase, so it takes no votes', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'A');
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id });
  assert.equal(res.status, 201);
  assert.equal(res.body.session.done, true);

  const vote = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${res.body.session.id}/votes/${round.members[0].id}`)
    .send({ votes: { [game.id]: { rating: 4 } } });
  assert.equal(vote.status, 400);
  assert.equal(vote.body.error, 'voting_closed');
});

// The core of the feature: two people, two devices, two separate requests —
// and both columns survive. A merge done client-side would lose one of them.
test('two people write their own columns without clobbering each other', async () => {
  const { round, a, b, session } = await setup();
  const [alice, bob] = round.members;

  const first = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 5 }, [b.id]: { rating: 2 } } });
  assert.equal(first.status, 200);

  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${bob.id}`)
    .send({ votes: { [a.id]: { rating: 3 } } });

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
        .send({ votes: { [game.id]: { rating: i + 1 } } })
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
    .send({ votes: { [a.id]: { rating: 4 } } });
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
    .send({ votes: { [a.id]: { rating: 5 } } });

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
    .send({ votes: { [a.id]: { rating: 5 } } });

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
    .send({ votes: { [alice.id]: { [game.id]: { rating: 4 } } } });

  const stored = sessionOf(await getRound(round.id), sid);
  assert.equal(stored.votes[alice.id][game.id].rating, 4);
});

// #655: there is no opt-in any more, so a session drawn with no options at all
// takes incremental writes and redacts while open, exactly like any other.
test('every drawn session takes an incremental vote write and redacts while open', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'A');
  const started = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  const sid = started.body.session.id;
  const alice = round.members[0];

  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${sid}/votes/${alice.id}`)
    .send({ votes: { [game.id]: { rating: 4 } } });
  assert.equal(res.status, 200);

  // Open: who voted, never what they voted. This is the assertion that carries
  // the widened redaction — before #655 this session would have shipped the
  // rating in full, because the flag it keyed on was absent.
  const open = sessionOf(await getRound(round.id), sid);
  assert.deepEqual(open.votes, {});
  assert.deepEqual(open.votedIds, [alice.id]);

  // Closed: the reveal.
  await request(app).post(`/api/rounds/${round.id}/sessions/${sid}/close`).send({});
  const closed = sessionOf(await getRound(round.id), sid);
  assert.equal(closed.votes[alice.id][game.id].rating, 4);
});

/* The legacy bulk write (#655). Only a client still holding the pre-#655 bundle
   calls it, and that client believes it holds every vote — which it no longer
   does, because someone may have voted from the lobby or a shared link while it
   ran. So it MERGES rather than replaces: its own columns win for the people it
   collected, everyone else's survive. Replacing would erase them silently, with
   the stale client reporting success. */
test('the legacy bulk write merges into columns already collected, never clobbers', async () => {
  const { round, a, session } = await setup();
  const [alice, bob] = round.members;
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 5 } } });

  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/results`)
    .send({ votes: { [bob.id]: { [a.id]: { rating: 1 } } } });
  assert.equal(res.status, 200);

  const stored = sessionOf(await getRound(round.id), session.id);
  assert.equal(stored.votes[alice.id][a.id].rating, 5, "Alice's lobby vote must have survived");
  assert.equal(stored.votes[bob.id][a.id].rating, 1, "and Bob's bulk vote must have landed");
  assert.equal(stored.done, true, 'the bulk write still closes the session');
});

test('voting after the session is closed is refused', async () => {
  const { round, a, session } = await setup();
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${round.members[0].id}`)
    .send({ votes: { [a.id]: { rating: 5 } } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'voting_closed');
});

test('voting in a cancelled session is refused', async () => {
  const { round, a, session } = await setup();
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/cancel`).send({});
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${round.members[0].id}`)
    .send({ votes: { [a.id]: { rating: 5 } } });
  assert.equal(res.status, 400);
});

test('a person who did not join this session cannot vote in it', async () => {
  const { round, a, session } = await setup({ memberIds: [] });
  const other = await createRound(request);
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${other.members[0].id}`)
    .send({ votes: { [a.id]: { rating: 5 } } });
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
    .send({ votes: { [a.id]: { rating: 4 }, [stray.id]: { rating: 5 } } });
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});

  const stored = sessionOf(await getRound(round.id), session.id);
  assert.deepEqual(Object.keys(stored.votes[alice.id]), [a.id]);
});

test('an out-of-range rating is dropped, and no retire key is ever stored', async () => {
  const { round, a, b, session } = await setup();
  const [alice, bob] = round.members;
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${alice.id}`)
    // 0 is off the scale since #909 — it used to be the trash tile — and the
    // flag beside it is not a vote in its own right, so nothing survives.
    .send({ votes: { [a.id]: { rating: 0, retire: true }, [b.id]: { rating: 4, retire: true } } });
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${bob.id}`)
    .send({ votes: { [a.id]: { rating: 99 } } });
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});

  const stored = sessionOf(await getRound(round.id), session.id);
  // Only the well-formed rating survives, and it is stored as `{ rating }`
  // alone — the shape is what makes a `retire` key unwritable rather than
  // merely unusual (#909).
  assert.deepEqual(stored.votes[alice.id], { [b.id]: { rating: 4 } });
  assert.deepEqual(stored.votes[bob.id], {});
});

// #909 removed the last per-role difference in the vote path: a guest writes
// exactly what a member writes, so there is no flag left to strip.
test('a guest writes the same shape a member does', async () => {
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

test('any drawn session can be closed', async () => {
  const round = await createRound(request);
  await addGame(round.id, 'A');
  const started = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${started.body.session.id}/close`)
    .send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.done, true);
});

test('a per-device session in an unknown round 404s', async () => {
  const { session } = await setup();
  const res = await request(app)
    .post(`/api/rounds/nope/sessions/${session.id}/votes/whoever`)
    .send({ votes: {} });
  assert.equal(res.status, 404);
});
