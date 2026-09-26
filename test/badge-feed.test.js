'use strict';

/*
 * The account-tier Abzeichen in the friends' feed (#1389, lib/badge-feed.js).
 *
 * The one place an earning leaves its round. Pinned here:
 *  - crossing an account tier at a session finish stores ONE `badge_earned` row
 *    for that account, carrying the catalogue key + tier and nothing else — no
 *    round id, no round name, no member;
 *  - Siege crosses on a winner-chip RE-SAVE (not a transition), and still posts;
 *  - re-saving, un-finishing and re-finishing never announce a tier twice;
 *  - an account whose record is hidden from friends posts nothing;
 *  - the friend reads it through /friends/feed with `tier`.
 *
 * The emit-guard assertions read the STORE, not the feed route: the read-side
 * collapse would otherwise hide a duplicate
 * (.claude/rules/feed-events-fire-on-the-transition.md). The 24 earlier sessions
 * are seeded straight into the store — reaching them over HTTP is ~70 calls that
 * test nothing about this module.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, store } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');
const { crossedTiers, affectedAccounts } = require('../lib/badge-feed');
const { accountBadges } = require('../public/js/achievements');

const PASSWORD = 'correct horse battery';
const handle = (email) => email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');
const auth = (token) => ({ Authorization: `Bearer ${token}` });

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
const sess = (a, rid, path, body) =>
  request(app).post(`/api/rounds/${rid}/sessions${path}`).set(auth(a.token)).send(body);
const badgeRows = (a) =>
  repo.listFeedEvents([a.user.id], 500).then((rows) => rows.filter((e) => e.type === 'badge_earned'));

/* A round owned by `owner` (whose seat is linked to the account) with `past`
   finished sessions already played — `wonPast` of them won by the owner — and
   one open session with a chosen game, ready to be finished over HTTP. */
async function roundAt(owner, { past, wonPast = 0 }) {
  const round = await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Donnerstagsrunde', members: ['Anna'] }).then((r) => r.body);
  const req = request(app).post(`/api/rounds/${round.id}/games`).set(auth(owner.token));
  for (const [k, v] of Object.entries({ title: 'Kartographen', minPlayers: '2', maxPlayers: '4' })) req.field(k, v);
  const game = (await req).body;
  const stored = store.data.rounds.find((r) => r.id === round.id);
  const seat = stored.members.find((m) => m.userId === owner.user.id);
  for (let i = 0; i < past; i++) {
    stored.sessions.push({
      id: `past-${round.id}-${i}`, finished: true, cancelled: false,
      memberIds: stored.members.map((m) => m.id), winnerIds: i < wonPast ? [seat.id] : [],
      gameIds: [game.id], chosenGameId: game.id, votes: {},
      createdAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      finishedAt: new Date(Date.UTC(2026, 0, 1 + i, 3)).toISOString(),
    });
  }
  const session = (await sess(owner, round.id, '', {})).body.session;
  await sess(owner, round.id, `/${session.id}/choice`, { gameId: game.id });
  return { round: stored, seat, session, game };
}

// --- the pure halves -----------------------------------------------------------

test('crossedTiers names only the tiers the second snapshot added, never Jahre', () => {
  const before = accountBadges({ sessions: 24, wins: 9, rounds: 1 }, '2020-01-01T00:00:00.000Z');
  const after = accountBadges({ sessions: 25, wins: 10, rounds: 1 }, '2020-01-01T00:00:00.000Z');
  assert.deepEqual(crossedTiers(before, after), [
    { key: 'accountSessions', tier: 25 },
    { key: 'accountWins', tier: 10 },
  ], 'Jahre is earned on both sides and is never announced from a finish');
  assert.deepEqual(crossedTiers(after, after), [], 'nothing new, nothing announced');
  // Jahre is excluded by rule, not merely because it is earned on both sides.
  const young = accountBadges({}, new Date().toISOString());
  const old = accountBadges({}, '2020-01-01T00:00:00.000Z');
  assert.deepEqual(crossedTiers(young, old), []);
});

test('affectedAccounts: the table on the transition, the flipped winners on a re-save', () => {
  const members = [
    { id: 'm1', userId: 'u1' }, { id: 'm2', userId: 'u2' }, { id: 'm3', userId: null }, { id: 'm4', userId: 'u4' },
  ];
  const open = { finished: false, memberIds: ['m1', 'm2', 'm3'] };
  assert.deepEqual(affectedAccounts(members, open, []).sort(), ['u1', 'u2'], 'seated, linked accounts');
  const legacy = { finished: false };
  assert.deepEqual(affectedAccounts(members, legacy, []).sort(), ['u1', 'u2', 'u4'], 'no memberIds: everyone joined');
  const done = { finished: true, memberIds: ['m1', 'm2'], winnerIds: ['m1'] };
  assert.deepEqual(affectedAccounts(members, done, ['m1']), [], 'an unchanged re-save moves nobody');
  assert.deepEqual(affectedAccounts(members, done, ['m2']).sort(), ['u1', 'u2'], 'a flipped winner, both ways');
});

// --- over HTTP -------------------------------------------------------------------

test('the 25th session posts Sessions 25 once — key and tier, nothing about the round', async () => {
  const mia = await makeAccount('bf-mia@example.com');
  const bob = await makeAccount('bf-bob@example.com');
  await befriend(mia, bob);
  const { round, session } = await roundAt(mia, { past: 24 });

  assert.equal((await sess(mia, round.id, `/${session.id}/finish`, { winnerIds: [] })).status, 200);
  const rows = await badgeRows(mia);
  assert.deepEqual(rows.map((e) => [e.title, e.tier]), [['accountSessions', 25]]);

  // The stored row is the allowlist and nothing else.
  const row = rows[0];
  assert.deepEqual(Object.keys(row).filter((k) => !['id', 'uid'].includes(k)).sort(), ['at', 'coverUrl', 'tier', 'title', 'type']);
  assert.equal(row.coverUrl, null);
  const text = JSON.stringify(row);
  for (const value of [round.id, round.name, session.id, ...round.members.map((m) => m.name)]) {
    assert.equal(text.includes(value), false, `the feed row carries ${value}`);
  }

  // The friend reads it, with its tier.
  const feed = (await request(app).get('/api/account/friends/feed').set(auth(bob.token))).body;
  const mark = feed.events.find((e) => e.type === 'badge_earned');
  assert.deepEqual([mark.title, mark.tier, mark.username], ['accountSessions', 25, mia.username]);
  assert.equal(JSON.stringify(feed).includes(round.name), false);

  // Re-saves, an un-finish and a re-finish: the tier is announced once.
  await sess(mia, round.id, `/${session.id}/finish`, { winnerIds: [] });
  await sess(mia, round.id, `/${session.id}/finish`, { finished: false });
  await sess(mia, round.id, `/${session.id}/finish`, { winnerIds: [] });
  assert.equal((await badgeRows(mia)).length, 1, 'no second announcement of the same tier');
});

test('Siege 10 crosses on a winner-chip re-save and still posts, once', async () => {
  const lea = await makeAccount('bf-lea@example.com');
  const { round, seat, session } = await roundAt(lea, { past: 9, wonPast: 9 });

  await sess(lea, round.id, `/${session.id}/finish`, { winnerIds: [] });
  assert.deepEqual(await badgeRows(lea), [], 'control: finishing without a winner crosses nothing');

  // The chip tap: not a transition, and exactly the request that crosses 10.
  await sess(lea, round.id, `/${session.id}/finish`, { winnerIds: [seat.id] });
  assert.deepEqual((await badgeRows(lea)).map((e) => [e.title, e.tier]), [['accountWins', 10]]);

  // Toggled off and on again: 10 is crossed a second time, and not announced.
  await sess(lea, round.id, `/${session.id}/finish`, { winnerIds: [] });
  await sess(lea, round.id, `/${session.id}/finish`, { winnerIds: [seat.id] });
  assert.equal((await badgeRows(lea)).length, 1);
});

test('an account that hides its record from friends posts no badge', async () => {
  const kai = await makeAccount('bf-kai@example.com');
  await request(app).patch('/api/account/me').set(auth(kai.token)).send({ statsVisible: false });
  const { round, session } = await roundAt(kai, { past: 24 });
  await sess(kai, round.id, `/${session.id}/finish`, { winnerIds: [] });
  assert.deepEqual(await badgeRows(kai), []);
  // The control: the same finish still posted the play, so the route ran.
  const played = (await repo.listFeedEvents([kai.user.id], 50)).filter((e) => e.type === 'session_played');
  assert.equal(played.length, 1);
});

test('a demo account posts no badge', async () => {
  const dan = await makeAccount('bf-dan@example.com');
  await repo.updateUser(dan.user.id, { demo: true });
  const { round, session } = await roundAt(dan, { past: 24 });
  await sess(dan, round.id, `/${session.id}/finish`, { winnerIds: [] });
  assert.deepEqual(await badgeRows(dan), []);
});
