'use strict';

/* The two provider-info RESPONSES carry the whole field set (#1005, #1505).
 *
 * `PROVIDER_INFO_FIELDS` (public/js/provider-info-fields.js) decides what is
 * stored and what counts as complete, but the per-game GET …/provider-info and
 * the shelf-wide POST …/provider-info each project the stored game through a
 * hand-written object, and the client folds the answer back with a third
 * hand-written list (`mergeGameInfo`, game-info.js). The suggested-players poll
 * (`bestWith`/`recommendedWith`, #1005) was stored and counted and reached none
 * of the three — so on the visit that filled a shelf's polls the Regal and the
 * setup screen never learned them, and the „only what BGG recommends" toggle
 * (`metadataFilterOptions().recommended`, draw-pool.js) stayed hidden until the
 * next full load. (claude-file audit, 2026-10-04.)
 *
 * Each projection is compared with the field set itself, so the next field
 * added there fails here rather than silently stopping at the store. */

process.env.BGG_API_TOKEN = 'test-token';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const { PROVIDER_INFO_FIELDS } = require('../public/js/provider-info-fields');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

// One BGG item carrying a weight and a suggested-players poll: Best peaks at 3,
// and 2–4 have more positive than negative votes — so the poll the route must
// report is bestWith [3], recommendedWith [2, 3, 4].
const POLL = `<poll name="suggested_numplayers" title="User Suggested Number of Players" totalvotes="12">
  <results numplayers="2"><result value="Best" numvotes="1"/><result value="Recommended" numvotes="5"/><result value="Not Recommended" numvotes="2"/></results>
  <results numplayers="3"><result value="Best" numvotes="8"/><result value="Recommended" numvotes="2"/><result value="Not Recommended" numvotes="0"/></results>
  <results numplayers="4"><result value="Best" numvotes="3"/><result value="Recommended" numvotes="5"/><result value="Not Recommended" numvotes="1"/></results>
  <results numplayers="5"><result value="Best" numvotes="0"/><result value="Recommended" numvotes="1"/><result value="Not Recommended" numvotes="9"/></results>
</poll>`;
const stubPolled = (id) => {
  global.fetch = async () => ({
    status: 200,
    text: async () => `<?xml version="1.0" encoding="utf-8"?><items><item type="boardgame" id="${id}">
      <name type="primary" value="Game ${id}"/>${POLL}
      <statistics><ratings><average value="7.4"/><averageweight value="2.2"/></ratings></statistics>
    </item></items>`,
  });
};

async function roundWithLinkedGame(name, externalId) {
  const rid = (await request(app).post('/api/rounds').send({ name, members: ['Anna', 'Ben'] })).body.id;
  const game = await repo.createGame('default', rid, {
    title: `Game ${externalId}`, minPlayers: 2, maxPlayers: 5, image: null,
    source: { provider: 'bgg', externalId, url: null },
  });
  return { rid, game };
}

test('the per-game answer carries every provider field, the poll included', async () => {
  const { rid, game } = await roundWithLinkedGame('Projektion-Einzeln', '940001');
  stubPolled('940001');
  const res = await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.equal(res.status, 200);
  const missing = PROVIDER_INFO_FIELDS.filter((k) => !(k in res.body));
  assert.deepEqual(missing, [], `GET …/provider-info drops: ${missing.join(', ')}`);
  assert.deepEqual(res.body.bestWith, [3]);
  assert.deepEqual(res.body.recommendedWith, [2, 3, 4]);
});

test('the shelf answer carries every provider field but the rating, the poll included', async () => {
  const { rid, game } = await roundWithLinkedGame('Projektion-Regal', '940002');
  stubPolled('940002');
  const res = await request(app).post(`/api/rounds/${rid}/games/provider-info`);
  assert.equal(res.status, 200);
  const row = res.body.games.find((g) => g.id === game.id);
  assert.ok(row, 'the unfilled game was not in the answer');
  // `rating` is withheld on purpose (test/provider-info-shelf.test.js); every
  // other field is what the filter screens fold in and filter by.
  const missing = PROVIDER_INFO_FIELDS.filter((k) => k !== 'rating' && !(k in row));
  assert.deepEqual(missing, [], `POST …/provider-info drops: ${missing.join(', ')}`);
  assert.deepEqual(row.bestWith, [3]);
  assert.deepEqual(row.recommendedWith, [2, 3, 4]);
});

test('a poll that was never fetched is reported as null, not as an empty answer', async () => {
  // `[]` is a REAL poll answer ("nobody voted", provider-info-fields.js), so a
  // game with no poll at all must not be reported as one — the client would
  // fold it in as an answer. An unlinked game is never fetched.
  const rid = (await request(app).post('/api/rounds').send({ name: 'Projektion-Leer', members: ['Anna'] })).body.id;
  const game = await repo.createGame('default', rid, {
    title: 'Ohne Umfrage', minPlayers: 1, maxPlayers: 4, image: null,
  });
  global.fetch = async () => { throw new Error('an unlinked game must not reach the provider'); };
  const res = await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.equal(res.status, 200);
  assert.equal(res.body.bestWith, null);
  assert.equal(res.body.recommendedWith, null);
});
