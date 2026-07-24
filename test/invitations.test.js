'use strict';

/*
 * Round-sharing invitations (issue #207): send / accept / decline over HTTP.
 *
 * The core guarantee this pins: the INVITER fixes the seat decision at send time
 * (take over a specific user-less seat, or a fresh member), the invitee gets
 * exactly that and never picks a member themselves, and the seat is re-validated
 * at accept so a seat taken/changed in between is refused, not silently swapped
 * for a new member. Accepting creates the round_grant, so the invitee then has
 * access to exactly that round (the resolver isolation is proven in
 * test/round-grants-access.test.js).
 *
 * Accounts must be ON, so this drives real accounts (register → verify → login),
 * mirroring test/quota.test.js.
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

async function makeAccount(email) {
  await request(app).post('/api/account/register').send({ email, username: handle(email), password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/uid=([0-9a-f]+)&token=([A-Za-z0-9_-]+)/);
  await request(app).post('/api/account/verify-email').send({ uid: m[1], token: m[2] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email), username: handle(email) };
}
const makeRound = (owner, members) =>
  request(app).post('/api/rounds').set(auth(owner.token)).send({ name: 'Runde', members }).then((r) => r.body);
const inbox = (acct) => request(app).get('/api/account/inbox').set(auth(acct.token)).then((r) => r.body.items);
const send = (owner, body) => request(app).post('/api/account/invitations').set(auth(owner.token)).send(body);

test('send: owner-only, known user, valid seat', async () => {
  const owner = await makeAccount('inv-owner@example.com');
  const invitee = await makeAccount('inv-invitee@example.com');
  const outsider = await makeAccount('inv-outsider@example.com');
  const round = await makeRound(owner, ['Anna', 'Bob']);

  // A non-owner can't even see the round → 404 (doubles as the owner check).
  assert.equal((await send(outsider, { roundId: round.id, username: owner.username })).status, 404);
  // Unknown username, self-invite, bad seat.
  assert.equal((await send(owner, { roundId: round.id, username: 'nobody' })).status, 404);
  assert.equal((await send(owner, { roundId: round.id, username: owner.username })).body.error, 'cannot_invite_self');
  assert.equal((await send(owner, { roundId: round.id, username: invitee.username, memberId: 'nope' })).body.error, 'invalid_seat');

  // Valid send → 201 and an inbox item lands for the invitee.
  const ok = await send(owner, { roundId: round.id, username: invitee.username, memberId: round.members[0].id });
  assert.equal(ok.status, 201);
  const items = await inbox(invitee);
  const item = items.find((i) => i.type === 'round_invitation');
  assert.ok(item);
  assert.equal(item.payload.roundName, 'Runde');
  assert.equal(item.payload.memberName, 'Anna'); // the seat the inviter chose
  assert.equal(item.payload.inviterUsername, owner.username);

  // A second pending invite for the same pair is refused.
  assert.equal((await send(owner, { roundId: round.id, username: invitee.username })).body.error, 'already_invited');
});

test('accept (take over a seat): the invitee inherits exactly the chosen seat + gains access', async () => {
  const owner = await makeAccount('inv2-owner@example.com');
  const invitee = await makeAccount('inv2-invitee@example.com');
  const round = await makeRound(owner, ['Anna', 'Bob']);
  const annaId = round.members[0].id;

  await send(owner, { roundId: round.id, username: invitee.username, memberId: annaId });
  const item = (await inbox(invitee)).find((i) => i.type === 'round_invitation');

  const accept = await request(app).post(`/api/account/invitations/${item.payload.invitationId}/accept`).set(auth(invitee.token));
  assert.equal(accept.status, 200);
  assert.equal(accept.body.roundId, round.id);

  // The invitee now has access, and the CHOSEN seat (Anna) is linked to them —
  // no new member was created.
  const view = await request(app).get(`/api/rounds/${round.id}`).set(auth(invitee.token));
  assert.equal(view.status, 200);
  assert.equal(view.body.members.length, 2); // still Anna + Bob, none added
  assert.equal(view.body.members.find((m) => m.id === annaId).userId, invitee.user.id);

  // The inbox item is cleared, and a second accept is refused.
  assert.equal((await inbox(invitee)).some((i) => i.type === 'round_invitation'), false);
  assert.equal((await request(app).post(`/api/account/invitations/${item.payload.invitationId}/accept`).set(auth(invitee.token))).status, 409);
});

test('accept (fresh member): a new seat named after the invitee is created', async () => {
  const owner = await makeAccount('inv3-owner@example.com');
  const invitee = await makeAccount('inv3-invitee@example.com');
  const round = await makeRound(owner, ['Anna']);

  await send(owner, { roundId: round.id, username: invitee.username }); // no memberId => fresh
  const item = (await inbox(invitee)).find((i) => i.type === 'round_invitation');
  assert.equal(item.payload.memberName, null); // signals "fresh member"

  await request(app).post(`/api/account/invitations/${item.payload.invitationId}/accept`).set(auth(invitee.token));

  const view = await request(app).get(`/api/rounds/${round.id}`).set(auth(invitee.token));
  assert.equal(view.body.members.length, 2); // Anna + the new member
  const fresh = view.body.members.find((m) => m.userId === invitee.user.id);
  assert.equal(fresh.name, invitee.username); // named after the invitee's public handle
});

test('accept re-validates the seat: a seat taken between send and accept is refused, not swapped', async () => {
  const owner = await makeAccount('inv4-owner@example.com');
  const invitee = await makeAccount('inv4-invitee@example.com');
  const other = await makeAccount('inv4-other@example.com');
  const round = await makeRound(owner, ['Anna', 'Bob']);
  const bobId = round.members[1].id;

  await send(owner, { roundId: round.id, username: invitee.username, memberId: bobId });
  const item = (await inbox(invitee)).find((i) => i.type === 'round_invitation');

  // The owner links Bob's seat to someone else BEFORE the invitee accepts.
  await request(app).patch(`/api/rounds/${round.id}/members/${bobId}`).set(auth(owner.token)).send({ userId: other.user.id });

  // Accept must REFUSE (distinct code), never silently create a fresh member.
  const accept = await request(app).post(`/api/account/invitations/${item.payload.invitationId}/accept`).set(auth(invitee.token));
  assert.equal(accept.status, 409);
  assert.equal(accept.body.error, 'seat_unavailable');
  // The invitee gained no access and no duplicate member was added.
  assert.equal((await request(app).get(`/api/rounds/${round.id}`).set(auth(owner.token))).body.members.length, 2);
  assert.equal((await request(app).get(`/api/rounds/${round.id}`).set(auth(invitee.token))).status, 404);
});

test('invariants: at most one seat per user; decline is silent; only the addressee acts', async () => {
  const owner = await makeAccount('inv5-owner@example.com');
  const invitee = await makeAccount('inv5-invitee@example.com');
  const other = await makeAccount('inv5-other@example.com');
  const round = await makeRound(owner, ['Anna']);

  // Decline: silent, no access, invitation resolved (a second decline 409s).
  await send(owner, { roundId: round.id, username: invitee.username });
  let item = (await inbox(invitee)).find((i) => i.type === 'round_invitation');
  assert.equal((await request(app).post(`/api/account/invitations/${item.payload.invitationId}/decline`).set(auth(invitee.token))).status, 204);
  assert.equal((await inbox(invitee)).some((i) => i.type === 'round_invitation'), false);
  assert.equal((await request(app).get(`/api/rounds/${round.id}`).set(auth(invitee.token))).status, 404);

  // Only the addressee may accept: another account gets 404 (not-addressed hidden).
  await send(owner, { roundId: round.id, username: invitee.username });
  item = (await inbox(invitee)).find((i) => i.type === 'round_invitation');
  assert.equal((await request(app).post(`/api/account/invitations/${item.payload.invitationId}/accept`).set(auth(other.token))).status, 404);

  // Once the invitee is a member, re-inviting them is refused.
  await request(app).post(`/api/account/invitations/${item.payload.invitationId}/accept`).set(auth(invitee.token));
  assert.equal((await send(owner, { roundId: round.id, username: invitee.username })).body.error, 'already_member');
});
