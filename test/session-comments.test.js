'use strict';

/*
 * Session comments over HTTP (#1782): the round chat's router mounted a second
 * time at /api/rounds/:rid/sessions/:sid/messages. What this file pins is the
 * part that differs from the round thread — scoping a thread to one session,
 * the round thread showing the whole conversation, the read marker a session
 * view may move, the Chronik counts and the cascade on session delete. The
 * shared half (authorization, cap, quota, log hygiene) is the round chat's and
 * lives in test/round-messages.test.js; the repo contract covers both backends.
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

const bareSession = (gameIds) => ({
  createdAt: new Date().toISOString(), gameIds, votes: {}, chosenGameId: null, chosenAt: null,
  finished: false, finishedAt: null, winnerIds: [], cancelled: false, cancelledAt: null, done: false,
});

// An owner, an editor grantee, a round with one game and two sessions.
async function sharedRound(prefix) {
  const owner = await makeAccount(`${prefix}-owner@example.com`);
  const guest = await makeAccount(`${prefix}-guest@example.com`);
  const round = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Kommentarrunde', members: ['Bo'] })).body;
  await repo.createGrant({ roundId: round.id, ownerTenantId: owner.user.tenantId, userId: guest.user.id, role: 'editor' });
  const tenant = owner.user.tenantId;
  const game = await repo.createGame(tenant, round.id, { title: 'Catan', minPlayers: 2, maxPlayers: 4, image: null, source: null });
  const s1 = await repo.createSession(tenant, round.id, bareSession([game.id]));
  const s2 = await repo.createSession(tenant, round.id, bareSession([game.id]));
  const rbase = `/api/rounds/${round.id}/messages`;
  const sbase = (s) => `/api/rounds/${round.id}/sessions/${s.id}/messages`;
  return { owner, guest, round, s1, s2, rbase, sbase };
}

test('a session thread holds its own comments; the round thread shows them too, tagged', async () => {
  const { owner, guest, round, s1, s2, rbase, sbase } = await sharedRound('sc-scope');
  const outsider = await makeAccount('sc-scope-outsider@example.com');

  assert.equal((await request(app).post(rbase).set(auth(owner.token)).send({ text: 'Runde' })).status, 201);
  const c = await request(app).post(sbase(s1)).set(auth(guest.token)).send({ text: 'Wer bringt Snacks?' });
  assert.equal(c.status, 201, 'a grantee comments on the owner\'s session');
  assert.equal(c.body.sessionId, s1.id);
  assert.equal(c.body.own, true);
  await request(app).post(sbase(s2)).set(auth(owner.token)).send({ text: 'Anderer Abend' });

  const one = await request(app).get(sbase(s1)).set(auth(owner.token));
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.messages.map((m) => m.text), ['Wer bringt Snacks?']);

  const all = await request(app).get(rbase).set(auth(owner.token));
  assert.deepEqual(all.body.messages.map((m) => [m.text, m.sessionId || null]),
    [['Runde', null], ['Wer bringt Snacks?', s1.id], ['Anderer Abend', s2.id]]);

  // An unknown session, a session of another round, and an outsider.
  const other = (await request(app).post('/api/rounds').set(auth(owner.token)).send({ name: 'Andere', members: ['Cy'] })).body;
  assert.equal((await request(app).get(`/api/rounds/${round.id}/sessions/nope/messages`).set(auth(owner.token))).status, 404);
  assert.equal((await request(app).get(`/api/rounds/${other.id}/sessions/${s1.id}/messages`).set(auth(owner.token))).status, 404);
  assert.equal((await request(app).post(`/api/rounds/${other.id}/sessions/${s1.id}/messages`)
    .set(auth(owner.token)).send({ text: 'x' })).status, 404);
  assert.equal((await request(app).get(sbase(s1)).set(auth(outsider.token))).status, 404);
  assert.equal((await request(app).post(sbase(s1)).set(auth(outsider.token)).send({ text: 'x' })).status, 404);
  assert.equal((await request(app).get(sbase(s1))).status, 401);
});

test('editing and deleting on a session path reach that session\'s comments only', async () => {
  const { owner, guest, s1, s2, rbase, sbase } = await sharedRound('sc-edit');
  const roundMsg = (await request(app).post(rbase).set(auth(guest.token)).send({ text: 'Runde' })).body;
  const mine = (await request(app).post(sbase(s1)).set(auth(guest.token)).send({ text: 'alt' })).body;

  // Not this thread's message: a round-level one, or the comment via another session.
  assert.equal((await request(app).patch(`${sbase(s1)}/${roundMsg.id}`).set(auth(guest.token)).send({ text: 'x' })).status, 404);
  assert.equal((await request(app).delete(`${sbase(s2)}/${mine.id}`).set(auth(guest.token))).status, 404);

  // The author edits; nobody else does, the owner included.
  assert.equal((await request(app).patch(`${sbase(s1)}/${mine.id}`).set(auth(owner.token)).send({ text: 'x' })).status, 403);
  const edited = await request(app).patch(`${sbase(s1)}/${mine.id}`).set(auth(guest.token)).send({ text: 'neu' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.text, 'neu');
  assert.ok(edited.body.editedAt);

  // The round-wide flood clean-up is not offered on a session's path.
  assert.equal((await request(app).delete(`${sbase(s1)}/by-author/${mine.id}`).set(auth(owner.token))).status, 404);

  // The owner moderates: deletes someone else's comment.
  assert.equal((await request(app).delete(`${sbase(s1)}/${mine.id}`).set(auth(owner.token))).status, 204);
  assert.deepEqual((await request(app).get(sbase(s1)).set(auth(owner.token))).body.messages, []);
});

test('a session view marks read only below the first unread message it did not show', async () => {
  const { owner, guest, round, s1, rbase, sbase } = await sharedRound('sc-read');
  const unread = async () => (await request(app).get(`/api/rounds/${round.id}`).set(auth(guest.token))).body.chatUnread === true;

  const elsewhere = (await request(app).post(rbase).set(auth(owner.token)).send({ text: 'Runde' })).body;
  const comment = (await request(app).post(sbase(s1)).set(auth(owner.token)).send({ text: 'Session' })).body;
  assert.equal(await unread(), true);

  // The guest opens the session and has seen the comment — but not the round
  // message before it, so the marker must stop short of that one.
  const capped = await request(app).post(`${sbase(s1)}/read`).set(auth(guest.token)).send({ seq: comment.seq });
  assert.equal(capped.status, 200);
  assert.equal(capped.body.lastRead, elsewhere.seq - 1);
  assert.equal(await unread(), true, 'the round message nobody showed still lights the dot');

  // The Chat tab shows everything, and clears it.
  const all = await request(app).post(`${rbase}/read`).set(auth(guest.token)).send({ seq: comment.seq });
  assert.equal(all.body.lastRead, comment.seq);
  assert.equal(await unread(), false);

  // With nothing unread elsewhere, the session view marks its own comment read.
  const next = (await request(app).post(sbase(s1)).set(auth(owner.token)).send({ text: 'noch eins' })).body;
  assert.equal(await unread(), true, 'a session comment counts toward the round\'s dot');
  const full = await request(app).post(`${sbase(s1)}/read`).set(auth(guest.token)).send({ seq: next.seq });
  assert.equal(full.body.lastRead, next.seq);
  assert.equal(await unread(), false);

  assert.equal((await request(app).post(`/api/rounds/${round.id}/sessions/nope/messages/read`)
    .set(auth(guest.token)).send({ seq: 1 })).status, 404);
});

test('the Chronik counts per session, and a deleted session takes its comments', async () => {
  const { owner, guest, round, s1, s2, rbase, sbase } = await sharedRound('sc-count');
  await request(app).post(rbase).set(auth(owner.token)).send({ text: 'Runde' });
  for (const text of ['a', 'b']) await request(app).post(sbase(s1)).set(auth(guest.token)).send({ text });
  await request(app).post(sbase(s2)).set(auth(owner.token)).send({ text: 'c' });

  const counts = await request(app).get(`${rbase}/session-counts`).set(auth(guest.token));
  assert.equal(counts.status, 200);
  assert.deepEqual(counts.body.counts, { [s1.id]: 2, [s2.id]: 1 });
  assert.equal((await request(app).get(`${sbase(s1)}/session-counts`).set(auth(owner.token))).status, 404);

  assert.equal((await request(app).delete(`/api/rounds/${round.id}/sessions/${s2.id}`).set(auth(owner.token))).status, 200);
  assert.deepEqual((await request(app).get(`${rbase}/session-counts`).set(auth(owner.token))).body.counts, { [s1.id]: 2 });
  assert.deepEqual((await request(app).get(rbase).set(auth(owner.token))).body.messages.map((m) => m.text),
    ['Runde', 'a', 'b'], 'the deleted session\'s comment left the round thread too');
});
