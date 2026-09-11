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

/* Present WITHOUT your shelf (#1002). The seat still counts for everything the
 * session does with it — the whole scope of the feature is that the POOL
 * narrows and nothing else does — so each case below asserts both halves. */

test('a seat marked as without their shelf loses their solely-owned games (#1002)', async () => {
  const round = await createRound(request);
  const [alice, bob] = round.members;
  await addOwned(round.id, 'Alices', [alice.id]);
  await addOwned(round.id, 'Bobs', [bob.id]);
  await addOwned(round.id, 'Both', [alice.id, bob.id]);
  await addGame(round.id, { title: 'Unmarked' });

  const res = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 9, memberIds: [alice.id, bob.id], withoutShelfIds: [alice.id] });
  assert.equal(res.status, 201);
  // „Both" is the case a "remove their games" reading of the title gets wrong:
  // Bob is here and Bob owns it too, so the box is in the room.
  assert.deepEqual(res.body.games.map((g) => g.title).sort(), ['Bobs', 'Both', 'Unmarked']);
  // The seat itself is untouched — she plays, votes and can win.
  assert.deepEqual(res.body.session.memberIds.sort(), [alice.id, bob.id].sort());
});

test('marking every owner leaves only the games nobody owns (#1002)', async () => {
  const round = await createRound(request);
  const [alice, bob] = round.members;
  await addOwned(round.id, 'Alices', [alice.id]);
  await addOwned(round.id, 'Both', [alice.id, bob.id]);
  await addGame(round.id, { title: 'Unmarked' });

  const res = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 9, memberIds: [alice.id, bob.id], withoutShelfIds: [alice.id, bob.id] });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.games.map((g) => g.title), ['Unmarked'],
    'an empty shelf party must still APPLY the owner clause, not switch it off');
});

test('an id that is not a seat subtracts nothing, and no draw is rejected over it (#1002)', async () => {
  const round = await createRound(request);
  const [alice] = round.members;
  await addOwned(round.id, 'Alices', [alice.id]);

  const res = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 9, memberIds: [alice.id], withoutShelfIds: ['ghost', 42, null] });
  assert.equal(res.status, 201, 'the field is lenient like every other one on this body');
  assert.deepEqual(res.body.games.map((g) => g.title), ['Alices']);
});

test('the marks are STORED on the session, resolved against the seats (#1002)', async () => {
  const round = await createRound(request);
  const [alice, bob] = round.members;
  await addOwned(round.id, 'Bobs', [bob.id]);

  const res = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 9, memberIds: [alice.id, bob.id], withoutShelfIds: [alice.id, 'ghost'] });
  // The results screen reads this back, so an id naming nobody at this table
  // must not survive into the blob.
  assert.deepEqual(res.body.session.withoutShelfIds, [alice.id]);

  // …and an ordinary evening grows no key at all, so its blob stays
  // byte-identical to a pre-#1002 one in both backends.
  const plain = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 9, memberIds: [alice.id, bob.id] });
  assert.ok(!('withoutShelfIds' in plain.body.session), 'absent-key discipline');
});

test('who came without their shelf is NOT remembered as a preset (#1002)', async () => {
  const round = await createRound(request);
  const [alice, bob] = round.members;
  await addOwned(round.id, 'Alices', [alice.id]);
  await addOwned(round.id, 'Bobs', [bob.id]);

  await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 9, memberIds: [alice.id, bob.id], withoutShelfIds: [alice.id] });

  // Who brought what is a fact about tonight, like the seats and the guests —
  // not a filter somebody chose. Remembering it would silently hide Alice's
  // shelf next week with nothing on the setup screen ticked to explain it.
  const after = await request(app).get(`/api/rounds/${round.id}`);
  const stored = after.body.lastSessionFilters || {};
  assert.ok(!('withoutShelfIds' in stored), 'the preset must not carry it');
  const again = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 9, memberIds: [alice.id, bob.id] });
  assert.deepEqual(again.body.games.map((g) => g.title).sort(), ['Alices', 'Bobs'],
    'so the next draw starts from a full shelf again');
});
