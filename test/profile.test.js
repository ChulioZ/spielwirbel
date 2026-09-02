'use strict';

/*
 * Public account profiles (issue #558) over HTTP.
 *
 * The guarantees pinned here:
 *  - the four friendship states are reported from the CALLER's own rows, so
 *    "incoming" and "outgoing" are the same two accounts seen from either side;
 *  - the three refusals: an unknown handle and a SUSPENDED account answer the
 *    identical 404 user_not_found, and with accounts OFF every path 404s
 *    accounts_disabled;
 *  - matching is case-insensitive, consistent with getUserByUsername;
 *  - the feed appears only between accepted friends and keeps /friends/feed's
 *    acceptedAt cutoff — a fresh friendship must not expose prior history;
 *  - the profile discloses no e-mail address and nothing tenant-private;
 *  - a GUEST DEMO account is refused outright (#877), so the picture stays
 *    behind a real sign-in as vvt.md row 4 and the policy both state.
 *
 * Accounts must be ON, so this drives real accounts (register → verify → login),
 * mirroring test/friends.test.js.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
// #877 needs a real demo token, and demoEnabled() reads this at call time.
process.env.DEMO_ENABLED = 'true';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');

const PASSWORD = 'correct horse battery';
const handle = (email) => email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeAccount(email) {
  await request(app).post('/api/account/register').send({ email, username: handle(email), password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email), username: handle(email) };
}

const profile = (viewer, username) =>
  request(app).get(`/api/account/profile/${encodeURIComponent(username)}`).set(auth(viewer.token));
const sendReq = (from, username) => request(app).post('/api/account/friends').set(auth(from.token)).send({ username });
const inbox = (a) => request(app).get('/api/account/inbox').set(auth(a.token)).then((r) => r.body.items);
const makeRound = (a, members) =>
  request(app).post('/api/rounds').set(auth(a.token)).send({ name: 'Runde', members }).then((r) => r.body);
async function addGame(a, rid, title) {
  const req = request(app).post(`/api/rounds/${rid}/games`).set(auth(a.token));
  for (const [k, v] of Object.entries({ title, minPlayers: '2', maxPlayers: '4' })) req.field(k, v);
  return req.then((r) => r.body);
}

// Befriend two accounts, returning the friendship id.
async function befriend(a, b) {
  await sendReq(a, b.username);
  const fid = (await inbox(b)).find((i) => i.type === 'friend_request').payload.friendshipId;
  await request(app).post(`/api/account/friends/${fid}/accept`).set(auth(b.token));
  return fid;
}

test('a stranger profile: username + createdAt, friendship none, no e-mail', async () => {
  const alice = await makeAccount('pf-alice@example.com');
  const bob = await makeAccount('pf-bob@example.com');

  const res = await profile(alice, bob.username);
  assert.equal(res.status, 200);
  assert.equal(res.body.username, bob.username);
  assert.equal(res.body.userId, bob.user.id);
  assert.equal(res.body.friendship, 'none');
  assert.equal(res.body.self, false);
  assert.ok(res.body.createdAt, 'the registration date is what "Mitglied seit" renders');

  // The disclosure boundary: the profile carries the public handle and the
  // registration date and nothing else about the account. A field added here
  // later is a new disclosure needing policy §5 + vvt.md (#558).
  // `avatar` (#841) joined the list, and it went through exactly the gate this
  // comment names: privacy policy §5/§6 + docs/legal/vvt.md, with a
  // PRIVACY_REVISION bump. It is a picture the account chose to publish under
  // its own handle — deliberately narrower than it looks, since /uploads is
  // readable only by an authenticated caller, which the profile already is.
  assert.deepEqual(Object.keys(res.body).sort(),
    ['avatar', 'createdAt', 'friendship', 'self', 'userId', 'username']);
  assert.equal(JSON.stringify(res.body).includes('pf-bob@example.com'), false);
});

test('the four friendship states are reported from the caller\'s own rows', async () => {
  const alice = await makeAccount('st-alice@example.com');
  const bob = await makeAccount('st-bob@example.com');

  // none, both ways.
  assert.equal((await profile(alice, bob.username)).body.friendship, 'none');

  // A pending request is 'outgoing' for the sender and 'incoming' for the
  // addressee — the same row, read from either side.
  await sendReq(alice, bob.username);
  const out = await profile(alice, bob.username);
  assert.equal(out.body.friendship, 'outgoing');
  const inc = await profile(bob, alice.username);
  assert.equal(inc.body.friendship, 'incoming');
  // Both carry the id the accept/decline/cancel buttons need, and it is one row.
  assert.equal(out.body.friendshipId, inc.body.friendshipId);

  // accepted → 'friends' for both, with the since date the view renders.
  const fid = (await inbox(bob)).find((i) => i.type === 'friend_request').payload.friendshipId;
  await request(app).post(`/api/account/friends/${fid}/accept`).set(auth(bob.token));
  for (const [viewer, subject] of [[alice, bob], [bob, alice]]) {
    const res = await profile(viewer, subject.username);
    assert.equal(res.body.friendship, 'friends');
    assert.equal(res.body.friendshipId, fid);
    assert.ok(res.body.since, 'accepted friendships carry the "Freunde seit" date');
  }
});

test('your own handle reports self with no friendship to act on', async () => {
  const alice = await makeAccount('self-alice@example.com');
  const res = await profile(alice, alice.username);
  assert.equal(res.status, 200);
  assert.equal(res.body.self, true);
  assert.equal(res.body.friendship, 'none');
  // No friendshipId: there is no relationship, so the view offers no CTA.
  assert.equal('friendshipId' in res.body, false);
});

test('matching the handle is case-insensitive', async () => {
  const alice = await makeAccount('ci-alice@example.com');
  const bob = await makeAccount('ci-bob@example.com');
  const res = await profile(alice, bob.username.toUpperCase());
  assert.equal(res.status, 200);
  // The CANONICAL spelling comes back, not what was asked for — which is what
  // lets the view re-apply the chrome from the stored casing.
  assert.equal(res.body.username, bob.username);
});

test('an unknown handle and a SUSPENDED account answer the identical 404', async () => {
  const alice = await makeAccount('sus-alice@example.com');
  const bob = await makeAccount('sus-bob@example.com');

  const unknown = await profile(alice, 'nobody-xyz');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'user_not_found');

  // Suspension is an operator moderation action (#268); an account that stayed
  // browsable through here would be a hole in it. The check has to live in this
  // route — lib/tenant.js enforces suspension on the /api gate, which the
  // account surface sits ahead of.
  assert.equal((await profile(alice, bob.username)).status, 200);
  await repo.updateUser(bob.user.id, { disabled: new Date().toISOString() });
  const suspended = await profile(alice, bob.username);
  assert.equal(suspended.status, 404);
  assert.deepEqual(suspended.body, unknown.body, 'a suspended account must be indistinguishable from an unknown one');
});

test('the feed is friends-only and keeps the acceptedAt cutoff', async () => {
  const alice = await makeAccount('pfd-alice@example.com');
  const bob = await makeAccount('pfd-bob@example.com');
  const round = await makeRound(alice, ['Anna', 'Bob']);

  // Added BEFORE the friendship: must never appear.
  await addGame(alice, round.id, 'OldGame');
  await sleep(20);

  // A stranger's profile carries no feed at all.
  assert.equal('events' in (await profile(bob, alice.username)).body, false);

  await befriend(alice, bob);
  await sleep(20);
  await addGame(alice, round.id, 'Azul');

  const res = await profile(bob, alice.username);
  assert.equal(res.body.friendship, 'friends');
  const titles = res.body.events.map((e) => e.title);
  assert.equal(titles.includes('Azul'), true);
  assert.equal(titles.includes('OldGame'), false, 'a new friend must not see history predating the friendship');

  // Same isolation point as /friends/feed: an event carries ONLY these fields —
  // never a member name, score, vote or round name. `username` is absent here
  // because every event on a profile belongs to that one account.
  const ev = res.body.events.find((e) => e.title === 'Azul');
  assert.deepEqual(Object.keys(ev).sort(), ['at', 'coverUrl', 'title', 'type']);
});

/* #856: the profile feed is the SECOND read site, and a fix applied only to
   /friends/feed would leave a friend's own profile showing the same evening three
   times. The interrupted run is what makes this a collapse rather than a de-dupe. */
test('the feed collapses a run of duplicates, but not one broken by another event', async () => {
  const alice = await makeAccount('pdup-alice@example.com');
  const bob = await makeAccount('pdup-bob@example.com');
  await befriend(alice, bob);
  await sleep(20);

  // Written straight to the store: these model the rows the pre-#856 routes left
  // in production, which no guard can retroactively remove.
  const play = (title) => repo.addFeedEvent(alice.user.id, { type: 'session_played', title });
  await play('Catan');
  await play('Catan');
  await play('Azul');
  await play('Catan');

  const titles = (await profile(bob, alice.username)).body.events.map((e) => e.title);
  assert.deepEqual(titles, ['Catan', 'Azul', 'Catan'], 'newest first: the run folds, the split pair does not');
});

test('the profile requires a token, and 404s with accounts off', async () => {
  const alice = await makeAccount('gate-alice@example.com');

  // No Bearer token at all → 401, before any lookup.
  assert.equal((await request(app).get(`/api/account/profile/${alice.username}`)).status, 401);

  const { createApp } = require('../lib/app');
  const prevEnabled = process.env.ACCOUNTS_ENABLED;
  const prevPw = process.env.AUTH_PASSWORD;
  delete process.env.ACCOUNTS_ENABLED;
  delete process.env.AUTH_PASSWORD; // no shared gate either, so the route (not the gate) answers
  try {
    const off = createApp();
    const res = await request(off).get('/api/account/profile/anyone');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'accounts_disabled');
  } finally {
    if (prevEnabled === undefined) delete process.env.ACCOUNTS_ENABLED;
    else process.env.ACCOUNTS_ENABLED = prevEnabled;
    if (prevPw === undefined) delete process.env.AUTH_PASSWORD;
    else process.env.AUTH_PASSWORD = prevPw;
  }
});

test('a guest demo account is refused the profile, picture included (#877)', async () => {
  const alice = await makeAccount('pdemo-alice@example.com');
  // Written straight to the store rather than uploaded: what matters here is
  // that the field is populated, not how it got there.
  await repo.updateUser(alice.user.id, { avatar: '/uploads/0123456789abcdef.webp' });

  const started = await request(app).post('/api/account/demo').send({});
  assert.equal(started.status, 200, 'DEMO_ENABLED is on for this file');

  const res = await request(app)
    .get(`/api/account/profile/${encodeURIComponent(alice.username)}`)
    .set(auth(started.body.accessToken));
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'demo_forbidden');
  assert.equal(JSON.stringify(res.body).includes('.webp'), false, 'no picture path leaks in the refusal');

  // The refusal must not depend on the handle existing, or the demo surface
  // becomes a username oracle the signed-in surface deliberately is not.
  const unknown = await request(app)
    .get('/api/account/profile/nobody-by-that-name')
    .set(auth(started.body.accessToken));
  assert.equal(unknown.status, 403);
  assert.equal(unknown.body.error, 'demo_forbidden');

  // The control, without which this passes against a route that refuses
  // everyone: a real account still gets the whole profile.
  const bob = await makeAccount('pdemo-bob@example.com');
  const ok = await profile(bob, alice.username);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.avatar, '/uploads/0123456789abcdef.webp');
});
