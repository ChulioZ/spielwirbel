'use strict';

/*
 * POST /api/rounds/:rid/games/import (#1758): a shelf from another app's file
 * (Myludo), written in one go. Accounts off — the route needs no account,
 * unlike the BGG collection import. The dedupe and the stored shape of the
 * three new createGames fields are the repo contract's
 * (test/support/repo-contract.js); this spec covers the route's own decisions.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const { MYLUDO_IMPORT_MAX } = require('../public/js/myludo-import');

const url = (rid) => `/api/rounds/${rid}/games/import`;
const shelfOf = async (rid) => (await request(app).get(`/api/rounds/${rid}`)).body.games;
const activities = async (rid) => (await request(app).get(`/api/rounds/${rid}/activities`)).body;

test('imports linked and unlinked rows in ONE write with their expansions', async () => {
  const round = await createRound(request, { name: 'Myludo' });
  const res = await request(app).post(url(round.id)).send({
    games: [
      { title: 'Forêt Mixte', minPlayers: 1, maxPlayers: 5, playtime: { min: 40, max: 60 },
        expansions: [{ title: 'Alpes', minPlayers: 2, maxPlayers: 5 }, { title: 'alpes' }] },
      { title: 'Azul', bggId: 230802, minPlayers: 2, maxPlayers: 4, playtime: { min: 30, max: 45 },
        image: 'https://cf.geekdo-images.com/azul.jpg' },
      { title: 'Elsewhere', bggId: 1, image: 'https://evil.example/x.jpg' },
      { title: 'Plain', image: 'https://cf.geekdo-images.com/plain.jpg' },
    ],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { imported: 4, skipped: 0, attached: 0 });

  const games = await shelfOf(round.id);
  const foret = games.find((g) => g.title === 'Forêt Mixte');
  assert.equal(foret.source, undefined, 'an unlinked row stays unlinked');
  assert.deepEqual([foret.minPlayers, foret.maxPlayers], [1, 5]);
  assert.deepEqual(foret.playtimeOverride, { min: 40, max: 60 }, "the file's playing time is the round's own");
  assert.deepEqual(foret.expansions.map((e) => e.title), ['Alpes'], 'a repeated expansion lands once');
  assert.deepEqual([foret.expansions[0].minPlayers, foret.expansions[0].maxPlayers], [2, 5]);

  const azul = games.find((g) => g.title === 'Azul');
  assert.deepEqual(azul.source, { provider: 'bgg', externalId: '230802', url: 'https://boardgamegeek.com/boardgame/230802' });
  assert.equal(azul.playtimeOverride, undefined, "a linked row never takes the file's playing time over BGG's");
  assert.equal(azul.image, 'https://cf.geekdo-images.com/azul.jpg', "the preview's BGG cover is kept");
  assert.equal(games.find((g) => g.title === 'Elsewhere').image, null, 'a cover off the allowlist costs the cover only');
  assert.equal(games.find((g) => g.title === 'Plain').image, null, 'an unlinked row takes no cover from the request');

  const rows = (await activities(round.id)).filter((a) => a.type === 'games_imported');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 4);
});

test('a re-run adds nothing: linked rows by BGG id, unlinked rows by folded title', async () => {
  const round = await createRound(request, { name: 'Twice' });
  await request(app).post(`/api/rounds/${round.id}/games`).send({ title: 'Café International', minPlayers: 2, maxPlayers: 4 });
  const body = { games: [{ title: 'Azul', bggId: 230802 }, { title: 'Cafe international' }, { title: 'Azul' }] };
  const first = await request(app).post(url(round.id)).send(body);
  // „Azul" unlinked is a duplicate of the linked one created just before it.
  assert.deepEqual(first.body, { imported: 1, skipped: 2, attached: 0 });
  const again = await request(app).post(url(round.id)).send(body);
  assert.deepEqual(again.body, { imported: 0, skipped: 3, attached: 0 });
  assert.equal((await shelfOf(round.id)).length, 2);
});

test('attach adds expansions to a shelf game by union, and refuses a game it may not touch', async () => {
  const round = await createRound(request, { name: 'Attach' });
  const base = (await request(app).post(`/api/rounds/${round.id}/games`).send({ title: 'Cascadia', minPlayers: 1, maxPlayers: 4 })).body;
  await request(app).put(`/api/rounds/${round.id}/games/${base.id}/expansions`).send({ expansions: [{ title: 'Landmarks' }] });
  const wish = (await request(app).post(`/api/rounds/${round.id}/games`).send({ title: 'Wunsch', minPlayers: 2, maxPlayers: 2, wish: true })).body;

  const res = await request(app).post(url(round.id)).send({
    attach: [{ gameId: base.id, expansions: [{ title: 'landmarks' }, { title: 'Alpine Lakes', bggId: 4242, minPlayers: 1, maxPlayers: 6 }] }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { imported: 0, skipped: 0, attached: 1 });
  const cascadia = (await shelfOf(round.id)).find((g) => g.id === base.id);
  assert.deepEqual(cascadia.expansions.map((e) => e.title), ['Landmarks', 'Alpine Lakes'],
    'what the group recorded by hand is kept, a title it already owns is not repeated');
  assert.equal(cascadia.expansions[1].source.externalId, '4242');

  for (const gameId of [wish.id, 'nope']) {
    const bad = await request(app).post(url(round.id)).send({ attach: [{ gameId, expansions: [{ title: 'X' }] }] });
    assert.equal(bad.status, 400, gameId);
  }
});

test("another app's odd numbers are dropped, not refused", async () => {
  const round = await createRound(request, { name: 'Lenient' });
  const res = await request(app).post(url(round.id)).send({
    games: [
      { title: 'Zero', minPlayers: 0, maxPlayers: 4, playtime: { min: 0, max: 0 } },
      { title: 'Backwards', minPlayers: 6, maxPlayers: 2, playtime: { min: 90, max: 30 } },
      { title: 'Huge', minPlayers: 2, maxPlayers: 5000, playtime: 'long' },
    ],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const games = await shelfOf(round.id);
  const by = (t) => games.find((g) => g.title === t);
  assert.deepEqual([by('Zero').minPlayers, by('Zero').maxPlayers], [4, 4], 'a known end is kept');
  assert.equal(by('Zero').playtimeOverride, undefined);
  assert.deepEqual([by('Backwards').minPlayers, by('Backwards').maxPlayers], [2, 6]);
  assert.deepEqual(by('Backwards').playtimeOverride, { min: 90, max: 90 });
  assert.deepEqual([by('Huge').minPlayers, by('Huge').maxPlayers], [2, 2]);
});

test('the request is bounded and must carry something', async () => {
  const round = await createRound(request, { name: 'Bounds' });
  assert.equal((await request(app).post(url(round.id)).send({})).status, 400);
  assert.equal((await request(app).post(url(round.id)).send({ games: [], attach: [] })).status, 400);
  const tooMany = Array.from({ length: MYLUDO_IMPORT_MAX + 1 }, (_, i) => ({ title: `G${i}` }));
  assert.equal((await request(app).post(url(round.id)).send({ games: tooMany })).status, 400);
  assert.equal((await request(app).post(url('missing')).send({ games: [{ title: 'X' }] })).status, 404);
});
