'use strict';

/*
 * Unread chat threads in the in-app inbox (#1784), over HTTP: one collapsed item
 * per recipient per thread, none for the author, cleared by opening the thread,
 * off by the Konto switch, never a mail, never the message text — and never
 * resurrected by anything but a new message. lib/chat-inbox.js holds the logic;
 * the repo contract (test/support/repo-contract.js) covers the store pair on
 * both backends.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');
const { meProjection } = require('../lib/me-projection');

const PASSWORD = 'correct horse battery';
const handle = (email) => email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');
const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function makeAccount(email) {
  await request(app).post('/api/account/register').send({ email, username: handle(email), password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}

async function sharedRound(prefix) {
  const owner = await makeAccount(`${prefix}-owner@example.com`);
  const guest = await makeAccount(`${prefix}-guest@example.com`);
  const round = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Spieleabend', members: ['Bo'] })).body;
  await repo.createGrant({ roundId: round.id, ownerTenantId: owner.user.tenantId, userId: guest.user.id, role: 'editor' });
  return { owner, guest, round, base: `/api/rounds/${round.id}/messages` };
}

const post = (base, who, text) => request(app).post(base).set(auth(who.token)).send({ text });
const chatItems = async (who) => (await request(app).get('/api/account/inbox').set(auth(who.token)))
  .body.items.filter((i) => i.type === 'chat_unread');

test('a post gives every OTHER account one collapsed item, with a count and no text, and mails nobody', async () => {
  const { owner, guest, round, base } = await sharedRound('ci-post');
  const mails = outbox.length;

  await post(base, guest, 'Geheimer Text eins');
  let items = await chatItems(owner);
  assert.equal(items.length, 1, 'the owner — who holds no grant — is a recipient');
  assert.deepEqual(items[0].payload, { roundId: round.id, roundName: 'Spieleabend', count: 1, thread: `round:${round.id}` });
  assert.equal(items[0].read, false);
  assert.deepEqual(await chatItems(guest), [], 'the author gets no item for their own message');

  await post(base, guest, 'zwei');
  await post(base, guest, 'drei');
  items = await chatItems(owner);
  assert.equal(items.length, 1, 'still one item for the thread, not three');
  assert.equal(items[0].payload.count, 3);

  // The owner replying gives the GRANTEE an item: one unread message of the
  // owner's, not the guest's own three.
  await post(base, owner, 'Antwort');
  const g = await chatItems(guest);
  assert.equal(g.length, 1);
  assert.equal(g[0].payload.count, 1);

  const all = JSON.stringify(await request(app).get('/api/account/inbox').set(auth(owner.token)).then((r) => r.body));
  assert.equal(all.includes('Geheimer'), false, 'no message text in the inbox');
  assert.equal(outbox.length, mails, 'no mail was sent for any of it');
});

// The count alone already skips your own messages, so this is the case the
// author exclusion exists for: the author has OTHER people's unread messages and
// dismissed that item. Writing a reply must not bring it back (measured: with the
// exclusion removed, every other test here stays green).
test('posting never touches the author\'s own item, even when others\' messages are unread', async () => {
  const { owner, guest, base } = await sharedRound('ci-author');
  await post(base, owner, 'Frage');
  const [item] = await chatItems(guest);
  await request(app).delete(`/api/account/inbox/${item.id}`).set(auth(guest.token)).expect(204);
  await post(base, guest, 'Antwort');
  assert.deepEqual(await chatItems(guest), [], 'the author\'s dismissed item stays dismissed');
});

test('opening the thread clears its item, and a read short of the newest lowers the count instead', async () => {
  const { owner, guest, base } = await sharedRound('ci-read');
  const first = (await post(base, guest, 'a')).body;
  const second = (await post(base, guest, 'b')).body;

  await request(app).post(`${base}/read`).set(auth(owner.token)).send({ seq: first.seq });
  const items = await chatItems(owner);
  assert.equal(items.length, 1, 'a message arrived after the one shown, so the item stays');
  assert.equal(items[0].payload.count, 1);

  await request(app).post(`${base}/read`).set(auth(owner.token)).send({ seq: second.seq });
  assert.deepEqual(await chatItems(owner), [], 'read to the newest: the item is gone');
});

test('a dismissed item is not resurrected by a deletion, only by a new message', async () => {
  const { owner, guest, base } = await sharedRound('ci-dismiss');
  await post(base, guest, 'a');
  const doomed = (await post(base, guest, 'b')).body;
  const [item] = await chatItems(owner);
  assert.equal((await request(app).delete(`/api/account/inbox/${item.id}`).set(auth(owner.token))).status, 204);

  assert.equal((await request(app).delete(`${base}/${doomed.id}`).set(auth(guest.token))).status, 204);
  assert.deepEqual(await chatItems(owner), [], 'lowering the count must not bring a dismissed item back');

  await post(base, guest, 'c');
  const back = await chatItems(owner);
  assert.equal(back.length, 1, 'a new message does');
  assert.equal(back[0].payload.count, 2);
});

test('deleting messages lowers the count, and removes the item when nothing unread is left', async () => {
  const { owner, guest, base } = await sharedRound('ci-delete');
  const a = (await post(base, guest, 'a')).body;
  const b = (await post(base, guest, 'b')).body;
  await request(app).delete(`${base}/${a.id}`).set(auth(guest.token));
  assert.equal((await chatItems(owner))[0].payload.count, 1);
  await request(app).delete(`${base}/by-author/${b.id}`).set(auth(owner.token));
  assert.deepEqual(await chatItems(owner), []);
});

test('the Konto switch stops new items, still lets an old one clear, and refuses a non-boolean', async () => {
  const { owner, guest, base } = await sharedRound('ci-pref');
  const me = await request(app).get('/api/account/me').set(auth(owner.token));
  assert.equal(me.body.notifyChatInbox, true, 'on by default');
  assert.equal(meProjection({ id: 'legacy', email: 'x@example.com' }).notifyChatInbox, true,
    'an account predating the key reads as ON');

  const m = (await post(base, guest, 'vorher')).body;
  assert.equal((await request(app).patch('/api/account/me').set(auth(owner.token)).send({ notifyChatInbox: 'false' })).status, 400);
  const off = await request(app).patch('/api/account/me').set(auth(owner.token)).send({ notifyChatInbox: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.notifyChatInbox, false);

  // The existing item still follows the thread — it just gets no fresh one.
  await request(app).post(`${base}/read`).set(auth(owner.token)).send({ seq: m.seq });
  assert.deepEqual(await chatItems(owner), []);
  await post(base, guest, 'nachher');
  assert.deepEqual(await chatItems(owner), [], 'switched off: no new item');
});

test('a revoked share and a deleted round take the thread\'s items with them', async () => {
  const { owner, guest, round, base } = await sharedRound('ci-gone');
  await post(base, owner, 'an den Gast');
  assert.equal((await chatItems(guest)).length, 1);
  await request(app).delete(`/api/rounds/${round.id}/shares/${guest.user.id}`).set(auth(owner.token)).expect(204);
  assert.deepEqual(await chatItems(guest), [], 'a removed grantee keeps no item leading to a 404');

  const next = await sharedRound('ci-gone2');
  await post(next.base, next.guest, 'an den Owner');
  await post(next.base, next.owner, 'an den Gast');
  assert.equal((await chatItems(next.owner)).length, 1);
  assert.equal((await chatItems(next.guest)).length, 1);
  await request(app).delete(`/api/rounds/${next.round.id}`).set(auth(next.owner.token)).expect(200);
  assert.deepEqual(await chatItems(next.owner), []);
  assert.deepEqual(await chatItems(next.guest), [], 'the grantee\'s item went too, though the grant went first');
});
