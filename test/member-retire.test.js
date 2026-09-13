'use strict';

/* Retiring a member of a round (#1006), and deleting one who has no history.
 *
 * Reported by a user on La BSK: there was no way to remove a member at all, and
 * that was not an oversight — votes are stored as `votes[memberId][gameId]` and
 * EVERY game's Spielwirbel-Score is recomputed from them on demand, so a hard
 * delete either rewrites the group's history or orphans it.
 *
 * So the shape mirrors game retirement: a `retired`/`retiredAt` pair, nothing
 * else moved, and the person keeps resolving everywhere history already names
 * them. The hard delete is offered only where there is demonstrably nothing to
 * keep.
 *
 * The first test is the whole requirement and the easiest thing to break.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

const seat = (round, name) => round.members.find((m) => m.name === name);
const get = (rid) => request(app).get(`/api/rounds/${rid}`).then((r) => r.body);

// A round with a finished session: two members voted on two games, one of them
// won, and they played as a team. Everything a retirement could disturb.
async function playedRound() {
  const round = await createRound(request);
  const alice = seat(round, 'Alice');
  const bob = seat(round, 'Bob');
  const g1 = (await request(app).post(`/api/rounds/${round.id}/games`).send({ title: 'Catan', minPlayers: '1', maxPlayers: '8' })).body;
  const g2 = (await request(app).post(`/api/rounds/${round.id}/games`).send({ title: 'Azul', minPlayers: '1', maxPlayers: '8' })).body;
  const started = await request(app).post(`/api/rounds/${round.id}/sessions`).send({
    count: 5, memberIds: [alice.id, bob.id],
    teams: [{ memberIds: [alice.id, bob.id] }],
  });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const sid = started.body.session.id;
  for (const [mid, ratings] of [[alice.id, [5, 3]], [bob.id, [4, 2]]]) {
    const r = await request(app).post(`/api/rounds/${round.id}/sessions/${sid}/votes/${mid}`)
      .send({ votes: { [g1.id]: { rating: ratings[0] }, [g2.id]: { rating: ratings[1] } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  await request(app).post(`/api/rounds/${round.id}/sessions/${sid}/close`).send({});
  await request(app).post(`/api/rounds/${round.id}/sessions/${sid}/choice`).send({ gameId: g1.id });
  await request(app).post(`/api/rounds/${round.id}/sessions/${sid}/finish`)
    .send({ finished: true, winnerIds: [alice.id] });
  return { round: await get(round.id), alice, bob, g1, g2, sid };
}

/* ------------------------------- the invariant ------------------------------ */

test('retiring a member leaves every vote, winner and participant list byte-identical', async () => {
  const { round, alice } = await playedRound();
  const before = await get(round.id);

  const res = await request(app)
    .post(`/api/rounds/${round.id}/members/${alice.id}/retire`).send({ retired: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.retired, true);

  const after = await get(round.id);
  // The sessions are the history: votes, memberIds, winnerIds and teams must not
  // have moved by a single byte. Compared whole rather than field by field —
  // a spot-check would pass against a rewrite of whatever it did not name.
  assert.deepEqual(after.sessions, before.sessions);
  assert.deepEqual(after.games, before.games);
  // …and the member row differs ONLY by the two flags.
  // The two flags subtracted; everything else must match byte for byte.
  const strip = (ms) => ms.map((m) => { const r = { ...m }; delete r.retired; delete r.retiredAt; return r; });
  assert.deepEqual(strip(after.members), strip(before.members));
  assert.equal(after.members.find((m) => m.id === alice.id).retired, true);
});

test('restoring puts them back, and the flags are the only thing that moved', async () => {
  const { round, alice } = await playedRound();
  await request(app).post(`/api/rounds/${round.id}/members/${alice.id}/retire`).send({ retired: true });
  const res = await request(app)
    .post(`/api/rounds/${round.id}/members/${alice.id}/retire`).send({ retired: false });
  assert.equal(res.status, 200);
  assert.equal(res.body.retired, false);
  assert.equal(res.body.retiredAt, null);
});

test('the round\'s activity log records the retirement and the return', async () => {
  const { round, alice } = await playedRound();
  await request(app).post(`/api/rounds/${round.id}/members/${alice.id}/retire`).send({ retired: true });
  await request(app).post(`/api/rounds/${round.id}/members/${alice.id}/retire`).send({ retired: false });
  const acts = (await request(app).get(`/api/rounds/${round.id}/activities`)).body;
  assert.ok(acts.some((a) => a.type === 'member_retired' && a.name === 'Alice'));
  assert.ok(acts.some((a) => a.type === 'member_restored' && a.name === 'Alice'));
});

test('retire refuses a body that is not a boolean, and 404s an unknown seat', async () => {
  const round = await createRound(request);
  const alice = seat(round, 'Alice');
  assert.equal((await request(app)
    .post(`/api/rounds/${round.id}/members/${alice.id}/retire`).send({ retired: 'yes' })).status, 400);
  assert.equal((await request(app)
    .post(`/api/rounds/${round.id}/members/nope/retire`).send({ retired: true })).status, 404);
  assert.equal((await request(app)
    .post('/api/rounds/nope/members/x/retire').send({ retired: true })).status, 404);
});

/* --------------------------------- the delete -------------------------------- */

/* Three kinds of history, asserted ONE AT A TIME. Measured: with all three on
   one member, deleting the `votes` clause from the route's guard leaves the
   whole suite green — the win and the team still catch them, so the assertion
   names three rules and tests one
   (.claude/rules/break-the-code-on-purpose.md, habit 2). */
for (const kind of ['votes', 'win', 'team']) {
  test(`a seat whose only history is a ${kind} cannot be deleted — it must be retired`, async () => {
    const round = await createRound(request, { members: ['Alice', 'Bob', 'Carol'] });
    const alice = seat(round, 'Alice');
    const carol = seat(round, 'Carol');
    const g = (await request(app).post(`/api/rounds/${round.id}/games`)
      .send({ title: 'Catan', minPlayers: '1', maxPlayers: '8' })).body;
    const started = await request(app).post(`/api/rounds/${round.id}/sessions`).send({
      count: 5,
      memberIds: [alice.id, carol.id],
      ...(kind === 'team' ? { teams: [{ memberIds: [alice.id, carol.id] }] } : {}),
    });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const sid = started.body.session.id;
    if (kind === 'votes') {
      await request(app).post(`/api/rounds/${round.id}/sessions/${sid}/votes/${carol.id}`)
        .send({ votes: { [g.id]: { rating: 4 } } });
    }
    if (kind === 'win') {
      await request(app).post(`/api/rounds/${round.id}/sessions/${sid}/close`).send({});
      await request(app).post(`/api/rounds/${round.id}/sessions/${sid}/choice`).send({ gameId: g.id });
      await request(app).post(`/api/rounds/${round.id}/sessions/${sid}/finish`)
        .send({ finished: true, winnerIds: [carol.id] });
    }

    const res = await request(app).delete(`/api/rounds/${round.id}/members/${carol.id}`);
    assert.equal(res.status, 409, `a ${kind} is history and must block the delete`);
    assert.equal(res.body.error, 'member_has_history');
    // …and nothing was removed on the way to the refusal.
    assert.deepEqual((await get(round.id)).members.map((m) => m.name), ['Alice', 'Bob', 'Carol']);
    // Retiring is what IS offered instead, and it works.
    assert.equal((await request(app)
      .post(`/api/rounds/${round.id}/members/${carol.id}/retire`).send({ retired: true })).status, 200);
  });
}

test('a seat created by mistake is deleted outright, leaving no retired ghost', async () => {
  const round = await createRound(request);
  const added = (await request(app).post(`/api/rounds/${round.id}/members`).send({ name: 'Typo' })).body;

  assert.equal((await request(app).delete(`/api/rounds/${round.id}/members/${added.id}`)).status, 204);
  const after = await get(round.id);
  assert.deepEqual(after.members.map((m) => m.name), ['Alice', 'Bob']);
  const acts = (await request(app).get(`/api/rounds/${round.id}/activities`)).body;
  assert.ok(acts.some((a) => a.type === 'member_deleted' && a.name === 'Typo'));
});

test('a member who merely JOINED a session, and voted nothing, is still deletable', async () => {
  /* The distinction that makes the offer honest: `memberIds` alone is a seat at
     an evening that produced nothing, so refusing on it would leave a retired
     ghost for every abandoned draw. */
  const round = await createRound(request);
  const alice = seat(round, 'Alice');
  const bob = seat(round, 'Bob');
  const g = (await request(app).post(`/api/rounds/${round.id}/games`).send({ title: 'Catan', minPlayers: '1', maxPlayers: '8' })).body;
  const st = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: g.id, memberIds: [alice.id, bob.id] });
  assert.equal(st.status, 201, JSON.stringify(st.body));

  assert.equal((await request(app).delete(`/api/rounds/${round.id}/members/${bob.id}`)).status, 204);
});

test('deleting a seat freezes the colours the shift would otherwise have moved', async () => {
  const { MEMBER_COLORS } = require('../public/js/member-colors');
  const round = await createRound(request);
  await request(app).post(`/api/rounds/${round.id}/members`).send({ name: 'Charlie' });
  const before = (await get(round.id)).members;
  assert.ok(before.every((m) => !('color' in m)), 'the fixture must start on derived colours');

  await request(app).delete(`/api/rounds/${round.id}/members/${before[0].id}`);
  const after = (await get(round.id)).members;
  // Bob sat at index 1 and Charlie at 2; both keep the swatch they were painted
  // with, instead of sliding one step down the palette on every screen.
  assert.deepEqual(after.map((m) => m.color), [MEMBER_COLORS[1], MEMBER_COLORS[2]]);
});

test('deleting an unknown seat, or one in an unknown round, is a 404', async () => {
  const round = await createRound(request);
  assert.equal((await request(app).delete(`/api/rounds/${round.id}/members/nope`)).status, 404);
  assert.equal((await request(app).delete('/api/rounds/nope/members/x')).status, 404);
});
