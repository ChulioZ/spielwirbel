'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const store = require('../lib/store');

// A minimal but real PNG (magic bytes) — uploads are validated by content.
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8),
]);

test('POST /api/rounds creates a round with cleaned members', async () => {
  const res = await request(app)
    .post('/api/rounds')
    .send({ name: '  The Smiths  ', members: ['Ann', '', '  Ben  '] });
  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'The Smiths');
  assert.deepEqual(res.body.members.map((m) => m.name), ['Ann', 'Ben']);
  assert.deepEqual(res.body.games, []);
});

test('POST /api/rounds rejects a missing name', async () => {
  const res = await request(app).post('/api/rounds').send({ members: ['Ann'] });
  assert.equal(res.status, 400);
});

test('POST /api/rounds rejects a round without members', async () => {
  const res = await request(app).post('/api/rounds').send({ name: 'Lonely' });
  assert.equal(res.status, 400);
});

test('GET /api/rounds returns a compact list counting only active games', async () => {
  const round = await createRound(request);
  await request(app)
    .post(`/api/rounds/${round.id}/games`)
    .field('title', 'Chess')
    .field('minPlayers', '2')
    .field('maxPlayers', '2');
  const res = await request(app).get('/api/rounds');
  assert.equal(res.status, 200);
  const entry = res.body.find((r) => r.id === round.id);
  assert.equal(entry.gameCount, 1);
  assert.equal(entry.memberCount, 2);
});

// gameCount also feeds the import dropdown's "n games", and createRound's
// import skips BOTH archives — so counting a completed game here would promise
// more games than the copy actually delivers (#250).
test('GET /api/rounds excludes completed games from gameCount (#250)', async () => {
  const round = await createRound(request);
  const mk = async (title) =>
    (await request(app)
      .post(`/api/rounds/${round.id}/games`)
      .field('title', title)
      .field('minPlayers', '2')
      .field('maxPlayers', '4')).body;
  const active = await mk('Catan');
  const done = await mk('Pandemic Legacy');
  const gone = await mk('Alte Gurke');
  await request(app).post(`/api/rounds/${round.id}/games/${done.id}/complete`).send({});
  await request(app).post(`/api/rounds/${round.id}/games/${gone.id}/retire`).send({});

  const entry = (await request(app).get('/api/rounds')).body.find((r) => r.id === round.id);
  assert.equal(entry.gameCount, 1, 'only the active game counts');
  assert.ok(active.id);

  // ...and the import actually copies exactly that one game.
  const copy = await request(app)
    .post('/api/rounds')
    .send({ name: 'Copy', members: ['Z', 'Y'], importFromRoundId: round.id });
  assert.equal(copy.body.games.length, entry.gameCount);
  assert.equal(copy.body.games[0].title, 'Catan');
});

test('GET /api/rounds summary carries members, background and lastPlayed', async () => {
  const round = await createRound(request); // Alice, Bob

  let res = await request(app).get('/api/rounds');
  let entry = res.body.find((r) => r.id === round.id);
  assert.deepEqual(entry.members.map((m) => m.name), ['Alice', 'Bob']);
  assert.equal(entry.background, null);
  assert.equal(entry.lastPlayed, null);
  assert.equal(entry.playedCount, 0);

  // Play one full session: draw, choose the game, finish with Alice winning.
  const game = (
    await request(app)
      .post(`/api/rounds/${round.id}/games`)
      .field('title', 'Chess')
      .field('minPlayers', '2')
      .field('maxPlayers', '2')
  ).body;
  const session = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({})).body
    .session;
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/choice`)
    .send({ gameId: game.id });
  const alice = round.members[0];
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/finish`)
    .send({ finished: true, winnerIds: [alice.id] });

  res = await request(app).get('/api/rounds');
  entry = res.body.find((r) => r.id === round.id);
  assert.equal(entry.playedCount, 1);
  assert.equal(entry.lastPlayed.gameTitle, 'Chess');
  assert.deepEqual(entry.lastPlayed.winnerNames, ['Alice']);
  assert.ok(entry.lastPlayed.at);
});

test('GET /api/rounds lastPlayed follows createdAt, not a later re-finish', async () => {
  // Re-finishing an older session must not make it the "last played" one: the
  // home tile has to agree with the Chronik, which orders by createdAt.
  const round = await createRound(request); // Alice, Bob
  const alice = round.members[0];

  async function playSession(title) {
    const game = (
      await request(app)
        .post(`/api/rounds/${round.id}/games`)
        .field('title', title)
        .field('minPlayers', '2')
        .field('maxPlayers', '2')
    ).body;
    const session = (
      await request(app).post(`/api/rounds/${round.id}/sessions`).send({ gameId: game.id })
    ).body.session;
    await request(app)
      .post(`/api/rounds/${round.id}/sessions/${session.id}/finish`)
      .send({ finished: true, winnerIds: [alice.id] });
    return session;
  }

  const older = await playSession('Chess');
  // Keep the two createdAt stamps apart (they are ISO strings with ms).
  await new Promise((r) => setTimeout(r, 5));
  await playSession('Go');

  let entry = (await request(app).get('/api/rounds')).body.find((r) => r.id === round.id);
  assert.equal(entry.lastPlayed.gameTitle, 'Go');
  const at = entry.lastPlayed.at;
  assert.ok(at > older.createdAt); // the newer session's createdAt is shown

  // Reset the older session's result and finish it again — its finishedAt is
  // now the newest, but it stays the older session.
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${older.id}/finish`)
    .send({ finished: false });
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${older.id}/finish`)
    .send({ finished: true, winnerIds: [alice.id] });

  entry = (await request(app).get('/api/rounds')).body.find((r) => r.id === round.id);
  assert.equal(entry.lastPlayed.gameTitle, 'Go');
  assert.equal(entry.lastPlayed.at, at);
});

test('GET /api/rounds/:rid 404s for an unknown round', async () => {
  const res = await request(app).get('/api/rounds/does-not-exist');
  assert.equal(res.status, 404);
});

test('DELETE /api/rounds/:rid removes the round', async () => {
  const round = await createRound(request);
  const del = await request(app).delete(`/api/rounds/${round.id}`);
  assert.equal(del.status, 200);
  const res = await request(app).get(`/api/rounds/${round.id}`);
  assert.equal(res.status, 404);
});

// #280: the cover objects of a deleted round's games used to be left behind
// forever — unreachable, since the only copy of the key was the deleted row.
test('DELETE /api/rounds/:rid deletes its games\' cover files', async () => {
  const round = await createRound(request);
  const upload = await request(app)
    .post(`/api/rounds/${round.id}/games`)
    .field('title', 'Chess').field('minPlayers', '2').field('maxPlayers', '4')
    .attach('image', PNG_BYTES, { filename: 'c.png', contentType: 'image/png' });
  assert.equal(upload.status, 201);
  const cover = path.join(store.UPLOAD_DIR, path.basename(upload.body.image));
  assert.ok(fs.existsSync(cover));

  assert.equal((await request(app).delete(`/api/rounds/${round.id}`)).status, 200);
  assert.equal(fs.existsSync(cover), false);
});

// The counterpart: importFromRoundId copies the cover PATH, not the file, so
// deleting one round must not pull the cover out from under the other.
test('DELETE /api/rounds/:rid keeps a cover another round still references', async () => {
  const src = await createRound(request, { name: 'Src' });
  const upload = await request(app)
    .post(`/api/rounds/${src.id}/games`)
    .field('title', 'Chess').field('minPlayers', '2').field('maxPlayers', '4')
    .attach('image', PNG_BYTES, { filename: 'c.png', contentType: 'image/png' });
  const cover = path.join(store.UPLOAD_DIR, path.basename(upload.body.image));

  const copy = await request(app)
    .post('/api/rounds')
    .send({ name: 'Copy', members: ['Z'], importFromRoundId: src.id });
  assert.equal(copy.body.games[0].image, upload.body.image);

  assert.equal((await request(app).delete(`/api/rounds/${src.id}`)).status, 200);
  assert.ok(fs.existsSync(cover), 'the imported round still shows this cover');

  // Once the last referencing round goes, the object is cleaned up after all.
  assert.equal((await request(app).delete(`/api/rounds/${copy.body.id}`)).status, 200);
  assert.equal(fs.existsSync(cover), false);
});

// A hotlinked provider cover (#172) is not ours to delete, and storage.remove's
// basename() would otherwise resolve it onto one of OUR objects.
test('DELETE /api/rounds/:rid leaves hotlinked provider covers alone', async () => {
  const round = await createRound(request);
  const decoy = await createRound(request, { name: 'Decoy' });
  const upload = await request(app)
    .post(`/api/rounds/${decoy.id}/games`)
    .field('title', 'Keep').field('minPlayers', '2').field('maxPlayers', '4')
    .attach('image', PNG_BYTES, { filename: 'c.png', contentType: 'image/png' });
  const ours = path.join(store.UPLOAD_DIR, path.basename(upload.body.image));

  // Same basename as our object, but on a provider host — deleting the round
  // must not touch the file the colliding name resolves to.
  const hotlink = `https://cf.geekdo-images.com/x/${path.basename(upload.body.image)}`;
  const game = await request(app)
    .post(`/api/rounds/${round.id}/games`)
    .field('title', 'Linked').field('minPlayers', '2').field('maxPlayers', '4')
    .field('imageUrl', hotlink);
  assert.equal(game.body.image, hotlink);

  assert.equal((await request(app).delete(`/api/rounds/${round.id}`)).status, 200);
  assert.ok(fs.existsSync(ours), 'the colliding own-upload survives');
});

test('importFromRoundId copies active games into the new round', async () => {
  const src = await createRound(request, { name: 'Source' });
  await request(app)
    .post(`/api/rounds/${src.id}/games`)
    .field('title', 'Catan')
    .field('minPlayers', '3')
    .field('maxPlayers', '4');
  const res = await request(app)
    .post('/api/rounds')
    .send({ name: 'Copy', members: ['Ann'], importFromRoundId: src.id });
  assert.equal(res.status, 201);
  assert.equal(res.body.games.length, 1);
  assert.equal(res.body.games[0].title, 'Catan');
});

// Issue #264: the buy-next recommendations feature (the app's only AI surface)
// was removed entirely. Guard the removal so the route can't quietly come back.
test('the recommendations endpoints are gone (#264)', async () => {
  const round = await createRound(request, { name: 'NoRecs' });
  for (const [method, path] of [
    ['post', `/api/rounds/${round.id}/recommendations`],
    ['get', `/api/rounds/${round.id}/recommendations`],
    ['delete', `/api/rounds/${round.id}/recommendations/anything`],
  ]) {
    const res = await request(app)[method](path);
    assert.equal(res.status, 404, `${method.toUpperCase()} ${path} must 404`);
  }
});

// A round never carries a recommendation run history anymore (#264) — neither
// backend writes the key, so the payload shape is one field smaller.
test('a round snapshot carries no recommendationRuns key (#264)', async () => {
  const round = await createRound(request, { name: 'CleanShape' });
  assert.equal('recommendationRuns' in round, false);
  const res = await request(app).get(`/api/rounds/${round.id}`);
  assert.equal('recommendationRuns' in res.body, false);
});
