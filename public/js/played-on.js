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

   ## An optional TIME, and the date-only marker (#1629)

   The field may also carry a time („19:30"). With one, the instant is that
   local time and is SHOWN like any session's. Without one, the 20:00 above is
   a stand-in that keeps ordering and calendar buckets right and is never
   displayed: the session is date-only. Which of the two a session is cannot be
   read off the instant, so it is stored — `dateOnly` on the session, written as
   a boolean every time a session is logged or re-dated. `isDateOnlySession` is
   the one reader, shared by the server's summary and every client surface.

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
// A local time of day as an <input type="time"> returns it, minutes only.
const PLAYED_AT_SHAPE = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

// 'HH:MM' of `date` on the LOCAL clock — what an <input type="time"> shows.
function localTimeKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${playedOnPad(d.getHours())}:${playedOnPad(d.getMinutes())}`;
}

// The local Date for a picked day and an optional 'HH:MM', or null when either
// is not real. „2026-02-31" is refused by the round trip: `new Date` would
// quietly roll it into March. Not capped — see playedOnInstant.
function playedOnDate(dayKey, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ''));
  if (!m) return null;
  let hour = PLAYED_ON_HOUR;
  let minute = 0;
  if (time) {
    const t = PLAYED_AT_SHAPE.exec(String(time));
    if (!t) return null;
    hour = Number(t[1]);
    minute = Number(t[2]);
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute, 0, 0);
  if (Number.isNaN(d.getTime()) || localDayKey(d) !== dayKey) return null;
  return d;
}

// The stored instant for a picked local day — at `time` when one is given, else
// at the 20:00 stand-in — or null for anything that is not a real day or time.
// Capped at `now`: a stand-in 20:00 still ahead today becomes now. A typed time
// still ahead is refused before this is called (isFuturePlayedOn), never capped,
// since a silently moved time would be a time nobody entered.
function playedOnInstant(dayKey, now = new Date(), time = '') {
  const d = playedOnDate(dayKey, time);
  if (!d) return null;
  return (d > now ? now : d).toISOString();
}

// Is the picked day + time later than now? Only a TYPED time can be: the
// stand-in is capped, and a future day is refused on its own.
function isFuturePlayedOn(dayKey, time, now = new Date()) {
  if (!time) return false;
  const d = playedOnDate(dayKey, time);
  return !!d && d > now;
}

// Is this session shown by its DATE only (#1629)? A stored boolean wins. With
// none, a session whose date was set by hand — the `logged`/`redated` entries
// in its log — is date-only: every one of those predates the marker and was
// stored at the 20:00 stand-in. Any other session was stamped by the app and
// has a real time. Also accepts a summary row ({ at, dateOnly? }), which never
// carries events and so reads its boolean or nothing.
function isDateOnlySession(session) {
  if (!session) return false;
  if (typeof session.dateOnly === 'boolean') return session.dateOnly;
  // Array.isArray, not `|| []`: the summary reads every open session of every
  // round, so one malformed blob must not take the home screen down — and it is
  // the exact equivalent of the jsonb_typeof guard the SQL restatement needs.
  const events = Array.isArray(session.events) ? session.events : [];
  return events.some((e) => e && (e.type === 'logged' || e.type === 'redated'));
}

// What a request's `dateOnly` means. Only an explicit `false` says „a time was
// entered": a client that predates #1629 sends none, and it only ever sent the
// 20:00 stand-in.
function requestedDateOnly(value) {
  return value !== false;
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
    localDayKey, localTimeKey, isPastDay, playedOnInstant, isFuturePlayedOn,
    normalizePlayedOn, isDateOnlySession, requestedDateOnly,
  };
}
