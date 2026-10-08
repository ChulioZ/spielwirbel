'use strict';

/*
 * Round invite links (issue #1515) over HTTP: the owner mints, lists and revokes
 * (lib/routes/invite-links.js); a signed-in account previews and joins
 * (lib/routes/join.js).
 *
 * What these pin, beyond the happy path:
 * - the gate re-reads the TARGET (round + seat) on every request, so a row that
 *   survives its round or its seat is inert — tested by reviving a stale row on
 *   purpose, the only test shape that reads the gate
 *   (.claude/rules/capability-links-gate-on-the-target.md);
 * - every dead link answers the same 404 `invalid_link`;
 * - a seat link is single-use and a fresh-seat link reusable, each bounded by
 *   the round's member quota rather than by a per-link cap.
 *
 * Accounts must be ON, so this drives real accounts like test/invitations.test.js.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, store } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');

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
const makeRound = (owner, members) =>
  request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Donnerstagsrunde', members, ownerSeat: false }).then((r) => r.body);
const mint = (acct, rid, memberId) =>
  request(app).post(`/api/rounds/${rid}/invite-links`).set(auth(acct.token)).send(memberId ? { memberId } : {});
const links = (acct, rid) => request(app).get(`/api/rounds/${rid}/invite-links`).set(auth(acct.token));
const preview = (acct, token) => request(app).post('/api/account/join/preview').set(auth(acct.token)).send({ token });
const join = (acct, token) => request(app).post('/api/account/join').set(auth(acct.token)).send({ token });
const roundOf = (acct, rid) => request(app).get(`/api/rounds/${rid}`).set(auth(acct.token));

let n = 0;
const fresh = (tag) => makeAccount(`il-${tag}-${(n += 1)}@example.com`);

test('a fresh-seat link: preview, join as an editor, and it stays usable for the next person', async () => {
  const owner = await fresh('owner');
  const round = await makeRound(owner, ['Anna']);
  const res = await mint(owner, round.id);
  assert.equal(res.status, 201);
  const { link } = res.body;
  assert.equal(link.memberId, null);
  assert.equal(link.slot, 'fresh');
  const days = (Date.parse(link.expiresAt) - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days <= 7, `expires in 7 days (got ${days})`);

  const ben = await fresh('ben');
  const p = await preview(ben, link.token);
  assert.equal(p.status, 200);
  assert.deepEqual(p.body, { roundName: 'Donnerstagsrunde', seatName: null });

  const j = await join(ben, link.token);
  assert.equal(j.status, 200);
  assert.equal(j.body.roundId, round.id);
  const grant = (await repo.listGrantsForUser(ben.user.id)).find((g) => g.roundId === round.id);
  assert.equal(grant.role, 'editor', 'a link always hands out the editor role');
  const seen = (await roundOf(ben, round.id)).body;
  const seat = seen.members.find((m) => m.userId === ben.user.id);
  assert.equal(seat.name, ben.username, 'the fresh seat is named after the account');
  assert.equal(seen.members.length, 2);

  // Reusable: a second account joins through the same link.
  const cleo = await fresh('cleo');
  assert.equal((await join(cleo, link.token)).status, 200);
  // …and nobody joins twice.
  assert.equal((await join(ben, link.token)).body.error, 'already_member');
  assert.equal((await preview(ben, link.token)).body.error, 'already_member');
});

test('a seat link hands over exactly that seat, once', async () => {
  const owner = await fresh('owner');
  const round = await makeRound(owner, ['Anna', 'Bob']);
  const bob = round.members.find((m) => m.name === 'Bob');
  const { link } = (await mint(owner, round.id, bob.id)).body;
  assert.equal(link.slot, bob.id);
  assert.equal(link.seatName, 'Bob');

  const dana = await fresh('dana');
  assert.equal((await preview(dana, link.token)).body.seatName, 'Bob');
  assert.equal((await join(dana, link.token)).status, 200);
  const seen = (await roundOf(dana, round.id)).body;
  assert.equal(seen.members.length, 2, 'no fresh seat was created');
  assert.equal(seen.members.find((m) => m.id === bob.id).userId, dana.user.id);

  const emil = await fresh('emil');
  const again = await join(emil, link.token);
  assert.equal(again.status, 404);
  assert.deepEqual(again.body, { error: 'invalid_link' });
  assert.equal(await repo.findRoundInviteLink(link.token), null, 'the single-use row is consumed');
});

test('minting validates the seat and refuses grantees; the list is owner-only', async () => {
  const owner = await fresh('owner');
  const round = await makeRound(owner, ['Anna', 'Bob', 'Cleo']);
  const [anna, bob, cleo] = ['Anna', 'Bob', 'Cleo'].map((nm) => round.members.find((m) => m.name === nm));

  assert.equal((await mint(owner, round.id, 'nope')).body.error, 'invalid_seat');
  await request(app).post(`/api/rounds/${round.id}/members/${cleo.id}/retire`).set(auth(owner.token)).send({ retired: true });
  assert.equal((await mint(owner, round.id, cleo.id)).body.error, 'invalid_seat', 'a retired seat is not offered');

  const { link } = (await mint(owner, round.id, anna.id)).body;
  const finn = await fresh('finn');
  await join(finn, link.token);
  assert.equal((await mint(owner, round.id, anna.id)).body.error, 'seat_taken');

  // The editor who just joined cannot hand out access themselves.
  assert.equal((await mint(finn, round.id)).status, 403);
  assert.equal((await links(finn, round.id)).status, 403);
  // An outsider does not see the round at all.
  const outsider = await fresh('out');
  assert.equal((await mint(outsider, round.id)).status, 404);

  await mint(owner, round.id, bob.id);
  const list = (await links(owner, round.id)).body;
  assert.deepEqual(list.map((l) => l.seatName), ['Bob'], 'the consumed and the retired seat are not listed');
});

test('a new link for the same slot replaces the old one; revoking by slot kills it', async () => {
  const owner = await fresh('owner');
  const round = await makeRound(owner, ['Anna']);
  const first = (await mint(owner, round.id)).body.link;
  const second = (await mint(owner, round.id)).body.link;
  assert.notEqual(first.token, second.token);
  const gina = await fresh('gina');
  assert.equal((await preview(gina, first.token)).status, 404, 'the replaced link is dead');
  assert.equal((await preview(gina, second.token)).status, 200);
  assert.equal((await links(owner, round.id)).body.length, 1, 'one fresh-seat link per round');

  // A seat link is its own slot and does not replace the fresh one.
  const anna = round.members[0];
  await mint(owner, round.id, anna.id);
  assert.equal((await links(owner, round.id)).body.length, 2);

  assert.equal((await request(app).delete(`/api/rounds/${round.id}/invite-links/fresh`).set(auth(owner.token))).status, 204);
  assert.equal((await preview(gina, second.token)).status, 404);
  assert.equal((await request(app).delete(`/api/rounds/${round.id}/invite-links/fresh`).set(auth(owner.token))).status, 404);
  assert.deepEqual((await links(owner, round.id)).body.map((l) => l.slot), [anna.id]);
});

test('the owner cannot join their own round, and a logged-out caller is refused', async () => {
  const owner = await fresh('owner');
  const round = await makeRound(owner, ['Anna']);
  const { link } = (await mint(owner, round.id)).body;
  assert.equal((await preview(owner, link.token)).body.error, 'own_round');
  assert.equal((await join(owner, link.token)).body.error, 'own_round');
  assert.equal((await request(app).post('/api/account/join').send({ token: link.token })).status, 401);
});

test('the gate re-reads the TARGET: a revived row for a taken seat or a deleted round is inert', async () => {
  const owner = await fresh('owner');
  const round = await makeRound(owner, ['Anna', 'Bob']);
  const anna = round.members.find((m) => m.name === 'Anna');
  const hana = await fresh('hana');

  // The seat is taken by other means (here: the repo, as an invitation accept
  // would) while its link row still exists.
  const seatLink = (await mint(owner, round.id, anna.id)).body.link;
  await repo.forTenant(owner.user.tenantId).updateMember(round.id, anna.id, { userId: owner.user.id });
  assert.ok(await repo.findRoundInviteLink(seatLink.token), 'the row is still there');
  assert.deepEqual((await preview(hana, seatLink.token)).body, { error: 'invalid_link' });
  assert.deepEqual((await links(owner, round.id)).body, [], 'nor does the owner see it as live any more');

  // The round is deleted, then a row naming it is put back — what a missed
  // cascade site would leave behind.
  assert.equal((await request(app).delete(`/api/rounds/${round.id}`).set(auth(owner.token))).status, 200);
  const revived = await repo.createRoundInviteLink({ roundId: round.id, ownerTenantId: owner.user.tenantId, memberId: null });
  assert.ok(await repo.findRoundInviteLink(revived.id), 'the revived row really is back');
  const res = await join(hana, revived.id);
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'invalid_link' });
  assert.equal((await repo.listGrantsForUser(hana.user.id)).length, 0);
});

test('deleting the round takes its links with it', async () => {
  const owner = await fresh('owner');
  const round = await makeRound(owner, ['Anna']);
  const { link } = (await mint(owner, round.id)).body;
  await request(app).delete(`/api/rounds/${round.id}`).set(auth(owner.token));
  assert.equal(await repo.findRoundInviteLink(link.token), null);
});

test('a link older than 7 days is dead, and the sweep deletes it while a live one survives', async () => {
  const owner = await fresh('owner');
  const round = await makeRound(owner, ['Anna', 'Bob']);
  const old = (await mint(owner, round.id)).body.link;
  const live = (await mint(owner, round.id, round.members[0].id)).body.link;
  const row = store.data.roundInviteLinks.find((l) => l.id === old.token);
  row.createdAt = new Date(Date.now() - 7 * 86400000 - 60000).toISOString();

  const ida = await fresh('ida');
  assert.deepEqual((await preview(ida, old.token)).body, { error: 'invalid_link' });
  assert.equal((await links(owner, round.id)).body.length, 1, 'the owner no longer sees it');

  const { runJob } = require('../lib/scheduler');
  await runJob('purgeExpiredInviteLinks');
  assert.equal(await repo.findRoundInviteLink(old.token), null, 'the expired row is gone');
  assert.ok(await repo.findRoundInviteLink(live.token), 'the live one survives the sweep');
});

test('a full round: no fresh-seat link is minted, and an existing one cannot be used', async (t) => {
  const prev = process.env.MAX_MEMBERS_PER_ROUND;
  t.after(() => { if (prev === undefined) delete process.env.MAX_MEMBERS_PER_ROUND; else process.env.MAX_MEMBERS_PER_ROUND = prev; });
  const owner = await fresh('owner');
  const round = await makeRound(owner, ['Anna', 'Bob']);
  const { link } = (await mint(owner, round.id)).body;
  process.env.MAX_MEMBERS_PER_ROUND = '2';
  assert.equal((await mint(owner, round.id)).body.error, 'quota_members');
  const jan = await fresh('jan');
  assert.equal((await join(jan, link.token)).body.error, 'quota_members');
  // A seat link fills an existing seat, so the quota does not stand in its way.
  const seatLink = (await mint(owner, round.id, round.members[0].id)).body.link;
  assert.equal((await join(jan, seatLink.token)).status, 200);
});

test('the join page never writes its token into the logs', () => {
  const { reqPath } = require('../lib/observability');
  const token = 'NOT-A-REAL-TOKEN-just-a-path-segment';
  assert.equal(reqPath({ originalUrl: `/join/${token}` }), '/join/:token');
  assert.equal(reqPath({ originalUrl: `/join/${token}?x=1` }), '/join/:token');
  assert.ok(!reqPath({ originalUrl: `/join/${token}` }).includes(token));
  // Untouched: the API carries the token in its body, and a look-alike path is
  // not a join link.
  assert.equal(reqPath({ originalUrl: '/api/account/join/preview' }), '/api/account/join/preview');
  assert.equal(reqPath({ originalUrl: '/joined/x' }), '/joined/x');
});
