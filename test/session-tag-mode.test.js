'use strict';

/* The included-tag combination mode (#726), at the ROUTE — its own file rather
   than more of test/sessions.test.js, which already spans four independently
   editable concerns and was one addition away from the 700-line budget
   (.claude/rules/token-friendly-source-files.md).
 *
 * The feature has three halves and each is tested where it lives: the predicate
 * in test/draw.test.js, the two client surfaces in test/tag-filter-mode.test.js,
 * and here the part only the route can answer — that the field is lenient enough
 * never to 400, that it is normalised away when it cannot mean anything, and
 * that an AND draw's stored blob is byte-identical to a pre-#726 one. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Game', minPlayers: '1', maxPlayers: '8', ...fields };
  // An array REPEATS the multipart field, which is how the route receives more
  // than one tag id. `String(['a','b'])` would send the single unknown id 'a,b'
  // and 400 — `tagIds` in lib/routes/games.js coerces a bare value to a
  // one-element array, so the failure is a rejected id, not a parse error.
  for (const [k, v] of Object.entries(all)) req.field(k, Array.isArray(v) ? v.map(String) : String(v));
  return (await req).body;
}

/* 'Both' carries the two filterable tags and 'OnlyA' just one, which is the
   whole discrimination: AND draws {Both}, OR draws {Both, OnlyA}. 'Untagged'
   carries neither, so OR can be shown to still be a filter. */
async function taggedRound() {
  const round = await createRound(request);
  const post = (name) => request(app).post(`/api/rounds/${round.id}/tags`).send({ name });
  const a = (await post('Area Control')).body;
  const b = (await post('Deck Builder')).body;
  await addGame(round.id, { title: 'Both', tagIds: [a.id, b.id] });
  await addGame(round.id, { title: 'OnlyA', tagIds: a.id });
  await addGame(round.id, { title: 'Untagged' });
  return { round, a, b };
}
const drawnTitles = (res) => res.body.games.map((g) => g.title).sort();

test("tagMode 'any' draws games carrying at least one included tag (#726)", async () => {
  const { round, a, b } = await taggedRound();
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ tagIds: [a.id, b.id], tagMode: 'any', count: 9 });
  assert.equal(res.status, 201);
  assert.deepEqual(drawnTitles(res), ['Both', 'OnlyA']);
  // Stored on the session, so the results screen and any later read agree with
  // what was actually drawn.
  assert.equal(res.body.session.tagMode, 'any');
});

test('the default stays AND, and the session grows no tagMode key for it (#726)', async () => {
  const { round, a, b } = await taggedRound();
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ tagIds: [a.id, b.id], count: 9 });
  assert.deepEqual(drawnTitles(res), ['Both']);
  // Absent, not 'all' — an all-mode session blob must stay byte-identical to a
  // pre-#726 one (.claude/rules/postgres-backend.md).
  assert.equal('tagMode' in res.body.session, false);
});

test('a bogus tagMode is ignored rather than rejected (#726)', async () => {
  const { round, a, b } = await taggedRound();
  for (const tagMode of ['ANY', 'nonsense', 7, null, ['any']]) {
    const res = await request(app)
      .post(`/api/rounds/${round.id}/sessions`)
      .send({ tagIds: [a.id, b.id], tagMode, count: 9 });
    assert.equal(res.status, 201, `tagMode ${JSON.stringify(tagMode)} must not 400`);
    assert.deepEqual(drawnTitles(res), ['Both'], 'and must fall back to AND');
    assert.equal('tagMode' in res.body.session, false);
  }
});

test('tagMode is dropped when there is no included tag to combine (#726)', async () => {
  const { round, b } = await taggedRound();
  // Excludes only: with nothing included the mode cannot mean anything, so it
  // must not reach the blob or the preset and make an unfiltered draw look
  // different from every other unfiltered draw.
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ excludeTagIds: [b.id], tagMode: 'any', count: 9 });
  assert.equal(res.status, 201);
  assert.deepEqual(drawnTitles(res), ['OnlyA', 'Untagged']);
  assert.equal('tagMode' in res.body.session, false);
  const preset = (await request(app).get(`/api/rounds/${round.id}`)).body.lastSessionFilters;
  assert.deepEqual(preset, { tagIds: [], excludeTagIds: [b.id], count: 9 });
});

test('a SINGLE included tag keeps the mode, because the preset has to (#726)', async () => {
  // The two modes draw the same pool here, so nothing about the draw can see the
  // difference — but the sheet must reopen on what the user chose. Dropping it
  // would silently reset the control whenever someone narrowed to one tag before
  // drawing.
  const { round, a } = await taggedRound();
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ tagIds: [a.id], tagMode: 'any', count: 9 });
  assert.deepEqual(drawnTitles(res), ['Both', 'OnlyA'], 'one included tag: identical either way');
  assert.equal(res.body.session.tagMode, 'any');
});

test('the mode rides in the remembered draw preset (#726, #252)', async () => {
  const { round, a, b } = await taggedRound();
  await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ tagIds: [a.id, b.id], tagMode: 'any', count: 2 });
  assert.deepEqual((await request(app).get(`/api/rounds/${round.id}`)).body.lastSessionFilters, {
    tagIds: [a.id, b.id], excludeTagIds: [], count: 2, tagMode: 'any',
  });

  // A later AND draw must clear it again — the preset is replaced wholesale, so
  // a leftover key would open the next sheet on a mode nobody chose.
  await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ tagIds: [a.id], count: 2 });
  assert.deepEqual((await request(app).get(`/api/rounds/${round.id}`)).body.lastSessionFilters, {
    tagIds: [a.id], excludeTagIds: [], count: 2,
  });
});

test('direct pick ignores tagMode entirely (#726)', async () => {
  const { round, a, b } = await taggedRound();
  const game = (await request(app).get(`/api/rounds/${round.id}`)).body.games
    .find((g) => g.title === 'Untagged');
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id, tagIds: [a.id, b.id], tagMode: 'any' });
  assert.equal(res.status, 201);
  assert.equal('tagMode' in res.body.session, false);
  assert.equal(res.body.session.tagIds, null);
});
