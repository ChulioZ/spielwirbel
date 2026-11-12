'use strict';

/*
 * The round chat over HTTP (#1781): who may read and post, who may edit and
 * delete, the unread dot on the home list and the round read, the quota, the
 * per-account rate limit, and that a message's text never reaches a log line.
 *
 * Accounts ON, real accounts (register → verify → login) and grants seeded
 * through the repo — the shape test/round-grants-access.test.js uses. The
 * repo contract (test/support/repo-contract.js) covers paging, tenant
 * isolation, markers and erasure on both backends; this file covers the route.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.ADMIN_PASSWORD = 'operator-secret-pw';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, adminSessionCookie } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');
const { CHAT_MESSAGE_MAX } = require('../public/js/round-chat');

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

async function sharedRound(prefix, role = 'editor') {
  const owner = await makeAccount(`${prefix}-owner@example.com`);
  const guest = await makeAccount(`${prefix}-guest@example.com`);
  const round = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Chatrunde', members: ['Bo'] })).body;
  await repo.createGrant({ roundId: round.id, ownerTenantId: owner.user.tenantId, userId: guest.user.id, role });
  return { owner, guest, round, base: `/api/rounds/${round.id}/messages` };
}

test('owner and grantee read and post; an outsider, a revoked grantee and another tenant get 404', async () => {
  const { owner, guest, round, base } = await sharedRound('chat-access');
  const outsider = await makeAccount('chat-access-outsider@example.com');

  const a = await request(app).post(base).set(auth(owner.token)).send({ text: '  Wer bringt Snacks?  ' });
  assert.equal(a.status, 201);
  assert.equal(a.body.text, 'Wer bringt Snacks?', 'stored trimmed');
  assert.equal(a.body.own, true);
  assert.equal(a.body.author.username, 'chat-access-owner');
  assert.equal('authorUserId' in a.body, false, 'the account id is not sent to the client');

  const b = await request(app).post(base).set(auth(guest.token)).send({ text: 'Ich!' });
  assert.equal(b.status, 201, 'a grantee posts into the owner\'s round');

  const read = await request(app).get(base).set(auth(guest.token));
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.messages.map((m) => [m.text, m.own]), [['Wer bringt Snacks?', false], ['Ich!', true]]);
  assert.equal(read.body.hasMore, false);

  for (const who of [outsider]) {
    assert.equal((await request(app).get(base).set(auth(who.token))).status, 404);
    assert.equal((await request(app).post(base).set(auth(who.token)).send({ text: 'hi' })).status, 404);
    assert.equal((await request(app).post(`${base}/read`).set(auth(who.token)).send({ seq: 99 })).status, 404);
  }

  // Revoked: the grant goes, and the thread with it.
  assert.ok(await repo.deleteGrant(round.id, guest.user.id), 'the grant existed and is gone');
  assert.equal((await request(app).get(base).set(auth(guest.token))).status, 404);
  assert.equal((await request(app).post(base).set(auth(guest.token)).send({ text: 'noch da?' })).status, 404);

  // Unauthenticated callers never reach it.
  assert.equal((await request(app).get(base)).status, 401);
});

test('a message is validated after normalisation, against the shared cap', async () => {
  const { owner, base } = await sharedRound('chat-valid');
  assert.equal((await request(app).post(base).set(auth(owner.token)).send({ text: '   ' })).status, 400);
  assert.equal((await request(app).post(base).set(auth(owner.token)).send({})).status, 400);
  assert.equal((await request(app).post(base).set(auth(owner.token)).send({ text: 'x'.repeat(CHAT_MESSAGE_MAX + 1) })).status, 400);
  const ok = await request(app).post(base).set(auth(owner.token)).send({ text: `${'x'.repeat(CHAT_MESSAGE_MAX)}\r\n` });
  assert.equal(ok.status, 201, 'trailing whitespace does not count against the cap');
  const bad = await request(app).post(base).set(auth(owner.token)).send({ text: 'y'.repeat(CHAT_MESSAGE_MAX + 5) });
  assert.equal(JSON.stringify(bad.body).includes('yyyy'), false, 'the refusal does not echo the text');
});

test('only the author edits; the author, the owner and a co-owner delete; an editor cannot delete others\'', async () => {
  const { owner, guest, round, base } = await sharedRound('chat-rights');
  const co = await makeAccount('chat-rights-co@example.com');
  await repo.createGrant({ roundId: round.id, ownerTenantId: owner.user.tenantId, userId: co.user.id, role: 'coowner' });

  const mine = (await request(app).post(base).set(auth(guest.token)).send({ text: 'Tippfeler' })).body;
  const ownerMsg = (await request(app).post(base).set(auth(owner.token)).send({ text: 'Vom Owner' })).body;

  const edit = await request(app).patch(`${base}/${mine.id}`).set(auth(guest.token)).send({ text: 'Tippfehler' });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.text, 'Tippfehler');
  assert.ok(edit.body.editedAt, 'an edit is marked');
  assert.equal((await request(app).patch(`${base}/${mine.id}`).set(auth(owner.token)).send({ text: 'umgeschrieben' })).body.error,
    'not_author', 'even the owner cannot reword someone else\'s message');

  // The editor may not delete the owner's message …
  const refused = await request(app).delete(`${base}/${ownerMsg.id}`).set(auth(guest.token));
  assert.equal(refused.status, 403);
  // … a co-owner may, and the owner may delete the editor's.
  assert.equal((await request(app).delete(`${base}/${ownerMsg.id}`).set(auth(co.token))).status, 204);
  const second = (await request(app).post(base).set(auth(guest.token)).send({ text: 'Noch einer' })).body;
  assert.equal((await request(app).delete(`${base}/${second.id}`).set(auth(owner.token))).status, 204);
  // And an author deletes their own.
  assert.equal((await request(app).delete(`${base}/${mine.id}`).set(auth(guest.token))).status, 204);
  assert.deepEqual((await request(app).get(base).set(auth(owner.token))).body.messages, []);
  assert.equal((await request(app).delete(`${base}/${mine.id}`).set(auth(owner.token))).status, 404);
});

test('the unread dot: lit by someone else\'s message on the home list and the round read, cleared by reading', async () => {
  const { owner, guest, round, base } = await sharedRound('chat-unread');
  const homeFlag = async (who) => (await request(app).get('/api/rounds').set(auth(who.token))).body
    .find((r) => r.id === round.id).chatUnread === true;
  const roundFlag = async (who) => (await request(app).get(`/api/rounds/${round.id}`).set(auth(who.token))).body.chatUnread === true;

  assert.equal(await homeFlag(owner), false);
  const msg = (await request(app).post(base).set(auth(owner.token)).send({ text: 'Hallo' })).body;
  assert.equal(await homeFlag(owner), false, 'your own message never lights your dot');
  assert.equal(await roundFlag(owner), false);
  assert.equal(await homeFlag(guest), true, 'the grantee sees it on the home list');
  assert.equal(await roundFlag(guest), true, 'and on the round');

  const mark = await request(app).post(`${base}/read`).set(auth(guest.token)).send({ seq: msg.seq });
  assert.equal(mark.status, 200);
  assert.equal(await homeFlag(guest), false, 'read clears it');
  assert.equal(await roundFlag(guest), false);

  // Per account: the guest replying lights the owner's dot and not the guest's.
  await request(app).post(base).set(auth(guest.token)).send({ text: 'Hi' });
  assert.equal(await homeFlag(owner), true);
  assert.equal(await homeFlag(guest), false);
  assert.equal((await request(app).get(base).set(auth(owner.token))).body.lastRead, 0,
    'posting marks nothing read — only the view does, for what it has shown');
});

test('the per-tenant message quota counts a grantee\'s message against the owner', async () => {
  const { owner, guest, base } = await sharedRound('chat-quota');
  process.env.MAX_MESSAGES_PER_TENANT = '2';
  try {
    assert.equal((await request(app).post(base).set(auth(owner.token)).send({ text: '1' })).status, 201);
    assert.equal((await request(app).post(base).set(auth(guest.token)).send({ text: '2' })).status, 201);
    const refused = await request(app).post(base).set(auth(owner.token)).send({ text: '3' });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'quota_messages');
  } finally {
    delete process.env.MAX_MESSAGES_PER_TENANT;
  }
});

test('posting is rate-limited per ACCOUNT, not per address', async () => {
  const { owner, guest, base } = await sharedRound('chat-rate');
  process.env.CHAT_RATE_LIMIT_MAX = '3';
  try {
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await request(app).post(base).set(auth(owner.token)).send({ text: `m${i}` })).status, 201);
    }
    const limited = await request(app).post(base).set(auth(owner.token)).send({ text: 'zu viel' });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, 'rate_limited');
    // Same supertest address, different account: unaffected.
    assert.equal((await request(app).post(base).set(auth(guest.token)).send({ text: 'ich darf' })).status, 201);
  } finally {
    delete process.env.CHAT_RATE_LIMIT_MAX;
  }
});

test('a message\'s text reaches no log line — request, event or error', async () => {
  const { owner, base } = await sharedRound('chat-logs');
  const SECRET = 'Pssst-Nachricht-7f3a';
  const lines = [];
  const orig = process.stdout.write;
  const level = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  process.stdout.write = (chunk, ...rest) => { lines.push(String(chunk)); return orig.call(process.stdout, chunk, ...rest); };
  try {
    const posted = await request(app).post(base).set(auth(owner.token)).send({ text: SECRET });
    await request(app).patch(`${base}/${posted.body.id}`).set(auth(owner.token)).send({ text: `${SECRET}-2` });
    await request(app).post(base).set(auth(owner.token)).send({ text: `${SECRET}${'x'.repeat(CHAT_MESSAGE_MAX)}` });
    await request(app).get(base).set(auth(owner.token));
  } finally {
    process.stdout.write = orig;
    process.env.LOG_LEVEL = level;
  }
  // Only the app's own JSON lines: node --test writes its protocol (with test
  // names) to the same stream.
  const logs = lines.join('').split('\n')
    .map((l) => l.slice(Math.max(0, l.indexOf('{"level"'))))
    .filter((l) => l.startsWith('{"level"'));
  assert.ok(logs.some((l) => l.includes('"chat_message_posted"')), 'the capture saw the app log at all');
  assert.ok(logs.some((l) => l.includes('/messages')), 'the capture saw the request lines');
  assert.equal(logs.filter((l) => l.includes(SECRET)).length, 0, 'message text leaked into the logs');
});

test('an accounts-off instance has no chat', async () => {
  const { createApp } = require('../lib/app');
  const prev = process.env.ACCOUNTS_ENABLED;
  process.env.ACCOUNTS_ENABLED = 'false';
  try {
    const legacy = createApp();
    const round = (await request(legacy).post('/api/rounds').send({ name: 'Alt', members: ['A'] })).body;
    assert.equal((await request(legacy).get(`/api/rounds/${round.id}/messages`)).status, 404);
    assert.equal((await request(legacy).post(`/api/rounds/${round.id}/messages`).send({ text: 'hi' })).status, 404);
    assert.equal('chatUnread' in (await request(legacy).get(`/api/rounds/${round.id}`)).body, false);
  } finally {
    process.env.ACCOUNTS_ENABLED = prev;
  }
});

test('the operator looks up a reported message across tenants, removes it, and the log keeps the text', async () => {
  const { owner, guest, round, base } = await sharedRound('chat-mod');
  const bad = (await request(app).post(base).set(auth(guest.token)).send({ text: 'Rechtswidriger Inhalt' })).body;
  const cookie = await adminSessionCookie();

  assert.equal((await request(app).get('/api/admin/messages/..%2Fx').set('Cookie', cookie)).status, 400);
  const look = await request(app).get(`/api/admin/messages/${bad.id}`).set('Cookie', cookie);
  assert.equal(look.status, 200);
  assert.equal(look.body.message.text, 'Rechtswidriger Inhalt');
  assert.equal(look.body.message.roundName, 'Chatrunde');
  assert.equal(look.body.message.tenantId, owner.user.tenantId, 'stored under the OWNER tenant');
  assert.equal(look.body.message.authorUsername, 'chat-mod-guest');

  assert.equal((await request(app).post('/api/admin/messages/remove').set('Cookie', cookie)
    .send({ id: bad.id })).status, 400, 'a reason is required');
  const rm = await request(app).post('/api/admin/messages/remove').set('Cookie', cookie)
    .send({ id: bad.id, reason: 'DSA-Meldung' });
  assert.equal(rm.status, 200);
  assert.equal(rm.body.entry.action, 'remove_message');
  assert.equal(rm.body.entry.previous, 'Rechtswidriger Inhalt');
  assert.equal(rm.body.entry.roundId, round.id);
  assert.deepEqual((await request(app).get(base).set(auth(owner.token))).body.messages, [], 'gone from the thread');
  assert.equal((await request(app).post('/api/admin/messages/remove').set('Cookie', cookie)
    .send({ id: bad.id, reason: 'again' })).status, 404);
  const statement = await request(app).get(`/api/admin/statement?entry=${rm.body.entry.id}`).set('Cookie', cookie);
  assert.match(statement.body.text, /deine Chat-Nachricht „Rechtswidriger Inhalt“ entfernt/,
    'the Art. 17 statement names the measure, not the generic fallback');
  const log = await request(app).get('/api/admin/log').set('Cookie', cookie);
  assert.ok(log.body.entries.some((e) => e.action === 'remove_message' && e.target === bad.id));
});

test('the operator\'s Art. 15 export forwards EVERY store exportAccountData returns, chat included', async () => {
  const { guest, base } = await sharedRound('chat-export');
  await request(app).post(base).set(auth(guest.token)).send({ text: 'Meine Nachricht' });
  const cookie = await adminSessionCookie();
  const res = await request(app).post(`/api/admin/users/${guest.user.id}/export`).set('Cookie', cookie)
    .send({ reason: 'Auskunftsersuchen' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.export.roundMessages.map((m) => m.text), ['Meine Nachricht']);
  // Parity, not a list: the export route names each store by hand, and
  // quizSubmissions had been returned by the repo and dropped here since #743.
  const keys = Object.keys(await repo.exportAccountData(guest.user.id, guest.user.tenantId));
  const missing = keys.filter((k) => !(k in res.body.export));
  assert.deepEqual(missing, [], 'stores the repo exports but the route does not forward');
});

test('the read marker and the paging cursor refuse numbers no seq can be (no 500 on Postgres)', async () => {
  // Measured: 1e300 reaches Postgres as a bigint and throws 22P02 → a 500 any
  // account can repeat, each one an entry in the operator's error log.
  const { owner, base } = await sharedRound('chat-bounds');
  for (const seq of [1e300, Number.MAX_SAFE_INTEGER + 2, -1, 1.5]) {
    const res = await request(app).post(`${base}/read`).set(auth(owner.token)).send({ seq });
    assert.equal(res.status, 400, `seq ${seq}`);
  }
  for (const before of ['1e300', String(Number.MAX_SAFE_INTEGER + 2), '0', 'x']) {
    assert.equal((await request(app).get(`${base}?before=${before}`).set(auth(owner.token))).status, 400, `before ${before}`);
  }
  assert.equal((await request(app).post(`${base}/read`).set(auth(owner.token)).send({ seq: Number.MAX_SAFE_INTEGER })).status, 200);
});

test('one author cannot fill the round owner\'s message quota on their own', async () => {
  const { owner, guest, base } = await sharedRound('chat-share');
  process.env.MAX_MESSAGES_PER_TENANT = '10';
  process.env.MAX_MESSAGES_PER_AUTHOR = '2';
  try {
    for (let i = 0; i < 2; i += 1) {
      assert.equal((await request(app).post(base).set(auth(guest.token)).send({ text: `g${i}` })).status, 201);
    }
    const refused = await request(app).post(base).set(auth(guest.token)).send({ text: 'g3' });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'quota_messages_author');
    assert.equal((await request(app).post(base).set(auth(owner.token)).send({ text: 'ich darf noch' })).status, 201,
      'the owner — and everyone else — can still post');
  } finally {
    delete process.env.MAX_MESSAGES_PER_TENANT;
    delete process.env.MAX_MESSAGES_PER_AUTHOR;
  }
});

test('owner and co-owner remove all of one person\'s messages in a round at once; an editor cannot', async () => {
  const { owner, guest, round, base } = await sharedRound('chat-purge');
  const editor = await makeAccount('chat-purge-editor@example.com');
  await repo.createGrant({ roundId: round.id, ownerTenantId: owner.user.tenantId, userId: editor.user.id, role: 'editor' });
  const spam = [];
  for (let i = 0; i < 3; i += 1) spam.push((await request(app).post(base).set(auth(guest.token)).send({ text: `spam${i}` })).body);
  const keep = (await request(app).post(base).set(auth(editor.token)).send({ text: 'normal' })).body;

  assert.equal((await request(app).delete(`${base}/by-author/${spam[0].id}`).set(auth(editor.token))).status, 403);
  const res = await request(app).delete(`${base}/by-author/${spam[1].id}`).set(auth(owner.token));
  assert.equal(res.status, 200);
  assert.equal(res.body.removed, 3);
  assert.deepEqual((await request(app).get(base).set(auth(owner.token))).body.messages.map((m) => m.id), [keep.id]);
  assert.equal((await request(app).delete(`${base}/by-author/${spam[1].id}`).set(auth(owner.token))).status, 404);
});
