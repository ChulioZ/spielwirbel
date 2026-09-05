'use strict';

/*
 * POST /api/rounds/:rid/games/copy-to (#916) — the HTTP half of the copy.
 *
 * Its own file rather than more of test/games.test.js, which is already past the
 * 700-line source budget (.claude/rules/token-friendly-source-files.md), and
 * named for what it covers rather than for a module basename
 * (.claude/rules/test-file-names-collide-silently.md).
 *
 * The repo contract (test/support/repo-contract.js) proves the two backends copy
 * identically; what is left for this file is the ROUTE's contract — the refusal
 * codes, the dedupe, and the one thing neither layer alone can show: that the
 * source round's session history survives a copy of a played game, which is
 * exactly what the same request to /move-to destroys.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Chess', minPlayers: '2', maxPlayers: '4', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  return req;
}

const copyTo = (rid, body) => request(app).post(`/api/rounds/${rid}/games/copy-to`).send(body);

test('POST games/copy-to lands copies on the target and leaves the source shelf alone', async () => {
  const src = await createRound(request);
  const dst = await createRound(request);

  const srcTag = (await request(app).post(`/api/rounds/${src.id}/tags`).send({ name: 'Party' })).body;
  // Same tag by name (different case) already on the target — reused, not duplicated.
  const dstTag = (await request(app).post(`/api/rounds/${dst.id}/tags`).send({ name: 'party' })).body;
  const soloTag = (await request(app).post(`/api/rounds/${src.id}/tags`).send({ name: 'Solo' })).body;

  // Built inline rather than via addGame(): multipart repeats `tagIds` per value.
  const tagged = (await request(app).post(`/api/rounds/${src.id}/games`)
    .field('title', 'Uno').field('minPlayers', '2').field('maxPlayers', '4')
    .field('tagIds', srcTag.id).field('tagIds', soloTag.id)).body;
  const archived = (await addGame(src.id, { title: 'Old' })).body;
  await request(app).post(`/api/rounds/${src.id}/games/${archived.id}/retire`).send({});

  const res = await copyTo(src.id, { targetRoundId: dst.id });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { copiedGames: 2, mergedTags: 1, createdTags: 1 });

  // The source is untouched — the half that separates this from /move-to.
  const after = (await request(app).get(`/api/rounds/${src.id}`)).body;
  assert.deepEqual(after.games.map((g) => g.id), [tagged.id, archived.id]);

  const target = (await request(app).get(`/api/rounds/${dst.id}`)).body;
  assert.deepEqual(target.games.map((g) => g.title).sort(), ['Old', 'Uno']);
  // An archived game copies as archived; it is the same game over there.
  assert.equal(target.games.find((g) => g.title === 'Old').retired, true);

  // Fresh ids, and the player range rides along (#921's field set).
  const copy = target.games.find((g) => g.title === 'Uno');
  assert.notEqual(copy.id, tagged.id);
  assert.equal(copy.minPlayers, 2);
  assert.equal(copy.maxPlayers, 4);
  // Remapped onto the TARGET's tag ids: the merged one keeps the target's id.
  const createdTag = target.tags.find((tg) => tg.name === 'Solo');
  assert.deepEqual(copy.tagIds, [dstTag.id, createdTag.id]);

  // One bulk feed entry per round, and NOT the move's — the period recap counts
  // games_copied_in and deliberately ignores games_copied_out.
  const outFeed = (await request(app).get(`/api/rounds/${src.id}/activities`)).body;
  const inFeed = (await request(app).get(`/api/rounds/${dst.id}/activities`)).body;
  assert.equal(outFeed.filter((a) => a.type === 'games_copied_out').length, 1);
  assert.equal(outFeed.filter((a) => a.type === 'games_moved_out').length, 0);
  assert.equal(inFeed.filter((a) => a.type === 'games_copied_in').length, 1);
  assert.equal(inFeed.find((a) => a.type === 'games_copied_in').count, 2);
});

/* The one assertion neither the repo contract nor a move spec can make: the same
   request that would SCRUB this session leaves it whole. A copy of a played game
   must keep the evening, its votes and its winner in the source round. */
test('POST games/copy-to keeps the source round\'s session history', async () => {
  const src = await createRound(request);
  const dst = await createRound(request);
  const game = (await addGame(src.id, { title: 'Played' })).body;
  const seat = (await request(app).get(`/api/rounds/${src.id}`)).body.members[0].id;

  const session = (await request(app).post(`/api/rounds/${src.id}/sessions`)
    .send({ gameId: game.id, memberIds: [seat] })).body;
  await request(app).post(`/api/rounds/${src.id}/sessions/${session.id}/finish`)
    .send({ winnerIds: [seat] });

  const before = (await request(app).get(`/api/rounds/${src.id}`)).body;
  assert.equal(before.sessions.length, 1);

  assert.equal((await copyTo(src.id, { targetRoundId: dst.id })).status, 200);

  const after = (await request(app).get(`/api/rounds/${src.id}`)).body;
  assert.deepEqual(after.sessions, before.sessions, 'the copy scrubbed the source round');
  assert.deepEqual(after.games, before.games);
  // History never travels: the copy is a different game in a different round.
  const target = (await request(app).get(`/api/rounds/${dst.id}`)).body;
  assert.deepEqual(target.sessions, []);
  assert.notEqual(target.games[0].id, game.id);
});

test('POST games/copy-to rejects a missing, blank or identical target', async () => {
  const src = await createRound(request);

  const missing = await copyTo(src.id, { targetRoundId: 'nope' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'Target round not found');

  assert.equal((await copyTo(src.id, { targetRoundId: src.id })).status, 400);
  assert.equal((await copyTo(src.id, {})).status, 400);
  assert.equal((await copyTo('nope', { targetRoundId: src.id })).status, 404);
});

test('POST games/copy-to copies only the games named in gameIds, deduped', async () => {
  const src = await createRound(request);
  const dst = await createRound(request);
  const a = (await addGame(src.id, { title: 'A' })).body;
  const b = (await addGame(src.id, { title: 'B' })).body;
  const c = (await addGame(src.id, { title: 'C' })).body;

  // Duplicates in the request are deduped, not counted twice — so asking for the
  // same game twice cannot put two rows of it on the target shelf.
  const res = await copyTo(src.id, { targetRoundId: dst.id, gameIds: [a.id, c.id, a.id] });
  assert.equal(res.status, 200);
  assert.equal(res.body.copiedGames, 2);

  const after = (await request(app).get(`/api/rounds/${src.id}`)).body;
  assert.deepEqual(after.games.map((g) => g.id), [a.id, b.id, c.id]);
  const target = (await request(app).get(`/api/rounds/${dst.id}`)).body;
  assert.deepEqual(target.games.map((g) => g.title), ['A', 'C']);
});

test('POST games/copy-to rejects an empty or unknown gameIds selection', async () => {
  const src = await createRound(request);
  const dst = await createRound(request);
  const a = (await addGame(src.id, { title: 'A' })).body;

  // Absent = copy the whole shelf; [] is a client error, not a silent no-op —
  // the same split /move-to draws (#402).
  assert.equal((await copyTo(src.id, { targetRoundId: dst.id, gameIds: [] })).status, 400);

  const unknown = await copyTo(src.id, { targetRoundId: dst.id, gameIds: [a.id, 'nope'] });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'Unknown game');
  // Refused WHOLE: the known id in that request did not land either.
  assert.deepEqual((await request(app).get(`/api/rounds/${dst.id}`)).body.games, []);
});

/* Two identically-titled games on one shelf is ALLOWED by design — the sheet
   flags and unticks them, and ticking one back on copies it anyway. This pins
   that the server does not quietly dedupe by title behind the picker's back. */
test('POST games/copy-to allows a title the target already has', async () => {
  const src = await createRound(request);
  const dst = await createRound(request);
  await addGame(src.id, { title: 'Azul' });
  await addGame(dst.id, { title: 'Azul' });

  assert.equal((await copyTo(src.id, { targetRoundId: dst.id })).body.copiedGames, 1);
  const target = (await request(app).get(`/api/rounds/${dst.id}`)).body;
  assert.deepEqual(target.games.map((g) => g.title), ['Azul', 'Azul']);
  assert.notEqual(target.games[0].id, target.games[1].id);
});
