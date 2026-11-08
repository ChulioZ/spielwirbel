/* Spielwirbel – how long a session's game really took (#1770).
 *
 * A session in play carries `startedPlayingAt` (stamped when its game is chosen,
 * or when „Jetzt spielen" creates it) and, once played, `durationMinutes`: what
 * the timer measured, or what someone typed. This file holds the rules both ends
 * share — the bounds the result's field offers and `PUT …/sessions/:sid/duration`
 * validates, the timer's own reading, and the round's typical figure the
 * Spielepass prints — so the client and the route cannot disagree about any of
 * them (.claude/rules/shared-constants-across-the-stack.md). Pure and
 * dependency-free; both repo backends require it for `settlePlayDuration`.
 *
 * Part of the frontend; all files share one global script scope (load order: see
 * index.html). */

// A recorded duration, in whole minutes: one minute to one day. The ceiling is
// a full day's play, short of a timer nobody stopped for a week.
const DURATION_MIN = 1;
const DURATION_MAX = 1440;

// The timer records nothing below this. Choosing a game and marking it played
// straight away — a group that only opens the app after the game — reads as
// a one-minute play otherwise, and two of those would put a filler's figure on
// the Spielepass of a two-hour game. Typing a short figure stays possible: the
// floor only applies to what the timer writes by itself.
const DURATION_TIMER_FLOOR = 5;

function isValidDuration(v) {
  return Number.isInteger(v) && v >= DURATION_MIN && v <= DURATION_MAX;
}

// Whole minutes between two instants, or null when either is missing or
// unparsable, or the span is negative. Not clamped: callers decide what an
// out-of-range reading means (the running line shows it, the stamp refuses it).
function elapsedMinutes(startIso, endIso) {
  const a = Date.parse(startIso);
  const b = Date.parse(endIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.floor((b - a) / 60000);
}

// The finish transition's write, run by BOTH backends inside their session lock
// (so it is decided against the stored state, never a snapshot). Mutates `s`.
//
// Only when nothing is recorded yet: every winner-chip tap re-POSTs /finish,
// and an un-finish + re-finish must not overwrite a figure somebody corrected by
// hand. A reading under the floor or past a day records nothing — the field on
// the result stays empty for the group to fill in.
function settlePlayDuration(s, nowIso) {
  if (s.finished || isValidDuration(s.durationMinutes) || !s.startedPlayingAt) return;
  const m = elapsedMinutes(s.startedPlayingAt, nowIso);
  if (m != null && m >= DURATION_TIMER_FLOOR && m <= DURATION_MAX) s.durationMinutes = m;
}

// The round's own typical duration for one game: the median over its played
// sessions with a recorded duration, rounded to 5 minutes. Null below two such
// sessions — one evening is an anecdote, not „bei euch". Computed on demand from
// the sessions (CLAUDE.md: never denormalized), so deleting a session or
// clearing its minutes removes its effect.
const DURATION_MEDIAN_MIN_SESSIONS = 2;

function roundGameDuration(sessions, gameId) {
  const mins = (sessions || [])
    .filter((s) => s && s.finished && !s.cancelled && s.chosenGameId === gameId && isValidDuration(s.durationMinutes))
    .map((s) => s.durationMinutes)
    .sort((a, b) => a - b);
  if (mins.length < DURATION_MEDIAN_MIN_SESSIONS) return null;
  const mid = mins.length >> 1;
  const median = mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2;
  return { minutes: Math.max(5, Math.round(median / 5) * 5), count: mins.length };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DURATION_MIN, DURATION_MAX, DURATION_TIMER_FLOOR, DURATION_MEDIAN_MIN_SESSIONS,
    isValidDuration, elapsedMinutes, settlePlayDuration, roundGameDuration,
  };
}
