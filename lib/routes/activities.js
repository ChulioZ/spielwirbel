'use strict';

/* Route for a round's activity feed: list it, delete a single entry.
   Mounted under /api/rounds/:rid/activities (mergeParams for rid). The feed is
   not part of the round payload (issue #197) — Chronik fetches it here. */

const express = require('express');

// The GLOBAL, un-scoped repo, deliberately not req.repo: a grant is cross-tenant
// by nature and absent from TENANT_METHODS (.claude/rules/postgres-backend.md).
// This is the same call resolveRoundGrant makes.
const repo = require('../repo');

const router = express.Router({ mergeParams: true });

/* Drop the reference to the round on the other side of a bulk move/copy (#1007).
   Returns a NEW object — the JSON backend hands back its live in-memory rows, so
   deleting the keys in place would redact them for the owner too, permanently.
   The keys are removed rather than nulled: absent is what the Chronik branches
   on when it picks the generic wording. */
const stripRoundRef = (a) => {
  const rest = { ...a };
  delete rest.roundId;
  delete rest.roundName;
  return rest;
};

router.get('/', async (req, res) => {
  const activities = await req.repo.listActivities(req.params.rid);
  if (!activities) return res.status(404).json({ error: 'Round not found' });

  /* The four bulk move/copy events store the other round's id AND name, and a
     round name is user-chosen free text. Every grantee reads the whole feed, so
     without this a grantee of round B learns that a round called „…" exists —
     one the owner never invited them to. Storage stays unredacted on purpose:
     it is what this keys off, and it keeps historical rows right for the owner.

     Keyed on req.grant, NOT req.userId. The owner holds no grant on their own
     round — and in legacy/shared-password mode there are no accounts and no
     grants at all — so keying on the account id would redact for the owner too.
     roundId appears in no other activity type, so no per-type table is needed
     and a fifth such event stays covered. */
  // The `.some` guard keeps the extra grant lookup off the common path: most
  // feeds carry no cross-round reference at all.
  if (req.grant && activities.some((a) => a.roundId)) {
    const visible = new Set((await repo.listGrantsForUser(req.userId)).map((g) => g.roundId));
    return res.json(activities.map((a) => (a.roundId && !visible.has(a.roundId) ? stripRoundRef(a) : a)));
  }
  res.json(activities);
});

router.delete('/:aid', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const deleted = await req.repo.deleteActivity(req.params.rid, req.params.aid);
  if (!deleted) return res.status(404).json({ error: 'Activity not found' });
  res.json({ ok: true });
});

module.exports = router;
