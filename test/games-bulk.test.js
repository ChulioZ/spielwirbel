'use strict';

/*
 * Bulk shelf tidying (#832): POST …/games/bulk-retire and …/games/bulk-delete.
 *
 * The shelf can be FILLED in one action (the BGG collection import, #481) while
 * emptying it was per-game and two-step, so undoing a 200-game import ran to
 * some 400 interactions. These two routes are the one-request path.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const { app, store, createRound } = require('./helpers');

// Real magic bytes, padded past the 12-byte sniff minimum (as test/games.test.js).
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8),
]);
const objectOf = (image) => path.join(store.UPLOAD_DIR, path.basename(image));

async function addGame(rid, title) {
  const res = await request(app).post(`/api/rounds/${rid}/games`)
    .field('title', title).field('minPlayers', '2').field('maxPlayers', '4');
  assert.equal(res.status, 201, `fixture setup: ${JSON.stringify(res.body)}`);
  return res.body;
}
const shelf = async (rid, ...titles) => Promise.all(titles.map((x) => addGame(rid, x)));
const getRound = async (rid) => (await request(app).get(`/api/rounds/${rid}`)).body;
const feed = async (rid) => (await request(app).get(`/api/rounds/${rid}/activities`)).body;

test('bulk-retire takes several games off the shelf in one request', async () => {
  const round = await createRound(request);
  const [a, b, c] = await shelf(round.id, 'Azul', 'Brass', 'Cascadia');

  const res = await request(app)
    .post(`/api/rounds/${round.id}/games/bulk-retire`)
    .send({ gameIds: [a.id, b.id] });
  assert.equal(res.status, 200);
  assert.equal(res.body.retired, 2);

  const after = await getRound(round.id);
  const byId = Object.fromEntries(after.games.map((g) => [g.id, g]));
  assert.equal(byId[a.id].retired, true);
  assert.equal(byId[b.id].retired, true);
  assert.equal(byId[c.id].retired, false, 'an unnamed game is untouched');
  assert.ok(byId[a.id].retiredAt, 'the timestamp is stamped, as the single path does');
});

/* One count-bearing Chronik row, not N — the reasoning games_imported and
   games_moved_out were created for. An undo of a 200-game import would
   otherwise bury every other event the round has ever had. */
test('bulk-retire writes ONE counted activity, not one per game', async () => {
  const round = await createRound(request);
  const games = await shelf(round.id, 'A', 'B', 'C');
  await request(app).post(`/api/rounds/${round.id}/games/bulk-retire`)
    .send({ gameIds: games.map((g) => g.id) });

  const acts = await feed(round.id);
  const bulk = acts.filter((x) => x.type === 'games_retired');
  assert.equal(bulk.length, 1);
  assert.equal(bulk[0].count, 3);
  assert.equal(acts.filter((x) => x.type === 'game_retired').length, 0,
    'the single-game type is not also written');
});

/* The three off-shelf states stay mutually exclusive in the data layer
   (#250/#560), and a bulk path that skipped that would leave a game both
   wished-for and retired — one the round simultaneously wants and threw out. */
test('bulk-retire clears the completed and wish flags it supersedes', async () => {
  const round = await createRound(request);
  const [a, b] = await shelf(round.id, 'A', 'B');
  await request(app).post(`/api/rounds/${round.id}/games/${a.id}/complete`).send({});
  await request(app).post(`/api/rounds/${round.id}/games/${b.id}/wish`).send({});

  await request(app).post(`/api/rounds/${round.id}/games/bulk-retire`)
    .send({ gameIds: [a.id, b.id] });

  const byId = Object.fromEntries((await getRound(round.id)).games.map((g) => [g.id, g]));
  assert.equal(byId[a.id].completed, false);
  assert.equal(byId[a.id].wish, false);
  assert.equal(byId[b.id].wish, false);
  assert.equal(byId[a.id].retired, true);
  assert.equal(byId[b.id].retired, true);
});

/* Asking for a state a game is already in is not an error — a stale client
   re-sending is a no-op — but the count must report what actually changed, or
   the toast claims work that did not happen. */
test('an already-retired game is skipped and not counted', async () => {
  const round = await createRound(request);
  const [a, b] = await shelf(round.id, 'A', 'B');
  await request(app).post(`/api/rounds/${round.id}/games/${a.id}/retire`).send({});

  const res = await request(app).post(`/api/rounds/${round.id}/games/bulk-retire`)
    .send({ gameIds: [a.id, b.id] });
  assert.equal(res.body.retired, 1);
  assert.equal((await feed(round.id)).filter((x) => x.type === 'games_retired')[0].count, 1);
});

test('a selection naming a game of another round is refused WHOLE', async () => {
  const round = await createRound(request);
  const other = await createRound(request, { name: 'Elsewhere' });
  const [mine] = await shelf(round.id, 'Mine');
  const [theirs] = await shelf(other.id, 'Theirs');

  const res = await request(app).post(`/api/rounds/${round.id}/games/bulk-retire`)
    .send({ gameIds: [mine.id, theirs.id] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Unknown game');
  assert.equal((await getRound(round.id)).games[0].retired, false,
    'nothing is retired — a stale client is refused, not partly obeyed');
});

/* `gameIds` is REQUIRED here, unlike move-to's optional subset. A missing field
   must never be read as "retire or delete the whole shelf". */
test('a missing or empty gameIds is a 400, never "everything"', async () => {
  const round = await createRound(request);
  await shelf(round.id, 'A', 'B');
  for (const body of [{}, { gameIds: [] }]) {
    for (const act of ['retire', 'delete']) {
      const res = await request(app).post(`/api/rounds/${round.id}/games/bulk-${act}`).send(body);
      assert.equal(res.status, 400, `${act} ${JSON.stringify(body)}`);
    }
  }
  assert.equal((await getRound(round.id)).games.length, 2);
});

test('both routes 404 a missing round', async () => {
  for (const act of ['retire', 'delete']) {
    const res = await request(app).post(`/api/rounds/nope/games/bulk-${act}`).send({ gameIds: ['x'] });
    assert.equal(res.status, 404);
  }
});

test('bulk-delete removes several games in one request', async () => {
  const round = await createRound(request);
  const [a, b, c] = await shelf(round.id, 'A', 'B', 'C');

  const res = await request(app).post(`/api/rounds/${round.id}/games/bulk-delete`)
    .send({ gameIds: [a.id, b.id] });
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, 2);

  const after = await getRound(round.id);
  assert.deepEqual(after.games.map((g) => g.id), [c.id]);
  const acts = await feed(round.id);
  assert.equal(acts.filter((x) => x.type === 'games_deleted').length, 1);
  assert.equal(acts.filter((x) => x.type === 'games_deleted')[0].count, 2);
});

/* THE decision this endpoint exists to implement. DELETE /:gid refuses a game
   still on the shelf ('not_archived') so a stray request cannot erase one; the
   bulk path accepts it, because forcing the two-step in bulk is the problem
   rather than the fix. Reached only from a confirm naming the count, and gated
   on `game.delete` (co-owner) exactly as the single route is. */
test('bulk-delete accepts an ACTIVE game, which the single DELETE refuses', async () => {
  const round = await createRound(request);
  const [a] = await shelf(round.id, 'Still on the shelf');

  const single = await request(app).delete(`/api/rounds/${round.id}/games/${a.id}`);
  assert.equal(single.status, 400);
  assert.match(single.body.error, /Only retired, completed or wished-for/);

  const bulk = await request(app).post(`/api/rounds/${round.id}/games/bulk-delete`)
    .send({ gameIds: [a.id] });
  assert.equal(bulk.status, 200);
  assert.deepEqual((await getRound(round.id)).games, []);
});

/* A session is created by DRAWING `count` games from the active pool — there is
   no endpoint that takes an explicit game list — so the fixtures below draw the
   whole shelf and then delete part of it. */
const startSession = (rid, count) =>
  request(app).post(`/api/rounds/${rid}/sessions`).send({ count });

test('bulk-delete scrubs the games out of session history but keeps the session', async () => {
  const round = await createRound(request);
  const [a, b, c] = await shelf(round.id, 'A', 'B', 'C');
  assert.equal((await startSession(round.id, 3)).status, 201);
  assert.deepEqual([...(await getRound(round.id)).sessions[0].gameIds].sort(),
    [a.id, b.id, c.id].sort(), 'fixture: the session drew the whole shelf');

  await request(app).post(`/api/rounds/${round.id}/games/bulk-delete`)
    .send({ gameIds: [a.id, b.id] });

  const after = await getRound(round.id);
  assert.equal(after.sessions.length, 1, 'a session still holding a kept game survives');
  assert.deepEqual(after.sessions[0].gameIds, [c.id]);
});

test('a session left with NO games at all is dropped, as the single delete does', async () => {
  const round = await createRound(request);
  const [a, b] = await shelf(round.id, 'A', 'B');
  assert.equal((await startSession(round.id, 2)).status, 201);
  assert.equal((await getRound(round.id)).sessions.length, 1);

  await request(app).post(`/api/rounds/${round.id}/games/bulk-delete`)
    .send({ gameIds: [a.id, b.id] });

  assert.deepEqual((await getRound(round.id)).sessions, []);
});

/* The whole point of the bulk path is ONE pass over the sessions rather than one
   per deleted game. This is the behavioural half: several sessions and several
   games, every reference consistent afterwards. */
test('bulk-delete leaves no dangling reference across several sessions', async () => {
  const round = await createRound(request);
  const games = await shelf(round.id, 'A', 'B', 'C', 'D');
  const ids = games.map((g) => g.id);
  await startSession(round.id, 4);
  await startSession(round.id, 4);
  assert.equal((await getRound(round.id)).sessions.length, 2);

  await request(app).post(`/api/rounds/${round.id}/games/bulk-delete`)
    .send({ gameIds: [ids[0], ids[1]] });

  const after = await getRound(round.id);
  const live = new Set(after.games.map((g) => g.id));
  assert.equal(after.games.length, 2);
  assert.equal(after.sessions.length, 2);
  for (const s of after.sessions) {
    assert.ok(s.gameIds.length > 0, 'no empty session survives');
    for (const gid of s.gameIds) assert.ok(live.has(gid), `session ${s.id} still names ${gid}`);
    for (const votes of Object.values(s.votes || {})) {
      for (const gid of Object.keys(votes)) assert.ok(live.has(gid), `a vote still names ${gid}`);
    }
  }
});

test('bulk-delete drops the deleted games from the activity feed', async () => {
  const round = await createRound(request);
  const [a, b] = await shelf(round.id, 'A', 'B');
  assert.equal((await feed(round.id)).filter((x) => x.gameId === a.id).length, 1);

  await request(app).post(`/api/rounds/${round.id}/games/bulk-delete`)
    .send({ gameIds: [a.id] });

  const acts = await feed(round.id);
  assert.equal(acts.filter((x) => x.gameId === a.id).length, 0);
  assert.equal(acts.filter((x) => x.gameId === b.id).length, 1, 'the kept game keeps its row');
});

test('duplicate ids in one request are deduped, not double-counted', async () => {
  const round = await createRound(request);
  const [a] = await shelf(round.id, 'A');
  const res = await request(app).post(`/api/rounds/${round.id}/games/bulk-delete`)
    .send({ gameIds: [a.id, a.id, a.id] });
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, 1);
});

/* A bulk path that skips the per-image cleanup leaks one object per deleted
   game — 200 files on the undo this feature exists for, with nothing anywhere
   to say so (.claude/rules/deletion-paths-must-free-cover-objects.md). */
test('bulk-delete frees the cover object of every deleted game', async () => {
  const round = await createRound(request);
  const withCover = async (title) => {
    const res = await request(app).post(`/api/rounds/${round.id}/games`)
      .field('title', title).field('minPlayers', '2').field('maxPlayers', '4')
      .attach('image', PNG_BYTES, { filename: 'c.png', contentType: 'image/png' });
    assert.equal(res.status, 201);
    assert.ok(fs.existsSync(objectOf(res.body.image)), 'fixture: the object was stored');
    return res.body;
  };
  const a = await withCover('A');
  const b = await withCover('B');
  const keep = await withCover('Keep');

  await request(app).post(`/api/rounds/${round.id}/games/bulk-delete`)
    .send({ gameIds: [a.id, b.id] });

  assert.equal(fs.existsSync(objectOf(a.image)), false, 'A\'s cover leaked');
  assert.equal(fs.existsSync(objectOf(b.image)), false, 'B\'s cover leaked');
  assert.ok(fs.existsSync(objectOf(keep.image)), 'the kept game\'s cover was removed');
});

/* An imported round copies the cover PATH, not the file, so the check has to be
   per image and not "these games are gone, so their covers are". */
test('bulk-delete keeps a cover another round still points at', async () => {
  const round = await createRound(request);
  const res = await request(app).post(`/api/rounds/${round.id}/games`)
    .field('title', 'Original').field('minPlayers', '2').field('maxPlayers', '4')
    .attach('image', PNG_BYTES, { filename: 'c.png', contentType: 'image/png' });
  const original = res.body;

  // Importing a round copies each game's stored path, so two rows now name one
  // file — the shape isImageReferenced exists for.
  const copy = await createRound(request, { name: 'Copy', importFromRoundId: round.id });
  assert.equal(copy.games.length, 1);
  assert.equal(copy.games[0].image, original.image, 'fixture: both rows name one file');

  await request(app).post(`/api/rounds/${round.id}/games/bulk-delete`)
    .send({ gameIds: [original.id] });

  assert.ok(fs.existsSync(objectOf(original.image)),
    'the file is still referenced by the imported round and must survive');
});
