'use strict';

/*
 * Freundeskreis feed writer (issue #325).
 *
 * The ONE seam through which a route reports "the acting account did X" to their
 * friends' feed — so, like trackEvent (lib/observability.js), the discipline lives
 * in one place instead of at every call site:
 *
 *   - The no-personal-data ALLOWLIST is enforced by repo.addFeedEvent, which
 *     constructs the stored row from exactly { type, title, coverUrl } and drops
 *     everything else. A member name, score, vote or round name passed here can
 *     never reach a friend's feed.
 *   - It NO-OPS without an authenticated account (uid falsy — legacy mode /
 *     unauthenticated). Feed events only make sense in accounts mode (a feed is
 *     read by friends, which only exist there), and req.userId is set only then,
 *     so today's shared-password production writes nothing.
 *   - It NEVER throws: a feed-write failure must not fail the user action it
 *     accompanies. Call it AFTER the real repo mutation has resolved (mirroring
 *     the trackEvent contract), so a rejected/absent action can't post an event.
 *
 * The store is GLOBAL and un-scoped (keyed by account id), so it is reached on the
 * module-level repo, never req.repo. See .claude/rules/product-event-logging.md
 * for the sibling allowlist discipline this follows.
 */

const repo = require('./repo');
const { logger } = require('./observability');

async function emitFeedEvent(uid, event) {
  if (!uid) return;
  try {
    await repo.addFeedEvent(uid, event);
  } catch (err) {
    // Best-effort: log and move on. The action the event describes already happened.
    logger.warn({ event: 'feed_event_failed', message: err && err.message });
  }
}

module.exports = { emitFeedEvent };
