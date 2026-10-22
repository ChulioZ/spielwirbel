'use strict';

/*
 * The operator's own passkeys (#1670) — the gated half: list and remove.
 * Enrolling a key is NOT here: it needs ADMIN_ENROLL_TOKEN and lives beside the
 * login pair in ./index.js, so a stolen session can never add one.
 *
 * Removing the LAST key is refused. The panel would otherwise lock its operator
 * out from inside; recovery is the env-token path (docs/deploy-railway.md), not
 * an empty credential list. The check-then-delete is not atomic — two
 * concurrent removals of the last two keys could both pass — which is accepted
 * for a surface with one operator.
 *
 * Removing a key also ends every session that key opened (lib/admin.js).
 */

const express = require('express');
const admin = require('../../admin');
const adminPasskeys = require('../../admin-passkeys');
const repo = require('../../repo');
const { logger } = require('../../observability');

const router = express.Router();

const listing = async () => ({
  passkeys: (await repo.listAdminPasskeys()).map(adminPasskeys.publicAdminPasskey),
  // Drives the panel's warning banner: the token is meant to be set only for
  // the minutes an enrollment takes.
  enrollOpen: admin.enrollTokenSet(),
});

router.get('/passkeys', async (req, res) => {
  res.json(await listing());
});

router.delete('/passkeys/:cid', async (req, res) => {
  const keys = await repo.listAdminPasskeys();
  if (!keys.some((k) => k.credentialId === req.params.cid)) {
    return res.status(404).json({ error: 'not_found' });
  }
  if (keys.length <= 1) return res.status(409).json({ error: 'last_admin_passkey' });
  await repo.removeAdminPasskey(req.params.cid);
  // A key is removed because it is lost or no longer trusted, so whatever it
  // opened must close with it — otherwise a stolen device's session would
  // outlive the key by up to TOKEN_TTL_MS.
  await repo.deleteAdminSessionsForPasskey(req.params.cid);
  logger.info({ event: 'admin_passkey_removed' });
  res.json(await listing());
});

module.exports = router;
