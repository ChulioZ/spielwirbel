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
const { feedEventCutoff } = require('./feed-events');

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
 *     un-written; they otherwise sit in friends' feeds until the 12-month
 *     retention (#1357) ages them out;
 *   - a guard is a read-then-write, so two overlapping requests can still both
 *     see the old state and both emit.
 *
 * ADJACENT runs only — the same game announced again with something else in
 * between is a real second event, not a duplicate. Both feed read sites call
 * this BEFORE their FEED_PAGE slice, or duplicates eat the page and the feed
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
    // `tier` (#1389): two tiers of one Abzeichen are two earnings, not a repeat.
    // Undefined on every other type, so it compares equal there.
    if (kept && kept.uid === e.uid && kept.type === e.type && kept.title === e.title && kept.tier === e.tier) {
      const gap = Date.parse(kept.at) - Date.parse(e.at);
      // NaN (an unparseable stamp) fails this, so bad data keeps both rows —
      // never silently drop an event because its timestamp is unreadable.
      if (gap >= 0 && gap <= DUP_WINDOW_MS) continue;
    }
    out.push(e);
  }
  return out;
}

/*
 * Cursor paging for the two feed read routes (#1357) — /friends/feed and a
 * profile's feed. ONE implementation so the two cannot drift, because the order
 * of operations is the whole correctness argument:
 *
 *   read the raw window -> since-accepted filter -> collapse -> slice to the page
 *
 * and the cursor must follow the last RAW row consumed, never the last event
 * shown. The filter drops rows and the collapse merges them, so "the last shown
 * event" is not where the page stopped reading: a cursor taken from it would
 * re-read the rows the collapse folded into it (repeats) — and one taken from the
 * end of the raw window would skip everything past the page (gaps).
 *
 * So the page ends where the NEXT page's first event begins: the cursor is the
 * raw row immediately before event FEED_PAGE + 1. Every raw row up to that point
 * — rows the filter dropped, duplicates collapsed into the page's last event —
 * is consumed by this page, and the next page starts exactly at an event the
 * full-sequence collapse also kept, so it re-collapses identically.
 *
 * Windows are read until the page is over-full or the store is exhausted, bounded
 * by FEED_MAX_WINDOWS so a friend with a long pre-friendship history (all of it
 * filtered) cannot make one request scan the table. When that bound is hit the
 * cursor is the last raw row read, the page may be short, and a run of duplicates
 * that crosses THAT boundary may show once on each side — collapse only merges
 * adjacent rows it can see, and a cross-page collapse is not worth building for
 * it. The client simply asks for the next page.
 */
const FEED_PAGE = 50;
const FEED_WINDOW = 200;
const FEED_MAX_WINDOWS = 5;

// Opaque to the client: base64url of `<id>|<at>`. The repo takes { id, at } —
// the id positions the page, the timestamp stands in if that row has gone.
function encodeFeedCursor(row) {
  return Buffer.from(`${row.id}|${row.at || ''}`, 'utf8').toString('base64url');
}

// null for anything that is not a cursor this module could have written. The
// route answers that with a 400 rather than an empty page, so a mangled URL is
// visible instead of reading as "no more events".
function decodeFeedCursor(value) {
  if (typeof value !== 'string' || !value || value.length > 120 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const m = /^([0-9a-f]{16})\|(\d{4}-\d\d-\d\dT[\d:.]+Z)$/.exec(Buffer.from(value, 'base64url').toString('utf8'));
  return m ? { id: m[1], at: m[2] } : null;
}

// `uids` are the accounts to read; `sinceOf(uid)` answers that account's cutoff
// (an ISO string, or null/'' for none); `before` a decoded cursor or null.
// Returns { events, nextCursor } — events are repo rows, newest first.
async function readFeedPage(uids, sinceOf, before = null) {
  const raw = [];
  let cursor = before;
  let exhausted = false;
  let events = [];
  for (let w = 0; w < FEED_MAX_WINDOWS; w++) {
    const rows = await repo.listFeedEvents(uids, FEED_WINDOW, cursor);
    raw.push(...rows);
    if (rows.length < FEED_WINDOW) exhausted = true;
    if (rows.length) cursor = { id: rows[rows.length - 1].id, at: rows[rows.length - 1].at };
    // Only events the account produced after the cutoff (string ISO compare).
    events = collapseFeedEvents(raw.filter((e) => String(e.at) >= String(sinceOf(e.uid) || '')));
    if (events.length > FEED_PAGE || exhausted) break;
  }
  if (events.length > FEED_PAGE) {
    // Collapse returns the raw row objects it kept, so the next page's first
    // event can be located in the raw window by identity.
    const next = raw.indexOf(events[FEED_PAGE]);
    return { events: events.slice(0, FEED_PAGE), nextCursor: encodeFeedCursor(raw[next - 1]) };
  }
  if (exhausted || !raw.length) return { events, nextCursor: null };
  return { events, nextCursor: encodeFeedCursor(raw[raw.length - 1]) };
}

/*
 * The feed's retention sweep (#1357), run by lib/scheduler.js. addFeedEvent
 * already prunes the WRITER's expired rows, but an account that stops writing
 * would then keep its events forever and the 12-month statement in
 * docs/legal/retention.md would be false — this is what makes it true for every
 * account. Idempotent: it re-derives the cutoff each run, so overlapping
 * processes during a deploy delete the rows once and no-op the rest.
 *
 * The log line carries a count and a date only — never an event.
 */
async function purgeExpiredFeedEvents(now = Date.now()) {
  const cutoff = feedEventCutoff(now);
  const deleted = await repo.purgeExpiredFeedEvents(cutoff);
  logger.info({ event: 'retention_purge_ran', scope: 'feed_events', cutoff, deleted });
  return deleted;
}

module.exports = {
  emitFeedEvent, collapseFeedEvents, purgeExpiredFeedEvents, readFeedPage,
  encodeFeedCursor, decodeFeedCursor, DUP_WINDOW_MS, FEED_PAGE, FEED_WINDOW, FEED_MAX_WINDOWS,
};
