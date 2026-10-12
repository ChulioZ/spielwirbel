'use strict';

/*
 * Putting a removed person back into a session (#1655):
 * POST …/sessions/:sid/people/:pid/restore, and the mutator behind it
 * (lib/session-remove-person.js `restorePersonToSession`).
 *
 * The property this exists for is the inverse of #1538's split: the person
 * takes part again — the session's people, the vote routes, the "voted" count —
 * and the ratings removal KEPT count for this session's result again, while
 * what removal DISCARDED (winners, teams, points) stays discarded.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const { removePersonFromSession, restorePersonToSession } = require('../lib/session-remove-person');

async function addGame(rid, title) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8' })) req.field(k, v);
  return (await req).body;
}

async function setup(over = {}) {
  const round = await createRound(request, { members: ['Alice', 'Bob', 'Cleo'] });
  const a = await addGame(round.id, 'A');
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 1, guests: ['Dora'], ...over });
  return { round, a, session: res.body.session };
}

const base = (round, session) => `/api/rounds/${round.id}/sessions/${session.id}`;
const getSession = async (round, sid) =>
  (await request(app).get(`/api/rounds/${round.id}`)).body.sessions.find((s) => s.id === sid);

// ---- the mutator ----------------------------------------------------------

test('restorePersonToSession reverses a removal and leaves the kept column alone', () => {
  const s = {
    memberIds: ['m1', 'm2'], guests: [{ id: 'g1', name: 'Dora' }], winnerIds: ['m2'],
    tableProposals: [], votes: { m2: { x: { rating: 4 } }, g1: { x: { rating: 2 } } },
  };
  removePersonFromSession(s, 'm2');
  removePersonFromSession(s, 'g1');
  s.tableProposals = [];

  restorePersonToSession(s, 'g1');
  assert.deepEqual(s.guests, [{ id: 'g1', name: 'Dora' }], 'the guest comes back in the shape resolveGuests mints');
  assert.deepEqual(s.removedPeople, [{ id: 'm2' }]);
  assert.equal('tableProposals' in s, false, 'proposals go back to unset');

  restorePersonToSession(s, 'm2');
  assert.deepEqual(s.memberIds, ['m1', 'm2']);
  assert.equal('removedPeople' in s, false, 'an emptied list is deleted — absent means none');
  assert.deepEqual(s.winnerIds, [], 'a discarded winner is not guessed back');
  assert.deepEqual(s.votes.m2, { x: { rating: 4 } });
});

test('restorePersonToSession is a no-op for someone not removed, and never duplicates', () => {
  const s = { memberIds: ['m1'], guests: [], removedPeople: [{ id: 'm1' }] };
  restorePersonToSession(s, 'nobody');
  assert.deepEqual(s.removedPeople, [{ id: 'm1' }]);
  // An id somehow both removed and present (a hand-edited blob) is not pushed twice.
  restorePersonToSession(s, 'm1');
  assert.deepEqual(s.memberIds, ['m1']);
  assert.equal('removedPeople' in s, false);
});

// ---- the route ------------------------------------------------------------

test('a restored member takes part again and their kept ratings count for the session', async () => {
  const { round, a, session } = await setup();
  const [, bob] = round.members;
  await request(app).post(`${base(round, session)}/votes/${bob.id}`).send({ votes: { [a.id]: { rating: 2 } } });
  await request(app).delete(`${base(round, session)}/people/${bob.id}`);

  const res = await request(app).post(`${base(round, session)}/people/${bob.id}/restore`).send({});
  assert.equal(res.status, 200);
  assert.ok(res.body.memberIds.includes(bob.id));
  assert.equal('removedPeople' in res.body, false);
  assert.equal(res.body.events.at(-1).type, 'person_restored');
  assert.equal(res.body.events.at(-1).personId, bob.id);

  // Counted as having voted again, from the column removal kept.
  const open = await getSession(round, session.id);
  assert.ok(open.votedIds.includes(bob.id));
  // And their seat can be written again.
  const vote = await request(app).post(`${base(round, session)}/votes/${bob.id}`).send({ votes: { [a.id]: { rating: 5 } } });
  assert.equal(vote.status, 200);
});

test('a restored guest can vote through the shared vote link again', async () => {
  const { round, session } = await setup();
  const guest = session.guests[0];
  await request(app).delete(`${base(round, session)}/people/${guest.id}`);
  const res = await request(app).post(`${base(round, session)}/people/${guest.id}/restore`).send({});
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.guests, [{ id: guest.id, name: 'Dora' }]);

  const link = await request(app).post(`${base(round, session)}/vote-link`).send({});
  const vote = await request(app).post(`/api/vote/${link.body.token}/votes/${guest.id}`).send({ votes: {} });
  assert.equal(vote.status, 200);
});

test('restoring into a finished session brings the person back but not their win', async () => {
  const { round, a, session } = await setup();
  const [, bob] = round.members;
  await request(app).post(`${base(round, session)}/close`);
  await request(app).post(`${base(round, session)}/choice`).send({ gameId: a.id });
  await request(app).post(`${base(round, session)}/finish`).send({ winnerIds: [bob.id] });
  await request(app).delete(`${base(round, session)}/people/${bob.id}`);

  const res = await request(app).post(`${base(round, session)}/people/${bob.id}/restore`).send({});
  assert.equal(res.status, 200);
  assert.ok(res.body.memberIds.includes(bob.id));
  assert.equal(res.body.finished, true);
  assert.deepEqual(res.body.winnerIds, []);
});

test('remove → restore → remove again leaves one entry and no duplicate ids', async () => {
  const { round, session } = await setup();
  const [, bob] = round.members;
  const guest = session.guests[0];
  for (const pid of [bob.id, guest.id]) {
    await request(app).delete(`${base(round, session)}/people/${pid}`);
    await request(app).post(`${base(round, session)}/people/${pid}/restore`).send({});
    const again = await request(app).delete(`${base(round, session)}/people/${pid}`);
    assert.equal(again.status, 200);
  }
  const s = await getSession(round, session.id);
  assert.deepEqual(s.removedPeople, [{ id: bob.id }, { id: guest.id, guest: true, name: 'Dora' }]);
  assert.equal(new Set(s.memberIds).size, s.memberIds.length);
  assert.deepEqual(s.guests, []);
});

test('the refusals: not removed, unknown session, deleted member, split parent', async () => {
  const { store } = require('./helpers');
  const { round, session } = await setup();
  const [alice, bob, cleo] = round.members;

  const notRemoved = await request(app).post(`${base(round, session)}/people/${alice.id}/restore`).send({});
  assert.equal(notRemoved.status, 404);
  const missing = await request(app).post(`/api/rounds/${round.id}/sessions/nope/people/x/restore`).send({});
  assert.equal(missing.status, 404);

  // A removed member deleted from the round since has no seat to come back to.
  await request(app).delete(`${base(round, session)}/people/${cleo.id}`);
  const live = store.data.rounds.find((r) => r.id === round.id);
  live.members = live.members.filter((m) => m.id !== cleo.id);
  const gone = await request(app).post(`${base(round, session)}/people/${cleo.id}/restore`).send({});
  assert.equal(gone.status, 404);

  await request(app).delete(`${base(round, session)}/people/${bob.id}`);
  live.sessions.find((s) => s.id === session.id).childSessionIds = ['child'];
  const split = await request(app).post(`${base(round, session)}/people/${bob.id}/restore`).send({});
  assert.equal(split.status, 400);
  assert.equal(split.body.error, 'already_split');
});
