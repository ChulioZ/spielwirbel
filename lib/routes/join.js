'use strict';

/*
 * Joining a round through an invite link (issue #1515) — the account's side.
 *
 * Mounted at /api/account/join beside the invitation routes, and for their
 * reason: the person joining is a stranger to the round's tenant until this
 * succeeds, so it runs before the /api tenant gate and resolves the owner's
 * tenant itself — from the link, the way /api/vote resolves it from a vote
 * link. An account is required (operator decision on #1515): the link is a way
 * to REACH someone, never a way around registering.
 *
 * The token travels in the BODY, never in the path. A path is what the request
 * logger records (.claude/rules/secrets-in-paths-reach-the-logs.md), so the API
 * half of this feature cannot leak the credential by construction; only the
 * page itself (/join/<token>) is a path, and lib/observability.js redacts it.
 *
 * ## The gate re-reads the target every time
 *
 * `openInviteLink` validates the round and the seat on every request, never the
 * row alone (.claude/rules/capability-links-gate-on-the-target.md): a link whose
 * round was deleted, or whose seat was taken by an ordinary invitation in the
 * meantime, is dead whatever its row says. Every such refusal is the same
 * `404 invalid_link`, byte for byte — a distinct "expired" would confirm to a
 * stranger that the token they tried is real.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../repo');
const accounts = require('../accounts');
const demo = require('../demo');
const quota = require('../quota');
const { validateBody } = require('../validate');
const { isInviteLinkExpired } = require('../invite-link');

const router = express.Router();

router.use((req, res, next) => {
  if (!accounts.accountsEnabled()) return res.status(404).json({ error: 'accounts_disabled' });
  next();
});

// 32 random bytes would be 43 characters; the cap only stops an absurd body.
const tokenSchema = z.object({ token: z.string().min(1).max(200) });

const invalid = (res) => res.status(404).json({ error: 'invalid_link' });

async function openInviteLink(token) {
  const link = await repo.findRoundInviteLink(token);
  if (!link || isInviteLinkExpired(link)) return null;
  const ownerRepo = repo.forTenant(link.ownerTenantId);
  const round = await ownerRepo.getRoundMeta(link.roundId);
  if (!round) return null;
  let seat = null;
  if (link.memberId) {
    seat = round.members.find((m) => m.id === link.memberId);
    if (!seat || seat.userId || seat.retired) return null;
  }
  return { link, round, seat, ownerRepo };
}

// Who may join, asked identically by the preview and the join so the
// confirmation never offers something the button then refuses. Returns an
// error code, or null when the caller may proceed.
//
// The account checks are spelled out because this mount sits before withTenant,
// which is where a suspended or erased account is otherwise stopped — the bare
// token check in accounts.requireUser does not look.
async function refusal(userId, opened) {
  const user = await repo.getUserById(userId);
  if (!user) return [401, 'auth_required'];
  if (user.disabled) return [403, 'account_disabled'];
  if (demo.isDemoUser(user)) return [403, 'demo_forbidden'];
  // The owner opening their own link. Caught here rather than by the seat check:
  // an owner who created the round without a seat holds none for it to find.
  if (user.tenantId === opened.link.ownerTenantId) return [409, 'own_round'];
  if (opened.round.members.some((m) => m.userId === userId)
    || (await repo.listGrantsForUser(userId)).some((g) => g.roundId === opened.link.roundId)) {
    return [409, 'already_member'];
  }
  // A fresh seat counts against the round's member quota exactly like the
  // owner adding one by hand (lib/routes/members.js) — the bound #1515 relies on
  // instead of a per-link cap.
  if (!opened.seat && quota.enforced() && opened.round.members.length >= quota.membersPerRound()) {
    return [403, 'quota_members'];
  }
  return null;
}

// What the confirmation card shows. Only the round's name and the seat's —
// nothing a link holder could not already be told by the person who sent it.
router.post('/preview', accounts.requireUser, async (req, res) => {
  const body = validateBody(tokenSchema, req, res);
  if (!body) return;
  const opened = await openInviteLink(body.token);
  if (!opened) return invalid(res);
  const refused = await refusal(req.userId, opened);
  if (refused) return res.status(refused[0]).json({ error: refused[1] });
  res.json({ roundName: opened.round.name, seatName: opened.seat ? opened.seat.name : null });
});

router.post('/', accounts.requireUser, async (req, res) => {
  const body = validateBody(tokenSchema, req, res);
  if (!body) return;
  const opened = await openInviteLink(body.token);
  if (!opened) return invalid(res);
  const refused = await refusal(req.userId, opened);
  if (refused) return res.status(refused[0]).json({ error: refused[1] });
  const { link, ownerRepo } = opened;

  // One atomic write (#1604): a seat link is consumed — of two people racing
  // for one seat exactly one gets it — the seat is re-checked under a lock, a
  // fresh seat is counted against the member quota in the same critical
  // section, and the grant (always an editor, #1515) is created with them, or
  // none of it is. A refusal that surfaces only here means the link died
  // between the gate and this write: the same uniform 404, naming no winner.
  const user = await repo.getUserById(req.userId);
  const joined = await ownerRepo.joinRound(link.roundId, {
    userId: req.userId,
    memberId: link.memberId || null,
    memberName: (user && user.username) || 'Gast',
    role: 'editor',
    // A seat link is consumed; a fresh-seat link is only re-checked, so one
    // revoked or replaced since the gate refuses the join.
    claim: link.memberId ? { link: link.id } : { link: link.id, consume: false },
    memberLimit: quota.enforced() ? quota.membersPerRound() : null,
  });
  if (joined === 'already_member') return res.status(409).json({ error: 'already_member' });
  if (joined === 'quota_members') return res.status(403).json({ error: 'quota_members' });
  if (typeof joined === 'string') return invalid(res);
  res.json({ roundId: link.roundId });
});

module.exports = router;
