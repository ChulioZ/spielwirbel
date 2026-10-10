/* Spielwirbel – the day a session was PLAYED, when it is not today (#1616).

   A session logged after the fact (a WhatsApp-poll evening before the group
   found the app, an evening entered a day late) and a finished session whose
   date is corrected both carry a day the user picked. This file is the one
   place that turns that day into a stored instant and that decides whether a
   stored instant is acceptable — the client offers it, the server validates
   it, so both require THIS file
   (.claude/rules/shared-constants-across-the-stack.md).

   ## The day becomes 20:00 LOCAL time, computed on the CLIENT

   The field is a day, not a time. Stored as midnight UTC it would slide
   across a calendar boundary for every reader east or west of Greenwich, and
   the Chronik's period recap buckets on the reader's local calendar day
   (period-recap.js, #1080) — so a session dated „1 March" would count in
   February for half the world. 20:00 local is the middle of the evening the
   group means, far enough from either midnight that no zone moves it to
   another day. Only the client knows its zone, so the conversion happens
   there; the server only checks the result.

   A day that is TODAY but whose 20:00 is still ahead is capped at `now`, so
   „today" can never be a future instant (the server refuses those).

   Pure and DOM-free, with the `module.exports` guard, so the suite can require
   it (.claude/rules/frontend-helper-modules-and-coverage.md). */

'use strict';

// The earliest day a session may be dated. Older than the app by decades;
// it exists to refuse a typo'd year (0202), not to date anything real.
const PLAYED_ON_MIN = '2000-01-01';
// The local hour a picked day is stored at — see the header.
const PLAYED_ON_HOUR = 20;
// How far in the future a submitted instant may lie before it is refused.
// Only clock skew between a device and the server; the client never sends a
// future instant on purpose (`playedOnInstant` caps at now).
const PLAYED_ON_SKEW_MS = 10 * 60 * 1000;

// An ISO 8601 instant WITH a zone, the only shape the server accepts. Date.parse
// alone takes "1", "March 3" and an offset-less local time, each of which means
// something different on the server than it did on the device.
const PLAYED_ON_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const playedOnPad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' of `date` on the LOCAL calendar — what an <input type="date">
// shows and returns.
function localDayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${playedOnPad(d.getMonth() + 1)}-${playedOnPad(d.getDate())}`;
}

// Is `dayKey` a day BEFORE today on the local calendar? String comparison is
// exact on the zero-padded key.
function isPastDay(dayKey, now = new Date()) {
  return typeof dayKey === 'string' && dayKey < localDayKey(now);
}

// The stored instant for a picked local day, or null for anything that is not
// a real calendar day. „2026-02-31" is refused by the round trip: `new Date`
// would quietly roll it into March.
function playedOnInstant(dayKey, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), PLAYED_ON_HOUR, 0, 0, 0);
  if (Number.isNaN(d.getTime()) || localDayKey(d) !== dayKey) return null;
  return (d > now ? now : d).toISOString();
}

// The server's check: the normalised ISO string, or null when the value is not
// a zoned ISO instant, lies in the future beyond the skew, or predates
// PLAYED_ON_MIN. Normalising through toISOString keeps every stored stamp in one
// format, which matters because the backends ORDER sessions by the raw string.
function normalizePlayedOn(value, now = Date.now()) {
  if (typeof value !== 'string' || !PLAYED_ON_SHAPE.test(value)) return null;
  // The written calendar day must exist: Date.parse quietly rolls „2026-02-30"
  // into 2 March. Checked on the date as WRITTEN, before any offset applies,
  // so a legitimate offset that moves the UTC day is not mistaken for one.
  const [y, mo, d] = value.slice(0, 10).split('-').map(Number);
  const cal = new Date(Date.UTC(y, mo - 1, d));
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  if (ms > now + PLAYED_ON_SKEW_MS) return null;
  if (ms < Date.parse(`${PLAYED_ON_MIN}T00:00:00Z`)) return null;
  return new Date(ms).toISOString();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLAYED_ON_MIN, PLAYED_ON_HOUR, PLAYED_ON_SKEW_MS,
    localDayKey, isPastDay, playedOnInstant, normalizePlayedOn,
  };
}
