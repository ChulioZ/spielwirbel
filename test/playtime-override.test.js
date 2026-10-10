'use strict';

/*
 * A round's own playing time (#1627): `playtimeOverride: { min, max }` beside
 * BGG's `minPlaytime`/`maxPlaytime`, read through `gamePlaytime` in
 * public/js/draw-pool.js by every surface and by the draw.
 *
 * The properties worth pinning are the silent ones:
 *  - the DRAW honours the edit (a filter acting on BGG's number while the page
 *    shows the group's would hand out a game that does not fit the evening);
 *  - a later BGG fill does not revert it (the backfill overwrites the provider
 *    pair whenever BGG answers, so the edit would simply vanish);
 *  - the key never joins PROVIDER_INFO_FIELDS (that would make every game re-ask
 *    BGG weekly, or never — .claude/rules/provider-info-is-a-field-set.md);
 *  - the shared-vote ballot carries the edited number.
 * The repo half (both backends, absent-key clear) is in test/support/repo-contract.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const repo = require('../lib/repo');
const { drawPool } = require('../lib/draw');
const {
  gamePlaytime, fitsMetadataFilters, metadataFilterOptions, PLAYTIME_OVERRIDE_MAX,
} = require('../public/js/draw-pool');
const { PROVIDER_INFO_FIELDS } = require('../public/js/provider-info-fields');

const T = repo.forTenant('default');

async function addGame(rid, title) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8' })) req.field(k, String(v));
  return (await req).body;
}
const patch = (rid, gid, body) => request(app).patch(`/api/rounds/${rid}/games/${gid}`).send(body);
const gameOf = async (rid, gid) =>
  (await request(app).get(`/api/rounds/${rid}`)).body.games.find((g) => g.id === gid);

/* ----------------------------- The resolver ------------------------------ */

test('gamePlaytime prefers the round\'s override and otherwise reads BGG\'s pair', () => {
  assert.deepEqual(gamePlaytime({ minPlaytime: 60, maxPlaytime: 90 }),
    { minPlaytime: 60, maxPlaytime: 90, overridden: false });
  assert.deepEqual(gamePlaytime({ minPlaytime: 60, maxPlaytime: 90, playtimeOverride: { min: 120, max: 150 } }),
    { minPlaytime: 120, maxPlaytime: 150, overridden: true });
  // A hand-typed game BGG knows nothing about can carry one too.
  assert.deepEqual(gamePlaytime({ playtimeOverride: { min: 30, max: 30 } }),
    { minPlaytime: 30, maxPlaytime: 30, overridden: true });
  assert.deepEqual(gamePlaytime({}), { minPlaytime: null, maxPlaytime: null, overridden: false });
  assert.deepEqual(gamePlaytime(null), { minPlaytime: null, maxPlaytime: null, overridden: false });
});

test('a 90-minute BGG game edited to 150 is OUT of a "max 120" draw, and the reverse is IN', () => {
  const edited = { id: 'a', minPlaytime: 60, maxPlaytime: 90, playtimeOverride: { min: 120, max: 150 } };
  const shortened = { id: 'b', minPlaytime: 120, maxPlaytime: 180, playtimeOverride: { min: 45, max: 60 } };
  const plain = { id: 'c', minPlaytime: 30, maxPlaytime: 60 };
  const filters = { maxPlaytime: 120 };
  assert.equal(fitsMetadataFilters(edited, filters), false);
  assert.equal(fitsMetadataFilters(shortened, filters), true);
  // The "at least" bound reads the edited minimum as well.
  assert.equal(fitsMetadataFilters(shortened, { minPlaytime: 90 }), false);

  // And through the real pool builder lib/draw.js uses.
  const round = { games: [edited, shortened, plain] };
  const pool = drawPool(round, { playerCount: 3, metadata: filters });
  assert.deepEqual(pool.map((g) => g.id), ['b', 'c']);
});

test('the shelf offers the playtime controls for a game only the round has timed', () => {
  const opts = metadataFilterOptions([{ id: 'x', playtimeOverride: { min: 20, max: 40 } }]);
  assert.equal(opts.playtimeMin, true);
  assert.equal(opts.playtimeMax, true);
  assert.equal(metadataFilterOptions([{ id: 'y' }]).playtimeMax, false);
});

test('the override is NOT a provider field — it can neither trigger nor suppress a BGG fetch', () => {
  assert.equal(PROVIDER_INFO_FIELDS.includes('playtimeOverride'), false);
});

/* ------------------------------- The route ------------------------------- */

test('PATCH sets the override, validates it like the player range, and null clears it', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'Massive Darkness');

  const ok = await patch(round.id, game.id, { playtimeOverride: { min: 120, max: 180 } });
  assert.equal(ok.status, 200);
  assert.deepEqual((await gameOf(round.id, game.id)).playtimeOverride, { min: 120, max: 180 });

  for (const bad of [
    { min: 90, max: 60 },                      // max below min
    { min: 0, max: 60 },                       // below 1
    { min: 60.5, max: 90 },                    // not a whole number
    { min: 60 },                               // a lone bound
    { min: 60, max: PLAYTIME_OVERRIDE_MAX + 1 }, // past the ceiling
    { min: 60, max: 90, note: 'slow table' },  // an unknown key rides along
    '60-90',
  ]) {
    const res = await patch(round.id, game.id, { playtimeOverride: bad });
    assert.equal(res.status, 400, `accepted ${JSON.stringify(bad)}`);
  }
  // A refused edit changed nothing.
  assert.deepEqual((await gameOf(round.id, game.id)).playtimeOverride, { min: 120, max: 180 });

  const cleared = await patch(round.id, game.id, { playtimeOverride: null });
  assert.equal(cleared.status, 200);
  assert.equal('playtimeOverride' in (await gameOf(round.id, game.id)), false);
});

test('a later BGG fill with different numbers does not revert the edit', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'Gloomhaven');
  await T.setGameProviderInfo(round.id, game.id, { minPlaytime: 60, maxPlaytime: 120 });
  await patch(round.id, game.id, { playtimeOverride: { min: 150, max: 210 } });
  const before = (await gameOf(round.id, game.id)).providerInfoAt;

  // The single-game backfill and the shelf-wide corpus fill both go through
  // assignProviderInfo, which overwrites the provider pair.
  await T.setGameProviderInfo(round.id, game.id, { minPlaytime: 30, maxPlaytime: 45 });
  await T.setGameProviderInfoMany(round.id, [{ gameId: game.id, info: { minPlaytime: 20, maxPlaytime: 40 } }]);

  const after = await gameOf(round.id, game.id);
  assert.deepEqual(after.playtimeOverride, { min: 150, max: 210 });
  assert.deepEqual(gamePlaytime(after), { minPlaytime: 150, maxPlaytime: 210, overridden: true });
  assert.ok(before, 'the fill stamped the attempt');

  // Editing the override alone never touches the provider stamp either way.
  await patch(round.id, game.id, { playtimeOverride: { min: 100, max: 100 } });
  assert.equal((await gameOf(round.id, game.id)).providerInfoAt, after.providerInfoAt);
});

test('the shared-vote ballot carries the round\'s own playing time', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'Spirit Island');
  await addGame(round.id, 'Azul');
  await T.setGameProviderInfo(round.id, game.id, { minPlaytime: 90, maxPlaytime: 120 });
  await patch(round.id, game.id, { playtimeOverride: { min: 150, max: 180 } });

  const session = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 5 })).body.session;
  const { token } = (await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/vote-link`).send({})).body;
  const ballot = (await request(app).get(`/api/vote/${token}`)).body;
  const g = ballot.games.find((x) => x.id === game.id);
  assert.equal(g.minPlaytime, 150);
  assert.equal(g.maxPlaytime, 180);
  // The voter sees a number, not where it came from.
  assert.equal('playtimeOverride' in g, false);
});

test('copying a game into another round carries its playing time along', async () => {
  const from = await createRound(request);
  const to = await createRound(request, { name: 'Target' });
  const game = await addGame(from.id, 'Brass');
  await patch(from.id, game.id, { playtimeOverride: { min: 120, max: 120 } });
  const res = await request(app).post(`/api/rounds/${from.id}/games/copy-to`)
    .send({ targetRoundId: to.id, gameIds: [game.id] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const copied = (await request(app).get(`/api/rounds/${to.id}`)).body.games.find((g) => g.title === 'Brass');
  assert.deepEqual(copied.playtimeOverride, { min: 120, max: 120 });
});

test('the shelf profile bands a game by the round\'s own playing time', () => {
  const { shelfProfile } = require('../public/js/shelf-profile');
  const { fitsPlayerCount } = require('../public/js/draw-pool');
  // Eight 45-minute games by BGG's figure; the round says one of them runs 3 h.
  const games = Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, minPlaytime: 30, maxPlaytime: 45 }));
  games[0].playtimeOverride = { min: 150, max: 180 };
  const deps = { fitsPlayerCount, gamePlaytime, scoreOf: () => null, creditedDesigners: () => [] };
  const n = (key) => shelfProfile(games, deps).time.bands.find((b) => b.key === key).n;
  assert.equal(n('over120'), 1);
  assert.equal(n('to60'), 7);
});
