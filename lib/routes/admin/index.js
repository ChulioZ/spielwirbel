'use strict';

/*
 * Operator moderation endpoints (issue #268) — the tooling that makes the
 * reactive DSA duties scoped in #140 actually performable: once a valid abuse
 * notice arrives, locate the reported cover image, take it down, suspend the
 * responsible account, and leave a record of why.
 *
 * Mounted at /api/admin in lib/app.js AHEAD of the app's own auth gate (like
 * /api/auth and /api/account), because the operator must be able to reach it
 * whichever mode the instance runs in — and it carries its own, stronger gate:
 * lib/admin.js (ADMIN_PASSWORD, a separate secret from AUTH_PASSWORD; see that
 * file's header for why they must not be the same value).
 *
 * These handlers use the module-level `repo`, NOT req.repo: moderation is
 * deliberately cross-tenant (a notice names an image, not a tenant), which is
 * exactly why the moderation methods are absent from TENANT_METHODS. The tenant
 * middleware never runs for this router. See
 * .claude/rules/admin-moderation-surface.md.
 *
 * SPLIT INTO SUB-ROUTERS BY #996. The file self-labelled sixteen sections and
 * had grown to 1124 lines; four of them are separately-owned bodies of work with
 * disjoint rule and doc files (DSA notices, the Art. 15/17 flows, the BGG corpus
 * ingest, the cover backfill), and editing one had never touched another.
 *
 * WHY THE SUB-ROUTERS MOUNT HERE AND NOT IN lib/app.js, which is what #996
 * proposed by analogy with the five /api/account routers: those have distinct
 * PATH prefixes, and these do not — /status, /logs, /users and the rest all live
 * directly under /api/admin. Mounting seven routers on one prefix in the app
 * would run `authLimiter` seven times per request and silently divide
 * AUTH_RATE_LIMIT_MAX by seven, which is precisely the trap the passkeys router
 * carries a comment about. One mount stays in lib/app.js; the composition is
 * here, where the gate already is.
 */

const express = require('express');
const admin = require('../../admin');
const storage = require('../../storage');
const { logger } = require('../../observability');

const router = express.Router();

/* ---------------------------------- login ---------------------------------- */

// The only unauthenticated route here. 404s when no ADMIN_PASSWORD is set, so an
// instance that never configured the surface doesn't advertise it at all.
router.post('/login', (req, res) => {
  if (!admin.adminEnabled()) return res.status(404).json({ error: 'admin_disabled' });
  if (!admin.passwordMatches((req.body || {}).password)) {
    logger.warn({ event: 'admin_login_failed', ip: req.ip });
    return res.status(401).json({ error: 'invalid_password' });
  }
  admin.setSession(req, res);
  logger.info({ event: 'admin_login' });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  admin.clearSession(req, res);
  res.json({ ok: true });
});

// Session probe for the UI: 200 when signed in, 401 when not, 404 when the
// surface is off — the same three-way shape the SPA already reads from
// /api/account/me (see .claude/rules/accounts-mode-gate.md).
router.get('/me', admin.requireAdmin, (req, res) => {
  res.json({ ok: true, storage: storage.backend });
});

/* --------------------------- everything below: gated ----------------------- */

router.use(admin.requireAdmin);

// Order is irrelevant — the sub-routers register disjoint paths — so they are
// listed in the order the panel's cards read, which is the order somebody
// looking for a handler will guess.
router.use(require('./status'));
router.use(require('./corpus'));
router.use(require('./covers'));
router.use(require('./moderation'));
router.use(require('./users'));
router.use(require('./log'));
router.use(require('./notices'));

module.exports = router;
