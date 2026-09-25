'use strict';

/*
 * Notice handling proper (#268/#275): locate a reported image, read a round's user-authored text, redact one field of it, take a cover down.
 *
 * One of the operator router's sub-routers (#996). Mounted by
 * lib/routes/admin/index.js, which owns the /api/admin prefix, the
 * ADMIN_PASSWORD gate and the single mount in lib/app.js.
 *
 * Like every handler here it uses the module-level `repo`, NOT req.repo:
 * moderation is deliberately cross-tenant (a notice names an image, not a
 * tenant), which is exactly why the moderation methods are absent from
 * TENANT_METHODS. The tenant middleware never runs for this router. See
 * .claude/rules/admin-moderation-surface.md.
 */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../../validate');
const repo = require('../../repo');
const storage = require('../../storage');
const quota = require('../../quota');
const { logger } = require('../../observability');
const { reasonSchema, imageSchema, idSchema } = require('./shared');
const router = express.Router();

/* --------------------------------- lookup ---------------------------------- */


// Sizing an object costs one stat/HeadObject each, so a tenant sitting at the
// games quota would otherwise fire thousands of requests to answer one panel
// card. Past this many covers the count is still exact and `bytes` becomes a
// documented lower bound (the panel renders it with a "≥").
const SIZE_SAMPLE_MAX = 500;

// Total bytes this tenant occupies in OUR storage. Provider covers are hotlinked
// (#172) and cost us nothing, so isHostedImage filters them out rather than
// counting someone else's CDN as our storage. A size that can't be determined
// (missing object, transport error) is skipped, never guessed.
async function uploadUsage(images) {
  const hosted = (images || []).filter(storage.isHostedImage);
  const sample = hosted.slice(0, SIZE_SAMPLE_MAX);
  const sizes = await Promise.all(sample.map((p) => storage.size(p).catch(() => null)));
  const known = sizes.filter((n) => typeof n === 'number');
  return {
    count: hosted.length,
    sized: known.length,
    bytes: known.reduce((n, b) => n + b, 0),
    complete: known.length === hosted.length,
  };
}

// Everything the operator needs about one tenant once it has been identified,
// whichever way the notice named it. The ceilings ride along so the panel can
// show usage against them (#275 item 5) — it decides what counts as "close to
// the cap"; this reports the numbers, the same division of labour the status
// card uses (.claude/rules/admin-moderation-surface.md).
async function tenantPayload(tenantId) {
  const summary = await repo.tenantSummary(tenantId);
  const users = (await repo.listUsers())
    .filter((u) => (u.tenantId || null) === tenantId)
    .map((u) => ({ id: u.id, email: u.email, username: u.username || null, disabled: !!u.disabled }));
  return {
    tenantId,
    summary: summary ? { rounds: summary.rounds, totals: summary.totals } : null,
    uploads: await uploadUsage(summary ? summary.images : []),
    quota: {
      enforced: quota.enforced(),
      roundsPerTenant: quota.roundsPerTenant(),
      gamesPerRound: quota.gamesPerRound(),
      tagsPerRound: quota.tagsPerRound(),
    },
    users,
  };
}

// Resolve a notice to a tenant — by cover path (#268), or, since #275, by the
// round link / e-mail address / tenant id a notice or support mail actually
// tends to name. Since #320 also by username: that is the ONLY identifier an
// outside reporter can legitimately know, since the e-mail address must never
// be revealed to them. Read-only: it answers "whose is this, and what do they
// hold?" without changing anything, so an operator can assess before acting.
//
// Exactly one selector, deliberately: accepting several and picking a winner
// would make a typo'd second parameter silently change which tenant the
// operator then acts on.
router.get('/lookup', async (req, res) => {
  const given = ['image', 'round', 'tenant', 'email', 'username'].filter((k) => req.query[k]);
  if (given.length !== 1) {
    return res.status(400).json({ error: 'Provide exactly one of image, round, tenant, email, username' });
  }
  const by = given[0];

  const parse = (schema, value) => {
    const out = schema.safeParse(value);
    return out.success ? out.data : null;
  };

  let tenantId = null;
  let owner = null;
  let round = null;

  if (by === 'image') {
    const image = parse(imageSchema, req.query.image);
    if (!image) return res.status(400).json({ error: 'Not a valid /uploads/ path' });
    owner = await repo.findImageOwner(image);
    if (!owner) return res.status(404).json({ error: 'not_found' });
    tenantId = owner.tenantId;
  } else if (by === 'round') {
    const rid = parse(idSchema, req.query.round);
    if (!rid) return res.status(400).json({ error: 'Not a valid id' });
    round = await repo.findRoundOwner(rid);
    if (!round) return res.status(404).json({ error: 'not_found' });
    tenantId = round.tenantId;
  } else if (by === 'email') {
    const user = await repo.getUserByEmail(String(req.query.email || '').trim().toLowerCase());
    if (!user) return res.status(404).json({ error: 'not_found' });
    tenantId = user.tenantId || null;
  } else if (by === 'username') {
    // Matched case-insensitively by the repo — a reporter transcribing a handle
    // off a screen has no way to know which casing the owner registered.
    const user = await repo.getUserByUsername(String(req.query.username || '').trim());
    if (!user) return res.status(404).json({ error: 'not_found' });
    tenantId = user.tenantId || null;
  } else {
    tenantId = parse(idSchema, req.query.tenant);
    if (!tenantId) return res.status(400).json({ error: 'Not a valid id' });
    // A tenant id is the one selector with nothing to resolve it against, so an
    // unknown one must 404 here rather than render an empty-but-plausible card.
    const summary = await repo.tenantSummary(tenantId);
    if (!summary || !summary.rounds.length) {
      const known = (await repo.listUsers()).some((u) => (u.tenantId || null) === tenantId);
      if (!known) return res.status(404).json({ error: 'not_found' });
    }
  }

  return res.json({ by, owner, round, ...await tenantPayload(tenantId) });
});

/* --------------------------------- content --------------------------------- */

// Every user-authored string in one round — the drill-down that makes a text
// notice actionable, since a report names the offending words, not an id. Kept
// off the tenant summary because it is unbounded (a round may hold 1000 games)
// while the summary must stay small enough to render for a whole tenant.
router.get('/content', async (req, res) => {
  const parsed = idSchema.safeParse(req.query.round);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const content = await repo.roundContent(parsed.data);
  if (!content) return res.status(404).json({ error: 'not_found' });
  res.json({ content });
});

/* --------------------------------- redact ---------------------------------- */

// What a redacted field is replaced with. FIXED, not operator-supplied: a free
// replacement would let the panel write arbitrary text into a user's own data,
// which is a worse power than the one being exercised, and an empty string would
// render as a blank row that reads like a bug rather than a moderation action.
// German like the rest of this surface; the original text is preserved on the
// log entry, which is what an Art. 17 statement of reasons has to point at.
const REDACTED = '[entfernt]';

const REDACT_KINDS = ['round', 'game', 'member', 'tag', 'expansion', 'filter', 'feedback'];

// Blank one user-authored text field (#275 item 2). Until now only images could
// be taken down, so an illegal round name or game title had no remedy short of
// suspending the whole account or editing the database by hand.
//
// This never deletes a row — a redacted tag keeps its id, so no game silently
// loses a tag as a side effect. Deleting data is erasure (#273) and stays a
// separate, deliberately harder act.
router.post('/redact', async (req, res) => {
  const body = validateBody(z.object({
    kind: z.enum(REDACT_KINDS),
    // Absent for a round (the round IS the target) and required otherwise; the
    // reverse for roundId. Checked below against `kind` rather than with a
    // refinement so each side gets its own message.
    id: idSchema.optional(),
    roundId: idSchema.optional(),
    reason: reasonSchema,
  }), req, res);
  if (!body) return;

  const needsRound = body.kind !== 'feedback';
  if (needsRound && !body.roundId) return res.status(400).json({ error: 'roundId is required' });
  if (body.kind !== 'round' && !body.id) return res.status(400).json({ error: 'id is required' });

  const target = {
    kind: body.kind,
    roundId: needsRound ? body.roundId : null,
    id: body.kind === 'round' ? body.roundId : body.id,
  };

  const done = await repo.redactText(target, REDACTED);
  if (!done) return res.status(404).json({ error: 'not_found' });

  // `previous` is the whole point of the record: once the field is blanked, this
  // entry is the only remaining evidence of what was actually removed — which is
  // exactly what an Art. 17 statement of reasons has to state.
  const entry = await repo.logModeration({
    action: `redact_${body.kind}`,
    target: done.id,
    reason: body.reason,
    at: new Date().toISOString(),
    tenantId: done.tenantId,
    roundId: done.roundId,
    previous: done.previous,
  });

  logger.info({ event: 'admin_redact', tenantId: done.tenantId });
  res.json({ ok: true, redacted: { ...done, replacement: REDACTED }, entry });
});

/* -------------------------------- takedown --------------------------------- */

// Clear the cover from every game referencing it AND delete the stored object,
// then record the action. Order matters: the DB reference is cleared first, so a
// failure to delete the bytes can never leave a row pointing at a missing
// object (the reverse would render a broken cover for the user).
router.post('/takedown', async (req, res) => {
  const body = validateBody(z.object({ image: imageSchema, reason: reasonSchema }), req, res);
  if (!body) return;

  // Capture the owner BEFORE clearing, so the log records what was taken down.
  const owner = await repo.findImageOwner(body.image);
  const cleared = await repo.takedownImage(body.image);
  await storage.remove(body.image);

  // Since #841 the path may be an account's PROFILE PICTURE rather than a game
  // cover, and the record has to say which: an Art. 17 statement of reasons that
  // names a round and a game title for a picture taken off someone's profile
  // describes the wrong act. The game fields stay null in that case rather than
  // being repurposed — an entry claiming a roundId the action never touched is
  // worse than one that is honestly narrow.
  const isAccount = !!owner && owner.kind === 'account';
  const entry = await repo.logModeration({
    action: 'takedown',
    target: body.image,
    reason: body.reason,
    at: new Date().toISOString(),
    tenantId: owner ? owner.tenantId : null,
    ownerKind: owner ? owner.kind : null,
    roundId: !owner || isAccount ? null : owner.roundId,
    gameId: !owner || isAccount ? null : owner.gameId,
    gameTitle: !owner || isAccount ? null : owner.gameTitle,
    userId: isAccount ? owner.userId : null,
    username: isAccount ? owner.username : null,
    clearedReferences: cleared,
  });

  logger.info({ event: 'admin_takedown', tenantId: owner ? owner.tenantId : null });
  // `cleared: 0` is reported honestly rather than as an error: the object may
  // already have been removed, and deleting the bytes is still worth doing.
  res.json({ ok: true, cleared, entry });
});

module.exports = router;
