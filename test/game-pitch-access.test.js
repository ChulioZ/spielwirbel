'use strict';

/*
 * Who may write a game's pitch line (#1837). It goes through PATCH …/games/:gid,
 * which lib/round-access.js maps to `round.write` — every grantee of the round,
 * the same as every other game editor. No new permission was added, so this
 * pins the two ends: a grantee may set it, and an account with no access to the
 * round cannot reach the game at all (404, nothing stored).
 *
 * There is no round role below `editor` today, so "a member without game-edit
 * rights" has no live instance; the outsider is the case that exists.
 *
 * Accounts must be ON for per-user tenants and grants, mirroring
 * test/round-grants-access.test.js.
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

async function makeAccount(email) {
  await request(app).post('/api/account/register').send({ email, username: handle(email), password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}

test('a grantee may write the pitch; an outsider cannot reach the game and stores nothing', async () => {
  const owner = await makeAccount('pitch-owner@example.com');
  const grantee = await makeAccount('pitch-grantee@example.com');
  const outsider = await makeAccount('pitch-outsider@example.com');

  const round = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Freitagsrunde', members: ['Owner'] })).body;
  const game = (await request(app).post(`/api/rounds/${round.id}/games`).set(auth(owner.token))
    .send({ title: 'Catan', minPlayers: 2, maxPlayers: 4 })).body;
  await repo.createGrant({ roundId: round.id, ownerTenantId: owner.user.tenantId, userId: grantee.user.id });
  const read = async () => (await request(app).get(`/api/rounds/${round.id}`).set(auth(owner.token)))
    .body.games.find((g) => g.id === game.id);

  const denied = await request(app).patch(`/api/rounds/${round.id}/games/${game.id}`)
    .set(auth(outsider.token)).send({ pitch: 'Von außen' });
  assert.equal(denied.status, 404);
  assert.equal('pitch' in await read(), false, 'the outsider wrote nothing');

  const unauthenticated = await request(app).patch(`/api/rounds/${round.id}/games/${game.id}`).send({ pitch: 'Anonym' });
  assert.equal(unauthenticated.status, 401);
  assert.equal('pitch' in await read(), false);

  const allowed = await request(app).patch(`/api/rounds/${round.id}/games/${game.id}`)
    .set(auth(grantee.token)).send({ pitch: 'Handeln, bauen, streiten' });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  assert.equal((await read()).pitch, 'Handeln, bauen, streiten');
});
