'use strict';

/*
 * Cursor paging of the two feed read routes (#1357): GET /api/account/friends/feed
 * and the profile feed (first page embedded in GET /api/account/profile/:username,
 * later pages from …/:username/feed).
 *
 * The guarantees pinned here:
 *  - walking `nextCursor` to null yields EVERY visible event exactly once, in
 *    order — over a store holding more than one read window (200 rows), where the
 *    since-accepted filter drops rows and the collapse merges a duplicate that
 *    sits across a page boundary. The expected list is written out from the
 *    seeding, never re-derived with the code under test;
 *  - the acceptedAt cutoff holds on every page;
 *  - the profile paging route runs the profile route's guards in the same order:
 *    the demo refusal before the lookup (identical 403 for an unknown handle and
 *    a stranger), a suspended account's identical 404, then the friends-only gate;
 *  - a cursor this server could not have written is a 400, not an empty page.
 *
 * Seeded through the repo, not the API: 700-odd events would trip nothing but
 * time through the routes, and the rows are what is under test.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.DEMO_ENABLED = 'true';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');
const { FEED_PAGE, FEED_WINDOW, encodeFeedCursor, decodeFeedCursor } = require('../lib/feed');

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

const inbox = (a) => request(app).get('/api/account/inbox').set(auth(a.token)).then((r) => r.body.items);
async function befriend(a, b) {
  await request(app).post('/api/account/friends').set(auth(a.token)).send({ username: b.username });
  const fid = (await inbox(b)).find((i) => i.type === 'friend_request').payload.friendshipId;
  await request(app).post(`/api/account/friends/${fid}/accept`).set(auth(b.token));
}
const add = (a, title, type = 'game_added') => repo.addFeedEvent(a.user.id, { type, title });

// Walk a paged route from its first page to nextCursor === null.
async function walk(first, next) {
  const pages = [first];
  let guard = 0;
  while (pages[pages.length - 1].nextCursor) {
    assert.ok(++guard < 20, 'paging did not terminate');
    pages.push(await next(pages[pages.length - 1].nextCursor));
  }
  return pages;
}

/* One fixture for the Freundeskreis walk, oldest first:
 *   C: 250 rows before C's friendship  -> all filtered; they make the LAST page
 *      read past one window, so the multi-window loop is exercised
 *   old region, 100 times: A_i, B_i, Ax_i, B_i   (A is not yet a friend)
 *      -> B_i shows ONCE: its two rows only become adjacent after A's are filtered
 *   new region, 30 times: A2_j, B2_j   (both friends by now)
 * Visible: 60 new + 100 B = 160 events = pages of 50/50/50/10, and the second
 * page boundary lands inside the old region, on a B_i whose duplicate row is the
 * next raw row but one — the case a cursor taken from the last SHOWN event
 * gets wrong. */
test('friends feed: walking nextCursor yields every visible event once, in order', async () => {
  const me = await makeAccount('pg-me@example.com');
  const a = await makeAccount('pg-a@example.com');
  const b = await makeAccount('pg-b@example.com');
  const c = await makeAccount('pg-c@example.com');

  for (let i = 0; i < 250; i++) await add(c, `C${i}`);
  await befriend(me, b);
  await sleep(20); // clear the acceptedAt cutoff
  for (let i = 0; i < 100; i++) {
    await add(a, `A${i}`);
    await add(b, `B${i}`);
    await add(a, `Ax${i}`);
    await add(b, `B${i}`);
  }
  await sleep(20);
  await befriend(me, a);
  await befriend(me, c);
  await sleep(20);
  for (let j = 0; j < 30; j++) {
    await add(a, `A2_${j}`);
    await add(b, `B2_${j}`);
  }

  const expected = [];
  for (let j = 29; j >= 0; j--) expected.push(`B2_${j}`, `A2_${j}`);
  for (let i = 99; i >= 0; i--) expected.push(`B${i}`);
  assert.ok(250 + 400 + 60 > 3 * FEED_WINDOW, 'the store holds more than three read windows');

  const get = (q = '') => request(app).get(`/api/account/friends/feed${q}`).set(auth(me.token))
    .then((r) => { assert.equal(r.status, 200); return r.body; });
  const pages = await walk(await get(), (cur) => get(`?before=${encodeURIComponent(cur)}`));

  assert.deepEqual(pages.map((p) => p.events.length), [FEED_PAGE, FEED_PAGE, FEED_PAGE, 10]);
  const titles = pages.flatMap((p) => p.events.map((e) => e.title));
  assert.deepEqual(titles, expected, 'no gap, no repeat, same order as the store');
  assert.equal(titles.some((tl) => /^(C\d+|Ax?\d+)$/.test(tl)), false, 'nothing from before a friendship, on any page');
  assert.equal(pages[pages.length - 1].nextCursor, null);
  assert.ok(pages.every((p) => p.friendCount === 3));
});

test('friends feed: one short page reports nextCursor null, and a friendless feed too', async () => {
  const me = await makeAccount('pg-short-me@example.com');
  const res = await request(app).get('/api/account/friends/feed').set(auth(me.token));
  assert.deepEqual(res.body, { friendCount: 0, events: [], nextCursor: null });

  const f = await makeAccount('pg-short-f@example.com');
  await befriend(me, f);
  await sleep(20);
  await add(f, 'Azul');
  const one = (await request(app).get('/api/account/friends/feed').set(auth(me.token))).body;
  assert.deepEqual(one.events.map((e) => e.title), ['Azul']);
  assert.equal(one.nextCursor, null);
});

test('a cursor this server did not write is a 400, not an empty page', async () => {
  const me = await makeAccount('pg-bad@example.com');
  const bogus = ['x', 'not base64!', Buffer.from('nope').toString('base64url'),
    Buffer.from('0123456789abcdef|yesterday').toString('base64url'), 'A'.repeat(200)];
  for (const cur of bogus) {
    const res = await request(app).get(`/api/account/friends/feed?before=${encodeURIComponent(cur)}`).set(auth(me.token));
    assert.equal(res.status, 400, `accepted ${cur}`);
    assert.equal(res.body.error, 'invalid_cursor');
  }
  // …and one it did write round-trips.
  const row = { id: '0123456789abcdef', at: '2026-01-02T03:04:05.678Z' };
  assert.deepEqual(decodeFeedCursor(encodeFeedCursor(row)), row);
});

/* ------------------------------ profile feed ------------------------------ */

const profile = (viewer, username) =>
  request(app).get(`/api/account/profile/${encodeURIComponent(username)}`).set(auth(viewer.token));
const profileFeed = (token, username, cursor) =>
  request(app).get(`/api/account/profile/${encodeURIComponent(username)}/feed`
    + (cursor ? `?before=${encodeURIComponent(cursor)}` : '')).set(auth(token));

test('profile feed: a friend pages the whole post-friendship history, and nothing before it', async () => {
  const me = await makeAccount('pp-me@example.com');
  const f = await makeAccount('pp-f@example.com');
  for (let i = 0; i < 30; i++) await add(f, `Old${i}`);
  await sleep(20);
  await befriend(me, f);
  await sleep(20);
  // 120 events, with duplicate runs: 'Dup' × 3 collapses to one.
  for (let i = 0; i < 120; i++) await add(f, `G${i}`);
  for (let i = 0; i < 3; i++) await add(f, 'Dup', 'session_played');

  const first = (await profile(me, f.username)).body;
  assert.equal(first.friendship, 'friends');
  assert.equal(first.events.length, FEED_PAGE);
  assert.ok(first.nextCursor, 'the embedded first page carries a cursor');

  const pages = await walk(first, (cur) => profileFeed(me.token, f.username, cur)
    .then((r) => { assert.equal(r.status, 200); return r.body; }));
  const titles = pages.flatMap((p) => p.events.map((e) => e.title));
  const expected = ['Dup'];
  for (let i = 119; i >= 0; i--) expected.push(`G${i}`);
  assert.deepEqual(titles, expected);
  assert.equal(titles.some((tl) => tl.startsWith('Old')), false, 'the acceptedAt cutoff holds on every page');
  // Same shape as the first page: nothing but the allowlisted fields.
  assert.deepEqual(Object.keys(pages[1].events[0]).sort(), ['at', 'coverUrl', 'title', 'type']);
});

test('profile feed: your own feed pages with no cutoff', async () => {
  const me = await makeAccount('pp-self@example.com');
  for (let i = 0; i < 60; i++) await add(me, `S${i}`);
  const first = (await profile(me, me.username)).body;
  assert.equal(first.self, true);
  const pages = await walk(first, (cur) => profileFeed(me.token, me.username, cur).then((r) => r.body));
  assert.equal(pages.flatMap((p) => p.events).length, 60);
});

test('profile feed: a stranger, a pending request and a bad cursor are refused', async () => {
  const me = await makeAccount('pp-guard-me@example.com');
  const stranger = await makeAccount('pp-guard-s@example.com');
  const pending = await makeAccount('pp-guard-p@example.com');
  await add(stranger, 'Secret');
  await request(app).post('/api/account/friends').set(auth(me.token)).send({ username: pending.username });

  for (const who of [stranger, pending]) {
    const res = await profileFeed(me.token, who.username);
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: 'not_friends' });
  }
  const self = await profileFeed(me.token, me.username, 'garbage');
  assert.equal(self.status, 400);
  assert.equal(self.body.error, 'invalid_cursor');
});

test('profile feed: an unknown handle and a SUSPENDED account answer the identical 404', async () => {
  const me = await makeAccount('pp-susp-me@example.com');
  const f = await makeAccount('pp-susp-f@example.com');
  await befriend(me, f);
  await sleep(20);
  await add(f, 'Azul');
  assert.equal((await profileFeed(me.token, f.username)).status, 200, 'the control: a friend reads it');

  const unknown = await profileFeed(me.token, 'nobody-by-that-name');
  await repo.updateUser(f.user.id, { disabled: new Date().toISOString() });
  const suspended = await profileFeed(me.token, f.username);
  assert.equal(suspended.status, 404);
  assert.deepEqual(suspended.body, unknown.body);
});

/* The guard ORDER, not merely the guards: the demo refusal runs before the
   lookup, so a demo cannot tell a real handle from a free one — and it runs
   before the cursor check, so not even a malformed query string reaches past it. */
test('profile feed: a demo gets the identical 403 for a real handle, a free one and a bad cursor', async () => {
  const started = await request(app).post('/api/account/demo').send({});
  assert.equal(started.status, 200);
  const token = started.body.accessToken;
  const real = await makeAccount('pp-demo-real@example.com');

  const taken = await profileFeed(token, real.username);
  const free = await profileFeed(token, 'definitely-nobody-xyz');
  const mangled = await profileFeed(token, 'definitely-nobody-xyz', 'garbage');
  assert.equal(taken.status, 403);
  assert.deepEqual(taken.body, { error: 'demo_forbidden' });
  assert.deepEqual(free.body, taken.body);
  assert.deepEqual(mangled.body, taken.body);

  // Its own feed stays reachable, as its own profile is.
  const mine = (await request(app).get('/api/account/me').set(auth(token))).body;
  assert.equal((await profileFeed(token, mine.username)).status, 200);
});

/* ---------------------------- retention sweep ----------------------------- */

/* The scheduler job is what keeps docs/legal/retention.md's 12 months true for
   an account that stops writing — the prune-on-write only ever reaches the
   writer. Driven through runJob, the way the scheduler calls it. */
test('the scheduler\'s feed sweep deletes an idle account\'s expired events', async (t) => {
  const scheduler = require('../lib/scheduler');
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now: now - 366 * day });
  try {
    await repo.addFeedEvent('sweep-idle', { type: 'game_added', title: 'last year' });
  } finally {
    t.mock.timers.reset();
  }
  await repo.addFeedEvent('sweep-active', { type: 'game_added', title: 'today' });

  assert.ok(Object.keys(scheduler.JOBS).includes('purgeExpiredFeedEvents'));
  const deleted = await scheduler.runJob('purgeExpiredFeedEvents');
  assert.ok(deleted >= 1);
  assert.deepEqual(await repo.listFeedEvents(['sweep-idle']), []);
  assert.equal((await repo.listFeedEvents(['sweep-active'])).length, 1, 'a fresh row survives');
});
