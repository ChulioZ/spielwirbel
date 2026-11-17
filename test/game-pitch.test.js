'use strict';

/*
 * A game's pitch line (#1837): one sentence the round writes about a game,
 * shown on the vote card. Stored as `pitch: '<text>'`, absent when there is none.
 *
 * Pinned here: the shared check (game-pitch.js), the route's create, set, clear
 * and refusals, the vote-link ballot carrying it (and still no rating), and
 * copy/move carrying it. The repo half (both backends, the absent-key clear) is
 * in test/support/repo-contract.js; who may write it is
 * test/game-pitch-access.test.js; the screens are test/game-pitch-view.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const { GAME_PITCH_MAX, gamePitchFrom } = require('../public/js/game-pitch');

async function addGame(rid, title, extra = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8', ...extra })) req.field(k, String(v));
  return req;
}
const patch = (rid, gid, body) => request(app).patch(`/api/rounds/${rid}/games/${gid}`).send(body);
const gameOf = async (rid, gid) => (await request(app).get(`/api/rounds/${rid}`)).body.games.find((g) => g.id === gid);

/* ------------------------------ the check -------------------------------- */

test('gamePitchFrom trims, clears a blank, and refuses a newline, a non-string or an over-long line', () => {
  assert.deepEqual(gamePitchFrom('  Fies, 45 min  '), { pitch: 'Fies, 45 min' });
  assert.deepEqual(gamePitchFrom(''), { pitch: null });
  assert.deepEqual(gamePitchFrom('   '), { pitch: null });
  assert.deepEqual(gamePitchFrom(null), { pitch: null });
  assert.deepEqual(gamePitchFrom('a\nb'), { error: 'newline' });
  assert.deepEqual(gamePitchFrom('a\r\nb'), { error: 'newline' });
  assert.deepEqual(gamePitchFrom('a b'), { error: 'newline' });
  assert.deepEqual(gamePitchFrom(42), { error: 'type' });
  assert.deepEqual(gamePitchFrom(['x']), { error: 'type' });
  assert.deepEqual(gamePitchFrom('x'.repeat(GAME_PITCH_MAX)), { pitch: 'x'.repeat(GAME_PITCH_MAX) });
  assert.deepEqual(gamePitchFrom('x'.repeat(GAME_PITCH_MAX + 1)), { error: 'long' });
});

test('the cap counts characters, not UTF-16 units — an emoji costs one', () => {
  assert.equal(GAME_PITCH_MAX, 90, 'the issue states 90; change it here and in the copy deliberately');
  const emoji = '🎲'.repeat(GAME_PITCH_MAX);
  assert.equal(emoji.length, GAME_PITCH_MAX * 2, 'the fixture is two units per character');
  assert.deepEqual(gamePitchFrom(emoji), { pitch: emoji });
  assert.deepEqual(gamePitchFrom(emoji + '🎲'), { error: 'long' });
});

/* -------------------------------- route --------------------------------- */

test('PATCH sets, changes and clears a pitch; a clear leaves no key', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id, 'Brass')).body;
  assert.equal('pitch' in (await gameOf(round.id, game.id)), false, 'absent until written');

  let res = await patch(round.id, game.id, { pitch: '  Kanäle, Kohle, fies  ' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await gameOf(round.id, game.id)).pitch, 'Kanäle, Kohle, fies');
  res = await patch(round.id, game.id, { pitch: 'Eisenbahn statt Kanäle' });
  assert.equal(res.status, 200);
  assert.equal((await gameOf(round.id, game.id)).pitch, 'Eisenbahn statt Kanäle');

  // A title edit alone leaves the pitch where it is.
  await patch(round.id, game.id, { title: 'Brass: Birmingham' });
  assert.equal((await gameOf(round.id, game.id)).pitch, 'Eisenbahn statt Kanäle');

  for (const clear of [null, '', '   ']) {
    await patch(round.id, game.id, { pitch: 'wieder da' });
    res = await patch(round.id, game.id, { pitch: clear });
    assert.equal(res.status, 200);
    assert.equal('pitch' in (await gameOf(round.id, game.id)), false, `${JSON.stringify(clear)} must clear`);
  }
});

test('PATCH refuses an over-long, multi-line or non-string pitch and stores nothing', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id, 'Azul')).body;
  for (const pitch of ['x'.repeat(GAME_PITCH_MAX + 1), 'eins\nzwei', 'eins\rzwei', 42, ['x'], { text: 'x' }, true]) {
    const res = await patch(round.id, game.id, { pitch });
    assert.equal(res.status, 400, `${JSON.stringify(pitch)} must 400`);
  }
  assert.equal('pitch' in (await gameOf(round.id, game.id)), false);
});

test('POST stores a typed pitch, leaves the key off a blank one, and refuses a bad one', async () => {
  const round = await createRound(request);
  const withOne = await addGame(round.id, 'Kartographen', { pitch: ' Karten zeichnen, ruhig ' });
  assert.equal(withOne.status, 201, JSON.stringify(withOne.body));
  assert.equal((await gameOf(round.id, withOne.body.id)).pitch, 'Karten zeichnen, ruhig');

  const blank = await addGame(round.id, 'Azul', { pitch: '  ' });
  assert.equal(blank.status, 201);
  assert.equal('pitch' in (await gameOf(round.id, blank.body.id)), false);

  const tooLong = await addGame(round.id, 'Catan', { pitch: 'x'.repeat(GAME_PITCH_MAX + 1) });
  assert.equal(tooLong.status, 400);
  const games = (await request(app).get(`/api/rounds/${round.id}`)).body.games;
  assert.equal(games.some((g) => g.title === 'Catan'), false, 'a refused add creates nothing');
});

test('the vote-link ballot carries the pitch — and still no rating', async () => {
  const round = await createRound(request);
  const a = (await addGame(round.id, 'A')).body;
  const b = (await addGame(round.id, 'B')).body;
  await patch(round.id, a.id, { pitch: 'Würfel als Arbeiter' });
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 5 });
  const sid = res.body.session.id;
  const token = (await request(app).post(`/api/rounds/${round.id}/sessions/${sid}/vote-link`).send({})).body.token;

  const ballot = (await request(app).get(`/api/vote/${token}`)).body;
  const byId = Object.fromEntries(ballot.games.map((g) => [g.id, g]));
  assert.equal(byId[a.id].pitch, 'Würfel als Arbeiter');
  assert.equal(byId[b.id].pitch, null, 'a game without one says so explicitly');
  assert.equal(JSON.stringify(ballot).includes('"rating"'), false);
});

test('moving and copying a game carry its pitch', async () => {
  const from = await createRound(request);
  const copyTo = await createRound(request, { name: 'Copy target' });
  const moveTo = await createRound(request, { name: 'Move target' });
  const copied = (await addGame(from.id, 'Brass')).body;
  const moved = (await addGame(from.id, 'Azul')).body;
  await patch(from.id, copied.id, { pitch: 'Kanäle, Kohle, fies' });
  await patch(from.id, moved.id, { pitch: 'Plättchen, ruhig' });

  let res = await request(app).post(`/api/rounds/${from.id}/games/copy-to`).send({ targetRoundId: copyTo.id, gameIds: [copied.id] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  res = await request(app).post(`/api/rounds/${from.id}/games/move-to`).send({ targetRoundId: moveTo.id, gameIds: [moved.id] });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const titled = async (rid, title) => (await request(app).get(`/api/rounds/${rid}`)).body.games.find((x) => x.title === title);
  assert.equal((await titled(copyTo.id, 'Brass')).pitch, 'Kanäle, Kohle, fies');
  assert.equal((await titled(moveTo.id, 'Azul')).pitch, 'Plättchen, ruhig');
});
