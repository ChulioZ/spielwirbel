'use strict';

/*
 * Instance status and the recent-log ring buffer.
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
const { instanceStatus } = require('../../status');
const { recentLogs, recentClientErrors } = require('../../observability');
const router = express.Router();

/* --------------------------------- status ---------------------------------- */

// How this instance is actually configured (issue #274), so #219's go-live
// checklist is verifiable from the app rather than by eye against Railway's
// env-var list. Read-only, and every field is a derived boolean/enum/number or a
// public host name — never a secret, not even truncated. lib/status.js is where
// that guarantee is kept; don't widen the response here.
router.get('/status', async (req, res) => {
  res.json({ status: await instanceStatus() });
});

/* ----------------------------------- logs ---------------------------------- */

// The most recent warn/error lines this process has emitted (issue #359),
// newest first, from the in-memory ring buffer in lib/observability.js — so the
// operator can see "what just went wrong on this instance" without leaving for
// Railway's log search. Global and ephemeral (per-process, no store, cleared on
// restart): read from the module-level observability seam, no tenant scoping,
// like the moderation-log / feedback / notices cards.
router.get('/logs', (req, res) => {
  res.json({ entries: recentLogs() });
});

// Faults reported from a visitor's BROWSER (issue #1149), newest first, from the
// second ring buffer in lib/observability.js. A separate route because it is a
// separate buffer, and that separation is the whole point: an unauthenticated
// writer must not be able to evict anything from /logs above. Same ephemeral,
// per-process, no-tenant-scoping shape as its neighbour.
router.get('/logs/client', (req, res) => {
  res.json({ entries: recentClientErrors() });
});

module.exports = router;
