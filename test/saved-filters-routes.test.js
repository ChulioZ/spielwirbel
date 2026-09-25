'use strict';

/*
 * Saved session filters (#1328): POST/PATCH/DELETE /api/rounds/:rid/filters.
 *
 * Runs in legacy mode (accounts off) ON PURPOSE: unlike every other quota, the
 * saved-filter cap is enforced in every mode (lib/quota.js says why), so the
 * cap case here would go red if it were ever gated on quota.enforced().
 * The ceiling is lowered before the app is required — lib/quota.js reads it
 * per call, but the reorder schema's payload bound reads it at require time.
 */

process.env.MAX_SAVED_FILTERS_PER_ROUND = '3';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, store, createRound } = require('./helpers');

async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Game', minPlayers: '1', maxPlayers: '8', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  return (await req).body;
}

// Provider metadata written the way the backfill does it (see
// test/session-metadata-filter.test.js for why in place on the JSON tree).
function seedMeta(rid, gid, meta) {
  const round = store.data.rounds.find((r) => r.id === rid);
  Object.assign(round.games.find((g) => g.id === gid), meta);
}

async function shelf() {
  const round = await createRound(request, { members: ['Anna', 'Ben', 'Cleo'] });
  const kurz = await addGame(round.id, { title: 'Kurz' });
  const lang = await addGame(round.id, { title: 'Lang' });
  seedMeta(round.id, kurz.id, { minPlaytime: 30, maxPlaytime: 45 });
  seedMeta(round.id, lang.id, { minPlaytime: 120, maxPlaytime: 180 });
  const tag = (await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'Koop' })).body;
  return { round, tag };
}

const save = (rid, body) => request(app).post(`/api/rounds/${rid}/filters`).send(body);
const read = async (rid) => (await request(app).get(`/api/rounds/${rid}`)).body;

test('saving stores the resolved setup under a name — the shape the hub chip replays', async () => {
  const { round, tag } = await shelf();
  const [anna, ben] = round.members;
  const res = await save(round.id, {
    name: '  Kinderabend  ',
    tagIds: [tag.id, 'ghost-tag'],
    excludeTagIds: ['ghost-too'],
    tagMode: 'any',
    metadata: { maxPlaytime: 60, nonsense: 3 },
    multiTable: true,
    count: '4',
    memberIds: [anna.id, ben.id, 'ghost-seat'],
  });
  assert.equal(res.status, 201);
  assert.match(res.body.id, /^[0-9a-f]{16}$/);
  const { id, metadata, ...rest } = res.body;
  assert.ok(id);
  assert.deepEqual(rest, {
    name: 'Kinderabend',
    tagIds: [tag.id],
    excludeTagIds: [],
    count: 4,
    tagMode: 'any',
    multiTable: true,
    memberIds: [anna.id, ben.id],
  }, 'unknown ids are dropped on save, exactly as the draw drops them');
  // The metadata blob is stored in normalizeMetadataFilters' full shape, as the
  // draw's preset is; the unknown category is gone.
  assert.equal(metadata.maxPlaytime, 60);
  assert.equal('nonsense' in metadata, false);
  assert.deepEqual((await read(round.id)).savedFilters, [res.body]);
});

test('an ordinary filter grows no optional keys — the same absent-key shape as lastSessionFilters', async () => {
  const { round } = await shelf();
  const res = await save(round.id, { name: 'Alles', count: 2 });
  assert.equal(res.status, 201);
  for (const key of ['tagMode', 'metadata', 'multiTable']) {
    assert.equal(key in res.body, false, `${key} was stored for a filter that never set it`);
  }
  assert.deepEqual(res.body.memberIds, [], 'no seats sent, none stored — the screen falls back to everyone');
});

test('the save and the draw normalize through ONE function', async () => {
  // Same body to both routes: the saved filter's filter half must equal the
  // preset the draw remembers. Two copies of the rules would agree on the easy
  // inputs; this body carries one of each normalization.
  const { round, tag } = await shelf();
  const body = {
    // `tagMode: 'any'` with nothing left included collapses to the default.
    tagIds: ['ghost'], excludeTagIds: [tag.id, 'ghost-too'], tagMode: 'any',
    metadata: { maxPlaytime: 60, weightMax: 9 }, count: '0',
  };
  const drew = await request(app).post(`/api/rounds/${round.id}/sessions`).send(body);
  assert.equal(drew.status, 201);
  const saved = (await save(round.id, { name: 'Gleich', ...body })).body;
  const { lastSessionFilters } = await read(round.id);
  const { id, name, memberIds, ...filterHalf } = saved;
  assert.ok(id && name && memberIds);
  assert.deepEqual(filterHalf, lastSessionFilters);
});

test('a retired seat is not saved — the setup screen never offers one', async () => {
  const { round } = await shelf();
  const [anna, ben] = round.members;
  const retired = await request(app).post(`/api/rounds/${round.id}/members/${ben.id}/retire`).send({ retired: true });
  assert.equal(retired.status, 200);
  const res = await save(round.id, { name: 'Zwei', memberIds: [anna.id, ben.id] });
  assert.deepEqual(res.body.memberIds, [anna.id]);
});

test('saving does not touch the remembered draw preset', async () => {
  const { round } = await shelf();
  await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 2 });
  const before = (await read(round.id)).lastSessionFilters;
  assert.ok(before);
  await save(round.id, { name: 'Anders', count: 5, multiTable: true });
  assert.deepEqual((await read(round.id)).lastSessionFilters, before);
});

test('names: trimmed, 1–40 chars, unique per round case-insensitively', async () => {
  const { round } = await shelf();
  assert.equal((await save(round.id, { name: '   ' })).status, 400);
  assert.equal((await save(round.id, {})).status, 400);
  assert.equal((await save(round.id, { name: 'x'.repeat(41) })).status, 400);
  assert.equal((await save(round.id, { name: 'x'.repeat(40) })).status, 201);
  assert.equal((await save(round.id, { name: 'Koop' })).status, 201);
  const dup = await save(round.id, { name: ' kOOP ' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'filter_name_taken');
  // Another round may use the same name.
  const other = await createRound(request);
  assert.equal((await save(other.id, { name: 'Koop' })).status, 201);
});

test('the cap refuses the fourth filter in legacy mode too, and deleting frees a slot', async () => {
  const { round } = await shelf();
  for (const name of ['A', 'B', 'C']) assert.equal((await save(round.id, { name })).status, 201);
  const over = await save(round.id, { name: 'D' });
  assert.equal(over.status, 403);
  assert.equal(over.body.error, 'quota_filters');
  assert.equal(over.body.limit, 3);
  const first = (await read(round.id)).savedFilters[0];
  assert.equal((await request(app).delete(`/api/rounds/${round.id}/filters/${first.id}`)).status, 200);
  assert.equal((await save(round.id, { name: 'D' })).status, 201);
});

test('rename, reorder and delete', async () => {
  const { round } = await shelf();
  const a = (await save(round.id, { name: 'Eins' })).body;
  const b = (await save(round.id, { name: 'Zwei' })).body;
  const base = `/api/rounds/${round.id}/filters`;

  const renamed = await request(app).patch(`${base}/${a.id}`).send({ name: ' EINS ' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, 'EINS', 'a case fix of its own name is not a clash');
  const clash = await request(app).patch(`${base}/${a.id}`).send({ name: 'zwei' });
  assert.equal(clash.status, 409);
  assert.equal((await request(app).patch(`${base}/${a.id}`).send({ name: '' })).status, 400);
  assert.equal((await request(app).patch(`${base}/nope`).send({ name: 'X' })).status, 404);

  const moved = await request(app).patch(`${base}/order`).send({ filterIds: [b.id, a.id] });
  assert.equal(moved.status, 200, 'PATCH /order must not be swallowed by /:fid');
  assert.deepEqual((await read(round.id)).savedFilters.map((f) => f.name), ['Zwei', 'EINS']);
  const stale = await request(app).patch(`${base}/order`).send({ filterIds: [b.id] });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'filters_changed');

  assert.equal((await request(app).delete(`${base}/${b.id}`)).status, 200);
  assert.equal((await request(app).delete(`${base}/${b.id}`)).status, 404);
  assert.deepEqual((await read(round.id)).savedFilters.map((f) => f.name), ['EINS']);
});

test('an unknown round is a 404 on every route', async () => {
  const base = '/api/rounds/nope/filters';
  assert.equal((await request(app).post(base).send({ name: 'X' })).status, 404);
  assert.equal((await request(app).patch(`${base}/order`).send({ filterIds: ['a'] })).status, 404);
  assert.equal((await request(app).patch(`${base}/a`).send({ name: 'X' })).status, 404);
  assert.equal((await request(app).delete(`${base}/a`)).status, 404);
});

test('GET /api/config reports the ceiling and the name bound — always a number', async () => {
  const cfg = (await request(app).get('/api/config')).body;
  assert.deepEqual(cfg.savedFilters, { perRound: 3, nameMax: 40 });
});
