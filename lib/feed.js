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
 *   - It is NOT idempotent, and the CALL SITE owns that (#856). Every call appends
 *     a row, so a route the UI re-POSTs as an idempotent save must emit on the
 *     STATE TRANSITION, not on the request — see collapseFeedEvents below and
 *     .claude/rules/feed-events-fire-on-the-transition.md.
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

/*
 * Read-side collapse of a run of identical events (#856).
 *
 * Two independent jobs, which is why this is not merely a belt to the emit
 * guards' braces:
 *   - rows written BEFORE the guards existed are in production and cannot be
 *     un-written; they otherwise sit in friends' feeds until MAX_FEED_EVENTS
 *     ages them out;
 *   - a guard is a read-then-write, so two overlapping requests can still both
 *     see the old state and both emit.
 *
 * ADJACENT runs only — the same game announced again with something else in
 * between is a real second event, not a duplicate. Both feed read sites call
 * this BEFORE their FEED_SHOW slice, or duplicates eat the page and the feed
 * gets shorter instead of cleaner.
 */

// A game evening. Long enough to absorb an un-finish and re-finish of the same
// session; short enough that playing the same game on two evenings still reads
// as two plays.
const DUP_WINDOW_MS = 6 * 60 * 60 * 1000;

// `events` is newest-first, as listFeedEvents returns. The kept entry of a run is
// therefore the newest one, and the window is measured against IT rather than
// against each neighbour — chaining pairwise would let a long run swallow an
// event arbitrarily far back.
function collapseFeedEvents(events) {
  const out = [];
  for (const e of events || []) {
    const kept = out[out.length - 1];
    if (kept && kept.uid === e.uid && kept.type === e.type && kept.title === e.title) {
      const gap = Date.parse(kept.at) - Date.parse(e.at);
      // NaN (an unparseable stamp) fails this, so bad data keeps both rows —
      // never silently drop an event because its timestamp is unreadable.
      if (gap >= 0 && gap <= DUP_WINDOW_MS) continue;
    }
    out.push(e);
  }
  return out;
}

module.exports = { emitFeedEvent, collapseFeedEvents, DUP_WINDOW_MS };
