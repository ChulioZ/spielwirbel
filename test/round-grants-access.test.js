'use strict';

/*
 * Grant-based round access — the resolver (issue #207).
 *
 * resolveRoundGrant (lib/tenant.js) re-scopes a request to a round's OWNER tenant
 * when the caller holds a grant on that round, so a grantee acts AS the owner
 * tenant (RLS un-widened). This suite proves the isolation the whole feature
 * rests on: a grantee reaches EXACTLY the granted round — read and write — and
 * nothing else in the owner's tenant, cannot delete the owner's round, and a
 * non-grantee is refused.
 *
 * Accounts must be ON for per-user tenants + grants to exist, so this enables
 * accounts and drives real accounts (register → verify → login), mirroring
 * test/quota.test.js. There is no route to CREATE a grant yet (invitation accept
 * is a later slice of #207), so grants are seeded through the repo.
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
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}

test('a grantee reaches exactly the granted round — read, write, no delete, no other rounds', async () => {
  const owner = await makeAccount('grant-owner@example.com');
  const grantee = await makeAccount('grant-grantee@example.com');
  const outsider = await makeAccount('grant-outsider@example.com');

  // Owner creates a shared round (with a game) and a SEPARATE private round.
  const shared = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Freitagsrunde', members: ['Owner'] })).body;
  await request(app).post(`/api/rounds/${shared.id}/games`).set(auth(owner.token))
    .send({ title: 'Catan', minPlayers: 2, maxPlayers: 4 });
  const private_ = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Privatrunde', members: ['Owner'] })).body;

  // Seed the grant: the grantee may act on `shared`, owned by the owner's tenant.
  await repo.createGrant({ roundId: shared.id, ownerTenantId: owner.user.tenantId, userId: grantee.user.id });

  // READ: the grantee sees the owner's shared round and its game, and the payload
  // is flagged `shared` (reached via a grant, not ownership).
  const read = await request(app).get(`/api/rounds/${shared.id}`).set(auth(grantee.token));
  assert.equal(read.status, 200);
  assert.equal(read.body.name, 'Freitagsrunde');
  assert.deepEqual(read.body.games.map((g) => g.title), ['Catan']);
  assert.equal(read.body.shared, true);
  // The OWNER reading their own round gets no `shared` flag (unchanged payload).
  assert.equal('shared' in (await request(app).get(`/api/rounds/${shared.id}`).set(auth(owner.token))).body, false);

  // WRITE: the grantee adds a game, and it lands in the OWNER's round (the owner sees it).
  const add = await request(app).post(`/api/rounds/${shared.id}/games`).set(auth(grantee.token))
    .send({ title: 'Azul', minPlayers: 2, maxPlayers: 4 });
  assert.equal(add.status, 201);
  const ownerView = await request(app).get(`/api/rounds/${shared.id}`).set(auth(owner.token));
  assert.deepEqual(ownerView.body.games.map((g) => g.title).sort(), ['Azul', 'Catan']);

  // NO OTHER ROUNDS: the owner's private round is invisible to the grantee (no grant on it).
  assert.equal((await request(app).get(`/api/rounds/${private_.id}`).set(auth(grantee.token))).status, 404);

  // NO DELETE: a grant does not authorize destroying the owner's round.
  const del = await request(app).delete(`/api/rounds/${shared.id}`).set(auth(grantee.token));
  assert.equal(del.status, 403);
  assert.equal(del.body.error, 'not_owner');
  assert.equal((await request(app).get(`/api/rounds/${shared.id}`).set(auth(owner.token))).status, 200); // still there

  // HOME LIST (since the #207 home-merge): the grantee's list now includes the
  // shared round, flagged `shared` — and ONLY that one, not the owner's private
  // round (proof the merge fetches exactly the granted rounds).
  const list = await request(app).get('/api/rounds').set(auth(grantee.token));
  const sharedEntry = list.body.find((r) => r.id === shared.id);
  assert.ok(sharedEntry, 'the shared round appears on the grantee home');
  assert.equal(sharedEntry.shared, true);
  assert.equal(list.body.some((r) => r.id === private_.id), false); // the owner's private round never leaks in

  // A NON-grantee cannot reach the round at all.
  assert.equal((await request(app).get(`/api/rounds/${shared.id}`).set(auth(outsider.token))).status, 404);
});

test('the owner is unaffected: they read, edit and delete their own round normally', async () => {
  const owner = await makeAccount('grant-owner2@example.com');
  const grantee = await makeAccount('grant-grantee2@example.com');

  const round = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Sonntagsrunde', members: ['Owner'] })).body;
  await repo.createGrant({ roundId: round.id, ownerTenantId: owner.user.tenantId, userId: grantee.user.id });

  // The grant on this round must not change how the OWNER experiences it.
  assert.equal((await request(app).get(`/api/rounds/${round.id}`).set(auth(owner.token))).status, 200);
  const del = await request(app).delete(`/api/rounds/${round.id}`).set(auth(owner.token));
  assert.equal(del.status, 200); // owner delete succeeds (200 { ok: true })
  assert.equal(del.body.ok, true);
  assert.equal((await request(app).get(`/api/rounds/${round.id}`).set(auth(owner.token))).status, 404); // gone
});

// #562 opened renaming to every grantee; #137 moved it to CO-OWNER and up
// (operator decision, 2026-08-13) — the round's name is what identifies it on
// every other person's home screen, so it joined the destructive actions rather
// than staying in the class of editing a member name.
//
// The attribution half of #562 is unchanged and still pinned below: a rename by a
// grantee lands in the OWNER's round and names the actor's seat. That is why this
// spec drives the co-owner path rather than simply asserting a 403 — dropping to
// "an editor is refused" would have deleted the only coverage of `actorSeat`
// under a grant.
test('renaming a shared round needs co-owner, and is attributed to their seat (#562, #137)', async () => {
  const owner = await makeAccount('rename-owner@example.com');
  const grantee = await makeAccount('rename-grantee@example.com');
  const outsider = await makeAccount('rename-outsider@example.com');

  const shared = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Alte Runde', members: ['Owner'] })).body;
  // Seat the grantee and grant them access, exactly as invitation-accept does
  // (there is no route to create a grant here — see this file's header). The
  // seat must carry `userId`, or the rename has no actor to attribute to: a
  // grantee cannot claim a seat themselves (PATCH …/members answers 403
  // not_owner for them — .claude/rules/member-seat-self-claim.md).
  const seat = await repo.forTenant(owner.user.tenantId)
    .createMember(shared.id, { name: 'Grantee', userId: grantee.user.id });
  await repo.createGrant({
    roundId: shared.id, ownerTenantId: owner.user.tenantId, userId: grantee.user.id, memberId: seat.id,
  });

  // #137: the default role is `editor`, which may NOT rename. Asserted before the
  // promotion so the co-owner 200 below cannot pass vacuously — without this the
  // spec would be green against a build where the capability is never checked.
  const asEditor = await request(app).patch(`/api/rounds/${shared.id}`)
    .set(auth(grantee.token)).send({ name: 'Zu früh' });
  assert.equal(asEditor.status, 403);
  assert.equal(asEditor.body.error, 'not_owner');
  assert.equal((await request(app).get(`/api/rounds/${shared.id}`).set(auth(owner.token))).body.name, 'Alte Runde');

  await repo.updateGrantRole(shared.id, grantee.user.id, 'coowner');

  const res = await request(app).patch(`/api/rounds/${shared.id}`)
    .set(auth(grantee.token)).send({ name: 'Neue Runde' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Neue Runde');
  // The response keeps the markers GET sets, so a client replacing its round
  // object with it cannot silently start offering actions the role forbids.
  assert.equal(res.body.shared, true);
  assert.equal(res.body.role, 'coowner');

  // It landed in the OWNER's round, and the owner sees who did it.
  const ownerView = await request(app).get(`/api/rounds/${shared.id}`).set(auth(owner.token));
  assert.equal(ownerView.body.name, 'Neue Runde');
  assert.equal('shared' in ownerView.body, false);
  const acts = (await request(app).get(`/api/rounds/${shared.id}/activities`).set(auth(owner.token))).body
    .filter((a) => a.type === 'round_renamed');
  assert.equal(acts.length, 1);
  assert.equal(acts[0].actorMemberId, seat.id);

  // An outsider still cannot rename it — the round is simply not there for them.
  const denied = await request(app).patch(`/api/rounds/${shared.id}`)
    .set(auth(outsider.token)).send({ name: 'Gekapert' });
  assert.equal(denied.status, 404);
  assert.equal((await request(app).get(`/api/rounds/${shared.id}`).set(auth(owner.token))).body.name, 'Neue Runde');
});

test('moving games out of a shared round is owner-only (#411)', async () => {
  const owner = await makeAccount('move-owner@example.com');
  const grantee = await makeAccount('move-grantee@example.com');

  // The owner's shared round (with a game to move) plus a SEPARATE private round
  // the grantee holds no grant on — the target-round hole this guard closes.
  const shared = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Geteilte Runde', members: ['Owner'] })).body;
  await request(app).post(`/api/rounds/${shared.id}/games`).set(auth(owner.token))
    .send({ title: 'Catan', minPlayers: 2, maxPlayers: 4 });
  const private_ = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Privatrunde', members: ['Owner'] })).body;
  const granteeOwn = (await request(app).post('/api/rounds').set(auth(grantee.token))
    .send({ name: 'Eigene Runde', members: ['Grantee'] })).body;

  await repo.createGrant({ roundId: shared.id, ownerTenantId: owner.user.tenantId, userId: grantee.user.id });

  // A grantee may not move the shelf out of the shared round — whatever the
  // target is. 403 in every case, never a 404 that would confirm/deny that a
  // round of the owner's exists (same shape as the other owner-only guards).
  for (const targetRoundId of [granteeOwn.id, private_.id, shared.id, 'no-such-round']) {
    const res = await request(app).post(`/api/rounds/${shared.id}/games/move-to`)
      .set(auth(grantee.token)).send({ targetRoundId });
    assert.equal(res.status, 403, `move-to → ${targetRoundId}`);
    assert.equal(res.body.error, 'not_owner');
  }

  // Nothing moved anywhere: the shelf is untouched and the owner's private round
  // — which the grantee was never invited to — never received a game.
  const stillThere = await request(app).get(`/api/rounds/${shared.id}`).set(auth(owner.token));
  assert.deepEqual(stillThere.body.games.map((g) => g.title), ['Catan']);
  assert.equal((await request(app).get(`/api/rounds/${private_.id}`).set(auth(owner.token))).body.games.length, 0);

  // THE OWNER IS UNAFFECTED: the same call succeeds and actually moves the game.
  const moved = await request(app).post(`/api/rounds/${shared.id}/games/move-to`)
    .set(auth(owner.token)).send({ targetRoundId: private_.id });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.movedGames, 1);
  assert.deepEqual((await request(app).get(`/api/rounds/${private_.id}`).set(auth(owner.token)))
    .body.games.map((g) => g.title), ['Catan']);
});

/* Bulk shelf tidying (#832) costs exactly what each single-game counterpart
   costs — retiring is an ordinary write a grantee may do, deleting takes a
   game's whole rating history with it and is co-owner and up. That split lives
   in one table (lib/round-access.js), and the client hides what the server
   refuses; this is the server half. */
test('bulk-retire is open to a grantee, bulk-delete is co-owner and up (#832)', async () => {
  const owner = await makeAccount('bulk-owner@example.com');
  const grantee = await makeAccount('bulk-grantee@example.com');

  const shared = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Geteilte Runde', members: ['Owner'] })).body;
  const game = async (title) => (await request(app).post(`/api/rounds/${shared.id}/games`)
    .set(auth(owner.token)).send({ title, minPlayers: 2, maxPlayers: 4 })).body;
  const a = await game('Azul');
  const b = await game('Brass');

  const grant = { roundId: shared.id, ownerTenantId: owner.user.tenantId, userId: grantee.user.id };
  await repo.createGrant(grant);

  // A plain grantee (editor) may retire — it is reversible and the round's
  // content is exactly what sharing is for.
  const retire = await request(app).post(`/api/rounds/${shared.id}/games/bulk-retire`)
    .set(auth(grantee.token)).send({ gameIds: [a.id] });
  assert.equal(retire.status, 200);
  assert.equal(retire.body.retired, 1);

  // ...but may NOT delete. Were this open, the bulk route would be a way around
  // the co-owner guard on DELETE …/games/:gid.
  const del = await request(app).post(`/api/rounds/${shared.id}/games/bulk-delete`)
    .set(auth(grantee.token)).send({ gameIds: [a.id, b.id] });
  assert.equal(del.status, 403);
  assert.equal((await request(app).get(`/api/rounds/${shared.id}`).set(auth(owner.token)))
    .body.games.length, 2, 'nothing was deleted');

  // A co-owner may — the destructive action an owner can delegate.
  await repo.updateGrantRole(shared.id, grantee.user.id, 'coowner');
  const asCoowner = await request(app).post(`/api/rounds/${shared.id}/games/bulk-delete`)
    .set(auth(grantee.token)).send({ gameIds: [a.id, b.id] });
  assert.equal(asCoowner.status, 200);
  assert.equal((await request(app).get(`/api/rounds/${shared.id}`).set(auth(owner.token)))
    .body.games.length, 0);
});

// Seed a shared round: owner's round, one member linked to the grantee + a grant.
async function seedShare(owner, grantee, seatName = 'Anna') {
  const round = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Geteilt', members: [seatName, 'Bob'] })).body;
  // By NAME, not index — since #421 members[0] is the owner's own auto-seat, and
  // seating the grantee there would make this fixture quietly nonsensical.
  const seat = round.members.find((m) => m.name === seatName);
  await repo.forTenant(owner.user.tenantId).updateMember(round.id, seat.id, { userId: grantee.user.id });
  await repo.createGrant({ roundId: round.id, ownerTenantId: owner.user.tenantId, userId: grantee.user.id, memberId: seat.id });
  return { round, seatId: seat.id };
}

// #421: the seat link is the one member field a grantee may not touch. Their
// seat is linked at accept and released by DELETE …/shares/:userId, which drops
// the grant and the link together — patching it here would desync
// round_grants.memberId from the seat.
test('a grantee may rename their seat but not re-link it (#421)', async () => {
  const owner = await makeAccount('seat-owner@example.com');
  const grantee = await makeAccount('seat-grantee@example.com');
  const s = await seedShare(owner, grantee);
  const patch = (body) => request(app).patch(`/api/rounds/${s.round.id}/members/${s.seatId}`)
    .set(auth(grantee.token)).send(body);

  const rename = await patch({ name: 'Annika' });
  assert.equal(rename.status, 200);
  assert.equal(rename.body.name, 'Annika');

  for (const body of [{ userId: null }, { userId: grantee.user.id }, { userId: owner.user.id }]) {
    const res = await patch(body);
    assert.equal(res.status, 403, JSON.stringify(body));
    assert.equal(res.body.error, 'not_owner');
  }
  // Still seated, still granted: nothing above half-applied.
  const seat = (await request(app).get(`/api/rounds/${s.round.id}`).set(auth(grantee.token)))
    .body.members.find((m) => m.id === s.seatId);
  assert.equal(seat.userId, grantee.user.id);
});

test('revoke / leave a share: access ends, the seat is unlinked but kept', async () => {
  const owner = await makeAccount('rev-owner@example.com');
  const grantee = await makeAccount('rev-grantee@example.com');
  const other = await makeAccount('rev-other@example.com');

  // OWNER revokes the grantee.
  let s = await seedShare(owner, grantee);
  assert.equal((await request(app).get(`/api/rounds/${s.round.id}`).set(auth(grantee.token))).status, 200); // has access
  const rev = await request(app).delete(`/api/rounds/${s.round.id}/shares/${grantee.user.id}`).set(auth(owner.token));
  assert.equal(rev.status, 204);
  assert.equal((await request(app).get(`/api/rounds/${s.round.id}`).set(auth(grantee.token))).status, 404); // access ended
  assert.equal((await request(app).get('/api/rounds').set(auth(grantee.token))).body.some((r) => r.id === s.round.id), false); // off home
  // The seat is KEPT, just unlinked — its ratings/history stay on the round.
  const membersAfter = (await request(app).get(`/api/rounds/${s.round.id}`).set(auth(owner.token))).body.members;
  assert.equal(membersAfter.length, 3); // owner's own seat (#421) + 'Owner' + the grantee's

  assert.ok(!membersAfter.find((m) => m.id === s.seatId).userId); // unlinked (null), seat kept

  // GRANTEE leaves on their own.
  s = await seedShare(owner, grantee);
  const leave = await request(app).delete(`/api/rounds/${s.round.id}/shares/${grantee.user.id}`).set(auth(grantee.token));
  assert.equal(leave.status, 204);
  assert.equal((await request(app).get(`/api/rounds/${s.round.id}`).set(auth(grantee.token))).status, 404);

  // A grantee may NOT revoke a different account's share, only their own.
  s = await seedShare(owner, grantee);
  await repo.createGrant({ roundId: s.round.id, ownerTenantId: owner.user.tenantId, userId: other.user.id });
  assert.equal((await request(app).delete(`/api/rounds/${s.round.id}/shares/${other.user.id}`).set(auth(grantee.token))).status, 403);
  // Revoking someone who holds no share is a 404.
  assert.equal((await request(app).delete(`/api/rounds/${s.round.id}/shares/${'ffffffffffffffff'}`).set(auth(owner.token))).status, 404);
});

test('deleting a round revokes its grants and cancels its pending invitations', async () => {
  const owner = await makeAccount('del-owner@example.com');
  const grantee = await makeAccount('del-grantee@example.com');
  const invited = await makeAccount('del-invited@example.com');

  const s = await seedShare(owner, grantee);
  // A pending invitation to a THIRD account (lands an inbox item).
  await request(app).post('/api/account/invitations').set(auth(owner.token))
    .send({ roundId: s.round.id, username: 'del-invited' });
  assert.equal((await request(app).get('/api/account/inbox').set(auth(invited.token))).body.items
    .some((i) => i.type === 'round_invitation'), true);

  // Owner deletes the round.
  assert.equal((await request(app).delete(`/api/rounds/${s.round.id}`).set(auth(owner.token))).status, 200);

  // The grantee's grant is gone (home empty), and the invitee's stale invite is cleared.
  assert.equal((await request(app).get('/api/rounds').set(auth(grantee.token))).body.some((r) => r.id === s.round.id), false);
  assert.equal((await request(app).get('/api/account/inbox').set(auth(invited.token))).body.items
    .some((i) => i.type === 'round_invitation'), false);
});

test('a game a grantee adds to a shared round is attributed to their member seat (#207)', async () => {
  const owner = await makeAccount('attr-owner@example.com');
  const grantee = await makeAccount('attr-grantee@example.com');
  const s = await seedShare(owner, grantee); // grantee is linked to the seat s.seatId

  await request(app).post(`/api/rounds/${s.round.id}/games`).set(auth(grantee.token))
    .send({ title: 'Catan', minPlayers: 2, maxPlayers: 4 });

  const feed = (await request(app).get(`/api/rounds/${s.round.id}/activities`).set(auth(owner.token))).body;
  const added = feed.find((a) => a.type === 'game_added' && a.title === 'Catan');
  assert.equal(added.actorMemberId, s.seatId); // recorded as the grantee's seat
});

/* #682's read is mounted under /api/rounds/:rid, so it inherits both the grant
 * resolver and the role gate rather than carrying access rules of its own. That
 * inheritance is the whole security story for it, and it is worth an explicit
 * probe: the round's shelf and ratings are the profile, so a leak here would
 * expose one tenant's taste to another. It is a GET, so it is deliberately
 * absent from lib/round-access.js's table
 * (.claude/rules/round-roles-are-a-chokepoint.md).
 */
test('recommendations follow the grant: the grantee reads them, an outsider gets 404 (#682)', async () => {
  const owner = await makeAccount('rec-owner@example.com');
  const grantee = await makeAccount('rec-grantee@example.com');
  const outsider = await makeAccount('rec-outsider@example.com');

  const shared = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Empfehlungsrunde', members: ['Owner'] })).body;
  await repo.createGrant({ roundId: shared.id, ownerTenantId: owner.user.tenantId, userId: grantee.user.id });

  const asGrantee = await request(app).get(`/api/rounds/${shared.id}/recommendations`).set(auth(grantee.token));
  assert.equal(asGrantee.status, 200);
  // The shelf is empty here, so the honest answer is the cold start — what
  // matters is that the grantee is answered ABOUT THE OWNER'S ROUND at all.
  assert.deepEqual(asGrantee.body.recommendations, []);
  assert.equal(asGrantee.body.minProfileGames > 0, true);

  // An account with no grant must not learn that the round exists.
  assert.equal((await request(app).get(`/api/rounds/${shared.id}/recommendations`).set(auth(outsider.token))).status, 404);
  // Nor may an unauthenticated caller.
  assert.equal((await request(app).get(`/api/rounds/${shared.id}/recommendations`)).status, 401);
});
