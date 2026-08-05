'use strict';

/* The Wunschliste (#560): a fourth, mutually exclusive game state for games the
 * round wants but does not own yet.
 *
 * Its whole promise is that a wish is NOT part of the collection, and the two
 * guards that keep that true are on the SERVER — the draw pool's shared
 * predicate and the direct-pick 400 — because the UI never offers a wish
 * anywhere, so nothing client-side would notice either going missing
 * (`.claude/rules/active-games-filter-sites.md`).
 *
 * The repo-level guarantees (three-way exclusivity, absent-key parity, the
 * delete guard) live in the shared contract suite, which runs against both
 * backends; this file is the HTTP shape. The friend-feed half needs accounts and
 * a real friendship, so it sits in `test/friends.test.js` instead — with no
 * `req.userId` the feed emitter is a no-op, and an accounts-off spec asserting
 * "no event" would pass against a route that emits one unconditionally.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

// Add a game to a round via the multipart endpoint; returns the response.
async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Chess', minPlayers: '2', maxPlayers: '4', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  return req;
}

test('POST games { wish } creates the game outside the active collection', async () => {
  const round = await createRound(request);
  const owned = (await addGame(round.id, { title: 'Owned' })).body;
  const res = await addGame(round.id, { title: 'Wanted', wish: 'true' });
  assert.equal(res.status, 201);
  assert.equal(res.body.wish, true);
  assert.ok(res.body.wishAt, 'a wish carries its timestamp');
  assert.equal(res.body.retired, false);
  assert.equal(res.body.completed, false);

  // It is on the round, and it is invisible to the home screen's count.
  const detail = (await request(app).get(`/api/rounds/${round.id}`)).body;
  assert.deepEqual(detail.games.map((g) => g.title).sort(), ['Owned', 'Wanted']);
  const home = (await request(app).get('/api/rounds')).body.find((r) => r.id === round.id);
  assert.equal(home.gameCount, 1, 'a wish must not count toward the round\'s games');
  assert.equal(owned.wish, false, 'an ordinary add is unchanged');
});

test('a wish cannot be drawn and cannot be direct-picked by id', async () => {
  const round = await createRound(request);
  const wish = (await addGame(round.id, { title: 'Wanted', wish: 'true' })).body;

  // Direct pick: the one path that never consults the pool, so it needs its own
  // guard — miss it and a game the group does not own is playable by id.
  const direct = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: wish.id, count: 1 });
  assert.equal(direct.status, 400);
  assert.match(direct.body.error, /wishlist/i);

  // The draw: with nothing else on the shelf there is no pool at all.
  const draw = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  assert.equal(draw.status, 400, 'a round holding only wishes has nothing to draw');

  // ...and once it reaches the shelf, both work.
  await request(app).post(`/api/rounds/${round.id}/games/${wish.id}/wish`).send({ wish: false });
  const after = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  assert.equal(after.status, 201);
});

/* Adding a wish is silent and putting it on the shelf is the event — so the
   Chronik of a round that wished for a game and later bought it reads exactly
   like one where the game was added directly, on the day it arrived. */
test('the Chronik records the acquisition, not the wish', async () => {
  const round = await createRound(request);
  const wish = (await addGame(round.id, { title: 'Wanted', wish: 'true' })).body;

  let feed = (await request(app).get(`/api/rounds/${round.id}/activities`)).body;
  assert.equal(feed.filter((a) => a.type === 'game_added').length, 0,
    'wishing for a game writes nothing to the Chronik');

  await request(app).post(`/api/rounds/${round.id}/games/${wish.id}/wish`).send({ wish: false });
  feed = (await request(app).get(`/api/rounds/${round.id}/activities`)).body;
  const added = feed.filter((a) => a.type === 'game_added');
  assert.equal(added.length, 1);
  assert.equal(added[0].title, 'Wanted');
  assert.equal(added[0].gameId, wish.id);
});

/* The delete guard is "not in the active collection", not "in one of the two
   archives" — otherwise a wish could never be taken off the list again. */
test('DELETE accepts a wish and still refuses an active game', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id, { title: 'Wanted' })).body;

  const refused = await request(app).delete(`/api/rounds/${round.id}/games/${game.id}`);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /wished-for/);

  await request(app).post(`/api/rounds/${round.id}/games/${game.id}/wish`).send({});
  const gone = await request(app).delete(`/api/rounds/${round.id}/games/${game.id}`);
  assert.equal(gone.status, 200);
  assert.equal((await request(app).get(`/api/rounds/${round.id}`)).body.games.length, 0);
});

/* `wish` is opt-in and coerced from a multipart string, so every spelling that
   is not an explicit yes has to land on the shelf. A game silently created onto
   the wish list is invisible on the screen the user is looking at. */
test('POST games treats any unrecognised wish value as false', async () => {
  const round = await createRound(request);
  for (const value of ['false', '0', 'yes', 'on', '']) {
    const res = await addGame(round.id, { title: `V${value}`, wish: value });
    assert.equal(res.status, 201);
    assert.equal(res.body.wish, false, `wish=${JSON.stringify(value)} must not create a wish`);
  }
  // ...and the two that must.
  for (const value of ['true', '1']) {
    const res = await addGame(round.id, { title: `Y${value}`, wish: value });
    assert.equal(res.body.wish, true, `wish=${JSON.stringify(value)} must create a wish`);
  }
});

test('POST games/:gid/wish 404s for a missing round or game', async () => {
  const round = await createRound(request);
  assert.equal((await request(app).post('/api/rounds/nope/games/x/wish').send({})).status, 404);
  assert.equal((await request(app).post(`/api/rounds/${round.id}/games/nope/wish`).send({})).status, 404);
});
