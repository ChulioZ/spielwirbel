'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

// The one palette the UI offers and the route validates against — required from
// its real source, so a stale hand-copied constant can't make this suite pass
// against colours the UI stopped offering (#420).
const { MEMBER_COLORS } = require('../public/js/member-colors');
const A_VALID_COLOR = MEMBER_COLORS[0];

/* ------------------------- POST: add a seat (#563) ------------------------- */

test('POST members appends a name-only seat and returns it', async () => {
  const round = await createRound(request); // Alice, Bob
  const res = await request(app)
    .post(`/api/rounds/${round.id}/members`)
    .send({ name: '  Charlie  ' });
  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'Charlie'); // trimmed, same shape as round creation
  assert.match(res.body.id, /^[0-9a-f]{16}$/);
  // A name-only seat: the account link is self-claim (#421), so the key must be
  // ABSENT rather than null — a null would also split JSON/Postgres jsonb parity.
  assert.equal('userId' in res.body, false);

  const detail = await request(app).get(`/api/rounds/${round.id}`);
  // Appended, never prepended: memberColor() derives an unset avatar colour from
  // the seat's POSITION, so inserting at the front recolours everyone (#421).
  assert.deepEqual(detail.body.members.map((m) => m.name), ['Alice', 'Bob', 'Charlie']);
});

// The point of appending, asserted on the thing that would actually break.
test('POST members leaves the existing seats and their derived colours untouched', async () => {
  const round = await createRound(request);
  const before = (await request(app).get(`/api/rounds/${round.id}`)).body.members;
  await request(app).post(`/api/rounds/${round.id}/members`).send({ name: 'Charlie' });
  const after = (await request(app).get(`/api/rounds/${round.id}`)).body.members;
  assert.deepEqual(after.slice(0, before.length), before);
});

test('POST members rejects an empty or whitespace-only name', async () => {
  const round = await createRound(request);
  for (const body of [{ name: '   ' }, { name: '' }, {}]) {
    const res = await request(app).post(`/api/rounds/${round.id}/members`).send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  // Nothing was appended by any of the refusals.
  const detail = await request(app).get(`/api/rounds/${round.id}`);
  assert.equal(detail.body.members.length, 2);
});

// The security property the route rests on: seat→account linking is SELF-claim
// (#421), enforced by the PATCH matrix. A hand-crafted POST must not be able to
// seat a stranger's account, or that whole matrix is bypassable by adding a seat
// pre-linked to someone else. Two layers hold: zod strips unknown keys, and the
// handler forwards only `{ name }`.
test('POST members ignores a userId or color smuggled into the body', async () => {
  const round = await createRound(request);
  const res = await request(app)
    .post(`/api/rounds/${round.id}/members`)
    .send({ name: 'Mallory', userId: 'some-stranger-account', color: '#000000' });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: res.body.id, name: 'Mallory' });

  const detail = await request(app).get(`/api/rounds/${round.id}`);
  const seat = detail.body.members.at(-1);
  assert.deepEqual(seat, { id: res.body.id, name: 'Mallory' });
  assert.equal('userId' in seat, false);
  assert.equal('color' in seat, false);
});

test('POST members 404s for an unknown round', async () => {
  const res = await request(app).post('/api/rounds/nope/members').send({ name: 'X' });
  assert.equal(res.status, 404);
});

// A new person in the round is real history (#563), unlike the name/colour edits
// the PATCH route deliberately leaves unlogged.
test('POST members logs a member_added activity carrying the name', async () => {
  const round = await createRound(request);
  await request(app).post(`/api/rounds/${round.id}/members`).send({ name: 'Charlie' });
  const acts = (await request(app).get(`/api/rounds/${round.id}/activities`)).body;
  const entry = acts.find((a) => a.type === 'member_added');
  assert.ok(entry, 'a member_added activity should exist');
  assert.equal(entry.name, 'Charlie');
  // Legacy mode has no acting account, so no seat to attribute it to — the entry
  // must carry no actorMemberId key at all rather than a null one.
  assert.equal('actorMemberId' in entry, false);
});

// The seat has to be usable immediately, which is the whole point of adding it.
test('a freshly added member can be seated in a session and picked as winner', async () => {
  const round = await createRound(request);
  // Games arrive as multipart (the route is behind multer for the cover upload).
  const gameReq = request(app).post(`/api/rounds/${round.id}/games`);
  for (const [k, v] of Object.entries({ title: 'Catan', minPlayers: '1', maxPlayers: '8' }))
    gameReq.field(k, v);
  const game = (await gameReq).body;
  const added = (await request(app)
    .post(`/api/rounds/${round.id}/members`).send({ name: 'Charlie' })).body;

  // The start route answers { session, games } — not a bare session.
  const session = (await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id, memberIds: [added.id] })).body.session;
  assert.deepEqual(session.memberIds, [added.id]);

  const fin = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/finish`)
    .send({ finished: true, winnerIds: [added.id] });
  assert.equal(fin.status, 200);
  assert.deepEqual(fin.body.winnerIds, [added.id]);
});

test('PATCH member updates the name', async () => {
  const round = await createRound(request);
  const member = round.members[0];
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/members/${member.id}`)
    .send({ name: '  Alicia  ' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Alicia'); // trimmed

  const detail = await request(app).get(`/api/rounds/${round.id}`);
  assert.equal(detail.body.members.find((m) => m.id === member.id).name, 'Alicia');
});

test('PATCH member updates the color to a palette value', async () => {
  const round = await createRound(request);
  const member = round.members[0];
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/members/${member.id}`)
    .send({ color: A_VALID_COLOR });
  assert.equal(res.status, 200);
  assert.equal(res.body.color, A_VALID_COLOR);

  const detail = await request(app).get(`/api/rounds/${round.id}`);
  assert.equal(detail.body.members.find((m) => m.id === member.id).color, A_VALID_COLOR);
});

test('PATCH member accepts name and color together', async () => {
  const round = await createRound(request);
  const member = round.members[0];
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/members/${member.id}`)
    .send({ name: 'Bo', color: A_VALID_COLOR });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Bo');
  assert.equal(res.body.color, A_VALID_COLOR);
});

test('PATCH member rejects an empty name', async () => {
  const round = await createRound(request);
  const member = round.members[0];
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/members/${member.id}`)
    .send({ name: '   ' });
  assert.equal(res.status, 400);
});

// Every swatch the member view renders comes from MEMBER_COLORS, so every entry
// must be accepted — testing one colour is what let six of the eight rot (#420).
test('PATCH member accepts every color of the shared palette', async () => {
  const round = await createRound(request);
  const member = round.members[0];
  const rejected = [];
  for (const color of MEMBER_COLORS) {
    const res = await request(app)
      .patch(`/api/rounds/${round.id}/members/${member.id}`)
      .send({ color });
    if (res.status !== 200 || res.body.color !== color) rejected.push(`${color} → ${res.status}`);
  }
  assert.deepEqual(rejected, [], 'every palette color the UI offers must be storable');
  assert.equal(MEMBER_COLORS.length, 8, 'the palette should still hold 8 colors');
});

test('PATCH member rejects a color outside the palette', async () => {
  const round = await createRound(request);
  const member = round.members[0];
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/members/${member.id}`)
    .send({ color: '#123456' });
  assert.equal(res.status, 400);
});

test('PATCH member 404s for an unknown round or member', async () => {
  const round = await createRound(request);
  assert.equal(
    (await request(app).patch(`/api/rounds/nope/members/x`).send({ name: 'X' })).status,
    404
  );
  assert.equal(
    (await request(app).patch(`/api/rounds/${round.id}/members/nope`).send({ name: 'X' })).status,
    404
  );
});

// #421: without accounts there is no "me", so no seat can be claimed. Legacy
// mode must stay byte-identical — an unlinked seat, and no route that links one.
test('PATCH member refuses any userId in legacy (accounts-off) mode', async () => {
  const round = await createRound(request);
  const member = round.members[0];
  assert.equal('userId' in member, false); // no owner seat is written either

  for (const body of [{ userId: null }, { userId: 'someone' }]) {
    const res = await request(app)
      .patch(`/api/rounds/${round.id}/members/${member.id}`)
      .send(body);
    assert.equal(res.status, 403, JSON.stringify(body));
    assert.equal(res.body.error, 'not_self');
  }
  // The refusal is scoped to the link: name/colour still work in the same mode.
  assert.equal(
    (await request(app).patch(`/api/rounds/${round.id}/members/${member.id}`).send({ name: 'Ok' })).status,
    200
  );
});
