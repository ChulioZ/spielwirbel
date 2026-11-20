'use strict';

/*
 * GET /api/game-twins (#1843): the same BGG game in the caller's other rounds.
 *
 * The isolation is the point, so it is driven over HTTP with real accounts and
 * a grant seeded through the repo, the shape test/round-grants-access.test.js
 * uses. Games are created through the repo so each fixture states its BGG link
 * directly.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');

const PASSWORD = 'correct horse battery';
const handle = (email) => email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const bgg = (id) => ({ provider: 'bgg', externalId: id });

async function makeAccount(email) {
  await request(app).post('/api/account/register').send({ email, username: handle(email), password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}

async function round(acct, name) {
  const res = await request(app).post('/api/rounds').set(auth(acct.token)).send({ name, members: ['X'] });
  assert.equal(res.status, 201);
  return res.body;
}

const game = (acct, rid, title, source, extra = {}) =>
  repo.forTenant(acct.user.tenantId).createGame(rid, {
    title, minPlayers: 2, maxPlayers: 4, image: null, source, ...extra,
  });

const twins = (acct, query) => request(app).get('/api/game-twins').query(query).set(auth(acct.token));

test('own rounds and granted rounds holding the game — never the round being edited, never an unshared round', async () => {
  const me = await makeAccount('twins-me@example.com');
  const other = await makeAccount('twins-other@example.com');

  const editing = await round(me, 'Familie');
  const mine = await round(me, 'Verein');
  const noTwin = await round(me, 'Leer');
  await game(me, editing.id, 'Catan', bgg('13'));
  const mineCatan = await game(me, mine.id, 'Die Siedler', bgg('13'), { pitch: 'Handeln' });
  await game(me, noTwin.id, 'Azul', bgg('230802'));

  // The other account's round SHARED with me, and one it keeps to itself.
  const shared = await round(other, 'Spieletreff');
  const unshared = await round(other, 'Privat');
  const sharedCatan = await game(other, shared.id, 'Catan', bgg('13'));
  await game(other, unshared.id, 'Catan', bgg('13'));
  await repo.createGrant({ roundId: shared.id, ownerTenantId: other.user.tenantId, userId: me.user.id, role: 'editor' });

  const res = await twins(me, { bggId: '13', excludeRoundId: editing.id });
  assert.equal(res.status, 200);
  const got = res.body.twins.map((t) => [t.roundName, t.gameId, t.shared === true]);
  assert.deepEqual(got.sort(), [
    ['Spieletreff', sharedCatan.id, true],
    ['Verein', mineCatan.id, false],
  ]);
  assert.equal(res.body.twins.find((t) => t.gameId === mineCatan.id).pitch, 'Handeln');
  // The unshared round's NAME must not reach the response in any field.
  assert.doesNotMatch(JSON.stringify(res.body), /Privat/);

  // The owner, asking the same question, sees their own two rounds and nothing of mine.
  const theirs = await twins(other, { bggId: '13', excludeRoundId: shared.id });
  assert.deepEqual(theirs.body.twins.map((t) => t.roundName), ['Privat']);
});

test('a granted round being edited is excluded too, and the apply goes through that round\'s own PATCH', async () => {
  const me = await makeAccount('twins-grantee@example.com');
  const other = await makeAccount('twins-owner@example.com');
  const shared = await round(other, 'Geteilt');
  const sharedGame = await game(other, shared.id, 'Carcassonne', bgg('822'));
  const mine = await round(me, 'Zuhause');
  const mineGame = await game(me, mine.id, 'Carcassonne', bgg('822'));
  await repo.createGrant({ roundId: shared.id, ownerTenantId: other.user.tenantId, userId: me.user.id, role: 'editor' });

  const res = await twins(me, { bggId: '822', excludeRoundId: shared.id });
  assert.deepEqual(res.body.twins.map((t) => t.gameId), [mineGame.id]);

  // The other direction: editing at home, the shared copy is offered, and the
  // write it leads to is the ordinary per-round route a grantee already holds.
  const back = await twins(me, { bggId: '822', excludeRoundId: mine.id });
  assert.deepEqual(back.body.twins.map((t) => t.gameId), [sharedGame.id]);
  const patch = await request(app).patch(`/api/rounds/${shared.id}/games/${sharedGame.id}`)
    .set(auth(me.token)).send({ playtimeOverride: { min: 30, max: 45 } });
  assert.equal(patch.status, 200);
  const after = await repo.forTenant(other.user.tenantId).getGame(shared.id, sharedGame.id);
  assert.deepEqual(after.playtimeOverride, { min: 30, max: 45 });
});

test('an id that is not a BGG id has no twins, and the route sits behind the account gate', async () => {
  const me = await makeAccount('twins-shape@example.com');
  const r = await round(me, 'Eine');
  await game(me, r.id, 'Hand-typed', null);
  for (const bggId of ['', 'abc', '13 OR 1=1', '1'.repeat(11)]) {
    const res = await twins(me, { bggId, excludeRoundId: 'x' });
    assert.equal(res.status, 200, bggId);
    assert.deepEqual(res.body, { twins: [] }, bggId);
  }
  assert.equal((await request(app).get('/api/game-twins?bggId=13')).status, 401);
});
