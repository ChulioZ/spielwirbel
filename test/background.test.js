'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

test('POST background stores a theme design as page + accent only', async () => {
  const round = await createRound(request);
  // A stray "pattern" (from the retired texture system) must not be stored.
  const res = await request(app)
    .post(`/api/rounds/${round.id}/background`)
    .send({ type: 'theme', page: '#eef2f7', accent: '#3a67b1', pattern: 'clouds' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.background, { type: 'theme', page: '#eef2f7', accent: '#3a67b1' });

  const list = await request(app).get('/api/rounds');
  const entry = list.body.find((r) => r.id === round.id);
  assert.deepEqual(entry.background, { type: 'theme', page: '#eef2f7', accent: '#3a67b1' });
});

test('POST background keeps the legacy plain-color form', async () => {
  const round = await createRound(request);
  const res = await request(app)
    .post(`/api/rounds/${round.id}/background`)
    .send({ type: 'color', color: '#fff7ed' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.background, { type: 'color', color: '#fff7ed' });
});

test('POST background resets to the default design with type none', async () => {
  const round = await createRound(request);
  await request(app)
    .post(`/api/rounds/${round.id}/background`)
    .send({ type: 'theme', page: '#f6ecf1', accent: '#b23a72' });
  const res = await request(app)
    .post(`/api/rounds/${round.id}/background`)
    .send({ type: 'none' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.background, { type: 'none' });
});

test('POST background rejects an unknown round', async () => {
  const res = await request(app)
    .post('/api/rounds/does-not-exist/background')
    .send({ type: 'none' });
  assert.equal(res.status, 404);
});

// ---- Worlds (#903): the stored shape gained a stable `id` ----------------

const { DESIGNS } = require('../public/js/round-designs');

test('POST background round-trips every shipped design id', async () => {
  // EVERY id, not a sample: the schema caps the id length, and the loop is what
  // proves no shipped id is silently stripped by it — the palette bug of
  // .claude/rules/shared-constants-across-the-stack.md, one field over.
  const round = await createRound(request);
  for (const design of DESIGNS) {
    const body = { type: 'theme', id: design.id, page: design.page, accent: design.accent };
    const res = await request(app).post(`/api/rounds/${round.id}/background`).send(body);
    assert.equal(res.status, 200, design.id);
    assert.deepEqual(res.body.background, body, `${design.id}: the id must survive the save`);

    const list = await request(app).get('/api/rounds');
    const entry = list.body.find((r) => r.id === round.id);
    assert.deepEqual(entry.background, body, `${design.id}: the summary carries the id back`);
  }
});

test('POST background still never 400s: a malformed body falls back to the default design', async () => {
  const round = await createRound(request);
  for (const body of [
    { type: 'theme', id: 'x'.repeat(40), page: '#ecf1e4', accent: '#356427' }, // over the id cap
    { type: 'theme', id: 42, page: '#ecf1e4', accent: '#356427' },              // wrong type
    { type: 'theme', page: 42 },
    { type: 'world', id: 'forest' },
    'garbage',
  ]) {
    const res = await request(app).post(`/api/rounds/${round.id}/background`).send(body);
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual(res.body.background, { type: 'none' }, JSON.stringify(body));
  }
});
