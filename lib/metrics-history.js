'use strict';

/*
 * The weekly history buckets behind the operator panel's Konten and Sessions
 * charts (#941).
 *
 * ONE MODULE, required by both repo backends, because the whole value of the
 * series is that the two agree: the JSON backend buckets in JavaScript and the
 * Postgres one groups with `date_trunc('week', …)`, and a week boundary that
 * differed by a day between them would draw two different charts from the same
 * data with nothing to notice (.claude/rules/shared-constants-across-the-stack.md).
 * Dependency-free so `lib/repo/*.js` can require it without a cycle.
 *
 * WHY ONLY ACCOUNTS AND SESSIONS have history at all: they are the only two
 * dated rows. `createRound` writes no `createdAt`, and the rounds/games/members
 * tables carry only a `seq` bigserial. The operator decided (2026-09-05) to
 * derive history from the existing timestamps rather than add a snapshot table
 * or backfill a date, so the other three metrics keep their plain counts. That
 * is a knowing trade, not an oversight.
 */

// 26 buckets, ending with the current week. Weekly rather than monthly because
// the instance has only been public since 2026-07-24 — monthly would draw two
// bars. One constant, easy to retune.
const HISTORY_WEEKS = 26;

const DAY = 86400000;

/* The ISO week a timestamp falls in, as the `YYYY-MM-DD` of its MONDAY in UTC —
   the same boundary `date_trunc('week', …)` picks, which is why the Postgres
   side casts to UTC explicitly rather than trusting the session TimeZone.
   Returns null for anything unparseable, which is how a row without a usable
   `createdAt` gets DROPPED rather than bucketed as "unknown". */
function weekStart(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  // getUTCDay(): 0 = Sunday. Monday-based, so Sunday is 6 days into its week.
  const back = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - back * DAY);
  return monday.toISOString().slice(0, 10);
}

/* The bucket keys the charts expect, oldest first, ending with `now`'s week.
   Built from the clock rather than from the data, so a quiet week is a zero
   rather than a gap — a chart with missing columns misreads as missing data. */
function historyKeys(now = Date.now()) {
  const end = weekStart(new Date(now).toISOString());
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  const keys = [];
  for (let i = HISTORY_WEEKS - 1; i >= 0; i -= 1) {
    keys.push(new Date(endMs - i * 7 * DAY).toISOString().slice(0, 10));
  }
  return keys;
}

// A zero-filled series. Insertion order is oldest-first and JSON preserves it
// for string keys, so the panel can render `Object.entries()` directly.
function emptyHistory(now = Date.now()) {
  const out = {};
  for (const k of historyKeys(now)) out[k] = 0;
  return out;
}

/* Fold dated rows into a series. Rows outside the window are ignored rather
   than clamped into the first bucket, which would draw a false spike at the
   left edge every time the window moves. */
function countByWeek(isoDates, now = Date.now()) {
  const out = emptyHistory(now);
  for (const iso of isoDates) {
    const k = weekStart(iso);
    if (k !== null && k in out) out[k] += 1;
  }
  return out;
}

/* The oldest bucket's date, as a bound a SQL `where` can use as plain TEXT.
   `createdAt` is always written as an ISO-8601 UTC string, which sorts
   chronologically as text, so `data->>'createdAt' >= historyStart(now)` bounds
   the scan without a cast — the idiom the rest of the repo already uses.

   NOT CASTING IS THE POINT, and it is measured rather than cautious: a
   `date_trunc('week', (data->>'createdAt')::timestamptz)` is the obvious way to
   bucket in SQL and it THROWS FOR THE WHOLE QUERY on one malformed historical
   value — `invalid input syntax for type timestamp with time zone: "t"` — while
   the JSON backend silently drops that row. So the backend that was supposed to
   agree instead 500s the whole panel, and only on the instance that has the bad
   row. Both backends now filter by text here and bucket through `countByWeek`
   below, which makes them agree BY CONSTRUCTION rather than by two
   implementations someone has to keep in step. (Same reasoning as the moderation
   log's own `at` comparison — see lib/repo/postgres.js.) */
function historyStart(now = Date.now()) {
  return historyKeys(now)[0];
}

module.exports = {
  HISTORY_WEEKS, weekStart, historyKeys, historyStart, emptyHistory, countByWeek,
};
