'use strict';

/* Guest games (#1681): a box a session guest brought, stored as a real game row
 * in a fourth off-shelf state. This file is the HTTP shape — creating one (and
 * reusing an earlier one), releasing it onto the shelf or the wish list, and the
 * two draw-side guards that only the server can hold: a guest game is drawable
 * in exactly the session it was brought to, and only through the guest who
 * brought it. The repo-level guarantees (four-way exclusivity, absent-key
 * parity, silent creation) live in the shared contract suite, which runs
 * against both backends.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
// The real cap, never a hand-copied number
// (.claude/rules/shared-constants-across-the-stack.md).
const { MAX_GUEST_GAMES } = require('../public/js/session-people');

async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Chess', minPlayers: '2', maxPlayers: '4', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  return req;
}

const start = (rid, body) => request(app).post(`/api/rounds/${rid}/sessions`).send(body);
const activities = async (rid) => (await request(app).get(`/api/rounds/${rid}/activities`)).body;

test('POST games { guestGame } creates a guest game that is off the shelf and silent', async () => {
  const round = await createRound(request);
  const res = await addGame(round.id, { title: 'Azul', guestGame: 'true' });
  assert.equal(res.status, 201);
  assert.equal(res.body.guestGame, true);
  assert.equal(res.body.wish, false);

  const home = (await request(app).get('/api/rounds')).body.find((r) => r.id === round.id);
  assert.equal(home.gameCount, 0, 'a guest game is not on the shelf');
  assert.equal((await activities(round.id)).filter((a) => a.type === 'game_added').length, 0,
    'bringing a game along is not an acquisition');
});

test('a guest game never carries owners, and refuses them afterwards', async () => {
  const round = await createRound(request);
  const mid = round.members[0].id;
  const res = await addGame(round.id, { title: 'Azul', guestGame: 'true', ownerIds: mid });
  assert.equal(res.status, 201);
  assert.equal('ownerIds' in res.body, false);
  const patch = await request(app).patch(`/api/rounds/${round.id}/games/${res.body.id}`).send({ ownerIds: [mid] });
  assert.equal(patch.status, 400);
});

test('bringing the same title again REUSES the guest game, by source or by title', async () => {
  const round = await createRound(request);
  const first = (await addGame(round.id, { title: 'Azul', guestGame: 'true' })).body;
  const again = await addGame(round.id, { title: '  azul ', guestGame: 'true' });
  assert.equal(again.status, 200, 'a reuse creates nothing');
  assert.equal(again.body.id, first.id);

  const linked = (await addGame(round.id, {
    title: 'Cascadia', guestGame: 'true', sourceProvider: 'bgg', sourceExternalId: '314343',
  })).body;
  const renamed = await addGame(round.id, {
    title: 'Cascadia (DE)', guestGame: 'true', sourceProvider: 'bgg', sourceExternalId: '314343',
  });
  assert.equal(renamed.body.id, linked.id, 'the provider id wins over a differing title');

  // A SHELF game of the same name is the round's own box, not a guest game to
  // reuse — the reuse is among guest games only.
  const shelf = (await addGame(round.id, { title: 'Splendor' })).body;
  const brought = await addGame(round.id, { title: 'Splendor', guestGame: 'true' });
  assert.equal(brought.status, 201);
  assert.notEqual(brought.body.id, shelf.id);
  assert.equal((await request(app).get(`/api/rounds/${round.id}`)).body.games.length, 4);
});

test('POST …/guest-game { to } moves a guest game onto the shelf or the wish list', async () => {
  const round = await createRound(request);
  const a = (await addGame(round.id, { title: 'Azul', guestGame: 'true' })).body;
  const b = (await addGame(round.id, { title: 'Cascadia', guestGame: 'true' })).body;

  const shelved = await request(app).post(`/api/rounds/${round.id}/games/${a.id}/guest-game`).send({ to: 'shelf' });
  assert.equal(shelved.status, 200);
  assert.equal('guestGame' in shelved.body, false);
  const wished = await request(app).post(`/api/rounds/${round.id}/games/${b.id}/guest-game`).send({ to: 'wish' });
  assert.equal(wished.status, 200);
  assert.equal(wished.body.wish, true);

  assert.deepEqual((await activities(round.id)).filter((x) => x.type === 'game_added').map((x) => x.title), ['Azul']);
  const home = (await request(app).get('/api/rounds')).body.find((r) => r.id === round.id);
  assert.equal(home.gameCount, 1);

  // Releasing twice is refused: the second call would announce nothing true.
  const twice = await request(app).post(`/api/rounds/${round.id}/games/${a.id}/guest-game`).send({ to: 'shelf' });
  assert.equal(twice.status, 400);
  const bad = await request(app).post(`/api/rounds/${round.id}/games/${b.id}/guest-game`).send({ to: 'attic' });
  assert.equal(bad.status, 400);
  const missing = await request(app).post(`/api/rounds/${round.id}/games/nope/guest-game`).send({ to: 'shelf' });
  assert.equal(missing.status, 404);
});

test('a guest game is never in an ordinary draw', async () => {
  const round = await createRound(request);
  await addGame(round.id, { title: 'Azul', guestGame: 'true', minPlayers: '1', maxPlayers: '8' });
  // Not brought by anybody tonight: the round has nothing to draw.
  const draw = await start(round.id, { count: 1, guests: ['Dana'] });
  assert.equal(draw.status, 400);
});

// #1682: „Jetzt spielen" from the Start tab can play a game the group does not
// own, so the direct-pick branch admits a guest game — and ONLY that extra
// state. A retired, completed or wished game still has no business being played
// by id; each is pinned, so widening the predicate to "anything off the shelf"
// goes red.
test('direct play accepts a guest game, and still refuses retired, completed and wish games', async () => {
  const round = await createRound(request);
  const g = (await addGame(round.id, { title: 'Azul', guestGame: 'true', minPlayers: '1', maxPlayers: '8' })).body;
  const direct = await start(round.id, { gameId: g.id, count: 1 });
  assert.equal(direct.status, 201);
  assert.equal(direct.body.session.chosenGameId, g.id);
  assert.equal(direct.body.session.guests, undefined, 'no guest brought it, so the session names none');
  const fresh = (await request(app).get(`/api/rounds/${round.id}`)).body;
  assert.equal(fresh.games.find((x) => x.id === g.id).guestGame, true, 'playing it does not shelve it');

  const retired = (await addGame(round.id, { title: 'Old' })).body;
  await request(app).post(`/api/rounds/${round.id}/games/${retired.id}/retire`).send({});
  const completed = (await addGame(round.id, { title: 'Done' })).body;
  await request(app).post(`/api/rounds/${round.id}/games/${completed.id}/complete`).send({});
  const wish = (await addGame(round.id, { title: 'Someday', wish: 'true' })).body;
  for (const [game, why] of [[retired, /retired/], [completed, /completed/], [wish, /wishlist/]]) {
    const res = await start(round.id, { gameId: game.id, count: 1 });
    assert.equal(res.status, 400, game.title);
    assert.match(res.body.error, why);
  }
});

test('a BROUGHT guest game is drawable in its session, and the session records who brought it', async () => {
  const round = await createRound(request);
  const g = (await addGame(round.id, { title: 'Azul', guestGame: 'true', minPlayers: '1', maxPlayers: '8' })).body;
  const res = await start(round.id, { count: 3, guests: [{ name: 'Dana', gameIds: [g.id] }, 'Eli'] });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.session.gameIds, [g.id]);
  assert.deepEqual(res.body.session.guests.map((x) => x.gameIds), [[g.id], undefined],
    'the attribution rides the guest; a guest who brought nothing carries no key');
  assert.equal(res.body.session.guests[1].name, 'Eli', 'a bare name string still works');
});

test('the server drops brought ids that are not guest games of this round, and caps per guest', async () => {
  const round = await createRound(request);
  const other = await createRound(request);
  const shelf = (await addGame(round.id, { title: 'Shelf', minPlayers: '1', maxPlayers: '8' })).body;
  const foreign = (await addGame(other.id, { title: 'Foreign', guestGame: 'true' })).body;
  const brought = [];
  for (let i = 0; i < MAX_GUEST_GAMES + 1; i++) {
    brought.push((await addGame(round.id, { title: `Guest ${i}`, guestGame: 'true', minPlayers: '1', maxPlayers: '8' })).body.id);
  }
  const res = await start(round.id, {
    count: 20,
    guests: [{ name: 'Dana', gameIds: [shelf.id, foreign.id, 'nope', ...brought, brought[0]] }, { name: 'Eli', gameIds: [brought[0]] }],
  });
  assert.equal(res.status, 201);
  const [dana, eli] = res.body.session.guests;
  assert.deepEqual(dana.gameIds, brought.slice(0, MAX_GUEST_GAMES), 'dropped leniently, deduped, then capped');
  assert.equal('gameIds' in eli, false, 'one box is brought by one guest');
  assert.equal(res.body.session.gameIds.length, 1 + MAX_GUEST_GAMES);
});

test('a brought game obeys the player range and the metadata filters, never the tag filter', async () => {
  const round = await createRound(request);
  const tag = (await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'Kurz' })).body;
  const tagged = (await addGame(round.id, { title: 'Tagged', minPlayers: '1', maxPlayers: '8', tagIds: tag.id })).body;
  const fits = (await addGame(round.id, { title: 'Fits', guestGame: 'true', minPlayers: '1', maxPlayers: '8' })).body;
  const tooSmall = (await addGame(round.id, { title: 'Duo', guestGame: 'true', minPlayers: '2', maxPlayers: '2' })).body;
  const res = await start(round.id, {
    count: 10, tagIds: [tag.id],
    guests: [{ name: 'Dana', gameIds: [fits.id, tooSmall.id] }],
  });
  assert.equal(res.status, 201);
  // Two members + one guest = three seats: the duo is out on range, the
  // untagged guest game is in despite the tag filter.
  assert.deepEqual(res.body.session.gameIds.sort(), [fits.id, tagged.id].sort());
});

test('broughtGames maps each brought id to the FIRST guest naming it, and is empty without guests', () => {
  const { broughtGames } = require('../public/js/session-people');
  const dana = { id: 'a', name: 'Dana', gameIds: ['x1', 'x2'] };
  const eli = { id: 'b', name: 'Eli', gameIds: ['x2', 'x3'] };
  const map = broughtGames({ guests: [dana, { id: 'c', name: 'Kim' }, eli] });
  assert.deepEqual([...map.keys()], ['x1', 'x2', 'x3']);
  assert.equal(map.get('x2'), dana);
  assert.equal(broughtGames({}).size, 0);
  assert.equal(broughtGames(null).size, 0);
});
