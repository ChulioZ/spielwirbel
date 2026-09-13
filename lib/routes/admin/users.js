'use strict';

/*
 * Accounts (#268) plus the Art. 15 export and Art. 17 erasure flows (#273).
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
const demo = require('../../demo');
const { logger } = require('../../observability');
const { reasonSchema } = require('./shared');
const router = express.Router();

/* ---------------------------------- users ---------------------------------- */

// The safe projection of a stored user. listUsers()/getUserById() return the raw
// shape — password hash, refresh tokens, verification and reset material — so
// EVERY response carrying a user goes through here. Never respond with the repo
// shape directly (.claude/rules/admin-moderation-surface.md).
const safeUser = (u) => ({
  id: u.id,
  email: u.email,
  username: u.username || null,
  // The profile picture path (#841). An ALLOWLIST, so a field omitted here is a
  // field the Art. 15/20 export silently does not answer — and the picture is
  // personal data held about the subject, not an implementation detail.
  avatar: u.avatar || null,
  tenantId: u.tenantId,
  createdAt: u.createdAt,
  emailVerified: !!u.emailVerified,
  disabled: !!u.disabled,
  disabledAt: u.disabledAt || null,
  disabledReason: u.disabledReason || null,
});

// The account list, optionally filtered by `?q=` (case-insensitive substring
// over e-mail, username and tenant id). Since #403 the panel is search-first, so
// the ordinary request carries a `q` and only the matching accounts' e-mail
// addresses ever leave the server — data protection by default (Art. 25 DSGVO).
// No `q` still returns everything, which is what the panel's deliberate
// "Alle anzeigen" asks for.
//
// Guest-demo accounts (#427) are dropped BEFORE the `?q=` filter (#506), so a
// search term can never surface one either. They are throwaway rows the
// scheduler purges on its own, have no password identity and cannot invite or
// befriend anyone, so no moderation action against one is meaningful — they are
// pure noise in the operator's account list. Classified by tenant prefix via
// demo.isDemoTenant, the one tested predicate for it, exactly as
// lib/observability.js keeps demo traffic out of the product-event counts
// (.claude/rules/guest-demo-accounts.md).
router.get('/users', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const users = (await repo.listUsers())
    .filter((u) => !demo.isDemoTenant(u.tenantId))
    .map(safeUser);
  res.json({
    users: q
      ? users.filter((u) => [u.email, u.username, u.tenantId]
        .some((v) => v && String(v).toLowerCase().includes(q)))
      : users,
  });
});

// Suspend or restore an account WITHOUT deleting anything, so evidence survives
// a later law-enforcement request. Suspension takes effect immediately: lib/tenant.js
// refuses every /api call for a disabled user, and login/refresh both refuse too,
// so the existing access token can't outlive it (lib/routes/account.js).
router.post('/users/:uid/disabled', async (req, res) => {
  const body = validateBody(z.object({ disabled: z.boolean(), reason: reasonSchema }), req, res);
  if (!body) return;

  const user = await repo.getUserById(req.params.uid);
  if (!user) return res.status(404).json({ error: 'not_found' });

  await repo.updateUser(user.id, {
    disabled: body.disabled,
    disabledAt: body.disabled ? new Date().toISOString() : null,
    disabledReason: body.disabled ? body.reason : null,
    // Drop every refresh token on suspension so the account cannot resume from a
    // stale one if it is later restored.
    refreshTokens: body.disabled ? [] : user.refreshTokens || [],
  });

  const entry = await repo.logModeration({
    action: body.disabled ? 'user_disabled' : 'user_restored',
    target: user.id,
    reason: body.reason,
    at: new Date().toISOString(),
    tenantId: user.tenantId || null,
    email: user.email,
  });

  logger.info({ event: body.disabled ? 'admin_user_disabled' : 'admin_user_restored', tenantId: user.tenantId || null });
  res.json({ ok: true, entry });
});

// The neutral handle a forced rename installs (#320). Derived from the account
// id, so it is unique BY CONSTRUCTION — redaction's fixed '[entfernt]' marker
// cannot be reused here, because a unique index refuses a second one. Sliced so
// the result stays inside the 30-char registration policy whatever an id looks
// like; today's 16-hex ids are used whole.
const neutralUsername = (uid) => `user-${String(uid).slice(0, 24)}`;

// Force a new username on an account whose chosen handle is itself the abuse
// (a slur, an impersonation, doxxing in a name). The replacement is NOT
// operator-supplied — same reasoning as the fixed redaction marker (#275):
// writing chosen text into someone's account is a larger power than removing
// what they chose, and the log's `previous` preserves what was actually there.
//
// Suspension stays the answer to an abusive ACCOUNT; this is the answer to an
// abusive NAME on an account that may otherwise be fine.
router.post('/users/:uid/username', async (req, res) => {
  const body = validateBody(z.object({ reason: reasonSchema }), req, res);
  if (!body) return;

  const user = await repo.getUserById(req.params.uid);
  if (!user) return res.status(404).json({ error: 'not_found' });

  const previous = user.username || null;
  const username = neutralUsername(user.id);
  // Already neutral — refuse rather than write a no-op and log it as a measure
  // an Art. 17 statement could then be generated from.
  if (previous === username) return res.status(409).json({ error: 'already_neutral' });

  await repo.updateUser(user.id, { username });

  // `previous` is the record's substance, exactly as for a redaction: once the
  // handle is replaced this entry is the only evidence of what was removed.
  const entry = await repo.logModeration({
    action: 'user_renamed',
    target: user.id,
    reason: body.reason,
    at: new Date().toISOString(),
    tenantId: user.tenantId || null,
    email: user.email,
    previous,
  });

  logger.info({ event: 'admin_user_renamed', tenantId: user.tenantId || null });
  res.json({ ok: true, username, entry });
});

/* --------------------------- export & erasure (#273) ------------------------ */

// Art. 15/20: everything held for one account, as JSON the operator can hand to
// the data subject.
//
// A POST, not a GET, even though it only reads: a reason is mandatory here like
// on every other logged action, and a reason belongs in the BODY. As a query
// parameter it would be written verbatim into the HTTP access log — which
// records method/path (.claude/rules/product-event-logging.md) — putting the
// text of a subject-access request, quite possibly naming the subject, into a
// second place we would then have to erase.
router.post('/users/:uid/export', async (req, res) => {
  const body = validateBody(z.object({ reason: reasonSchema }), req, res);
  if (!body) return;

  const user = await repo.getUserById(req.params.uid);
  if (!user) return res.status(404).json({ error: 'not_found' });

  const { rounds } = await repo.exportTenant(user.tenantId || null);
  // The account's rows in the global stores (friendships, feed, inbox, invitations,
  // grants) that live OUTSIDE the tenant's rounds — #397. Erasure already deletes
  // all five as the account's personal data, so an Art. 15/20 answer must return
  // them too; exportAccountData mirrors that enumeration.
  const shares = await repo.exportAccountData(user.id, user.tenantId || null);
  const at = new Date().toISOString();

  // The disclosure itself is logged: handing a copy of someone's data out is an
  // act worth an audit record, and Art. 15 requests are answerable-for.
  const entry = await repo.logModeration({
    action: 'user_exported',
    target: user.id,
    reason: body.reason,
    at,
    tenantId: user.tenantId || null,
    email: user.email,
    rounds: rounds.length,
  });

  logger.info({ event: 'admin_user_exported', tenantId: user.tenantId || null });
  res.json({
    export: {
      exportedAt: at,
      account: safeUser(user),
      tenantId: user.tenantId || null,
      rounds,
      friendships: shares.friendships,
      feedEvents: shares.feedEvents,
      inbox: shares.inbox,
      invitations: shares.invitations,
      grants: shares.grants,
    },
    entry,
  });
});

// Art. 17: erase the account AND its tenant's round data, then delete the stored
// cover objects. Irreversible, so it is deliberately awkward: a mandatory reason
// plus `confirmEmail`, which must match the account's own address. That makes a
// mis-typed or mis-clicked account id refuse rather than erase the wrong person
// — the one mistake here that cannot be walked back.
//
// Suspension (above) stays the right first response to an abuse case: it
// preserves evidence. Erasure is the opposite and must never be a side effect of
// anything else (#268).
router.post('/users/:uid/erase', async (req, res) => {
  const body = validateBody(
    // min(1) matters: without it an empty confirmEmail would "match" a user row
    // that somehow carries no address, turning the guard off exactly when the
    // data is already odd.
    z.object({ reason: reasonSchema, confirmEmail: z.string().min(1, 'A confirmation e-mail is required') }),
    req, res,
  );
  if (!body) return;

  const user = await repo.getUserById(req.params.uid);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (body.confirmEmail.trim().toLowerCase() !== String(user.email || '').toLowerCase()) {
    return res.status(400).json({ error: 'confirm_mismatch' });
  }

  const result = await repo.eraseAccount(user.id);
  if (result === 'tenant_shared') return res.status(409).json({ error: 'tenant_shared' });
  if (!result) return res.status(404).json({ error: 'not_found' });

  // Rows first, bytes second (as in /takedown): the references are already gone,
  // so a failed object delete leaves an orphaned file, never a broken cover.
  // One failure must not abort the rest of an erasure that has already happened
  // in the database — count them and report honestly instead.
  let removed = 0;
  let failed = 0;
  for (const image of result.images) {
    try {
      await storage.remove(image);
      removed += 1;
    } catch (err) {
      failed += 1;
      logger.error({ event: 'admin_erase_object_failed', err: err.message });
    }
  }

  // Deliberately NO email and no round/game names on this entry, unlike every
  // other action here: the log outlives the erasure, so copying the erased
  // person's data into it would defeat the erasure it is meant to evidence. The
  // account id, tenant id, date, reason and counts are what proves the request
  // was honoured — which is the record's only job.
  const entry = await repo.logModeration({
    action: 'user_erased',
    target: user.id,
    reason: body.reason,
    at: new Date().toISOString(),
    tenantId: result.tenantId,
    rounds: result.rounds,
    imagesRemoved: removed,
    imagesFailed: failed,
  });

  logger.info({ event: 'admin_user_erased', tenantId: result.tenantId });
  res.json({ ok: true, rounds: result.rounds, imagesRemoved: removed, imagesFailed: failed, entry });
});

module.exports = router;
