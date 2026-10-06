'use strict';

/*
 * Erasure of never-verified accounts 7 days after sign-up (#1544; legal audit
 * 2026-10-04, L-014).
 *
 * Login refuses an unverified account (lib/routes/account.js) and its
 * verification link lives 24 h (accounts.VERIFY_TTL_MS), so past that the row
 * has no function — yet it kept an e-mail address, a username and a password
 * hash indefinitely (Art. 5(1)(c)/(e) DSGVO), and kept both identifiers
 * claimed, which is the squatting #448 set out to stop.
 *
 * The deadline runs from `createdAt`, NOT from the current link's expiry
 * (operator decision 2026-10-04): resend-verification mints a fresh link, and a
 * deadline tied to it could be pushed back forever.
 *
 * WHY ERASING IS SAFE. An unverified account can never have held a session:
 * register issues no tokens, login answers 403 before issueTokens, and every
 * other identity (passkeys) is added through requireUser. So it cannot own a
 * round, an avatar, a grant or a friendship — and a self-hosted instance with no
 * mail transport cannot have an unverified account in USE either, because the
 * same login gate holds there. It still goes through repo.eraseAccount, the one
 * erasure cascade, so the tenant id minted at registration and anything that
 * somehow did attach to it go too, rather than a second deletion path that
 * could drift.
 *
 * Demo accounts are excluded by the repo predicate (they are created verified
 * anyway, and lib/demo.js's own TTL sweep owns them).
 *
 * No moderation-log entry: the Art. 17 proofs in lib/erasure-actions.js record
 * that a REQUEST was honoured. This is a retention deletion that nobody asked
 * for, documented in docs/legal/retention.md instead.
 */

const repo = require('./repo');
const { logger } = require('./observability');

const UNVERIFIED_ACCOUNT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Idempotent: an id another replica erased first answers null from
// eraseAccount and is skipped. One failing account must not stall the sweep —
// the next tick would hit it again first. The log line carries counts only,
// never an address or username (.claude/rules/product-event-logging.md).
async function purgeUnverifiedAccounts(storage, now = Date.now()) {
  const cutoff = new Date(now - UNVERIFIED_ACCOUNT_TTL_MS).toISOString();
  const stale = await repo.listStaleUnverifiedUsers(cutoff);
  let erased = 0;
  for (const uid of stale) {
    let result;
    try {
      // Re-read right before erasing: the list was taken a moment ago, and a
      // person who clicks a resent link in between must not be erased just
      // after confirming. Narrows the window to one round trip; it does not
      // close it, which would need a conditional delete inside eraseAccount.
      const current = await repo.getUserById(uid);
      if (!current || current.emailVerified !== false) continue;
      result = await repo.eraseAccount(uid);
    } catch (e) {
      logger.warn({ event: 'unverified_purge_failed', message: e.message });
      continue;
    }
    if (!result || typeof result === 'string') continue;
    erased += 1;
    // Unreachable today (no session means no upload), but the cascade hands
    // paths back and dropping them would leave billable orphans
    // (.claude/rules/deletion-paths-must-free-cover-objects.md).
    for (const image of result.images || []) {
      try {
        await storage.remove(image);
      } catch (e) {
        logger.warn({ event: 'unverified_purge_image_failed', message: e.message });
      }
    }
  }
  if (erased) logger.info({ event: 'retention_purge_ran', scope: 'unverified_account', erased });
  return erased;
}

module.exports = { UNVERIFIED_ACCOUNT_TTL_MS, purgeUnverifiedAccounts };
