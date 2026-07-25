'use strict';

/*
 * Friendships & the Freundeskreis feed (issue #325) over HTTP.
 *
 * The guarantees pinned here:
 *  - a request by username lands in the addressee's inbox; only the addressee can
 *    accept; decline/unfriend are silent and effective both ways;
 *  - the feed shows a friend's game_added / session_played with the game title and
 *    the friend's username — and NOTHING about the round (no member name, score,
 *    vote or round name can enter a feed payload), which is the isolation point;
 *  - only events created AFTER the friendship was accepted are shown;
 *  - per-account caps refuse with distinct 403 codes;
 *  - with accounts OFF every friend route 404s (tested on a fresh app).
 *
 * Accounts must be ON, so this drives real accounts (register → verify → login),
 * mirroring test/invitations.test.js.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeAccount(email) {
  await request(app).post('/api/account/register').send({ email, username: handle(email), password: PASSWORD });
  // The mailed link is one combined token since #434; assert the match so a
  // future shape change fails here loudly instead of throwing on m[1].
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email), username: handle(email) };
}

const inbox = (a) => request(app).get('/api/account/inbox').set(auth(a.token)).then((r) => r.body.items);
const sendReq = (from, username) => request(app).post('/api/account/friends').set(auth(from.token)).send({ username });
const listFriends = (a) => request(app).get('/api/account/friends').set(auth(a.token)).then((r) => r.body);
const getFeed = (a) => request(app).get('/api/account/friends/feed').set(auth(a.token)).then((r) => r.body);
const makeRound = (a, members) =>
  request(app).post('/api/rounds').set(auth(a.token)).send({ name: 'Runde', members }).then((r) => r.body);
async function addGame(a, rid, title) {
  const req = request(app).post(`/api/rounds/${rid}/games`).set(auth(a.token));
  for (const [k, v] of Object.entries({ title, minPlayers: '2', maxPlayers: '4' })) req.field(k, v);
  return req.then((r) => r.body);
}

test('send: known user, self/unknown rejected, inbox item lands, duplicates refused', async () => {
  const alice = await makeAccount('fr-alice@example.com');
  const bob = await makeAccount('fr-bob@example.com');

  // Unknown username 404 (a username is public, so no anti-enumeration hiding).
  assert.equal((await sendReq(alice, 'nobody-xyz')).status, 404);
  // Self-request rejected.
  assert.equal((await sendReq(alice, alice.username)).body.error, 'cannot_friend_self');

  // Valid send → 201, and a friend_request lands in Bob's inbox with Alice's handle.
  const ok = await sendReq(alice, bob.username);
  assert.equal(ok.status, 201);
  const item = (await inbox(bob)).find((i) => i.type === 'friend_request');
  assert.ok(item);
  assert.equal(item.payload.requesterUsername, alice.username);
  assert.ok(item.payload.friendshipId);

  // A second request for the same pair, either direction, is refused (pending).
  assert.equal((await sendReq(alice, bob.username)).status, 409);
  assert.equal((await sendReq(bob, alice.username)).body.error, 'request_pending');

  // It shows as outgoing for Alice, incoming for Bob — never as a friend yet.
  assert.equal((await listFriends(alice)).outgoing.length, 1);
  assert.equal((await listFriends(alice)).friends.length, 0);
  assert.equal((await listFriends(bob)).incoming[0].username, alice.username);
});

test('accept: only the addressee, once; both see the friendship; inbox cleared', async () => {
  const alice = await makeAccount('ac-alice@example.com');
  const bob = await makeAccount('ac-bob@example.com');
  const carol = await makeAccount('ac-carol@example.com');
  await sendReq(alice, bob.username);
  const fid = (await inbox(bob)).find((i) => i.type === 'friend_request').payload.friendshipId;

  const accept = (a) => request(app).post(`/api/account/friends/${fid}/accept`).set(auth(a.token));
  // The requester can't accept their own request; a stranger can't either.
  assert.equal((await accept(alice)).status, 404);
  assert.equal((await accept(carol)).status, 404);

  assert.equal((await accept(bob)).status, 200);
  // Both now list each other as a friend, and Bob's inbox item is gone.
  assert.equal((await listFriends(alice)).friends[0].username, bob.username);
  assert.equal((await listFriends(bob)).friends[0].username, alice.username);
  assert.equal((await inbox(bob)).some((i) => i.type === 'friend_request'), false);
  // A second accept is now a no-op (not pending) → 404.
  assert.equal((await accept(bob)).status, 404);
  // A fresh request between an accepted pair is refused with 'already_friends'.
  assert.equal((await sendReq(bob, alice.username)).body.error, 'already_friends');
});

test('decline and unfriend: silent, effective both ways', async () => {
  const alice = await makeAccount('un-alice@example.com');
  const bob = await makeAccount('un-bob@example.com');

  // Decline: Bob rejects Alice's request → gone for both, no notification to Alice.
  await sendReq(alice, bob.username);
  const fid1 = (await inbox(bob)).find((i) => i.type === 'friend_request').payload.friendshipId;
  assert.equal((await request(app).post(`/api/account/friends/${fid1}/decline`).set(auth(bob.token))).status, 204);
  assert.equal((await listFriends(alice)).outgoing.length, 0);
  assert.equal((await inbox(alice)).length, 0); // decline is silent

  // Now befriend, then unfriend from Alice's side → gone for Bob too.
  await sendReq(alice, bob.username);
  const fid2 = (await inbox(bob)).find((i) => i.type === 'friend_request').payload.friendshipId;
  await request(app).post(`/api/account/friends/${fid2}/accept`).set(auth(bob.token));
  assert.equal((await request(app).delete(`/api/account/friends/${fid2}`).set(auth(alice.token))).status, 204);
  assert.equal((await listFriends(alice)).friends.length, 0);
  assert.equal((await listFriends(bob)).friends.length, 0);
  // Unfriending a non-existent friendship id is a clean 404.
  assert.equal((await request(app).delete(`/api/account/friends/${fid2}`).set(auth(alice.token))).status, 404);
});

test('feed: shows a friend\'s game title + username, only post-friendship, no round data', async () => {
  const alice = await makeAccount('fd-alice@example.com');
  const bob = await makeAccount('fd-bob@example.com');
  const round = await makeRound(alice, ['Anna', 'Bob']);

  // A game Alice adds BEFORE the friendship must not appear in Bob's feed.
  await addGame(alice, round.id, 'OldGame');
  await sleep(20);

  await sendReq(alice, bob.username);
  const fid = (await inbox(bob)).find((i) => i.type === 'friend_request').payload.friendshipId;
  await request(app).post(`/api/account/friends/${fid}/accept`).set(auth(bob.token));

  await sleep(20);
  await addGame(alice, round.id, 'Azul');

  const feed = await getFeed(bob);
  assert.equal(feed.friendCount, 1);
  const titles = feed.events.map((e) => e.title);
  assert.equal(titles.includes('Azul'), true);
  assert.equal(titles.includes('OldGame'), false); // created before the friendship
  const ev = feed.events.find((e) => e.title === 'Azul');
  assert.equal(ev.type, 'game_added');
  assert.equal(ev.username, alice.username);
  // The isolation point: a feed event carries ONLY these fields — never a member
  // name, score, vote or round name.
  assert.deepEqual(Object.keys(ev).sort(), ['at', 'coverUrl', 'title', 'type', 'username']);

  // Alice sees an empty feed (Bob has added nothing) but the same friendCount.
  const aliceFeed = await getFeed(alice);
  assert.equal(aliceFeed.friendCount, 1);
  assert.equal(aliceFeed.events.length, 0);
});

test('caps: open outgoing requests are bounded with a distinct 403', async () => {
  const prev = process.env.MAX_FRIEND_REQUESTS_PER_USER;
  process.env.MAX_FRIEND_REQUESTS_PER_USER = '1';
  try {
    const alice = await makeAccount('cap-alice@example.com');
    const bob = await makeAccount('cap-bob@example.com');
    const carol = await makeAccount('cap-carol@example.com');
    assert.equal((await sendReq(alice, bob.username)).status, 201);
    // Second open request exceeds the cap → 403 quota_requests.
    const over = await sendReq(alice, carol.username);
    assert.equal(over.status, 403);
    assert.equal(over.body.error, 'quota_requests');
  } finally {
    if (prev === undefined) delete process.env.MAX_FRIEND_REQUESTS_PER_USER;
    else process.env.MAX_FRIEND_REQUESTS_PER_USER = prev;
  }
});

test('accounts off: every friend route 404s accounts_disabled', async () => {
  // A fresh app with accounts disabled (the shared helpers app has them on).
  const { createApp } = require('../lib/app');
  const prevEnabled = process.env.ACCOUNTS_ENABLED;
  const prevPw = process.env.AUTH_PASSWORD;
  delete process.env.ACCOUNTS_ENABLED;
  delete process.env.AUTH_PASSWORD; // no shared gate either, so the route (not the gate) answers
  try {
    const off = createApp();
    for (const r of [
      request(off).get('/api/account/friends'),
      request(off).get('/api/account/friends/feed'),
      request(off).post('/api/account/friends').send({ username: 'x' }),
      request(off).post('/api/account/friends/abc/accept'),
      request(off).delete('/api/account/friends/abc'),
    ]) {
      const res = await r;
      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'accounts_disabled');
    }
  } finally {
    if (prevEnabled === undefined) delete process.env.ACCOUNTS_ENABLED;
    else process.env.ACCOUNTS_ENABLED = prevEnabled;
    if (prevPw !== undefined) process.env.AUTH_PASSWORD = prevPw;
  }
});
