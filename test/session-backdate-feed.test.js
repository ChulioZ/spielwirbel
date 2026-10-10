'use strict';

/*
 * The Freundeskreis side of logging past sessions (#1616).
 *
 * A session logged or re-dated into the past is bookkeeping, not news, so it
 * emits no `session_played` row — while a today-dated direct play still does,
 * and the account-tier marks a logged session crosses are still announced. The
 * assertions read the STORE, not the feed route, whose read-side collapse would
 * otherwise hide a duplicate (.claude/rules/feed-events-fire-on-the-transition.md).
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, store } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');

const PASSWORD = 'correct horse battery';
const PAST = '2026-03-01T20:00:00.000Z';
const handle = (email) => email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');
const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function makeAccount(email) {
  await request(app).post('/api/account/register').send({ email, username: handle(email), password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}

const rows = (a, type) => repo.listFeedEvents([a.user.id], 500).then((r) => r.filter((e) => e.type === type));
const call = (a, method, rid, path, body) =>
  request(app)[method](`/api/rounds/${rid}/sessions${path}`).set(auth(a.token)).send(body || {});

async function roundWithGame(owner, past = 0) {
  const round = await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Donnerstagsrunde', members: ['Anna'] }).then((r) => r.body);
  const req = request(app).post(`/api/rounds/${round.id}/games`).set(auth(owner.token));
  for (const [k, v] of Object.entries({ title: 'Kartographen', minPlayers: '2', maxPlayers: '4' })) req.field(k, v);
  const game = (await req).body;
  // Earlier sessions seeded straight into the store — reaching them over HTTP
  // tests nothing about this feature (the badge-feed spec's shape).
  const stored = store.data.rounds.find((r) => r.id === round.id);
  for (let i = 0; i < past; i++) {
    stored.sessions.push({
      id: `bd-${round.id}-${i}`, finished: true, cancelled: false,
      memberIds: stored.members.map((m) => m.id), winnerIds: [],
      gameIds: [game.id], chosenGameId: game.id, votes: {},
      createdAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    });
  }
  return { round: stored, game };
}

test('a logged evening posts no session_played — today\'s direct play still does', async () => {
  const ada = await makeAccount('bd-ada@example.com');
  const { round, game } = await roundWithGame(ada);

  const logged = await call(ada, 'post', round.id, '', { gameId: game.id, playedOn: PAST });
  assert.equal(logged.status, 201);
  await call(ada, 'post', round.id, `/${logged.body.session.id}/finish`, { winnerIds: [] });
  assert.equal((await rows(ada, 'session_played')).length, 0, 'logging is bookkeeping, not news');

  // The control: an ordinary direct play on today announces exactly once.
  const today = (await call(ada, 'post', round.id, '', { gameId: game.id })).body.session;
  await call(ada, 'post', round.id, `/${today.id}/finish`, {});
  assert.equal((await rows(ada, 'session_played')).length, 1);
});

test('a re-dated session that is un-finished and re-finished posts nothing new', async () => {
  const ben = await makeAccount('bd-ben@example.com');
  const { round, game } = await roundWithGame(ben);
  const s = (await call(ben, 'post', round.id, '', { gameId: game.id })).body.session;
  await call(ben, 'post', round.id, `/${s.id}/finish`, {});
  assert.equal((await rows(ben, 'session_played')).length, 1);

  assert.equal((await call(ben, 'patch', round.id, `/${s.id}/date`, { playedOn: PAST })).status, 200);
  await call(ben, 'post', round.id, `/${s.id}/finish`, { finished: false });
  await call(ben, 'post', round.id, `/${s.id}/finish`, {});
  assert.equal((await rows(ben, 'session_played')).length, 1, 'still the one row from the real finish');
});

test('the mark a logged session crosses IS announced — the 25th session', async () => {
  const cem = await makeAccount('bd-cem@example.com');
  const { round, game } = await roundWithGame(cem, 24);
  assert.equal((await call(cem, 'post', round.id, '', { gameId: game.id, playedOn: PAST })).status, 201);
  assert.deepEqual((await rows(cem, 'badge_earned')).map((e) => [e.title, e.tier]), [['accountSessions', 25]]);
});
