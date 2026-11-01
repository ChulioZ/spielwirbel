'use strict';

/* The window behind „Letzte sieben Tage" on the operator panel — derived ONCE
   here and handed to both repo backends, so the two cannot disagree about where
   the week starts (.claude/rules/server-computed-calendar-periods.md §2).

   A ROLLING 7 × 24 h, on purpose: the card's label names no calendar period, so
   it makes no claim a calendar boundary would have to honour, and an hour of DST
   drift on a seven-day count is noise. The upper bound sits a day ahead of now
   because the stamps are compared as ISO TEXT: a letter sorts after every digit,
   so without a bound a malformed stamp would read as recent — and a played-on
   date may legitimately sit slightly in the future (played-on.js's skew). */

const DAY_MS = 86400000;

function lastWeekWindow(now = Date.now()) {
  return {
    since: new Date(now - 7 * DAY_MS).toISOString(),
    until: new Date(now + DAY_MS).toISOString(),
  };
}

module.exports = { lastWeekWindow };
