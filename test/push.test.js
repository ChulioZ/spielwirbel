'use strict';

/*
 * Web push for chat messages (#1785) over HTTP: the settings router, and what a
 * new message in a round thread, a session thread or a direct conversation sends
 * — through a stubbed transport, so the exact payload is asserted. Accounts ON,
 * VAPID set. The store on both backends is test/support/push-contract.js.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.VAPID_PUBLIC_KEY = 'BTestPublicKey';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';
process.env.VAPID_SUBJECT = 'mailto:operator@example.com';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const push = require('../lib/push');
const { isAllowedPushEndpoint } = require('../lib/routes/push');
const { outbox } = require('../lib/mail');
const { recentLogs, clearLogs } = require('../lib/observability');

const PASSWORD = 'correct horse battery';
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const KEYS = { p256dh: 'BPp256dhtestkey00000000', auth: 'authtestkey0' };
let n = 0;

async function makeAccount(prefix) {
  n += 1;
  const username = `${prefix}-${n}`;
  const email = `${username}@example.com`;
  await request(app).post('/api/account/register').send({ email, username, password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  const user = await repo.getUserByEmail(email);
  return { token: login.body.accessToken, user, id: user.id, username };
}

async function subscribe(who, { endpoint = `https://fcm.googleapis.com/fcm/send/${who.id}-${n}`, locale = 'de' } = {}) {
  const res = await request(app).put('/api/account/push/subscription').set(auth(who.token))
    .send({ endpoint, keys: KEYS, locale });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return endpoint;
}

async function sharedRound(prefix) {
  const owner = await makeAccount(`${prefix}-owner`);
  const guest = await makeAccount(`${prefix}-guest`);
  const round = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Pushrunde', members: ['Bo'] })).body;
  await repo.createGrant({ roundId: round.id, ownerTenantId: owner.user.tenantId, userId: guest.user.id, role: 'editor' });
  return { owner, guest, round, base: `/api/rounds/${round.id}/messages` };
}

// Every send the app makes, with the parsed payload. `fail` maps an endpoint to
// the status code the "push service" answers it with.
let sent = [];
let fail = new Map();
beforeEach(() => {
  sent = [];
  fail = new Map();
  push.resetCollapse();
  push.setSender(async (sub, body, options) => {
    sent.push({ endpoint: sub.endpoint, keys: sub.keys, payload: JSON.parse(body), options });
    if (fail.has(sub.endpoint)) throw Object.assign(new Error('push service says no'), { statusCode: fail.get(sub.endpoint) });
    return { statusCode: 201 };
  });
});

test('the config flag and GET / report push as available with the public key', async () => {
  const cfg = await request(app).get('/api/config');
  assert.equal(cfg.body.push, true);
  const me = await makeAccount('push-get');
  const res = await request(app).get('/api/account/push').set(auth(me.token));
  assert.deepEqual(res.body, { available: true, publicKey: 'BTestPublicKey', mutes: [] });
});

test('a round message pushes every OTHER subscribed member once — thread name, fixed line, no text', async () => {
  const { owner, guest, round, base } = await sharedRound('push-round');
  const ep = await subscribe(guest, { locale: 'de' });
  await subscribe(owner);
  const MESSAGE_TEXT = 'Geheimer-Inhalt-91c';
  const res = await request(app).post(base).set(auth(owner.token)).send({ text: MESSAGE_TEXT });
  assert.equal(res.status, 201);
  assert.equal(sent.length, 1, 'the guest only — never the author');
  assert.equal(sent[0].endpoint, ep);
  assert.deepEqual(sent[0].payload, {
    title: 'Pushrunde', body: push.newMessageLine('de'), url: `/round/${round.id}/chat`, tag: `round:${round.id}`,
  });
  assert.ok(!JSON.stringify(sent[0]).includes(MESSAGE_TEXT), 'the message text is nowhere in the push');
  assert.ok(push.newMessageLine('de') && push.newMessageLine('de') !== push.newMessageLine('en'), 'localised');
  assert.match(sent[0].options.topic, /^[A-Za-z0-9_-]{1,32}$/, 'a valid Topic header, not the raw key');

  // The author exclusion is NOT redundant with the recount: an author who has
  // unread messages from someone else has a non-zero count when they post, and
  // would be pushed about their own message. The guest writes first, so the
  // owner holds one unread when posting.
  push.resetCollapse();
  await request(app).post(base).set(auth(guest.token)).send({ text: 'vorher' });
  sent = [];
  await request(app).post(base).set(auth(owner.token)).send({ text: 'danach' });
  assert.deepEqual(sent.map((x) => x.endpoint), [ep], 'only the guest — the owner is not pushed about their own post');
});

test('an unread burst collapses inside the window; the first unread after a read always pushes', async () => {
  const { owner, guest, round, base } = await sharedRound('push-collapse');
  await subscribe(guest);
  await request(app).post(base).set(auth(owner.token)).send({ text: 'eins' });
  await request(app).post(base).set(auth(owner.token)).send({ text: 'zwei' });
  assert.equal(sent.length, 1, 'the second unread message is the same burst');
  // The guest reads the thread: the next message is the first unread again.
  const page = await request(app).get(base).set(auth(guest.token));
  const top = page.body.messages[page.body.messages.length - 1].seq;
  await request(app).post(`${base}/read`).set(auth(guest.token)).send({ seq: top });
  await request(app).post(base).set(auth(owner.token)).send({ text: 'drei' });
  assert.equal(sent.length, 2, 'read, then a new message: pushed despite the window');
  assert.equal(sent[1].payload.tag, `round:${round.id}`);
});

test('the window expires: a still-unread thread pushes again after COLLAPSE_MS', async () => {
  const guest = await makeAccount('push-window');
  await subscribe(guest);
  const args = { thread: 'round:w1', name: 'W', url: '/round/w1/chat' };
  const t0 = 1_000_000;
  assert.equal(await push.notifyChat(guest.id, { ...args, unread: 1, now: t0 }), 1);
  assert.equal(await push.notifyChat(guest.id, { ...args, unread: 2, now: t0 + push.COLLAPSE_MS - 1 }), 0);
  assert.equal(await push.notifyChat(guest.id, { ...args, unread: 3, now: t0 + push.COLLAPSE_MS }), 1);
});

test('a muted round thread pushes nothing — and muting the round mutes its session comments too', async () => {
  const { owner, guest, round, base } = await sharedRound('push-mute');
  await subscribe(guest);
  const mute = await request(app).put('/api/account/push/mutes').set(auth(guest.token))
    .send({ thread: `round:${round.id}`, muted: true });
  assert.deepEqual(mute.body, { thread: `round:${round.id}`, muted: true });
  await request(app).post(base).set(auth(owner.token)).send({ text: 'still' });
  const session = await repo.createSession(owner.user.tenantId, round.id, {
    createdAt: new Date().toISOString(), gameIds: [], votes: {}, chosenGameId: null, chosenAt: null,
    finished: true, finishedAt: null, winnerIds: [], cancelled: false, cancelledAt: null, done: true,
  });
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/messages`).set(auth(owner.token))
    .send({ text: 'Kommentar' });
  assert.equal(sent.length, 0);
  await request(app).put('/api/account/push/mutes').set(auth(guest.token)).send({ thread: `round:${round.id}`, muted: false });
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/messages`).set(auth(owner.token))
    .send({ text: 'Noch einer' });
  assert.equal(sent.length, 1, 'unmuted: the comment pushes');
  assert.deepEqual(sent[0].payload, {
    title: 'Pushrunde', body: push.newMessageLine('de'),
    url: `/round/${round.id}/session/${session.id}`, tag: `session:${session.id}`,
  });
  // A session muted on its own stays quiet while the round does not.
  push.resetCollapse();
  await request(app).put('/api/account/push/mutes').set(auth(guest.token)).send({ thread: `session:${session.id}`, muted: true });
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/messages`).set(auth(owner.token)).send({ text: 'x' });
  await request(app).post(base).set(auth(owner.token)).send({ text: 'y' });
  assert.deepEqual(sent.slice(1).map((s) => s.payload.tag), [`round:${round.id}`]);
});

test('a direct message pushes the recipient, named after the author, and never the author', async () => {
  const ana = await makeAccount('push-dm');
  const ben = await makeAccount('push-dm');
  const f = await repo.createFriendRequest({ requesterUserId: ana.id, addresseeUserId: ben.id });
  await repo.acceptFriendRequest(f.id, ben.id);
  await subscribe(ana);
  await subscribe(ben, { locale: 'en' });
  await request(app).post(`/api/account/messages/${ben.id}`).set(auth(ana.token)).send({ text: 'Freitag?' });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].payload, {
    title: ana.username, body: push.newMessageLine('en'), url: `/freunde/nachrichten/${ana.id}`, tag: `dm:${ana.id}`,
  });
});

test('a 404/410 from the push service deletes that device; any other failure keeps it and logs no endpoint', async () => {
  const { owner, guest, base } = await sharedRound('push-dead');
  const dead = await subscribe(guest, { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/dead-one' });
  const flaky = await subscribe(guest, { endpoint: 'https://web.push.apple.com/flaky-one' });
  fail.set(dead, 410);
  fail.set(flaky, 500);
  clearLogs();
  const res = await request(app).post(base).set(auth(owner.token)).send({ text: 'hallo' });
  assert.equal(res.status, 201, 'a push failure never fails the post');
  assert.deepEqual((await repo.listPushSubscriptions(guest.id)).map((s) => s.endpoint), [flaky]);
  const logs = JSON.stringify(recentLogs());
  assert.match(logs, /push_send_failed/);
  assert.ok(!logs.includes('flaky-one') && !logs.includes('dead-one'), 'no endpoint in any log line');
});

test('opt-out and sign-out: DELETE forgets this device only, and is a no-op for an unknown one', async () => {
  const me = await makeAccount('push-out');
  const a = await subscribe(me, { endpoint: 'https://fcm.googleapis.com/fcm/send/out-a' });
  await subscribe(me, { endpoint: 'https://fcm.googleapis.com/fcm/send/out-b' });
  const res = await request(app).delete('/api/account/push/subscription').set(auth(me.token)).send({ endpoint: a });
  assert.equal(res.status, 200);
  assert.deepEqual((await repo.listPushSubscriptions(me.id)).map((s) => s.endpoint), ['https://fcm.googleapis.com/fcm/send/out-b']);
  const again = await request(app).delete('/api/account/push/subscription').set(auth(me.token)).send({ endpoint: a });
  assert.equal(again.status, 200);
});

test('only a known push service is accepted as an endpoint — the server fetches it', async () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QAbc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ]) assert.equal(isAllowedPushEndpoint(ok), true, ok);
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/abc',      // not https
    'https://fcm.googleapis.com:8443/x',           // odd port
    'https://user:pw@fcm.googleapis.com/x',        // credentials
    'https://fcm.googleapis.com.evil.example/x',   // suffix spoof
    'https://evilpush.apple.com/x',               // needs the leading dot of .push.apple.com
    'https://xnotify.windows.com/x',              // …and of .notify.windows.com
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/x',
    'not a url',
  ]) assert.equal(isAllowedPushEndpoint(bad), false, bad);
  const me = await makeAccount('push-ssrf');
  const res = await request(app).put('/api/account/push/subscription').set(auth(me.token))
    .send({ endpoint: 'https://127.0.0.1/hook', keys: KEYS });
  assert.equal(res.status, 400);
  assert.deepEqual(await repo.listPushSubscriptions(me.id), []);
});

test('a mute key must be a thread key; malformed keys are refused', async () => {
  const me = await makeAccount('push-keys');
  for (const thread of ['round:', 'chat:abc', 'round:a/b', `dm:${'x'.repeat(81)}`]) {
    const res = await request(app).put('/api/account/push/mutes').set(auth(me.token)).send({ thread, muted: true });
    assert.equal(res.status, 400, thread);
  }
});

test('a guest demo account is refused the whole router', async () => {
  const tourist = await makeAccount('push-demo');
  await repo.updateUser(tourist.id, { demo: true });
  for (const [method, url, body] of [
    ['get', '/api/account/push', {}],
    ['put', '/api/account/push/subscription', { endpoint: 'https://fcm.googleapis.com/fcm/send/demo', keys: KEYS }],
  ]) {
    const res = await request(app)[method](url).set(auth(tourist.token)).send(body);
    assert.equal(res.status, 403, `${method} ${url}`);
    assert.equal(res.body.error, 'demo_forbidden');
  }
  assert.deepEqual(await repo.listPushSubscriptions(tourist.id), []);
});
