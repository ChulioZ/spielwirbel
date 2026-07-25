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
