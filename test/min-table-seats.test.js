'use strict';

/* A multi-table session's own minimum table size (#1730), end to end: the draw
   pool, the stored session and preset, the proposals, the split validation and
   the saved filter.

   The default of 3 is pinned by test/sessions-multi-table.test.js, whose
   sessions carry no `minTableSeats` at all — the legacy shape. This file covers
   what moves when the group picks another value. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

const NAMES = ['Anna', 'Ben', 'Dana', 'Eli', 'Frida', 'Georg', 'Hana', 'Ivo', 'Jo'];

async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Game', minPlayers: '2', maxPlayers: '4', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  return (await req).body;
}

const draw = (rid, body) => request(app).post(`/api/rounds/${rid}/sessions`).send({ count: 5, ...body });
const readRound = async (rid) => (await request(app).get(`/api/rounds/${rid}`)).body;

// Six people, a two-player box and a four-player box — the issue's weekend in
// miniature: only a 2 + 4 split seats everyone.
async function duoAndQuad() {
  const round = await createRound(request, { name: 'Wochenende', members: NAMES.slice(0, 6) });
  const duo = await addGame(round.id, { title: 'Duo', minPlayers: '2', maxPlayers: '2' });
  const quad = await addGame(round.id, { title: 'Quad', minPlayers: '4', maxPlayers: '4' });
  return { round, duo, quad };
}

async function voteAndClose(round, session, rating = () => 4) {
  const members = (await readRound(round.id)).members;
  for (const member of members) {
    const votes = {};
    session.gameIds.forEach((gid) => { votes[gid] = { rating: rating(member, gid) }; });
    await request(app)
      .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${member.id}`)
      .send({ votes });
  }
  const closed = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});
  assert.equal(closed.status, 200);
  return members;
}

test('at minimum 2 a two-player game enters the pool, and the split 2 + 4 goes through', async () => {
  const { round, duo, quad } = await duoAndQuad();

  const atDefault = await draw(round.id, { multiTable: true });
  assert.equal(atDefault.status, 201);
  assert.deepEqual(atDefault.body.session.gameIds, [quad.id], 'control: at 3 the duo box seats no table');

  const res = await draw(round.id, { multiTable: true, minTableSeats: 2 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const session = res.body.session;
  assert.deepEqual(session.gameIds.slice().sort(), [duo.id, quad.id].sort());
  assert.equal(session.minTableSeats, 2);
  assert.equal((await readRound(round.id)).lastSessionFilters.minTableSeats, 2, 'remembered for the next draw');

  const members = await voteAndClose(round, session);
  const proposals = (await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/tables`).send({})).body.proposals;
  assert.equal(proposals.length, 1);
  const sizes = proposals[0].tables.map((tb) => tb.personIds.length).sort();
  assert.deepEqual(sizes, [2, 4]);

  const ids = members.map((m) => m.id);
  const split = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/split`)
    .send({ tables: [{ gameId: duo.id, personIds: ids.slice(0, 2) }, { gameId: quad.id, personIds: ids.slice(2) }] });
  assert.equal(split.status, 201, JSON.stringify(split.body));
});

test('at minimum 4 a three-player box leaves the pool, and a table of three is refused', async () => {
  const round = await createRound(request, { name: 'Acht', members: NAMES.slice(0, 8) });
  const trio = await addGame(round.id, { title: 'Trio', minPlayers: '3', maxPlayers: '3' });
  const a = await addGame(round.id, { title: 'A', minPlayers: '2', maxPlayers: '6' });
  const b = await addGame(round.id, { title: 'B', minPlayers: '2', maxPlayers: '6' });

  const atDefault = await draw(round.id, { multiTable: true });
  assert.ok(atDefault.body.session.gameIds.includes(trio.id), 'control: at 3 the trio box is in');

  const res = await draw(round.id, { multiTable: true, minTableSeats: 4 });
  assert.equal(res.status, 201);
  const session = res.body.session;
  assert.deepEqual(session.gameIds.slice().sort(), [a.id, b.id].sort());

  const members = await voteAndClose(round, session);
  const proposals = (await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/tables`).send({})).body.proposals;
  assert.ok(proposals.length);
  for (const pr of proposals) for (const tb of pr.tables) assert.ok(tb.personIds.length >= 4, JSON.stringify(pr));

  // 3 + 5 is inside both boxes' ranges and above the default — refused only
  // because THIS session said four.
  const ids = members.map((m) => m.id);
  const split = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/split`)
    .send({ tables: [{ gameId: a.id, personIds: ids.slice(0, 3) }, { gameId: b.id, personIds: ids.slice(3) }] });
  assert.equal(split.status, 400);
  assert.equal(split.body.error, 'table_too_small');
});

test('the default and a single-table draw grow no key, in the session or the preset', async () => {
  const { round } = await duoAndQuad();
  for (const body of [{ multiTable: true }, { multiTable: true, minTableSeats: 3 }, { minTableSeats: 2 }]) {
    const res = await draw(round.id, body);
    assert.equal(res.status, body.multiTable ? 201 : 400, JSON.stringify(body));
    if (res.status === 201) assert.equal('minTableSeats' in res.body.session, false, JSON.stringify(body));
    assert.equal('minTableSeats' in ((await readRound(round.id)).lastSessionFilters || {}), false, JSON.stringify(body));
  }
});

test('an out-of-range or malformed minimum is a 400, never a silent default', async () => {
  const { round } = await duoAndQuad();
  for (const value of [1, 7, 0, 2.5, '2', 'zwei', true]) {
    const res = await draw(round.id, { multiTable: true, minTableSeats: value });
    assert.equal(res.status, 400, `minTableSeats: ${JSON.stringify(value)}`);
  }
});

test('a saved filter keeps the minimum with the mode, and only then', async () => {
  const { round } = await duoAndQuad();
  const save = (body) => request(app).post(`/api/rounds/${round.id}/filters`).send({ count: 2, ...body });

  const kept = await save({ name: 'Duos ok', multiTable: true, minTableSeats: 2 });
  assert.equal(kept.status, 201);
  assert.equal(kept.body.minTableSeats, 2);

  const dropped = await save({ name: 'Ein Tisch', minTableSeats: 2 });
  assert.equal(dropped.status, 201);
  assert.equal('minTableSeats' in dropped.body, false, 'meaningless without multiTable');

  assert.equal((await save({ name: 'Kaputt', multiTable: true, minTableSeats: 9 })).status, 400);
});
