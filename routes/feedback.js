'use strict';

/* In-app user feedback capture (issue #260): the write side of the "learn what
   users need" loop. One route — POST /api/feedback — storing a free-text message
   plus the small amount of context that makes it actionable (which screen, which
   language, which tenant).

   Mounted at /api/feedback in lib/app.js, i.e. BEHIND the normal gate and the
   tenant middleware, so the submitter is an authenticated app user in either
   auth mode. It carries its own low rate limit (FEEDBACK_RATE_LIMIT_MAX).

   Storage is deliberately GLOBAL, not tenant-scoped: feedback is addressed to
   the operator, who reads it across every tenant, so it goes through the
   module-level `repo` (like routes/admin.js) rather than req.repo. The reader is
   GET /api/admin/feedback, behind the operator panel's own password gate (#268).

   The READ side of this data is subject to a narrow, explicit carve-out from
   .claude/rules/no-reading-production-data.md — see
   .claude/rules/reading-feedback-data.md. */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../lib/validate');
const accounts = require('../lib/accounts');
const repo = require('../lib/repo');
const { logger } = require('../lib/observability');

const router = express.Router();

const MESSAGE_MAX = 2000;
// The SPA path the user was on when they wrote it ('/round/<rid>/regal', …).
// Capped purely so a crafted request can't store an unbounded string.
const PATH_MAX = 200;

const feedbackSchema = z.object({
  message: z.preprocess(
    (v) => String(v || '').trim(),
    z.string().min(1, 'A message is required').max(MESSAGE_MAX, 'Message is too long'),
  ),
  // Which screen the feedback is about. Optional — a submission is still useful
  // without it, so a missing/oversized value is dropped rather than a 400.
  path: z.preprocess(
    (v) => String(v || '').trim().slice(0, PATH_MAX),
    z.string(),
  ).optional(),
  // The UI language, allowlisted the same way routes/lookup.js `lookupLang`
  // does — by FALLING BACK, not by rejecting. An unrecognized value (a locale
  // added later, a stale cached client) is dropped to null rather than 400ing:
  // losing a user's written message over a metadata field would defeat the
  // point of collecting it at all.
  locale: z.preprocess(
    (v) => (['de', 'en'].includes(String(v || '').toLowerCase())
      ? String(v).toLowerCase()
      : undefined),
    z.string().optional(),
  ),
  // Opt-in to attach the submitter's account so the operator can follow up.
  // A BOOLEAN only — the identity itself is resolved server-side below, never
  // taken from the request, so a caller cannot attribute feedback to anyone else.
  attachIdentity: z.boolean().optional(),
  // Honeypot: a field no human sees, so anything in it is a bot.
  website: z.string().optional(),
});

// The account behind the request, or null. Resolved from the Bearer token the
// same way lib/tenant.js does — deliberately re-derived here rather than trusted
// from the body. Returns null in legacy shared-password mode, where there is no
// per-user identity to attach at all.
async function submitter(req) {
  if (!accounts.accountsEnabled()) return null;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const uid = token ? accounts.verifyAccessToken(token) : null;
  if (!uid) return null;
  return repo.getUserById(uid);
}

router.post('/', async (req, res) => {
  const body = validateBody(feedbackSchema, req, res);
  if (!body) return;

  // A filled honeypot gets a normal-looking 200 and stores nothing: reporting
  // the rejection would tell a bot exactly which field gave it away. Same idea
  // as the contact form's spam handling (#225) — no code shared, different auth
  // context, just the same trick.
  if (body.website) return res.status(201).json({ ok: true });

  // Identity is attached ONLY on explicit opt-in, and only what is needed to
  // reply. An anonymous submission stores no user id and no address — which is
  // the default, and the whole point of making it a choice.
  let identity = {};
  if (body.attachIdentity) {
    const user = await submitter(req);
    if (user) identity = { userId: user.id, email: user.email };
  }

  const entry = await repo.createFeedback({
    message: body.message,
    context: {
      path: body.path || null,
      locale: body.locale || null,
      // Server-derived, never client-supplied.
      tenantId: req.tenantId || null,
      ...identity,
    },
    createdAt: new Date().toISOString(),
  });

  // The message text is deliberately NOT logged — it is user-authored personal
  // data and the logs are a second store we would then have to erase from (see
  // .claude/rules/product-event-logging.md). Only that one arrived, and where.
  logger.info({ event: 'feedback_submitted', tenantId: req.tenantId || null });
  res.status(201).json({ ok: true, id: entry.id });
});

module.exports = router;
