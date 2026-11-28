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

function durationMedianOf(mins) {
  if (mins.length < DURATION_MEDIAN_MIN_SESSIONS) return null;
  const sorted = [...mins].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { minutes: Math.max(5, Math.round(median / 5) * 5), count: sorted.length };
}

const countsTowardDuration = (s) => s && s.finished && !s.cancelled && isValidDuration(s.durationMinutes);

function roundGameDuration(sessions, gameId) {
  return durationMedianOf((sessions || [])
    .filter((s) => countsTowardDuration(s) && s.chosenGameId === gameId)
    .map((s) => s.durationMinutes));
}

// Every game's typical duration at once (#1874): a Map of game id → what
// roundGameDuration answers, holding only the games that have one. This is the
// index `gamePlaytime` (draw-pool.js) takes for a game whose round chose
// „aus euren Sessions" — built once per render or request from the round's
// sessions, never stored, so a newly timed session moves the figure everywhere
// on the next read.
function roundDurations(sessions) {
  const byGame = new Map();
  (sessions || []).forEach((s) => {
    if (!countsTowardDuration(s) || !s.chosenGameId) return;
    if (!byGame.has(s.chosenGameId)) byGame.set(s.chosenGameId, []);
    byGame.get(s.chosenGameId).push(s.durationMinutes);
  });
  const index = new Map();
  byGame.forEach((mins, gid) => {
    const d = durationMedianOf(mins);
    if (d) index.set(gid, d);
  });
  return index;
}

// Whether the Spielepass offers „Übernehmen" beside „Bei euch" (#1874): only
// when the measured figure says something the current one does not. Inside the
// range, or within BOTH 15 minutes and a fifth of the nearer bound, it would be
// an invitation to freeze noise; with no current figure at all it always does.
// `pair` is what gamePlaytime answers today ({ minPlaytime, maxPlaytime }).
const PLAYTIME_ADOPT_MIN_DELTA = 15;
const PLAYTIME_ADOPT_MIN_SHARE = 0.2;

function offersMeasuredPlaytime(pair, minutes) {
  if (!isValidDuration(minutes)) return false;
  const p = pair || {};
  const lo = Number.isFinite(p.minPlaytime) ? p.minPlaytime : (Number.isFinite(p.maxPlaytime) ? p.maxPlaytime : null);
  const hi = Number.isFinite(p.maxPlaytime) ? p.maxPlaytime : lo;
  if (lo == null) return true;
  if (minutes >= lo && minutes <= hi) return false;
  const bound = minutes > hi ? hi : lo;
  return Math.abs(minutes - bound) > Math.max(PLAYTIME_ADOPT_MIN_DELTA, PLAYTIME_ADOPT_MIN_SHARE * bound);
}

// How long a set of played sessions took together (#1772): the period recap's
// „12 Std. gespielt". Only sessions with a recorded duration contribute — an
// untimed evening is not zero minutes, it is unknown — so `timed` travels with
// the sum and the recap can say how many of `played` it covers. A split parent
// is not finished (its tables are), so a split evening counts per table, as
// the Chronik shows it.
function sessionsPlayTime(sessions) {
  let minutes = 0;
  let timed = 0;
  let played = 0;
  (sessions || []).forEach((s) => {
    if (!s || !s.finished || s.cancelled) return;
    played += 1;
    if (!isValidDuration(s.durationMinutes)) return;
    minutes += s.durationMinutes;
    timed += 1;
  });
  return { minutes, timed, played };
}

// The round's longest played session (#1772, Pokale's „Längste Session"),
// among those whose game still exists — the card names it, and a deleted game
// has nothing to name. Null until the first timed session. On a tie the most
// recent session wins: the card names ONE evening (its date is on it), and the
// fresher one is the one the group remembers.
function longestSession(sessions, games) {
  const known = new Set((games || []).map((g) => g.id));
  let best = null;
  (sessions || []).forEach((s) => {
    if (!s || !s.finished || s.cancelled || !known.has(s.chosenGameId) || !isValidDuration(s.durationMinutes)) return;
    if (!best || s.durationMinutes > best.durationMinutes
      || (s.durationMinutes === best.durationMinutes && String(s.createdAt) > String(best.createdAt))) best = s;
  });
  return best;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DURATION_MIN, DURATION_MAX, DURATION_TIMER_FLOOR, DURATION_MEDIAN_MIN_SESSIONS,
    isValidDuration, elapsedMinutes, settlePlayDuration, roundGameDuration,
    roundDurations, offersMeasuredPlaytime, PLAYTIME_ADOPT_MIN_DELTA, PLAYTIME_ADOPT_MIN_SHARE,
    sessionsPlayTime, longestSession,
  };
}
