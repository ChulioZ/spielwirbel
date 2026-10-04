'use strict';

/*
 * Removing a person from a session (#1538): DELETE …/sessions/:sid/people/:pid.
 *
 * The property this exists for is the split the issue draws: a removed person
 * stops having TAKEN PART (the session's people, its votes route, its winners,
 * its "voted" count) while what they had rated keeps counting for the shelf —
 * which is lib/session-remove-person.js keeping their column, asserted here
 * through the round read the shelf screens use.
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

test('a removed member leaves the session but keeps their stored column', async () => {
  const { round, a, session } = await setup();
  const [alice, bob] = round.members;
  await request(app).post(`${base(round, session)}/votes/${bob.id}`).send({ votes: { [a.id]: { rating: 2 } } });

  const res = await request(app).delete(`${base(round, session)}/people/${bob.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.memberIds.includes(bob.id), false);
  assert.ok(res.body.memberIds.includes(alice.id));
  assert.deepEqual(res.body.removedPeople, [{ id: bob.id }]);
  assert.equal(res.body.events.at(-1).type, 'person_removed');
  assert.equal(res.body.events.at(-1).personId, bob.id);

  // While voting is open the round read redacts values to `votedIds`, and a
  // removed voter must not be counted there any more.
  const open = await getSession(round, session.id);
  assert.equal(open.votedIds.includes(bob.id), false);

  // Their column can no longer be written.
  const vote = await request(app).post(`${base(round, session)}/votes/${bob.id}`).send({ votes: { [a.id]: { rating: 5 } } });
  assert.equal(vote.status, 404);

  // …and after the reveal the kept column is there for the shelf readers.
  await request(app).post(`${base(round, session)}/close`);
  const closed = await getSession(round, session.id);
  assert.deepEqual(closed.votes[bob.id], { [a.id]: { rating: 2 } });
});

test('a removed guest keeps their name in removedPeople and loses their vote link column', async () => {
  const { round, session } = await setup();
  const guest = session.guests[0];
  const res = await request(app).delete(`${base(round, session)}/people/${guest.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.guests, []);
  assert.deepEqual(res.body.removedPeople, [{ id: guest.id, guest: true, name: 'Dora' }]);

  const link = await request(app).post(`${base(round, session)}/vote-link`).send({});
  const vote = await request(app).post(`/api/vote/${link.body.token}/votes/${guest.id}`).send({ votes: {} });
  assert.equal(vote.status, 404, 'the shared vote link refuses the removed guest too');
});

test('removing a winner of a finished session drops them from winnerIds', async () => {
  const { round, a, session } = await setup();
  const [, bob] = round.members;
  await request(app).post(`${base(round, session)}/close`);
  await request(app).post(`${base(round, session)}/choice`).send({ gameId: a.id });
  await request(app).post(`${base(round, session)}/finish`).send({ winnerIds: [bob.id] });

  const res = await request(app).delete(`${base(round, session)}/people/${bob.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.winnerIds, []);
  assert.equal(res.body.finished, true, 'the session stays played, with neither winners nor an ending');
  assert.equal('ending' in res.body, false);
});

test('a team that falls below two dissolves', async () => {
  const round0 = await createRound(request, { members: ['Alice', 'Bob', 'Cleo'] });
  await addGame(round0.id, 'A');
  const [alice, bob] = round0.members;
  const res0 = await request(app).post(`/api/rounds/${round0.id}/sessions`)
    .send({ count: 1, teams: [{ memberIds: [alice.id, bob.id], guestIndices: [] }] });
  const session = res0.body.session;
  assert.equal(session.teams.length, 1);

  const res = await request(app).delete(`${base(round0, session)}/people/${bob.id}`);
  assert.equal(res.status, 200);
  assert.equal('teams' in res.body, false);
});

test('the refusals: unknown person, last person, split parent, unknown session', async () => {
  const { round, session } = await setup();
  const unknown = await request(app).delete(`${base(round, session)}/people/nobody`);
  assert.equal(unknown.status, 404);

  const missing = await request(app).delete(`/api/rounds/${round.id}/sessions/nope/people/x`);
  assert.equal(missing.status, 404);

  // Take everyone out but one; the last is refused.
  const ids = [...session.memberIds, ...session.guests.map((g) => g.id)];
  for (const pid of ids.slice(1)) {
    assert.equal((await request(app).delete(`${base(round, session)}/people/${pid}`)).status, 200);
  }
  const last = await request(app).delete(`${base(round, session)}/people/${ids[0]}`);
  assert.equal(last.status, 400);
  assert.equal(last.body.error, 'last_person');
});

test('a split parent refuses with already_split', async () => {
  const { store } = require('./helpers');
  const { round, session } = await setup();
  // Mark the parent split directly — the split flow itself is
  // sessions-multi-table.test.js's subject, not this one's.
  const live = store.data.rounds.find((r) => r.id === round.id).sessions.find((s) => s.id === session.id);
  live.childSessionIds = ['child'];
  const res = await request(app).delete(`${base(round, session)}/people/${round.members[0].id}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'already_split');
});
