'use strict';

/*
 * Direct messages over HTTP (#1783): who may read, write, edit and delete; the
 * conversation list and its unread dots; the inbox item; the quota; and that a
 * message's text reaches no log line. Accounts ON, real accounts, friendships
 * seeded through the repo. The store itself — paging, markers, erasure on both
 * backends — is test/support/direct-messages-contract.js.
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
const auth = (token) => ({ Authorization: `Bearer ${token}` });
let n = 0;

async function makeAccount(prefix) {
  n += 1;
  const username = `${prefix}-${n}`;
  const email = `${username}@example.com`;
  await request(app).post('/api/account/register').send({ email, username, password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  const user = await repo.getUserByEmail(email);
  return { token: login.body.accessToken, user, id: user.id, username };
}

async function befriend(a, b) {
  const f = await repo.createFriendRequest({ requesterUserId: a.id, addresseeUserId: b.id });
  assert.ok(await repo.acceptFriendRequest(f.id, b.id), 'the friendship was accepted');
  return f.id;
}

const base = (who) => `/api/account/messages/${who.id}`;
const chatItems = async (user, other) => (await repo.listInbox(user.id))
  .filter((it) => it.type === 'chat_unread' && it.payload && it.payload.thread === `dm:${other.id}`);

test('friends read and write; a stranger and an unknown id get the same 404', async () => {
  const ana = await makeAccount('dm-access');
  const ben = await makeAccount('dm-access');
  const eve = await makeAccount('dm-access');
  await befriend(ana, ben);

  const a = await request(app).post(base(ben)).set(auth(ana.token)).send({ text: '  Spielen wir Freitag?  ' });
  assert.equal(a.status, 201);
  assert.equal(a.body.text, 'Spielen wir Freitag?', 'stored trimmed');
  assert.equal(a.body.own, true);
  assert.equal('authorUserId' in a.body, false, 'the account id is not sent');

  const b = await request(app).post(base(ana)).set(auth(ben.token)).send({ text: 'Ja!' });
  assert.equal(b.status, 201);
  assert.equal(b.body.own, true);

  const read = await request(app).get(base(ana)).set(auth(ben.token));
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.messages.map((m) => [m.text, m.own]), [['Spielen wir Freitag?', false], ['Ja!', true]]);
  assert.equal(read.body.messages[0].author.username, ana.username);
  assert.equal(read.body.canPost, true);
  assert.equal(read.body.partner.username, ana.username);

  // A stranger: no conversation to read, none to start, nothing to mark — and
  // the answer is the one an id that names nobody gets.
  const stranger = await request(app).get(base(ana)).set(auth(eve.token));
  const unknown = await request(app).get('/api/account/messages/doesnotexist').set(auth(eve.token));
  assert.equal(stranger.status, 404);
  assert.deepEqual(stranger.body, unknown.body);
  assert.equal((await request(app).post(base(ana)).set(auth(eve.token)).send({ text: 'hi' })).status, 404);
  assert.equal((await request(app).post(`${base(ana)}/read`).set(auth(eve.token)).send({ seq: 9 })).status, 404);
  // Nor can she read the pair's conversation by naming either side.
  assert.equal((await request(app).get(base(ben)).set(auth(eve.token))).status, 404);

  // Yourself, and nobody signed in.
  assert.equal((await request(app).get(base(ana)).set(auth(ana.token))).status, 404);
  assert.equal((await request(app).get(base(ana))).status, 401);
});

test('ending the friendship closes the conversation for new messages; the history stays', async () => {
  const ana = await makeAccount('dm-ended');
  const ben = await makeAccount('dm-ended');
  const fid = await befriend(ana, ben);
  const mine = (await request(app).post(base(ben)).set(auth(ana.token)).send({ text: 'vorher' })).body;
  assert.ok(await repo.deleteFriendshipById(fid, ben.id), 'the friendship ended');

  const read = await request(app).get(base(ben)).set(auth(ana.token));
  assert.equal(read.status, 200, 'an ex-friend still reads the history');
  assert.deepEqual(read.body.messages.map((m) => m.text), ['vorher']);
  assert.equal(read.body.canPost, false);
  assert.equal(read.body.friend, false);

  const post = await request(app).post(base(ben)).set(auth(ana.token)).send({ text: 'nachher' });
  assert.equal(post.status, 403);
  assert.equal(post.body.error, 'not_friends');
  // An edit is a new text by another name.
  const edit = await request(app).patch(`${base(ben)}/${mine.id}`).set(auth(ana.token)).send({ text: 'umgeschrieben' });
  assert.equal(edit.status, 403);
  assert.equal(edit.body.error, 'not_friends');
  // Taking your own message back stays possible.
  assert.equal((await request(app).delete(`${base(ben)}/${mine.id}`).set(auth(ana.token))).status, 204);

  // With the last message gone and no friendship, nothing is left to see.
  assert.equal((await request(app).get(base(ben)).set(auth(ana.token))).status, 404);
});

test('a guest-demo account reaches nothing, and is nobody to write to', async () => {
  const ana = await makeAccount('dm-demo');
  const tourist = await makeAccount('dm-demo');
  await befriend(ana, tourist);
  await repo.updateUser(tourist.id, { demo: true });

  for (const [method, url] of [['get', '/api/account/messages'], ['get', base(ana)], ['post', base(ana)]]) {
    const res = await request(app)[method](url).set(auth(tourist.token)).send({ text: 'hi' });
    assert.equal(res.status, 403, `${method} ${url}`);
    assert.equal(res.body.error, 'demo_forbidden');
  }
  // And from the real side, the demo is not a conversation partner at all.
  assert.equal((await request(app).post(base(tourist)).set(auth(ana.token)).send({ text: 'hi' })).status, 404);
  const list = await request(app).get('/api/account/messages').set(auth(ana.token));
  assert.equal(list.body.conversations.some((c) => c.userId === tourist.id), false);
});

test('only the author edits or deletes, and only messages of THIS conversation', async () => {
  const ana = await makeAccount('dm-own');
  const ben = await makeAccount('dm-own');
  const cleo = await makeAccount('dm-own');
  await befriend(ana, ben);
  await befriend(ana, cleo);
  const fromBen = (await request(app).post(base(ana)).set(auth(ben.token)).send({ text: 'von Ben' })).body;

  const notMine = await request(app).patch(`${base(ben)}/${fromBen.id}`).set(auth(ana.token)).send({ text: 'x' });
  assert.equal(notMine.status, 403);
  assert.equal(notMine.body.error, 'not_author');
  assert.equal((await request(app).delete(`${base(ben)}/${fromBen.id}`).set(auth(ana.token))).status, 403);
  // A message of the Ana–Ben conversation, addressed by its own author through
  // her conversation with Cleo, is not found there. Ana is friends with Cleo on
  // purpose: otherwise the partner check 404s first and this line could not see
  // the per-message check at all (measured — it stayed green with it deleted).
  const fromAna = (await request(app).post(base(ben)).set(auth(ana.token)).send({ text: 'von Ana' })).body;
  assert.equal((await request(app).patch(`${base(cleo)}/${fromAna.id}`).set(auth(ana.token)).send({ text: 'x' })).status, 404);
  assert.equal((await request(app).delete(`${base(cleo)}/${fromAna.id}`).set(auth(ana.token))).status, 404);
  assert.ok(await repo.getDirectMessage(fromAna.id), 'and it is still there');

  const edited = await request(app).patch(`${base(ana)}/${fromBen.id}`).set(auth(ben.token)).send({ text: 'von Ben, korrigiert' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.text, 'von Ben, korrigiert');
  assert.ok(edited.body.editedAt);
  assert.equal((await request(app).delete(`${base(ana)}/${fromBen.id}`).set(auth(ben.token))).status, 204);
  assert.equal(await repo.getDirectMessage(fromBen.id), null);
});

test('the conversation list: friends and ex-friends with history, newest first, with unread dots', async () => {
  const me = await makeAccount('dm-list');
  const quiet = await makeAccount('dm-list');
  const chatty = await makeAccount('dm-list');
  const ex = await makeAccount('dm-list');
  await befriend(me, quiet);
  await befriend(me, chatty);
  const exFid = await befriend(me, ex);
  await request(app).post(base(me)).set(auth(ex.token)).send({ text: 'alt' });
  await repo.deleteFriendshipById(exFid, me.id);
  const last = (await request(app).post(base(me)).set(auth(chatty.token)).send({ text: 'neu' })).body;

  const list = (await request(app).get('/api/account/messages').set(auth(me.token))).body.conversations;
  assert.deepEqual(list.map((c) => c.userId), [chatty.id, ex.id, quiet.id]);
  const by = Object.fromEntries(list.map((c) => [c.userId, c]));
  assert.equal(by[chatty.id].unread, true);
  assert.equal(by[chatty.id].friend, true);
  assert.equal(by[ex.id].friend, false);
  assert.equal(by[quiet.id].unread, false);
  assert.equal(by[quiet.id].lastAt, null);

  await request(app).post(`${base(chatty)}/read`).set(auth(me.token)).send({ seq: last.seq });
  const after = (await request(app).get('/api/account/messages').set(auth(me.token))).body.conversations;
  assert.equal(after.find((c) => c.userId === chatty.id).unread, false);
});

test('the inbox item: created for the recipient only, recounted on read and delete, no text in it', async () => {
  const ana = await makeAccount('dm-inbox');
  const ben = await makeAccount('dm-inbox');
  await befriend(ana, ben);
  const SECRET = 'Geheimtext-91c2';
  const m1 = (await request(app).post(base(ben)).set(auth(ana.token)).send({ text: SECRET })).body;
  const m2 = (await request(app).post(base(ben)).set(auth(ana.token)).send({ text: 'zwei' })).body;

  const items = await chatItems(ben, ana);
  assert.equal(items.length, 1, 'one collapsed item, not one per message');
  assert.equal(items[0].payload.count, 2);
  assert.equal(items[0].payload.username, ana.username);
  assert.equal(JSON.stringify(items[0]).includes(SECRET), false, 'the item carries no text');
  assert.deepEqual(await chatItems(ana, ben), [], 'the author gets none');

  // Deleting a message recounts; it never creates.
  await request(app).delete(`${base(ben)}/${m2.id}`).set(auth(ana.token));
  assert.equal((await chatItems(ben, ana))[0].payload.count, 1);

  // Reading clears it.
  await request(app).post(`${base(ana)}/read`).set(auth(ben.token)).send({ seq: m1.seq });
  assert.deepEqual(await chatItems(ben, ana), []);

  // An account that switched the items off gets no new one.
  await repo.updateUser(ben.id, { notifyChatInbox: false });
  await request(app).post(base(ben)).set(auth(ana.token)).send({ text: 'drei' });
  assert.deepEqual(await chatItems(ben, ana), []);
});

test('validation, the per-account quota and the rate limit', async () => {
  const ana = await makeAccount('dm-limits');
  const ben = await makeAccount('dm-limits');
  await befriend(ana, ben);
  for (const text of ['   ', 'x'.repeat(CHAT_MESSAGE_MAX + 1), 42]) {
    const res = await request(app).post(base(ben)).set(auth(ana.token)).send({ text });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid message', 'a fixed message, never the input echoed');
  }
  assert.equal((await request(app).get(`${base(ben)}?before=1e300`).set(auth(ana.token))).status, 400);
  assert.equal((await request(app).post(`${base(ben)}/read`).set(auth(ana.token)).send({ seq: 1e300 })).status, 400);

  const prev = process.env.MAX_DIRECT_MESSAGES_PER_USER;
  process.env.MAX_DIRECT_MESSAGES_PER_USER = '1';
  try {
    assert.equal((await request(app).post(base(ben)).set(auth(ana.token)).send({ text: 'eins' })).status, 201);
    const over = await request(app).post(base(ben)).set(auth(ana.token)).send({ text: 'zwei' });
    assert.equal(over.status, 403);
    assert.equal(over.body.error, 'quota_direct_messages');
    // Per account: Ben still has his own allowance.
    assert.equal((await request(app).post(base(ana)).set(auth(ben.token)).send({ text: 'ich' })).status, 201);
  } finally {
    if (prev === undefined) delete process.env.MAX_DIRECT_MESSAGES_PER_USER;
    else process.env.MAX_DIRECT_MESSAGES_PER_USER = prev;
  }

  const rl = process.env.CHAT_RATE_LIMIT_MAX;
  process.env.CHAT_RATE_LIMIT_MAX = '2';
  try {
    const cleo = await makeAccount('dm-limits');
    await befriend(cleo, ben);
    const codes = [];
    for (let i = 0; i < 3; i += 1) {
      codes.push((await request(app).post(base(ben)).set(auth(cleo.token)).send({ text: `m${i}` })).status);
    }
    assert.deepEqual(codes, [201, 201, 429]);
  } finally {
    if (rl === undefined) delete process.env.CHAT_RATE_LIMIT_MAX;
    else process.env.CHAT_RATE_LIMIT_MAX = rl;
  }
});

test("a message's text reaches no log line — request, event or error", async () => {
  const ana = await makeAccount('dm-logs');
  const ben = await makeAccount('dm-logs');
  await befriend(ana, ben);
  const SECRET = 'Pssst-Direkt-4b9e';
  const lines = [];
  const orig = process.stdout.write;
  const level = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  process.stdout.write = (chunk, ...rest) => { lines.push(String(chunk)); return orig.call(process.stdout, chunk, ...rest); };
  try {
    const posted = await request(app).post(base(ben)).set(auth(ana.token)).send({ text: SECRET });
    await request(app).patch(`${base(ben)}/${posted.body.id}`).set(auth(ana.token)).send({ text: `${SECRET}-2` });
    await request(app).post(base(ben)).set(auth(ana.token)).send({ text: `${SECRET}${'x'.repeat(CHAT_MESSAGE_MAX)}` });
    await request(app).get(base(ana)).set(auth(ben.token));
  } finally {
    process.stdout.write = orig;
    process.env.LOG_LEVEL = level;
  }
  const logs = lines.join('').split('\n')
    .map((l) => l.slice(Math.max(0, l.indexOf('{"level"'))))
    .filter((l) => l.startsWith('{"level"'));
  assert.ok(logs.some((l) => l.includes('"direct_message_posted"')), 'the capture saw the app log at all');
  assert.ok(logs.some((l) => l.includes('/api/account/messages')), 'the capture saw the request lines');
  assert.equal(logs.filter((l) => l.includes(SECRET)).length, 0, 'message text leaked into the logs');
});

test('the operator looks up and removes a reported direct message', async () => {
  const ana = await makeAccount('dm-mod');
  const ben = await makeAccount('dm-mod');
  await befriend(ana, ben);
  const bad = (await request(app).post(base(ben)).set(auth(ana.token)).send({ text: 'Beleidigung' })).body;
  const cookie = await adminSessionCookie();

  const look = await request(app).get(`/api/admin/messages/${bad.id}`).set('Cookie', cookie);
  assert.equal(look.status, 200);
  assert.equal(look.body.message.kind, 'direct');
  assert.equal(look.body.message.text, 'Beleidigung');
  assert.equal(look.body.message.authorUsername, ana.username);
  assert.equal(look.body.message.recipientUsername, ben.username);
  assert.equal('participants' in look.body.message, false);

  const rm = await request(app).post('/api/admin/messages/remove').set('Cookie', cookie)
    .send({ id: bad.id, reason: 'Nutzungsbedingungen § 4' });
  assert.equal(rm.status, 200);
  assert.equal(rm.body.entry.action, 'remove_direct_message');
  assert.equal(rm.body.entry.userId, ana.id);
  assert.equal(await repo.getDirectMessage(bad.id), null);
  assert.deepEqual(await chatItems(ben, ana), [], "the recipient's item went with it");
  assert.equal((await request(app).post('/api/admin/messages/remove').set('Cookie', cookie)
    .send({ id: bad.id, reason: 'x' })).status, 404);
});

test('accounts off: the whole surface is a 404', async () => {
  const { createApp } = require('../lib/app');
  const prev = process.env.ACCOUNTS_ENABLED;
  process.env.ACCOUNTS_ENABLED = 'false';
  try {
    const off = createApp();
    assert.equal((await request(off).get('/api/account/messages')).status, 404);
  } finally {
    process.env.ACCOUNTS_ENABLED = prev;
  }
});
