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

const { app, store } = require('./helpers');
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

/* ------------------------- the self profile (#1089) ------------------------ */

test('#1089: the self profile carries its OWN stats and its own feed, uncut', async () => {
  const alice = await makeAccount('selfst-alice@example.com');
  const round = await makeRound(alice, ['Anna', 'Bob']);
  // Long before any friendship exists — the self feed has no cutoff to apply,
  // because there is no friendship to date one from.
  await addGame(alice, round.id, 'Azul');
  await sleep(20);

  const res = await profile(alice, alice.username);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.events.map((e) => e.title), ['Azul']);
  assert.ok(res.body.stats, 'the self profile always carries stats');
  // A fresh round with no finished session is the empty state, and it is a REAL
  // record rather than a missing key — the view keys its empty line off
  // `sessions === 0`, which it cannot do if the whole object is absent.
  assert.equal(res.body.stats.sessions, 0);
  assert.equal(res.body.stats.rounds, 1, 'the owner seat counts');
});

test('#1089: the subject sees their own stats even with statsVisible OFF', async () => {
  const alice = await makeAccount('selfoff-alice@example.com');
  await request(app).patch('/api/account/me').set(auth(alice.token)).send({ statsVisible: false });

  const res = await profile(alice, alice.username);
  // The toggle governs what FRIENDS see. Hiding a number from the person it is
  // about would make the setting unverifiable from the UI that offers it.
  assert.ok(res.body.stats, 'the switch is about friends, not about yourself');
});

test('#1089: stats reach an accepted friend only, and only while the toggle is on', async () => {
  const alice = await makeAccount('vis-alice@example.com');
  const bob = await makeAccount('vis-bob@example.com');

  // A STRANGER gets no stats key at all — absent, not empty, exactly like
  // `events`: `stats: null` would be indistinguishable from a blank record.
  assert.equal('stats' in (await profile(bob, alice.username)).body, false);

  // Nor does a PENDING request, in either direction.
  await sendReq(bob, alice.username);
  assert.equal('stats' in (await profile(bob, alice.username)).body, false);
  assert.equal('stats' in (await profile(alice, bob.username)).body, false);

  const fid = (await inbox(alice)).find((i) => i.type === 'friend_request').payload.friendshipId;
  await request(app).post(`/api/account/friends/${fid}/accept`).set(auth(alice.token));
  assert.ok((await profile(bob, alice.username)).body.stats, 'an accepted friend sees them by default');

  // Switched off, they disappear for the friend — and stay gone until it is back on.
  await request(app).patch('/api/account/me').set(auth(alice.token)).send({ statsVisible: false });
  assert.equal('stats' in (await profile(bob, alice.username)).body, false);
  await request(app).patch('/api/account/me').set(auth(alice.token)).send({ statsVisible: true });
  assert.ok((await profile(bob, alice.username)).body.stats);
});

/* „Dein Rückblick" (#1147): `plays` is the account's flat play list, and unlike
   `stats` it has been through NO friend-disclosure pass — so it is the SUBJECT's
   alone, whatever `statsVisible` says. A played session is seeded straight into
   the store because the HTTP path to a finished session is a dozen calls that
   test nothing about this route. */
async function seedPlayed(owner, title) {
  const round = await makeRound(owner, ['Anna', 'Bob']);
  const game = await addGame(owner, round.id, title);
  const stored = store.data.rounds.find((r) => r.id === round.id);
  const seat = stored.members.find((m) => m.userId === owner.user.id);
  stored.sessions.push({
    id: `s-${round.id}`, finished: true, cancelled: false,
    memberIds: stored.members.map((m) => m.id), winnerIds: [seat.id],
    gameIds: [game.id], chosenGameId: game.id,
    votes: { [seat.id]: { [game.id]: { rating: 4 } } },
    createdAt: '2026-03-05T19:00:00.000Z', finishedAt: '2026-03-05T22:00:00.000Z',
  });
  return stored;
}

test('#1147: plays reach the subject — never a stranger, a pending request or a friend', async () => {
  const alice = await makeAccount('plays-alice@example.com');
  const bob = await makeAccount('plays-bob@example.com');
  await seedPlayed(alice, 'Azul');

  const own = (await profile(alice, alice.username)).body;
  assert.equal(own.plays.length, 1, 'the self profile carries the play list');
  assert.equal(own.plays[0].title, 'Azul');
  assert.equal(own.plays[0].rating, 4);

  // Absent, never empty — the same shape as `stats` and `events`.
  assert.equal('plays' in (await profile(bob, alice.username)).body, false, 'a stranger');
  await sendReq(bob, alice.username);
  assert.equal('plays' in (await profile(bob, alice.username)).body, false, 'the pending sender');
  assert.equal('plays' in (await profile(alice, bob.username)).body, false, 'the pending addressee');

  const fid = (await inbox(alice)).find((i) => i.type === 'friend_request').payload.friendshipId;
  await request(app).post(`/api/account/friends/${fid}/accept`).set(auth(alice.token));
  // The sharpest case: statsVisible is ON, so the friend DOES get `stats` —
  // and must still not get `plays`.
  const friendView = (await profile(bob, alice.username)).body;
  assert.ok(friendView.stats, 'control: the friend sees the stats the toggle allows');
  assert.equal('plays' in friendView, false, 'an accepted friend with stats visible');
});

test('#1147: the play list names no round, round id, member or tenant — structurally', async () => {
  const alice = await makeAccount('plays-shape@example.com');
  const stored = await seedPlayed(alice, 'Brass');
  const { plays } = (await profile(alice, alice.username)).body;
  assert.equal(plays.length, 1);
  for (const row of plays) {
    assert.deepEqual(Object.keys(row).sort(), ['at', 'image', 'key', 'rating', 'title']);
  }
  const text = JSON.stringify(plays);
  const forbidden = [stored.id, stored.name, alice.user.tenantId,
    ...stored.members.map((m) => m.id), ...stored.members.map((m) => m.name)];
  for (const value of forbidden) {
    assert.ok(value && !text.includes(value), `the play list carries ${value}`);
  }
});

/* The legacy shape .claude/rules/defaulted-account-fields-need-a-legacy-shape-spec.md
   requires. Every account a spec can build is born carrying the key, so without
   deleting it by hand this file cannot tell `!== false` from `=== true` — and
   the wrong one would hide the feature from every account that predates it. */
test('#1089: a user row with no statsVisible key reads as VISIBLE', async () => {
  const alice = await makeAccount('legacy-alice@example.com');
  const bob = await makeAccount('legacy-bob@example.com');
  await befriend(alice, bob);

  const row = store.data.users.find((u) => u.id === alice.user.id);
  delete row.statsVisible;
  store.saveData();
  assert.equal('statsVisible' in store.data.users.find((u) => u.id === alice.user.id), false,
    'the key is really gone — a delete on a snapshot would silently do nothing');

  assert.ok((await profile(bob, alice.username)).body.stats,
    'an account predating the field must behave like one that never touched the toggle');
  assert.equal((await request(app).get('/api/account/me').set(auth(alice.token))).body.statsVisible, true);
});

test('#1089: statsVisible round-trips through /me and refuses a non-boolean', async () => {
  const alice = await makeAccount('pref-alice@example.com');
  const patch = (v) => request(app).patch('/api/account/me').set(auth(alice.token)).send({ statsVisible: v });

  assert.equal((await patch(false)).body.statsVisible, false);
  assert.equal((await request(app).get('/api/account/me').set(auth(alice.token))).body.statsVisible, false);

  // Strictly a boolean: the value is read back as `!== false`, so a stored
  // string 'false' would be honoured going in and read as VISIBLE forever.
  const bad = await patch('false');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_stats_pref');
  assert.equal((await request(app).get('/api/account/me').set(auth(alice.token))).body.statsVisible, false,
    'the refused write changed nothing');
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

test('a guest demo account is refused ANOTHER account\'s profile, picture included (#877)', async () => {
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

test('#1089: a demo sees its OWN profile, and that does not reopen the oracle', async () => {
  const started = await request(app).post('/api/account/demo').send({});
  assert.equal(started.status, 200);
  const token = started.body.accessToken;
  const mine = (await request(app).get('/api/account/me').set(auth(token))).body;
  assert.ok(mine.username, 'a demo account gets a username');

  // The self exception: the demo is the showcase, and a profile with nothing on
  // it showcases nothing.
  const own = await request(app)
    .get(`/api/account/profile/${encodeURIComponent(mine.username)}`)
    .set(auth(token));
  assert.equal(own.status, 200);
  assert.equal(own.body.self, true);
  assert.ok(own.body.stats, 'the seeded demo rounds give it real numbers');
  assert.ok(own.body.stats.sessions > 0, 'the seed plays sessions the demo account sits in');

  // Case-insensitively, like getUserByUsername — otherwise a typed URL in the
  // wrong case would 403 the visitor out of their own profile.
  assert.equal((await request(app)
    .get(`/api/account/profile/${encodeURIComponent(mine.username.toUpperCase())}`)
    .set(auth(token))).status, 200);

  /* The oracle control, and the reason the check is keyed off the CALLER's handle
     rather than off `target.id === me`: a demo must not be able to tell a real
     account's handle apart from a free one. Both of these are 403 — deciding the
     refusal after the lookup would make the first 403 and the second 404. */
  const real = await makeAccount('pdemo-oracle@example.com');
  const taken = await request(app)
    .get(`/api/account/profile/${encodeURIComponent(real.username)}`).set(auth(token));
  const free = await request(app)
    .get('/api/account/profile/definitely-nobody-xyz').set(auth(token));
  assert.deepEqual(taken.body, free.body);
  assert.equal(taken.status, free.status);
  assert.equal(taken.status, 403);
});
