'use strict';

/*
 * Round-sharing invitations (issue #207) — send / accept / decline.
 *
 * Mounted at /api/account/invitations, so these are account-scoped actions (the
 * inviter owns the round; the invitee is a stranger to that tenant and reaches
 * this before the /api tenant gate). Each handler resolves the tenant it needs
 * itself, on the module-level repo. Delivery is the inbox (#207 slice 1): send
 * writes a `round_invitation` item; accept/decline dismiss it.
 *
 * The inviter FIXES the seat decision at send time — a specific user-less member
 * to take over (memberId), or a fresh member (memberId omitted). The invitee
 * never chooses, so they can't take over the wrong person. The seat is validated
 * at send AND re-validated at accept (it can be taken/renamed/deleted between),
 * refusing with a distinct code rather than silently creating a new member.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../lib/repo');
const accounts = require('../lib/accounts');
const { validateBody } = require('../lib/validate');

const router = express.Router();

// Env-gated like the rest of the account surface (routes/account.js): invisible
// (404) unless accounts are on.
router.use((req, res, next) => {
  if (!accounts.accountsEnabled()) return res.status(404).json({ error: 'accounts_disabled' });
  next();
});

const sendSchema = z.object({
  roundId: z.string().min(1),
  username: z.string().min(1),
  // Omitted / null => create a fresh member on accept; a string => take over that seat.
  memberId: z.string().min(1).nullish(),
});

// The member seat a userId currently holds in a round, if any (the
// at-most-one-member-per-round invariant, both here and at accept).
const seatOf = (round, userId) => round.members.find((m) => m.userId === userId);

// Dismiss the invitee's inbox item for this invitation (delivery is the inbox;
// resolving the invitation must clear its notification). Best-effort by design.
async function dismissInvitationInbox(userId, invitationId) {
  const item = (await repo.listInbox(userId)).find(
    (it) => it.type === 'round_invitation' && it.payload && it.payload.invitationId === invitationId);
  if (item) await repo.dismissInboxItem(userId, item.id);
}

/* ---------------------------------- send ----------------------------------- */
// The round's OWNER invites an account by username, choosing the seat. Owner-only:
// ownership is proven by the round being visible in the caller's OWN tenant.
router.post('/', accounts.requireUser, async (req, res) => {
  const body = validateBody(sendSchema, req, res);
  if (!body) return;

  const caller = await repo.getUserById(req.userId);
  if (!caller) return res.status(401).json({ error: 'auth_required' });

  // Ownership: the round must live in the caller's own tenant. A grantee (or
  // anyone else) simply can't see it here, so this doubles as the owner check.
  const ownerRepo = repo.forTenant(caller.tenantId);
  const round = await ownerRepo.getRoundMeta(body.roundId);
  if (!round) return res.status(404).json({ error: 'round_not_found' });

  // The invitee is addressed by their public username (#320). Unknown handle is a
  // plain 404 — a username is public, so this reveals nothing an owner shouldn't see.
  const invitee = await repo.getUserByUsername(body.username);
  if (!invitee) return res.status(404).json({ error: 'user_not_found' });
  if (invitee.id === caller.id) return res.status(400).json({ error: 'cannot_invite_self' });

  // At most one member per user per round — the invitee must not already hold a seat.
  if (seatOf(round, invitee.id)) return res.status(409).json({ error: 'already_member' });

  // One pending invite per (round, invitee) — no duplicate notifications.
  const pending = (await repo.listInvitationsForRound(body.roundId))
    .some((i) => i.status === 'pending' && i.inviteeUserId === invitee.id);
  if (pending) return res.status(409).json({ error: 'already_invited' });

  // The seat decision: if the inviter named one, it must be a real, user-LESS seat.
  let seat = null;
  if (body.memberId) {
    seat = round.members.find((m) => m.id === body.memberId);
    if (!seat) return res.status(400).json({ error: 'invalid_seat' });
    if (seat.userId) return res.status(400).json({ error: 'seat_taken' });
  }

  const inv = await repo.createInvitation({
    roundId: body.roundId,
    ownerTenantId: caller.tenantId,
    inviterUserId: caller.id,
    inviteeUserId: invitee.id,
    memberId: body.memberId || null,
  });

  await repo.addInboxItem(invitee.id, {
    type: 'round_invitation',
    payload: {
      invitationId: inv.id,
      roundId: body.roundId,
      roundName: round.name,
      inviterUsername: caller.username || null,
      memberName: seat ? seat.name : null, // null => a fresh member on accept
    },
  });

  res.status(201).json({ invitation: inv });
});

/* --------------------------------- accept ---------------------------------- */
// The INVITEE accepts. Re-validates the round + seat, atomically claims the
// pending invitation, then creates the seat (take-over or fresh) and the grant.
router.post('/:id/accept', accounts.requireUser, async (req, res) => {
  const inv = await repo.getInvitation(req.params.id);
  // Not addressed to this account => indistinguishable from missing.
  if (!inv || inv.inviteeUserId !== req.userId) return res.status(404).json({ error: 'not_found' });
  if (inv.status !== 'pending') return res.status(409).json({ error: 'not_pending' });

  const ownerRepo = repo.forTenant(inv.ownerTenantId);
  const round = await ownerRepo.getRoundMeta(inv.roundId);

  // The round can vanish between send and accept — clean the invite up rather
  // than leaving it stuck pending.
  if (!round) {
    await repo.resolveInvitation(inv.id, 'declined');
    await dismissInvitationInbox(req.userId, inv.id);
    return res.status(410).json({ error: 'round_gone' });
  }
  // Re-check the invariant: the invitee may have gained a seat since the invite.
  if (seatOf(round, req.userId)) {
    await repo.resolveInvitation(inv.id, 'declined');
    await dismissInvitationInbox(req.userId, inv.id);
    return res.status(409).json({ error: 'already_member' });
  }
  // Re-validate the chosen seat: it can be taken, renamed or deleted in between.
  // On a conflict, REFUSE with a distinct code — never silently fall back to a
  // fresh member (that puts a duplicate person on the shelf, #207).
  if (inv.memberId) {
    const seat = round.members.find((m) => m.id === inv.memberId);
    if (!seat || seat.userId) {
      await repo.resolveInvitation(inv.id, 'declined');
      await dismissInvitationInbox(req.userId, inv.id);
      return res.status(409).json({ error: 'seat_unavailable' });
    }
  }

  // Atomically claim the pending invitation FIRST, so two concurrent accepts
  // can't both create a seat/grant (the loser gets null → 409).
  if (!(await repo.resolveInvitation(inv.id, 'accepted'))) {
    return res.status(409).json({ error: 'not_pending' });
  }

  // Give the invitee their seat: take over the chosen one, or create a fresh
  // member named after their public username (#320).
  let memberId = inv.memberId;
  if (memberId) {
    await ownerRepo.updateMember(inv.roundId, memberId, { userId: req.userId });
  } else {
    const invitee = await repo.getUserById(req.userId);
    const member = await ownerRepo.createMember(inv.roundId, { name: (invitee && invitee.username) || 'Gast', userId: req.userId });
    memberId = member.id;
  }

  await repo.createGrant({
    roundId: inv.roundId, ownerTenantId: inv.ownerTenantId, userId: req.userId, memberId, role: 'member',
  });
  await dismissInvitationInbox(req.userId, inv.id);

  // The round id lets the client route straight into the now-shared round.
  res.json({ roundId: inv.roundId });
});

/* --------------------------------- decline --------------------------------- */
router.post('/:id/decline', accounts.requireUser, async (req, res) => {
  const inv = await repo.getInvitation(req.params.id);
  if (!inv || inv.inviteeUserId !== req.userId) return res.status(404).json({ error: 'not_found' });
  if (!(await repo.resolveInvitation(inv.id, 'declined'))) return res.status(409).json({ error: 'not_pending' });
  await dismissInvitationInbox(req.userId, inv.id);
  res.status(204).end();
});

module.exports = router;
