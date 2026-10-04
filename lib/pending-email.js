'use strict';

/*
 * Expiry of a pending e-mail change (#1076; legal audit 2026-10-04, L-014).
 *
 * The privacy policy promises the NEW address of a change is kept "bis zur
 * Bestätigung — längstens 24 Stunden". Until this sweep that was true of the
 * confirmation LINK only: an expired record was ignored by the account screen
 * (lib/me-projection.js) and refused by confirm-email, but it stayed on the row
 * until the person cancelled, asked again, confirmed or deleted the account —
 * and the address it holds may be a typo, i.e. somebody else's.
 *
 * So, like the vote-link and feed sweeps, the promise needs two halves that
 * read ONE expiry: the routes refuse a record whose `expiresAt` has passed, and
 * this deletes it on the scheduler's 15-minute tick. The sweep can therefore
 * only ever remove a record the routes already treat as dead — it never revokes
 * a link that would still have worked.
 *
 * The record's own `expiresAt` is the deadline, not a TTL recomputed here: it
 * was written from accounts.VERIFY_TTL_MS when the mail went out, and that is
 * the instant the link stops working.
 */

const repo = require('./repo');
const { logger } = require('./observability');

// Idempotent, so the overlapping processes of a zero-downtime deploy clear each
// record once and no-op the rest. The log line carries a count, never an address.
async function purgeExpiredPendingEmails(now = Date.now()) {
  const cleared = await repo.clearExpiredPendingEmails(new Date(now).toISOString());
  if (cleared) logger.info({ event: 'retention_purge_ran', scope: 'pending_email', cleared });
  return cleared;
}

module.exports = { purgeExpiredPendingEmails };
