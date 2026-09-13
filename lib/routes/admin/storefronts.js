'use strict';

/*
 * The storefront clean-up action (#981) — a one-off operator action, and a
 * sub-router of its own so that removing it is a file delete.
 *
 * One of the operator router's sub-routers (#996). Mounted by
 * lib/routes/admin/index.js, which owns the /api/admin prefix and the
 * ADMIN_PASSWORD gate; like every handler there it uses the module-level
 * `repo`, never req.repo — the action is deliberately cross-tenant
 * (.claude/rules/admin-moderation-surface.md).
 *
 * #744 retired the four digital storefronts as lookup providers and
 * deliberately kept what was already stored: covers hotlinked from their CDNs
 * keep rendering, and `source` links stay as data. That is why
 * `LEGACY_COVER_HOSTS` is frozen into the CSP img-src list and why the privacy
 * policy names Sony, Valve, Nintendo and Microsoft as recipients at all.
 *
 * Clearing those rows is the prerequisite for removing every one of those, and
 * it is an operator action rather than a migration: per CLAUDE.md a data change
 * ships as something run once, and per the operator's standing preference that
 * is a panel button, not a script. A dry run first, because the number the
 * operator is deciding on — how many covers go blank — is not knowable from the
 * code.
 *
 * THIS FILE IS MEANT TO BE REMOVED once the count reaches 0 in production, the
 * same tool-used-then-deleted pattern #242 used for the retired tag fields.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../../repo');
const { validateBody } = require('../../validate');
const { logger } = require('../../observability');
// The frozen legacy-cover host list.
const providers = require('../../providers');

const router = express.Router();

const STOREFRONT_PROVIDERS = ['psstore', 'steam', 'nintendo', 'xbox'];

// One boolean, and the DEFAULT is the harmless one: anything that is not an
// explicit `true` counts as a dry run, so a malformed body can never clear a row.
const storefrontSchema = z.object({ confirm: z.boolean().optional() });

router.post('/storefronts/clear', async (req, res) => {
  const b = validateBody(storefrontSchema, req, res);
  if (!b) return;
  const dryRun = b.confirm !== true;
  const run = await repo.clearStorefrontLinks({
    hosts: providers.legacyCoverHosts(),
    providerIds: STOREFRONT_PROVIDERS,
    dryRun,
  });
  logger.info({ event: 'admin_storefronts_clear', dryRun, ...run }, 'storefront link clean-up');
  res.json({ ok: true, dryRun, run });
});

module.exports = router;
