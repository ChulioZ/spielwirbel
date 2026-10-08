'use strict';

/*
 * The owner's side of round invite links (issue #1515): mint, list, revoke.
 *
 * Mounted at /api/rounds/:rid/invite-links, behind the tenant gate and the
 * grant resolver like every round route. Managing who may join is access
 * control, so all three are `round.shares.manage` (owner-only): the two writes
 * through lib/round-access.js's table, the read by its own line here, because
 * that table gates mutating methods only — the same split as GET …/shares.
 *
 * A link hands out exactly one seat decision, fixed by the owner here and never
 * by the person who opens it (the #207 invitation rule): a FRESH seat (reusable
 * until it expires) or one specific unclaimed seat (single-use). The account
 * side — preview and join — is lib/routes/join.js.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../repo');
const accounts = require('../accounts');
const demo = require('../demo');
const quota = require('../quota');
const { validateBody } = require('../validate');
const { can } = require('../../public/js/round-roles');
const { isInviteLinkExpired, inviteLinkExpiresAt } = require('../invite-link');

const router = express.Router({ mergeParams: true });

// The fresh-seat link's slot name in the revoke path.
const FRESH_SLOT = 'fresh';

// Joining needs an account, so on an accounts-off instance there is nothing a
// link could ever do — invisible, like the invitation routes.
router.use((req, res, next) => {
  if (!accounts.accountsEnabled()) return res.status(404).json({ error: 'accounts_disabled' });
  next();
});

const mintSchema = z.object({
  // Omitted / null => a fresh seat; a string => that unclaimed seat.
  memberId: z.string().min(1).nullish(),
});

// A seat a link may hand out: present, not retired, and nobody's yet. The join
// route asks the same question again on every request (lib/routes/join.js).
const isOpenSeat = (seat) => !!seat && !seat.userId && !seat.retired;

// What the owner's sheet needs. The token rides along on purpose — the owner has
// to be able to copy the link again — and this is the one listing of tokens the
// app has, behind the one role allowed to hand them out.
function present(link, round) {
  const seat = link.memberId ? round.members.find((m) => m.id === link.memberId) : null;
  return {
    token: link.id,
    slot: link.memberId || FRESH_SLOT,
    memberId: link.memberId || null,
    seatName: seat ? seat.name : null,
    expiresAt: inviteLinkExpiresAt(link),
  };
}

// Only links that would still work: an expired one, or a seat link whose seat
// has since been taken or retired, is dead weight the owner cannot act on.
router.get('/', async (req, res) => {
  if (!can(req.roundRole, 'round.shares.manage')) return res.status(403).json({ error: 'not_owner' });
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'round_not_found' });
  const links = (await repo.listRoundInviteLinks(req.params.rid)).filter((l) => !isInviteLinkExpired(l)
    && (!l.memberId || isOpenSeat(round.members.find((m) => m.id === l.memberId))));
  res.json(links.map((l) => present(l, round)));
});

// Mint — or REPLACE: a second link for the same slot retires the first, which is
// also how an owner kills a link that went somewhere it should not have.
router.post('/', demo.refuseDemoAccount, async (req, res) => {
  const body = validateBody(mintSchema, req, res);
  if (!body) return;
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'round_not_found' });
  const memberId = body.memberId || null;
  if (memberId) {
    const seat = round.members.find((m) => m.id === memberId);
    if (!seat || seat.retired) return res.status(400).json({ error: 'invalid_seat' });
    if (seat.userId) return res.status(400).json({ error: 'seat_taken' });
  } else if (quota.enforced() && round.members.length >= quota.membersPerRound()) {
    // A fresh-seat link on a full round could never be used; say so now rather
    // than at the stranger's end of it.
    return res.status(403).json({ error: 'quota_members', limit: quota.membersPerRound() });
  }
  const link = await repo.createRoundInviteLink({ roundId: req.params.rid, ownerTenantId: req.tenantId, memberId });
  res.status(201).json({ link: present(link, round) });
});

// Revoke, addressed by SLOT ('fresh' or the seat's member id) rather than by
// token: a path is what the request logger records, and the slot is not secret.
router.delete('/:slot', async (req, res) => {
  const want = req.params.slot === FRESH_SLOT ? null : req.params.slot;
  const link = (await repo.listRoundInviteLinks(req.params.rid)).find((l) => (l.memberId || null) === want);
  if (!link) return res.status(404).json({ error: 'not_found' });
  await repo.deleteRoundInviteLink(link.id);
  res.status(204).end();
});

module.exports = router;
