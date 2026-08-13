'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

// Add a game to a round via the multipart endpoint; returns the game object.
async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Chess', minPlayers: '2', maxPlayers: '4', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  return req;
}

test('POST games adds a game and logs a game_added activity', async () => {
  const round = await createRound(request);
  const res = await addGame(round.id, { title: 'Uno' });
  assert.equal(res.status, 201);
  assert.equal(res.body.title, 'Uno');
  assert.equal(res.body.retired, false);
  // platform/duration/type are retired fields (#242) — never stored on new games.
  assert.equal('platform' in res.body, false);
  assert.equal('duration' in res.body, false);
  assert.equal('type' in res.body, false);

  // The feed lives on its own endpoint (#197), not in the round payload.
  const detail = await request(app).get(`/api/rounds/${round.id}`);
  assert.equal('activities' in detail.body, false);
  const feed = await request(app).get(`/api/rounds/${round.id}/activities`);
  assert.ok(feed.body.some((a) => a.type === 'game_added' && a.gameId === res.body.id));
});

test('GET activities 404s for a missing round', async () => {
  const res = await request(app).get('/api/rounds/nope/activities');
  assert.equal(res.status, 404);
});

test('POST games rejects missing title and invalid player counts', async () => {
  const round = await createRound(request);
  assert.equal((await addGame(round.id, { title: '' })).status, 400);
  assert.equal((await addGame(round.id, { minPlayers: '0' })).status, 400);
  assert.equal((await addGame(round.id, { minPlayers: '4', maxPlayers: '2' })).status, 400);
});

test('retire flag sets retired/retiredAt and logs game_retired', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  const res = await request(app).post(`/api/rounds/${round.id}/games/${game.id}/retire`).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.retired, true);
  assert.ok(res.body.retiredAt);

  const feed = await request(app).get(`/api/rounds/${round.id}/activities`);
  assert.ok(feed.body.some((a) => a.type === 'game_retired'));
});

test('restoring clears retiredAt and logs game_restored', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  await request(app).post(`/api/rounds/${round.id}/games/${game.id}/retire`).send({});
  const res = await request(app)
    .post(`/api/rounds/${round.id}/games/${game.id}/retire`)
    .send({ retired: false });
  assert.equal(res.body.retired, false);
  assert.equal(res.body.retiredAt, null);
});

test('complete flag sets completed/completedAt and logs game_completed (#250)', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  const res = await request(app).post(`/api/rounds/${round.id}/games/${game.id}/complete`).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.completed, true);
  assert.ok(res.body.completedAt);

  const feed = await request(app).get(`/api/rounds/${round.id}/activities`);
  assert.ok(feed.body.some((a) => a.type === 'game_completed'));

  const back = await request(app)
    .post(`/api/rounds/${round.id}/games/${game.id}/complete`)
    .send({ completed: false });
  assert.equal(back.body.completed, false);
  assert.equal(back.body.completedAt, null);
});

// The two archives are exclusive, enforced server-side: a client that calls
// both endpoints must never end up with a game in Retired AND Completed.
test('completing a retired game moves it rather than stacking (#250)', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  await request(app).post(`/api/rounds/${round.id}/games/${game.id}/retire`).send({});
  const res = await request(app).post(`/api/rounds/${round.id}/games/${game.id}/complete`).send({});
  assert.equal(res.body.completed, true);
  assert.equal(res.body.retired, false);
  assert.equal(res.body.retiredAt, null);
});

test('complete 404s on an unknown round or game (#250)', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  assert.equal((await request(app).post(`/api/rounds/${round.id}/games/nope/complete`).send({})).status, 404);
  assert.equal((await request(app).post(`/api/rounds/nope/games/${game.id}/complete`).send({})).status, 404);
});

test('DELETE also accepts a completed game (#250)', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  await request(app).post(`/api/rounds/${round.id}/games/${game.id}/complete`).send({});
  assert.equal((await request(app).delete(`/api/rounds/${round.id}/games/${game.id}`)).status, 200);
  const after = await request(app).get(`/api/rounds/${round.id}`);
  assert.equal(after.body.games.length, 0);
});

test('PATCH games edits fields without adding an activity', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  const before = (await request(app).get(`/api/rounds/${round.id}/activities`)).body.length;
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({ title: 'Chess Deluxe', maxPlayers: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.body.title, 'Chess Deluxe');
  assert.equal(res.body.maxPlayers, 2);
  const after = (await request(app).get(`/api/rounds/${round.id}/activities`)).body.length;
  assert.equal(after, before);
});

test('DELETE only works on retired games and scrubs feed entries', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;

  const tooEarly = await request(app).delete(`/api/rounds/${round.id}/games/${game.id}`);
  assert.equal(tooEarly.status, 400);

  await request(app).post(`/api/rounds/${round.id}/games/${game.id}/retire`).send({});
  const res = await request(app).delete(`/api/rounds/${round.id}/games/${game.id}`);
  assert.equal(res.status, 200);

  const detail = await request(app).get(`/api/rounds/${round.id}`);
  assert.equal(detail.body.games.length, 0);
  // The add/retire entries referencing the game are gone; a game_deleted remains.
  const feed = (await request(app).get(`/api/rounds/${round.id}/activities`)).body;
  assert.ok(!feed.some((a) => a.gameId === game.id));
  assert.ok(feed.some((a) => a.type === 'game_deleted'));
});

// --- Provider source + server-side cover download (issue #41 follow-up) ---

const fs = require('node:fs');
const path = require('node:path');
const { store } = require('./helpers');

test('POST games ignores retired platform/duration/type fields (#242)', async () => {
  const round = await createRound(request);
  // The schema strips these unknown keys, so nothing is stored on the new game.
  const res = await addGame(round.id, { title: 'Ludo', platform: 'ps', duration: 'short', type: 'digital' });
  assert.equal(res.status, 201);
  assert.equal(res.body.title, 'Ludo');
  assert.equal('platform' in res.body, false);
  assert.equal('duration' in res.body, false);
  assert.equal('type' in res.body, false);
});

test('PATCH ignores retired platform/duration/type fields (#242)', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({ title: 'Renamed', platform: 'steam', duration: 'long', type: 'analog' });
  assert.equal(res.status, 200);
  assert.equal(res.body.title, 'Renamed'); // a real field still applies
  assert.equal('platform' in res.body, false);
  assert.equal('duration' in res.body, false);
  assert.equal('type' in res.body, false);
});

test('POST games ignores an unknown source provider and a non-http source url', async () => {
  const round = await createRound(request);
  const bad = await addGame(round.id, { sourceProvider: 'evil', sourceExternalId: '1' });
  assert.equal(bad.body.source, undefined);

  // A RETIRED provider (#744) is an unknown id like any other, so a stale tab
  // cannot mint a fresh storefront link — the four are checked as a set rather
  // than one of them standing in for the rest.
  for (const id of ['psstore', 'steam', 'nintendo', 'xbox']) {
    const retired = await addGame(round.id, { title: `stale ${id}`, sourceProvider: id, sourceExternalId: '1' });
    assert.equal(retired.body.source, undefined, `${id} must not mint a source link`);
  }

  const noUrl = await addGame(round.id, {
    sourceProvider: 'bgg',
    sourceExternalId: 'X',
    sourceUrl: 'javascript:alert(1)',
  });
  assert.equal(noUrl.body.source.url, null); // rejected, but the link id is kept
});

test('POST games stores a BoardGameGeek source link', async () => {
  const round = await createRound(request);
  const res = await addGame(round.id, {
    title: 'Catan',
    sourceProvider: 'bgg',
    sourceExternalId: '13',
    sourceUrl: 'https://boardgamegeek.com/boardgame/13/catan',
  });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.source, {
    provider: 'bgg',
    externalId: '13',
    url: 'https://boardgamegeek.com/boardgame/13/catan',
  });
});

// Provider cover art is HOTLINKED, never re-hosted (#172): the provider's own
// https URL is what gets stored, and the server must not fetch a single byte.
// One case per provider image host, so the allowlist stays covered. It listed
// five until #744 — the four storefront hosts are now render-only and refused by
// the write gate, which test/provider-covers.test.js pins from both sides.
const COVER_HOSTS = [
  ['BoardGameGeek', 'https://cf.geekdo-images.com/x/pic.jpg'],
];

for (const [label, imageUrl] of COVER_HOSTS) {
  test(`POST games stores a ${label} cover as a hotlink without downloading it`, async () => {
    const realFetch = global.fetch;
    let called = false;
    global.fetch = async () => { called = true; throw new Error('must not download a cover'); };
    try {
      const round = await createRound(request);
      const res = await addGame(round.id, { title: `Cover via ${label}`, imageUrl });
      assert.equal(res.status, 201);
      // Stored verbatim, so the browser fetches it from the provider.
      assert.equal(res.body.image, imageUrl);
      assert.equal(called, false, 'the server must not fetch the cover');
      // ...and nothing of ours was written for it.
      assert.equal(fs.readdirSync(store.UPLOAD_DIR).length, 0);
    } finally {
      global.fetch = realFetch;
    }
  });
}

test('POST games does not download a cover from a non-allowlisted host', async () => {
  const realFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error('should not fetch'); };
  try {
    const round = await createRound(request);
    const res = await addGame(round.id, {
      title: 'The Witcher 3',
      imageUrl: 'https://evil.example.com/x.png',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.image, null);
    assert.equal(called, false);
  } finally {
    global.fetch = realFetch;
  }
});

// --- Link an existing game to a provider via PATCH (issue #74) ---

test('PATCH links an unlinked game to a provider source', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  assert.equal(game.source, undefined);

  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({
      sourceProvider: 'bgg',
      sourceExternalId: '13',
      sourceUrl: 'https://boardgamegeek.com/boardgame/13/catan',
    });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.source, {
    provider: 'bgg',
    externalId: '13',
    url: 'https://boardgamegeek.com/boardgame/13/catan',
  });
});

test('PATCH ignores an invalid source and does not clobber the field', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({ sourceProvider: 'evil', sourceExternalId: '1', title: 'Renamed' });
  assert.equal(res.status, 200);
  assert.equal(res.body.source, undefined); // unknown provider → no link stored
  assert.equal(res.body.title, 'Renamed'); // other fields still applied
});

// --- Unlink a game from its provider (issue #282) ---

// Add a game that is linked to a provider and carries its hotlinked cover.
async function addLinkedGame(rid, image = 'https://cf.geekdo-images.com/x/pic.jpg') {
  const fields = {
    sourceProvider: 'bgg',
    sourceExternalId: '13',
    sourceUrl: 'https://boardgamegeek.com/boardgame/13/catan',
  };
  if (image) fields.imageUrl = image;
  return (await addGame(rid, fields)).body;
}

test('PATCH removeSource clears the link and the hotlinked provider cover', async () => {
  const round = await createRound(request);
  const game = await addLinkedGame(round.id);
  assert.equal(game.source.provider, 'bgg');
  assert.equal(game.image, 'https://cf.geekdo-images.com/x/pic.jpg');

  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({ removeSource: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.source, null);
  assert.equal(res.body.image, null); // falls back to the per-title placeholder

  // and it persisted, not just echoed back
  const after = await request(app).get(`/api/rounds/${round.id}`);
  const stored = after.body.games.find((g) => g.id === game.id);
  assert.equal(stored.source, null);
  assert.equal(stored.image, null);
});

test('PATCH removeSource accepts the multipart string form', async () => {
  const round = await createRound(request);
  const game = await addLinkedGame(round.id);
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .field('removeSource', 'true');
  assert.equal(res.status, 200);
  assert.equal(res.body.source, null);
  assert.equal(res.body.image, null);
});

test('PATCH removeSource keeps an own upload and deletes no stored object', async () => {
  const round = await createRound(request);
  const res = await request(app)
    .post(`/api/rounds/${round.id}/games`)
    .field('title', 'Chess')
    .field('minPlayers', '2')
    .field('maxPlayers', '4')
    .field('sourceProvider', 'bgg')
    .field('sourceExternalId', '13')
    .attach('image', PNG_BYTES, { filename: 'cover.png', contentType: 'image/png' });
  const game = res.body;
  assert.ok(game.image.startsWith('/uploads/'));
  const key = path.join(store.UPLOAD_DIR, path.basename(game.image));
  assert.ok(fs.existsSync(key));

  const un = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({ removeSource: true });
  assert.equal(un.status, 200);
  assert.equal(un.body.source, null);
  assert.equal(un.body.image, game.image, 'the member’s own cover is kept');
  assert.ok(fs.existsSync(key), 'the stored object was not deleted');
  // Other specs in this file assert the shared upload dir is empty — this is
  // the only one that deliberately leaves a file behind, so it clears it.
  fs.unlinkSync(key);
});

test('PATCH removeSource unlinks a source that has no url', async () => {
  const round = await createRound(request);
  // sourceUrl rejected as non-http → the link is stored with url: null
  const game = (await addGame(round.id, {
    sourceProvider: 'bgg',
    sourceExternalId: '13',
    sourceUrl: 'javascript:alert(1)',
  })).body;
  assert.equal(game.source.url, null);

  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({ removeSource: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.source, null);
});

test('PATCH without removeSource still never clobbers an existing link', async () => {
  const round = await createRound(request);
  const game = await addLinkedGame(round.id);
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({ title: 'Renamed' });
  assert.equal(res.status, 200);
  assert.equal(res.body.title, 'Renamed');
  assert.deepEqual(res.body.source, game.source);
  assert.equal(res.body.image, game.image);
});

test('PATCH removeSource wins over a source sent in the same request', async () => {
  const round = await createRound(request);
  const game = await addLinkedGame(round.id);
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({
      removeSource: true,
      sourceProvider: 'bgg',
      sourceExternalId: '99',
      sourceUrl: 'https://boardgamegeek.com/boardgame/99/other',
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.source, null);
});

test('PATCH removeSource together with a new cover keeps the new cover', async () => {
  const round = await createRound(request);
  const game = await addLinkedGame(round.id);
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({ removeSource: true, imageUrl: 'https://cf.geekdo-images.com/y/other.jpg' });
  assert.equal(res.status, 200);
  assert.equal(res.body.source, null);
  assert.equal(res.body.image, 'https://cf.geekdo-images.com/y/other.jpg');
});

test('PATCH stores an allowlisted imageUrl as a hotlink without downloading it', async () => {
  const realFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error('must not download a cover'); };
  try {
    const round = await createRound(request);
    const game = (await addGame(round.id)).body;
    const res = await request(app)
      .patch(`/api/rounds/${round.id}/games/${game.id}`)
      .send({ imageUrl: 'https://cf.geekdo-images.com/x/pic.jpg' });
    assert.equal(res.status, 200);
    assert.equal(res.body.image, 'https://cf.geekdo-images.com/x/pic.jpg');
    assert.equal(called, false, 'the server must not fetch the cover');
    assert.equal(fs.readdirSync(store.UPLOAD_DIR).length, 0);
  } finally {
    global.fetch = realFetch;
  }
});

test('PATCH keeps the old cover when an imageUrl host is not allowlisted', async () => {
  const realFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error('should not fetch'); };
  try {
    const round = await createRound(request);
    const game = (await addGame(round.id)).body;
    const res = await request(app)
      .patch(`/api/rounds/${round.id}/games/${game.id}`)
      .send({ imageUrl: 'https://evil.example.com/x.png' });
    assert.equal(res.status, 200);
    assert.equal(res.body.image, null); // unchanged (never had one)
    assert.equal(called, false);
  } finally {
    global.fetch = realFetch;
  }
});

// --- Uploaded-file hardening (issue #133): verify real content, derive the
// stored extension from the detected type, reject non-images. ---

// Minimal buffers carrying real magic bytes (padded past the 12-byte sniff min).
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8),
]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);

test('POST games stores an uploaded PNG and derives the extension from the content', async () => {
  const round = await createRound(request);
  // Filename lies (.jpg) and mimetype is generic — the stored ext must follow
  // the real PNG magic bytes, not the client-supplied name.
  const res = await request(app)
    .post(`/api/rounds/${round.id}/games`)
    .field('title', 'Chess').field('minPlayers', '2').field('maxPlayers', '4')
    .attach('image', PNG_BYTES, { filename: 'cover.jpg', contentType: 'image/jpeg' });
  assert.equal(res.status, 201);
  assert.match(res.body.image, /^\/uploads\/[0-9a-f]+\.png$/);
  assert.ok(fs.existsSync(path.join(store.UPLOAD_DIR, path.basename(res.body.image))));
});

test('POST games rejects an uploaded file whose content is not a real image', async () => {
  const round = await createRound(request);
  // A spoofed upload: image/* mimetype but the bytes are not an image.
  const before = fs.readdirSync(store.UPLOAD_DIR).length;
  const res = await request(app)
    .post(`/api/rounds/${round.id}/games`)
    .field('title', 'Chess').field('minPlayers', '2').field('maxPlayers', '4')
    .attach('image', Buffer.from('<script>alert(1)</script>'), {
      filename: 'evil.png', contentType: 'image/png',
    });
  assert.equal(res.status, 400);
  // Nothing was written to disk for the rejected upload.
  assert.equal(fs.readdirSync(store.UPLOAD_DIR).length, before);
});

test('PATCH rejects a spoofed image upload and keeps the old cover', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  // Give it a real cover first.
  const first = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .attach('image', JPEG_BYTES, { filename: 'a.jpg', contentType: 'image/jpeg' });
  assert.equal(first.status, 200);
  assert.match(first.body.image, /\.jpg$/);
  const cover = first.body.image;

  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .attach('image', Buffer.from('not an image'), {
      filename: 'x.png', contentType: 'image/png',
    });
  assert.equal(res.status, 400);
  // The existing cover is untouched (not cleared, not deleted).
  const detail = await request(app).get(`/api/rounds/${round.id}`);
  assert.equal(detail.body.games.find((g) => g.id === game.id).image, cover);
  assert.ok(fs.existsSync(path.join(store.UPLOAD_DIR, path.basename(cover))));
});

// --- Move all games to another round (#253) ---------------------------------

test('POST games/move-to reparents every game and merges tags by name', async () => {
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

  const res = await request(app).post(`/api/rounds/${src.id}/games/move-to`).send({ targetRoundId: dst.id });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { movedGames: 2, mergedTags: 1, createdTags: 1 });

  // Source is emptied but still there; the archived game moved along with the rest.
  const after = (await request(app).get(`/api/rounds/${src.id}`)).body;
  assert.deepEqual(after.games, []);
  const target = (await request(app).get(`/api/rounds/${dst.id}`)).body;
  assert.deepEqual(target.games.map((g) => g.title).sort(), ['Old', 'Uno']);
  assert.equal(target.games.find((g) => g.title === 'Old').retired, true);

  // The moved game keeps its id and is remapped onto the TARGET's tag ids.
  const moved = target.games.find((g) => g.id === tagged.id);
  assert.ok(moved);
  const createdTag = target.tags.find((tg) => tg.name === 'Solo');
  assert.deepEqual(moved.tagIds, [dstTag.id, createdTag.id]);

  // One bulk feed entry per round, naming the other side.
  const outFeed = (await request(app).get(`/api/rounds/${src.id}/activities`)).body;
  const inFeed = (await request(app).get(`/api/rounds/${dst.id}/activities`)).body;
  assert.equal(outFeed.filter((a) => a.type === 'games_moved_out').length, 1);
  assert.equal(inFeed.filter((a) => a.type === 'games_moved_in').length, 1);
  assert.equal(inFeed.find((a) => a.type === 'games_moved_in').count, 2);
});

test('POST games/move-to rejects a missing, blank or identical target', async () => {
  const src = await createRound(request);

  const missing = await request(app).post(`/api/rounds/${src.id}/games/move-to`).send({ targetRoundId: 'nope' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'Target round not found');

  const same = await request(app).post(`/api/rounds/${src.id}/games/move-to`).send({ targetRoundId: src.id });
  assert.equal(same.status, 400);

  assert.equal((await request(app).post(`/api/rounds/${src.id}/games/move-to`).send({})).status, 400);
  assert.equal((await request(app).post('/api/rounds/nope/games/move-to').send({ targetRoundId: src.id })).status, 404);
});

test('POST games/move-to moves only the games named in gameIds (#402)', async () => {
  const src = await createRound(request);
  const dst = await createRound(request);
  const a = (await addGame(src.id, { title: 'A' })).body;
  const b = (await addGame(src.id, { title: 'B' })).body;
  const c = (await addGame(src.id, { title: 'C' })).body;

  // Duplicates in the request are deduped, not counted twice.
  const res = await request(app).post(`/api/rounds/${src.id}/games/move-to`)
    .send({ targetRoundId: dst.id, gameIds: [a.id, c.id, a.id] });
  assert.equal(res.status, 200);
  assert.equal(res.body.movedGames, 2);

  const after = (await request(app).get(`/api/rounds/${src.id}`)).body;
  assert.deepEqual(after.games.map((g) => g.id), [b.id]);
  const target = (await request(app).get(`/api/rounds/${dst.id}`)).body;
  assert.deepEqual(target.games.map((g) => g.title), ['A', 'C']);
});

test('POST games/move-to rejects an empty or unknown gameIds selection (#402)', async () => {
  const src = await createRound(request);
  const dst = await createRound(request);
  const a = (await addGame(src.id, { title: 'A' })).body;

  // Absent = move all (unchanged); [] is a client error, not a silent no-op.
  const empty = await request(app).post(`/api/rounds/${src.id}/games/move-to`)
    .send({ targetRoundId: dst.id, gameIds: [] });
  assert.equal(empty.status, 400);

  const unknown = await request(app).post(`/api/rounds/${src.id}/games/move-to`)
    .send({ targetRoundId: dst.id, gameIds: [a.id, 'nope'] });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'Unknown game');

  // Refused whole: the valid id in that request did not move either.
  assert.deepEqual((await request(app).get(`/api/rounds/${src.id}`)).body.games.map((g) => g.id), [a.id]);
  assert.deepEqual((await request(app).get(`/api/rounds/${dst.id}`)).body.games, []);
});

test('POST games/move-to scrubs the source round\'s session history', async () => {
  const src = await createRound(request);
  const dst = await createRound(request);
  const game = (await addGame(src.id, { title: 'Uno' })).body;

  const session = await request(app).post(`/api/rounds/${src.id}/sessions`).send({ gameIds: [game.id] });
  assert.equal(session.status, 201);

  await request(app).post(`/api/rounds/${src.id}/games/move-to`).send({ targetRoundId: dst.id });

  // The session held only the moved game, so it is gone entirely — the same
  // rule permanently deleting a game already follows.
  const after = (await request(app).get(`/api/rounds/${src.id}`)).body;
  assert.deepEqual(after.sessions, []);
  // The game itself survives the move in the target round.
  const target = (await request(app).get(`/api/rounds/${dst.id}`)).body;
  assert.equal(target.games[0].id, game.id);
});

// Regression (#563): the local actorSeat copy in lib/routes/games.js had no uid guard,
// so `m.userId === undefined` matched the first UNLINKED seat and every
// game-lifecycle activity was credited to the round's first member in accounts-off
// mode ("· von Alice" for something Alice did not do).
//
// The assertion has to be `in`, not a truthiness or null check: the bug produced a
// REAL member id, so `assert.ok(!entry.actorMemberId)` passes against it.
test('game activities carry no actorMemberId with accounts off (never the first seat)', async () => {
  const round = await createRound(request); // Alice, Bob — neither linked to an account
  // addGame resolves to the RESPONSE, not the game — the id is on .body.
  const game = (await addGame(round.id, { title: 'Attribution' })).body;
  await request(app).post(`/api/rounds/${round.id}/games/${game.id}/retire`).send({ retired: true });
  await request(app).post(`/api/rounds/${round.id}/games/${game.id}/complete`).send({ completed: true });

  const feed = (await request(app).get(`/api/rounds/${round.id}/activities`)).body;
  const seatIds = round.members.map((m) => m.id);
  const credited = feed.filter((a) => 'actorMemberId' in a);
  assert.deepEqual(
    credited.map((a) => `${a.type} → ${seatIds.indexOf(a.actorMemberId)}`),
    [],
    'no activity may name a seat when no account is acting'
  );
  // The feed is genuinely populated, so the assertion above is not vacuous.
  assert.ok(feed.some((a) => a.type === 'game_added'), 'the feed should hold the add');
  assert.ok(feed.length >= 3, `expected add+retire+complete, got ${feed.length}`);
});

/* ---- the edition a cover was picked from (#742) ----------------------------- */

const GEEKDO = 'https://cf.geekdo-images.com/x/pic.jpg';
const OTHER_GEEKDO = 'https://cf.geekdo-images.com/y/other.jpg';

// The picker's flat wire shape. `editionLanguages` is repeated per value because
// multipart has no array form (the same coercion tagIds needs).
async function addGameWithEdition(rid, fields = {}, languages = ['German']) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Arche Nova', minPlayers: '2', maxPlayers: '4', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  languages.forEach((l) => req.field('editionLanguages', l));
  return req;
}

test('POST stores the picked edition beside its cover', async () => {
  const round = await createRound(request);
  const res = await addGameWithEdition(round.id, {
    imageUrl: GEEKDO, editionName: 'Deutsche Erstausgabe', editionYear: '2021',
  });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.edition, { name: 'Deutsche Erstausgabe', year: 2021, languages: ['German'] });
});

test('POST leaves the key ABSENT on a game whose cover was not picked', async () => {
  const round = await createRound(request);
  // A free-text game: no cover at all.
  const plain = await addGame(round.id, { title: 'Freitext' });
  assert.equal('edition' in plain.body, false);

  // A provider cover with no edition fields — how a pasted URL arrives.
  const pasted = await addGame(round.id, { title: 'Eingefügt', imageUrl: GEEKDO });
  assert.equal('edition' in pasted.body, false);

  // Edition fields present but the URL REFUSED: no cover was stored, so an
  // edition naming a printing would describe a box that is not on screen.
  const refused = await addGameWithEdition(round.id, {
    title: 'Abgelehnt', imageUrl: 'https://evil.example.com/x.png', editionName: 'Deutsche Erstausgabe',
  });
  assert.equal(refused.body.image, null);
  assert.equal('edition' in refused.body, false);
});

test('POST bounds every field of the edition', async () => {
  const round = await createRound(request);
  const res = await addGameWithEdition(
    round.id,
    { imageUrl: GEEKDO, editionName: 'ä'.repeat(500), editionYear: 'nicht-eine-zahl' },
    Array.from({ length: 30 }, (_, i) => `Lang${i}`)
  );
  assert.equal(res.body.edition.name.length, 200);
  assert.equal(res.body.edition.year, null, 'an unparseable year is BGG\'s "unknown"');
  assert.equal(res.body.edition.languages.length, 12);
  // A BGG `yearpublished value="0"` is its own "unknown" and must not store a 0.
  const zero = await addGameWithEdition(round.id, {
    title: 'Jahr null', imageUrl: GEEKDO, editionName: 'Erstausgabe', editionYear: '0',
  });
  assert.equal(zero.body.edition.year, null);
});

// Every way the cover can change, and what each must do to the stored edition.
// They are one test because the shared setup is the point: the same game, the
// same starting edition, one differing final act.
async function gameWithEdition(rid) {
  const res = await addGameWithEdition(rid, {
    imageUrl: GEEKDO, editionName: 'Deutsche Erstausgabe', editionYear: '2021',
  });
  return res.body;
}

test('PATCH replaces the edition when a different printing is picked', async () => {
  const round = await createRound(request);
  const game = await gameWithEdition(round.id);
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({ imageUrl: OTHER_GEEKDO, editionName: 'English first edition', editionYear: 2019, editionLanguages: ['English'] });
  assert.deepEqual(res.body.edition, { name: 'English first edition', year: 2019, languages: ['English'] });
});

test('PATCH re-picking the same cover URL still records the edition', async () => {
  const round = await createRound(request);
  // A game whose cover predates #742: the URL is already there, no edition.
  const game = (await addGame(round.id, { title: 'Alt', imageUrl: GEEKDO })).body;
  assert.equal('edition' in game, false);
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({ imageUrl: GEEKDO, editionName: 'Deutsche Erstausgabe', editionYear: 2021, editionLanguages: ['German'] });
  // The image did not change, so an edition gated on `newImage !== oldImage`
  // would never be written — and two BGG editions legitimately share one
  // thumbnail, so that is also how a real re-pick gets lost.
  assert.equal(res.body.edition.name, 'Deutsche Erstausgabe');
});

test('PATCH clears the edition when the cover stops being a picked printing', async () => {
  const round = await createRound(request);
  for (const [label, body] of [
    ['a pasted provider URL carrying no edition', { imageUrl: OTHER_GEEKDO }],
    ['removeImage', { removeImage: true }],
    ['unlinking the provider', { removeSource: true }],
  ]) {
    const game = await gameWithEdition(round.id);
    assert.equal(game.edition.name, 'Deutsche Erstausgabe', `${label}: sanity`);
    const res = await request(app).patch(`/api/rounds/${round.id}/games/${game.id}`).send(body);
    assert.equal(res.body.edition, null, `${label} must not keep a label for a box that is gone`);
  }
});

test('PATCH clears the edition when the cover is replaced by an UPLOAD', async () => {
  // Its own spec rather than a row in the loop above: an upload is multipart, so
  // it cannot ride `.send()`. A member's own photo is not a BGG printing.
  const round = await createRound(request);
  const game = await gameWithEdition(round.id);
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .attach('image', PNG_BYTES, { filename: 'cover.png', contentType: 'image/png' });
  assert.match(res.body.image, /^\/uploads\//, 'sanity: the upload replaced the cover');
  assert.equal(res.body.edition, null);
});

test('PATCH keeps the edition when the request says nothing about the cover', async () => {
  const round = await createRound(request);
  const game = await gameWithEdition(round.id);
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({ title: 'Umbenannt' });
  assert.deepEqual(res.body.edition, game.edition);
});

test('PATCH keeps the edition when an imageUrl is REFUSED — the old cover is still on screen', async () => {
  const round = await createRound(request);
  const game = await gameWithEdition(round.id);
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({ imageUrl: 'https://evil.example.com/x.png', editionName: 'Gefälscht' });
  assert.equal(res.body.image, GEEKDO, 'sanity: the refused URL changed nothing');
  assert.deepEqual(res.body.edition, game.edition);
});

test('PATCH does not give a game that never had an edition a null one', async () => {
  // Absent-key parity: an unrelated remove must not add the key.
  const round = await createRound(request);
  const game = (await addGame(round.id, { title: 'Ohne', imageUrl: GEEKDO })).body;
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/games/${game.id}`)
    .send({ removeImage: true });
  assert.equal('edition' in res.body, false);
});
