/* Spielwirbel – Challenges (#1779): a shared goal a round sets itself.

   A challenge is a preset goal with a deadline — „10 Sessions bis
   Jahresende", „jedes Spiel im Regal einmal". Only the GOAL is stored, on the
   round (`round.challenge`, the finished ones in `round.challengeHistory`);
   progress is derived on every read from the round's sessions, exactly like the
   Abzeichen (achievements.js). Deleting a session therefore corrects the count,
   and nothing has to run when a deadline passes: `expired` is read off the
   clock, never written by a scheduler.

   The server requires this file too — it refuses to start a second challenge
   while one is still RUNNING, and running is a derived state — so the client
   and the route cannot disagree about it
   (.claude/rules/shared-constants-across-the-stack.md).

   WHAT COUNTS. A play is a session whose outcome is `played` (finished, not
   cancelled, not a split parent) with a chosen game, dated by `createdAt` —
   when the evening happened, the Abzeichen's rule, so a session logged after
   the fact for a day before the start does not count. Only plays strictly after
   `startedAt` and at or before the end of the window (the deadline, or
   `endedAt` for one ended early) count.

   EVENINGS. The tables of one split session share a `parentSessionId` and are
   ONE session for the `sessions` preset (operator decision on #1779), as the
   Abzeichen read attendance. The game presets count games, which a split
   cannot inflate.

   „NEVER PLAYED BEFORE" means no play in this round at or before `startedAt`.
   A game bought after the start counts once it is first played (operator
   decision on #1779), so the preset needs no snapshot. Guest games (#1681) are
   another household's boxes and count for neither game preset.

   THE SHELF SNAPSHOT (`wholeShelf`) is the active shelf when the challenge
   started, taken by the server. A game deleted since drops out of the target;
   a retired one drops out unless it was already played in the window, so
   retiring a game never makes the count go backwards.

   Pure and DOM-free, with the module.exports guard. `opts.isActive` is the
   shelf predicate, injected because a public/js file cannot require a sibling
   in the browser; it falls back to the shared-scope `isActiveGame`. */

'use strict';

const CHALLENGE_KINDS = ['newGames', 'wholeShelf', 'sessions', 'distinctGames'];
// The presets that take a number; `wholeShelf`'s target is the shelf itself.
const CHALLENGE_COUNTED = ['newGames', 'sessions', 'distinctGames'];
const CHALLENGE_N_MIN = 1;
const CHALLENGE_N_MAX = 100;
// How far ahead a deadline may lie — a typo'd year, not a real plan, past this.
const CHALLENGE_DEADLINE_MAX_DAYS = 731;
// The „short history" the issue asks for: newest first, the rest dropped.
const CHALLENGE_HISTORY_MAX = 10;
const CHALLENGE_DAY_MS = 24 * 60 * 60 * 1000;

const challengeTime = (iso) => {
  const ms = Date.parse(iso || '');
  return Number.isFinite(ms) ? ms : null;
};

// Every play of the round, oldest first: { sessionId, gameId, evening, at }.
function challengePlays(round) {
  const sessions = (round && round.sessions) || [];
  return sessions
    .filter((s) => s && s.finished && !s.cancelled && s.chosenGameId
      && !(Array.isArray(s.childSessionIds) && s.childSessionIds.length))
    .map((s) => ({ sessionId: s.id, gameId: s.chosenGameId, evening: s.parentSessionId || s.id, at: challengeTime(s.createdAt) }))
    .filter((p) => p.at !== null)
    .sort((a, b) => a.at - b.at || String(a.sessionId).localeCompare(String(b.sessionId)));
}

// The window's closing instant: the deadline, or the early end if sooner.
function challengeWindowEnd(ch) {
  const deadline = challengeTime(ch.deadline);
  const ended = challengeTime(ch.endedAt);
  if (ended === null) return deadline;
  return deadline === null ? ended : Math.min(deadline, ended);
}

/* The derived state of ONE challenge:

     { state: 'running' | 'completed' | 'expired' | 'ended',
       count, of,          // progress; `of` is the target
       completedAt,        // { sessionId, at } of the play that reached it, or null
       steps }             // every play that moved the count: [{ sessionId, at, count }]

   `completed` wins over every other state: a goal reached before the deadline
   stays reached, whatever happens to the clock afterwards. */
function challengeProgress(round, ch, now = Date.now(), opts = {}) {
  const isActive = opts.isActive || (typeof isActiveGame === 'function' ? isActiveGame : () => true);
  const start = challengeTime(ch.startedAt);
  const end = challengeWindowEnd(ch);
  const plays = challengePlays(round);
  const games = new Map(((round && round.games) || []).map((g) => [g.id, g]));
  const inWindow = plays.filter((p) => start !== null && p.at > start && (end === null || p.at <= end));
  const isGuestGame = (gid) => !!(games.get(gid) && games.get(gid).guestGame);

  let of;
  let counts; // play -> does it add one to the count?
  const seen = new Set();
  if (ch.kind === 'sessions') {
    of = ch.n;
    counts = (p) => (seen.has(p.evening) ? false : seen.add(p.evening));
  } else if (ch.kind === 'distinctGames') {
    of = ch.n;
    counts = (p) => (isGuestGame(p.gameId) || seen.has(p.gameId) ? false : seen.add(p.gameId));
  } else if (ch.kind === 'newGames') {
    of = ch.n;
    const before = new Set(plays.filter((p) => p.at <= start).map((p) => p.gameId));
    counts = (p) => (before.has(p.gameId) || isGuestGame(p.gameId) || seen.has(p.gameId) ? false : seen.add(p.gameId));
  } else { // wholeShelf
    const playedNow = new Set(inWindow.map((p) => p.gameId));
    const target = new Set((ch.shelfSnapshot || []).filter((gid) => {
      const g = games.get(gid);
      return g && (isActive(g) || playedNow.has(gid));
    }));
    of = target.size;
    counts = (p) => (!target.has(p.gameId) || seen.has(p.gameId) ? false : seen.add(p.gameId));
  }

  const steps = [];
  let completedAt = null;
  inWindow.forEach((p) => {
    if (!counts(p)) return;
    steps.push({ sessionId: p.sessionId, at: new Date(p.at).toISOString(), count: steps.length + 1 });
    if (!completedAt && of > 0 && steps.length >= of) completedAt = { sessionId: p.sessionId, at: new Date(p.at).toISOString() };
  });
  const deadline = challengeTime(ch.deadline);
  let state = 'running';
  if (completedAt) state = 'completed';
  else if (challengeTime(ch.endedAt) !== null) state = 'ended';
  else if (deadline !== null && now > deadline) state = 'expired';
  return { state, count: Math.min(steps.length, of), of, completedAt, steps };
}

// The round's current challenge with its progress, or null.
function currentChallenge(round, now = Date.now(), opts = {}) {
  const ch = round && round.challenge;
  if (!ch) return null;
  return { ...ch, ...challengeProgress(round, ch, now, opts) };
}

// Is a challenge running — the one state that blocks starting another?
function challengeRunning(round, now = Date.now(), opts = {}) {
  const cur = currentChallenge(round, now, opts);
  return !!cur && cur.state === 'running';
}

// The history with each entry's derived state, newest first as stored.
function challengeHistory(round, now = Date.now(), opts = {}) {
  return ((round && round.challengeHistory) || []).map((ch) => ({ ...ch, ...challengeProgress(round, ch, now, opts) }));
}

/* Validate a start request's shape; the route adds the clock and the shelf.
   Returns { kind, n?, deadline } or a string naming what is wrong. */
function challengeStartError(body, now = Date.now()) {
  if (!body || !CHALLENGE_KINDS.includes(body.kind)) return 'Invalid kind';
  if (CHALLENGE_COUNTED.includes(body.kind)) {
    if (!Number.isInteger(body.n) || body.n < CHALLENGE_N_MIN || body.n > CHALLENGE_N_MAX) return 'Invalid n';
  } else if (body.n != null) return 'Invalid n';
  // An ISO instant WITH a zone — the client turns the picked day into the end
  // of that LOCAL day, as played-on.js does for a session's day.
  if (typeof body.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(body.deadline)) return 'Invalid deadline';
  const deadline = challengeTime(body.deadline);
  if (deadline === null || deadline <= now || deadline > now + CHALLENGE_DEADLINE_MAX_DAYS * CHALLENGE_DAY_MS) return 'Invalid deadline';
  return null;
}

// The end of a picked LOCAL day ('YYYY-MM-DD') as an ISO instant — client side.
function challengeDeadlineInstant(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Whole days left until the deadline, counting today; 0 once it has passed.
function challengeDaysLeft(ch, now = Date.now()) {
  const deadline = challengeTime(ch.deadline);
  if (deadline === null || now > deadline) return 0;
  return Math.ceil((deadline - now) / CHALLENGE_DAY_MS);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CHALLENGE_KINDS, CHALLENGE_COUNTED, CHALLENGE_N_MIN, CHALLENGE_N_MAX,
    CHALLENGE_DEADLINE_MAX_DAYS, CHALLENGE_HISTORY_MAX,
    challengePlays, challengeProgress, currentChallenge, challengeRunning,
    challengeHistory, challengeStartError, challengeDeadlineInstant, challengeDaysLeft,
  };
}
