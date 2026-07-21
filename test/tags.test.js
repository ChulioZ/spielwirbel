'use strict';

/*
 * Custom round tags (issue #238): the /api/rounds/:rid/tags routes (create with
 * case-insensitive dedupe, delete with unassign-everywhere), tagIds on the
 * games routes (create + edit, unknown ids -> 400), and the tag filter on the
 * session draw (AND include semantics + exclude rejection #241, unknown ids
 * dropped). Runs in legacy mode
 * (accounts off), so the tags quota is inert here — test/quota.test.js covers
 * the enforced cap.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, createRound } = require('./helpers');

const addGame = (rid, title, tagIds = []) => {
  let req = request(app).post(`/api/rounds/${rid}/games`)
    .field('title', title).field('platform', 'analog')
    .field('minPlayers', '1').field('maxPlayers', '4');
  tagIds.forEach((x) => { req = req.field('tagIds', x); });
  return req;
};

test('tag routes: create (trimmed + deduped) and delete', async (t) => {
  const round = await createRound(request);

  let outside;
  await t.test('creates a tag, trimming the name', async () => {
    const res = await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: '  Outside  ' });
    assert.equal(res.status, 201);
    assert.match(res.body.id, /^[0-9a-f]{16}$/);
    assert.equal(res.body.name, 'Outside');
    outside = res.body;
  });

  await t.test('a duplicate name (case-insensitive) reuses the existing tag', async () => {
    const res = await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'oUTSIDE' });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, outside);
    const fetched = await request(app).get(`/api/rounds/${round.id}`);
    assert.equal(fetched.body.tags.length, 1);
  });

  await t.test('an empty name is a 400; unknown round/tag are 404s', async () => {
    const empty = await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: '   ' });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, 'Tag name is missing');
    const noRound = await request(app).post('/api/rounds/nope/tags').send({ name: 'X' });
    assert.equal(noRound.status, 404);
    assert.equal(noRound.body.error, 'Round not found');
    const noTag = await request(app).delete(`/api/rounds/${round.id}/tags/nope`);
    assert.equal(noTag.status, 404);
    assert.equal(noTag.body.error, 'Tag not found');
  });

  // Own round: the sibling subtests assert on this round's exact tag list, so a
  // tag created here would throw them off.
  await t.test('a name longer than 30 chars is a 400; exactly 30 is accepted', async () => {
    const own = await createRound(request);
    const tooLong = await request(app)
      .post(`/api/rounds/${own.id}/tags`)
      .send({ name: 'x'.repeat(31) });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.error, 'Tag name is too long');

    // The cap applies to the *trimmed* name, so surrounding whitespace doesn't
    // push an otherwise-valid name over the limit.
    const padded = await request(app)
      .post(`/api/rounds/${own.id}/tags`)
      .send({ name: `  ${'y'.repeat(30)}  ` });
    assert.equal(padded.status, 201);
    assert.equal(padded.body.name, 'y'.repeat(30));
  });

  await t.test('deleting a tag unassigns it from every game', async () => {
    const tagged = await addGame(round.id, 'Tagged', [outside.id]);
    assert.equal(tagged.status, 201);
    assert.deepEqual(tagged.body.tagIds, [outside.id]);

    const del = await request(app).delete(`/api/rounds/${round.id}/tags/${outside.id}`);
    assert.equal(del.status, 200);
    const fetched = await request(app).get(`/api/rounds/${round.id}`);
    assert.deepEqual(fetched.body.tags, []);
    assert.deepEqual(fetched.body.games.find((g) => g.id === tagged.body.id).tagIds, []);
  });
});

test('games routes: tagIds on create and edit', async (t) => {
  const round = await createRound(request);
  const tagA = (await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'A' })).body;
  const tagB = (await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'B' })).body;

  let game;
  await t.test('create stores (deduped) tagIds; an unknown id is a 400', async () => {
    const res = await addGame(round.id, 'Catan', [tagA.id, tagB.id, tagA.id]);
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.tagIds, [tagA.id, tagB.id]);
    game = res.body;

    const bad = await addGame(round.id, 'Bad', ['nope']);
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'Unknown tag');
  });

  await t.test('a game created without tags has no tagIds key', async () => {
    const res = await addGame(round.id, 'Plain');
    assert.equal(res.status, 201);
    assert.equal('tagIds' in res.body, false);
  });

  await t.test('edit replaces the assignment; [] clears it; unknown id is a 400', async () => {
    const patched = await request(app).patch(`/api/rounds/${round.id}/games/${game.id}`)
      .send({ tagIds: [tagB.id] });
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.body.tagIds, [tagB.id]);

    const bad = await request(app).patch(`/api/rounds/${round.id}/games/${game.id}`)
      .send({ tagIds: ['nope'] });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'Unknown tag');

    const cleared = await request(app).patch(`/api/rounds/${round.id}/games/${game.id}`)
      .send({ tagIds: [] });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.tagIds, []);
  });
});

test('session draw: tag filter restricts the pool with AND semantics', async (t) => {
  const round = await createRound(request);
  const tagA = (await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'A' })).body;
  const tagB = (await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'B' })).body;
  const both = (await addGame(round.id, 'Both', [tagA.id, tagB.id])).body;
  await addGame(round.id, 'OnlyA', [tagA.id]);
  await addGame(round.id, 'Untagged');

  await t.test('one tag ON narrows the pool; two ON require both (AND)', async () => {
    const oneTag = await request(app).post(`/api/rounds/${round.id}/sessions`)
      .send({ count: 10, tagIds: [tagA.id] });
    assert.equal(oneTag.status, 201);
    assert.deepEqual(oneTag.body.games.map((g) => g.title).sort(), ['Both', 'OnlyA']);
    assert.deepEqual(oneTag.body.session.tagIds, [tagA.id]);

    const bothTags = await request(app).post(`/api/rounds/${round.id}/sessions`)
      .send({ count: 10, tagIds: [tagA.id, tagB.id] });
    assert.equal(bothTags.status, 201);
    assert.deepEqual(bothTags.body.games.map((g) => g.id), [both.id]);
  });

  await t.test('no selected tags = no tag filter; unknown ids are dropped', async () => {
    const all = await request(app).post(`/api/rounds/${round.id}/sessions`)
      .send({ count: 10, tagIds: [] });
    assert.equal(all.status, 201);
    assert.equal(all.body.games.length, 3);
    assert.equal(all.body.session.tagIds, null);

    const unknown = await request(app).post(`/api/rounds/${round.id}/sessions`)
      .send({ count: 10, tagIds: ['nope'] });
    assert.equal(unknown.status, 201);
    assert.equal(unknown.body.games.length, 3);
  });

  await t.test('a tag combination matching nothing is the usual 400', async () => {
    const tagC = (await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'C' })).body;
    const res = await request(app).post(`/api/rounds/${round.id}/sessions`)
      .send({ count: 10, tagIds: [tagC.id] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'No matching games in this round');
  });
});

test('session draw: exclude tag filter rejects games carrying the tag (#241)', async (t) => {
  const round = await createRound(request);
  const tagA = (await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'A' })).body;
  const tagB = (await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'B' })).body;
  await addGame(round.id, 'Both', [tagA.id, tagB.id]);
  await addGame(round.id, 'OnlyA', [tagA.id]);
  await addGame(round.id, 'Untagged');

  await t.test('one excluded tag drops every game carrying it', async () => {
    const res = await request(app).post(`/api/rounds/${round.id}/sessions`)
      .send({ count: 10, excludeTagIds: [tagA.id] });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.games.map((g) => g.title).sort(), ['Untagged']);
    assert.deepEqual(res.body.session.excludeTagIds, [tagA.id]);
  });

  await t.test('include + exclude combine: has all included AND none excluded', async () => {
    const res = await request(app).post(`/api/rounds/${round.id}/sessions`)
      .send({ count: 10, tagIds: [tagA.id], excludeTagIds: [tagB.id] });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.games.map((g) => g.title).sort(), ['OnlyA']);
  });

  await t.test('a tag in both lists is treated as included (include wins)', async () => {
    const res = await request(app).post(`/api/rounds/${round.id}/sessions`)
      .send({ count: 10, tagIds: [tagA.id], excludeTagIds: [tagA.id] });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.games.map((g) => g.title).sort(), ['Both', 'OnlyA']);
    assert.equal(res.body.session.excludeTagIds, null);
  });

  await t.test('empty / unknown exclude ids mean no exclude filter', async () => {
    const empty = await request(app).post(`/api/rounds/${round.id}/sessions`)
      .send({ count: 10, excludeTagIds: [] });
    assert.equal(empty.status, 201);
    assert.equal(empty.body.games.length, 3);
    assert.equal(empty.body.session.excludeTagIds, null);

    const unknown = await request(app).post(`/api/rounds/${round.id}/sessions`)
      .send({ count: 10, excludeTagIds: ['nope'] });
    assert.equal(unknown.status, 201);
    assert.equal(unknown.body.games.length, 3);
  });
});

// Tag icons (#255): the optional `icon` on create and the PATCH route, which is
// the first (and only) way to change an existing tag.
test('tag icons: create with one, patch it, clear it, reject bad input', async (t) => {
  const round = await createRound(request);

  await t.test('a tag created without an icon carries no icon key', async () => {
    const res = await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'Plain' });
    assert.equal(res.status, 201);
    assert.equal('icon' in res.body, false);
  });

  let puzzles;
  await t.test('a tag can be created with an icon from the curated set', async () => {
    const res = await request(app).post(`/api/rounds/${round.id}/tags`)
      .send({ name: 'Puzzles', icon: 'puzzle' });
    assert.equal(res.status, 201);
    assert.equal(res.body.icon, 'puzzle');
    puzzles = res.body;
  });

  await t.test('an icon outside the curated set is rejected on create', async () => {
    const res = await request(app).post(`/api/rounds/${round.id}/tags`)
      .send({ name: 'Bogus', icon: 'skull-and-crossbones' });
    assert.equal(res.status, 400);
  });

  await t.test('PATCH changes the icon and persists it', async () => {
    const res = await request(app).patch(`/api/rounds/${round.id}/tags/${puzzles.id}`)
      .send({ icon: 'brain' });
    assert.equal(res.status, 200);
    assert.equal(res.body.icon, 'brain');
    assert.equal(res.body.name, 'Puzzles'); // the route patches icon only

    const round2 = await request(app).get(`/api/rounds/${round.id}`);
    assert.equal(round2.body.tags.find((tg) => tg.id === puzzles.id).icon, 'brain');
  });

  await t.test('PATCH with null clears the icon back to the default glyph', async () => {
    const res = await request(app).patch(`/api/rounds/${round.id}/tags/${puzzles.id}`)
      .send({ icon: null });
    assert.equal(res.status, 200);
    assert.equal('icon' in res.body, false);
  });

  await t.test('PATCH rejects an unknown icon and an empty body', async () => {
    const bad = await request(app).patch(`/api/rounds/${round.id}/tags/${puzzles.id}`)
      .send({ icon: 'not-a-real-icon' });
    assert.equal(bad.status, 400);
    // `icon` is required on update — an empty body is a client error, not a
    // silent no-op that reports success.
    const empty = await request(app).patch(`/api/rounds/${round.id}/tags/${puzzles.id}`).send({});
    assert.equal(empty.status, 400);
  });

  await t.test('PATCH 404s for an unknown tag and an unknown round', async () => {
    const noTag = await request(app).patch(`/api/rounds/${round.id}/tags/nope`)
      .send({ icon: 'star' });
    assert.equal(noTag.status, 404);
    assert.equal(noTag.body.error, 'Tag not found');

    const noRound = await request(app).patch(`/api/rounds/missing/tags/${puzzles.id}`)
      .send({ icon: 'star' });
    assert.equal(noRound.status, 404);
    assert.equal(noRound.body.error, 'Round not found');
  });

  await t.test('a duplicate name reuses the existing tag without restyling it', async () => {
    const styled = await request(app).post(`/api/rounds/${round.id}/tags`)
      .send({ name: 'Dice night', icon: 'dice-3' });
    assert.equal(styled.status, 201);
    const dup = await request(app).post(`/api/rounds/${round.id}/tags`)
      .send({ name: 'DICE NIGHT', icon: 'rocket' });
    assert.equal(dup.status, 201);
    assert.deepEqual(dup.body, styled.body);
  });
});
