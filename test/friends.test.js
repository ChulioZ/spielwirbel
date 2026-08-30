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
// The per-account feed cap (#325, default 50) equals the route's FEED_SHOW, so a
// spec cannot store more rows than one page holds — which is exactly what the
// collapse-before-slice assertion below needs. Raised out of reach here;
// lib/repo/*.js read it per call. Nothing else in this file depends on it.
process.env.MAX_FEED_EVENTS = '400';

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
async function addGame(a, rid, title, extra = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`).set(auth(a.token));
  for (const [k, v] of Object.entries({ title, minPlayers: '2', maxPlayers: '4', ...extra })) req.field(k, v);
  return req.then((r) => r.body);
}
// Befriend two accounts, returning the friendship id (mirrors test/profile.test.js).
async function befriend(a, b) {
  await sendReq(a, b.username);
  const fid = (await inbox(b)).find((i) => i.type === 'friend_request').payload.friendshipId;
  await request(app).post(`/api/account/friends/${fid}/accept`).set(auth(b.token));
  return fid;
}
const sess = (a, rid, path, body) =>
  request(app).post(`/api/rounds/${rid}/sessions${path}`).set(auth(a.token)).send(body);
// What the store actually holds for one account — the emit-guard specs must read
// THIS and not the feed route, whose collapse would make them pass against a
// route that still emits per request.
const stored = (a, type) =>
  repo.listFeedEvents([a.user.id], 200).then((rows) => rows.filter((e) => e.type === type));

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
  assert.deepEqual(Object.keys(ev).sort(), ['at', 'avatar', 'coverUrl', 'title', 'type', 'username']);

  // Alice sees an empty feed (Bob has added nothing) but the same friendCount.
  const aliceFeed = await getFeed(alice);
  assert.equal(aliceFeed.friendCount, 1);
  assert.equal(aliceFeed.events.length, 0);
});

/* A wish (#560) is a game the group does NOT own, so it must not be announced
   to anyone's Freundeskreis as "‹Alice› hat ‹Spiel› ins Regal gestellt" — the
   line the feed renders for a `game_added`. The event fires later, once the game
   actually reaches the shelf.

   This needs accounts and a real friendship, which is why it lives here rather
   than beside the other wish specs in test/games.test.js: `emitFeedEvent` is a
   no-op without `req.userId`, so an accounts-off spec asserting "no event" would
   pass against a route that emits one unconditionally. */
test('feed: a wish is not announced; putting it on the shelf is', async () => {
  const alice = await makeAccount('wish-alice@example.com');
  const bob = await makeAccount('wish-bob@example.com');
  const round = await makeRound(alice, ['Anna']);

  await sendReq(alice, bob.username);
  const fid = (await inbox(bob)).find((i) => i.type === 'friend_request').payload.friendshipId;
  await request(app).post(`/api/account/friends/${fid}/accept`).set(auth(bob.token));
  await sleep(20);

  const wish = await addGame(alice, round.id, 'Wanted', { wish: 'true' });
  assert.equal(wish.wish, true, 'the fixture really created a wish');
  // Anti-vacuous: an ordinary add in the same window DOES reach the feed, so a
  // silent feed below cannot be the friendship or the timing being wrong.
  await addGame(alice, round.id, 'Owned');

  let titles = (await getFeed(bob)).events.map((e) => e.title);
  assert.equal(titles.includes('Owned'), true, 'an ordinary add must reach the feed');
  assert.equal(titles.includes('Wanted'), false, 'a wish must not be announced to friends');

  await sleep(20);
  await request(app)
    .post(`/api/rounds/${round.id}/games/${wish.id}/wish`)
    .set(auth(alice.token))
    .send({ wish: false });

  titles = (await getFeed(bob)).events.map((e) => e.title);
  assert.equal(titles.filter((x) => x === 'Wanted').length, 1,
    'reaching the shelf announces it exactly once');
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

/* #856: the results screen has no save button — every winner-chip tap re-POSTs
   …/finish with `finished: true`, so an unconditional emit stored one row per
   TAP and friends saw the same evening three times. The guard is a transition
   check, and these assertions read the STORE rather than the feed route: the
   read-side collapse below would hide a missing guard entirely. */
test('feed: repeated finish saves store one play; a reset and re-finish is a new one', async () => {
  const alice = await makeAccount('fin-alice@example.com');
  const bob = await makeAccount('fin-bob@example.com');
  await befriend(alice, bob);

  const round = await makeRound(alice, ['Anna', 'Bob']);
  const game = await addGame(alice, round.id, 'Catan');
  const session = (await sess(alice, round.id, '', {})).body.session;
  await sess(alice, round.id, `/${session.id}/choice`, { gameId: game.id });

  // Three saves, as three winner-chip taps produce.
  const winner = round.members[0].id;
  await sess(alice, round.id, `/${session.id}/finish`, { winnerIds: [] });
  await sess(alice, round.id, `/${session.id}/finish`, { winnerIds: [winner] });
  await sess(alice, round.id, `/${session.id}/finish`, { winnerIds: [winner] });
  assert.equal((await stored(alice, 'session_played')).length, 1, 'one play, one stored event');

  // Un-finishing announces nothing on its own.
  await sess(alice, round.id, `/${session.id}/finish`, { finished: false });
  assert.equal((await stored(alice, 'session_played')).length, 1);

  // …but a reset is a real un-play, so finishing again IS a second play.
  await sess(alice, round.id, `/${session.id}/finish`, { winnerIds: [winner] });
  assert.equal((await stored(alice, 'session_played')).length, 2);

  // Bob still sees one line: the two rows are the same evening, so the read-side
  // collapse folds them. Two plays a day apart is the case that stays two, and
  // test/feed.test.js pins the window that separates them.
  const played = (await getFeed(bob)).events.filter((e) => e.type === 'session_played');
  assert.deepEqual(played.map((e) => e.title), ['Catan']);
});

test('feed: repeated „Ins Regal" saves store one acquisition, and the feed shows one', async () => {
  const alice = await makeAccount('shelf-alice@example.com');
  const bob = await makeAccount('shelf-bob@example.com');
  await befriend(alice, bob);

  const round = await makeRound(alice, ['Anna']);
  const wish = await addGame(alice, round.id, 'Wanted', { wish: 'true' });
  const shelve = (v) => request(app)
    .post(`/api/rounds/${round.id}/games/${wish.id}/wish`).set(auth(alice.token)).send({ wish: v });

  // Three identical „Ins Regal" saves: only the first is a transition.
  await shelve(false);
  await shelve(false);
  await shelve(false);
  assert.equal((await stored(alice, 'game_added')).length, 1, 'only the transition emits');

  // Back to the wish list and onto the shelf again: a genuine second acquisition,
  // so a second row is stored — and the feed collapses the pair into one line.
  await shelve(true);
  await shelve(false);
  assert.equal((await stored(alice, 'game_added')).length, 2);
  const added = (await getFeed(bob)).events.filter((e) => e.type === 'game_added');
  assert.deepEqual(added.map((e) => e.title), ['Wanted']);
});

/* Collapse happens BEFORE the FEED_SHOW slice. Collapsing after it would let
   duplicates eat the page — the feed would get shorter instead of cleaner — and
   only a store holding more than one page's worth can tell the two orders apart. */
test('feed: a run of stored duplicates does not shorten the returned page', async () => {
  const alice = await makeAccount('page-alice@example.com');
  const bob = await makeAccount('page-bob@example.com');
  await befriend(alice, bob);
  await sleep(20); // clear the acceptedAt cutoff

  for (let i = 0; i < 52; i++) await repo.addFeedEvent(alice.user.id, { type: 'game_added', title: `G${i}` });
  // Newest: a run of three identical rows, as the pre-#856 routes wrote.
  for (let i = 0; i < 3; i++) await repo.addFeedEvent(alice.user.id, { type: 'session_played', title: 'Dup' });

  const events = (await getFeed(bob)).events;
  assert.equal(events.length, 50, 'still a full page after the run collapsed');
  assert.equal(events.filter((e) => e.title === 'Dup').length, 1);
  assert.equal(new Set(events.map((e) => e.title)).size, 50, 'and 50 DISTINCT entries');
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
