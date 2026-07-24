'use strict';

/* Routes for rounds: list, detail, create (optionally importing games), delete. */

const express = require('express');
const { z } = require('zod');
const repo = require('../lib/repo');
const storage = require('../lib/storage');
const { validateBody } = require('../lib/validate');
const quota = require('../lib/quota');
const { trackEvent, logger } = require('../lib/observability');

const router = express.Router();

// Create-round body. `members` is normalized (each entry stringified, trimmed,
// blanks dropped) before the non-empty check, mirroring the old hand-rolled
// clean-then-validate. `importFromRoundId` is passed through untouched.
const createRoundSchema = z.object({
  name: z.preprocess((v) => String(v || '').trim(), z.string().min(1, 'Round name is missing')),
  members: z
    .preprocess(
      (v) => (Array.isArray(v) ? v.map((m) => String(m || '').trim()).filter(Boolean) : []),
      z.array(z.string()).min(1, 'At least one member is required')
    ),
  importFromRoundId: z.unknown().optional(),
});

// Compact list for the home screen: identity, live counts, the round's design
// and a "last played" highlight so the lobby cards can tell each round's story.
// Computed by the data layer (listRoundSummaries) so the Postgres backend can
// answer it in one small statement instead of assembling every game/session of
// the tenant just to count them — the response shape is unchanged.
router.get('/', async (req, res) => {
  const own = await req.repo.listRoundSummaries();
  // #207 home-merge: append the rounds the caller has been GRANTED (each fetched
  // as its own single-round summary under the OWNER tenant, so we never read the
  // owner's other rounds), flagged `shared` so the UI can mark them and hide
  // owner-only actions. req.userId is set only in accounts mode, so legacy mode
  // returns own rounds exactly as before. A grant whose round is gone (owner
  // deleted it) yields null and is skipped.
  const shared = [];
  if (req.userId) {
    for (const g of await repo.listGrantsForUser(req.userId)) {
      const summary = await repo.forTenant(g.ownerTenantId).getRoundSummary(g.roundId);
      if (summary) shared.push({ ...summary, shared: true });
    }
  }
  res.json([...own, ...shared]);
});

router.get('/:rid', async (req, res) => {
  const round = await req.repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  // Tell the client when it reached this round through a GRANT rather than owning
  // it (resolveRoundGrant sets req.grant), so the UI marks it shared and hides
  // owner-only actions. Owners get the round unchanged (no extra key).
  res.json(req.grant ? { ...round, shared: true } : round);
});

router.post('/', async (req, res) => {
  const body = validateBody(createRoundSchema, req, res);
  if (!body) return;

  // Per-tenant round cap (#139): only in the public multi-tenant mode, so
  // today's single-tenant instance is unaffected. A state cap — count the
  // tenant's current rounds; deleting one frees a slot.
  if (quota.enforced()) {
    const limit = quota.roundsPerTenant();
    // Summaries, not full rounds: only the count matters here, and the summary
    // read doesn't drag every game/session row out of the database.
    const rounds = await req.repo.listRoundSummaries();
    if (rounds.length >= limit) {
      return res.status(403).json({ error: 'quota_rounds', limit });
    }
  }

  // The data layer mints ids and (optionally) copies the games list
  // (title/type/image only) from an existing round.
  const round = await req.repo.createRound({
    name: body.name,
    members: body.members,
    importFromRoundId: body.importFromRoundId || null,
  });
  trackEvent('round_created', { tenantId: req.tenantId });
  res.status(201).json(round);
});

router.delete('/:rid', async (req, res) => {
  // A grant lets a grantee act WITHIN a shared round, never destroy the owner's
  // whole round — that stays owner-only (#207). req.grant is set by
  // resolveRoundGrant only when the caller reached this round through a grant
  // rather than owning it; without a grant this is undefined and owners delete
  // normally. (Per-action roles are #137; deleting the round is the one clear
  // owner-only line this slice draws.)
  if (req.grant) return res.status(403).json({ error: 'not_owner' });

  // The data layer hands back the cover paths the round freed — it is the only
  // place that can still see them, since the games cascade away with the round.
  const deleted = await req.repo.deleteRound(req.params.rid);
  if (deleted === null) return res.status(404).json({ error: 'Round not found' });

  // Rows first, bytes second (as in the game delete and the admin erasure): the
  // references are already gone, so a failed object delete leaves an orphaned
  // file, never a broken cover. The round IS deleted at this point, so nothing
  // in here may throw its way into a 500 — the whole loop body is guarded and a
  // failure is logged and stepped over, never surfaced as a failed deletion.
  // The isImageReferenced check matters because createRound's importFromRoundId
  // copies a cover path across rounds rather than the file; storage.remove
  // ignores hotlinked provider URLs by construction (#172).
  for (const image of deleted.images) {
    try {
      if (!(await req.repo.isImageReferenced(image))) await storage.remove(image);
    } catch (err) {
      logger.error({ event: 'round_delete_object_failed', err: err.message });
    }
  }

  // #207: the round is gone, so no share may survive it. Its grants and
  // invitations live in GLOBAL stores that deleteRound above didn't touch —
  // revoke every grant and cancel every pending invitation, clearing the
  // invitees' now-un-actionable inbox items.
  for (const g of await repo.listGrantsForRound(req.params.rid)) {
    await repo.deleteGrant(req.params.rid, g.userId);
  }
  for (const v of await repo.listInvitationsForRound(req.params.rid)) {
    if (v.status !== 'pending') continue;
    await repo.resolveInvitation(v.id, 'declined');
    const item = (await repo.listInbox(v.inviteeUserId)).find(
      (it) => it.type === 'round_invitation' && it.payload && it.payload.invitationId === v.id);
    if (item) await repo.dismissInboxItem(v.inviteeUserId, item.id);
  }

  res.json({ ok: true });
});

// #207: revoke a share (owner removes a grantee) or LEAVE one (grantee removes
// their own). The grant is deleted and the freed member seat is UNLINKED but
// kept — its ratings and session history stay on the round. A grantee may only
// remove their OWN share; the owner may remove any. Either way req.repo is scoped
// to the owner tenant (the owner's own, or a grantee's grant re-scope), so the
// member unlink lands on the right round.
router.delete('/:rid/shares/:userId', async (req, res) => {
  const target = req.params.userId;
  if (req.grant && target !== req.userId) return res.status(403).json({ error: 'not_owner' });
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'round_not_found' });

  const removed = await repo.deleteGrant(req.params.rid, target);
  if (!removed) return res.status(404).json({ error: 'not_shared' });
  if (removed.memberId) {
    const member = round.members.find((m) => m.id === removed.memberId);
    if (member && member.userId === target) {
      await req.repo.updateMember(req.params.rid, removed.memberId, { userId: null });
    }
  }
  res.status(204).end();
});

module.exports = router;
