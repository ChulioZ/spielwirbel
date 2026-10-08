/* Spielwirbel – Abzeichen (#1386/#1387): the catalogue and its derivation.

   An Abzeichen is an earned mark a round, a member of a round, or an account
   collects by playing. NOTHING here is stored: every state is derived on demand
   from the round snapshot, exactly like `gameStats` (game-stats.js) — sessions
   are the single source of truth, so deleting a session removes the marks it
   produced, and changing a threshold below re-dates every round at once.

   The catalogue is the ★ core set of docs/design/handover-abzeichen-2026-09-26.md
   §2 with the decisions of docs/design/pruefung-abzeichen-2026-09-26.md finding 4:
   21 entries (9 member · 8 round · 4 account — Rückblick geteilt was dropped:
   sharing a recap stores nothing, so it could never be earned) and three
   secrets (Comeback · Einstimmig · Unentschieden). #1464 added 20 more on
   2026-10-01 (9 member · 10 round · 1 account), seven of them secret, lifting
   the three-secret cap: 41 entries and ten secrets. Vollzählig was planned with
   them and DROPPED (operator, 2026-10-02): members store no createdAt, so
   „everyone who had joined by then" could only mean everyone seen at a table so
   far — which every round's first evening satisfies by construction, whoever
   stayed home. The first release capped the
   ladders at three tiers (four for Stammgast and the round's Sessions); #1463
   lifted that cap on 2026-10-01. The rule since: every COUNT is a tier ladder,
   as long as its top is still plausible to reach, and only the yes/no marks
   (Erster Sieg, Alles gespielt, Teamgeist, Gegründet, Durchgespielt and the
   three secrets) stay single — a tier „1" would read „Teamgeist 1".

   The public API — the rendering slices (#1388 Klassisch, #1389 the account
   tier, the design skins) build on these and nothing else:

     roundBadges(round, opts)   -> { round: [entry], members: { [mid]: [entry] } }
     newSince(round, sid, opts) -> [{ key, holder, memberId, tier, sessionId, at, gameId? }]
     accountBadges(stats, createdAt, now) -> [entry]
     BADGE_CATALOGUE            -> the 41 definitions, in display order

   One entry:
     { key, holder, glyph, secret,
       state: 'earned' | 'progress' | 'locked' | 'secret',
       tier,      // the highest tier reached (tiered entries only), else null
       count, of, // progress toward the NEXT threshold; null when nothing to count
       earnedAt,  // { sessionId, at } of the latest earning, else null
       history,   // every earning, oldest first: [{ tier, sessionId, at, gameId? }]
       isNew,     // an earning came from the round's latest finished session
       gameId }   // Dauerbrenner only: the game holding the running best, i.e.
                  // the one the count belongs to. Each of its history entries
                  // carries its OWN `gameId` too — the game that crossed that
                  // tier, which a later game overtaking it does not rewrite.
   `sessionId` is null for the round entries no session produces (Regal,
   Durchgespielt, Jubiläum) and for the account tier.

   The replay: every condition walks the round's FINISHED sessions in
   `createdAt` order — when the evening happened, the Pokale streak's rule
   (session-tally.js), since `finishedAt` moves when an old session is
   re-finished — and reports its running count as `steps`. A threshold is earned
   at the first step reaching it, which is what makes a tier's date, the
   Chronik row and `newSince` derivable with no stored field.

   EVENINGS (#1464): the children of one split session (#796) share a
   `parentSessionId` and are ONE evening wherever a condition is about order,
   adjacency, a time window or attendance (Immer dabei, Revanche, Marathon,
   Anfängerglück's „first play"). Without that a three-table split is an instant
   Marathon and breaks everybody's Immer-dabei run. Plain counts still count
   each played table, as Stammgast and Sessions always have.

   Guests never hold marks (.claude/rules/session-guests-are-not-members.md):
   `members` is keyed by `round.members` alone. A guest still COUNTS as a person
   at the table for Große Runde, and as a voter for Einstimmig/Unentschieden,
   because those are about the evening, not about a seat. A retired member keeps
   their key, so their marks stay derivable.

   `opts.deps` carries the siblings this file reads, INJECTED — the memberStats
   shape (member-stats.js): a public/js file cannot require() a sibling, so a
   Node caller hands them in and the browser falls back to the shared scope.
   `accountBadges` needs none, which is why lib/user-stats.js can require this
   file without assembling them. Dependency-free otherwise; load order: see
   index.html. */

'use strict';

const BADGE_DAY_MS = 24 * 60 * 60 * 1000;
// Entdecker: a game counts when it is played within this many days of being
// added to the shelf.
const BADGE_EXPLORER_DAYS = 7;
// Große Runde: people at the table, guests included (handover B6).
const BADGE_BIG_TABLE_TIERS = [8, 12, 16];
// Comeback: contested sessions without a win before the one that ends it.
const BADGE_COMEBACK_DROUGHT = 10;
// Dauerbrenner: plays of one game.
const BADGE_EVERGREEN_TIERS = [10, 25, 50];
// Doppelschlag and Marathon: a duration on `createdAt`, never a time of day —
// the „no clock-time marks" exclusion of the epic stays untouched.
const BADGE_WINDOW_HOURS = 12;
const BADGE_WINDOW_MS = BADGE_WINDOW_HOURS * 60 * 60 * 1000;
// Jahrgang: calendar months (UTC) in a row with a finished session.
const BADGE_VINTAGE_MONTHS = 12;
// Wiederentdeckt: days since the game's previous play (or since it was added).
const BADGE_REDISCOVERED_DAYS = 365;
// Gegen den Strom: games ranked in the vote, so „last" is not merely „second".
const BADGE_TIDE_MIN_GAMES = 3;

/* Each definition: key (code identifier; the strings live under badges.<key>.*),
   holder, glyph (a class declared in public/fonts/tabler-icons.css — the four
   X17 sheets' choices), `tiers` for a counted threshold, `n` for a yes/no
   entry whose condition line still states a number (Comeback) — each is the {n}
   of the condition line — `secret`, `counted` (whether an unearned entry shows
   „7 / 10"; Serienheld and Große Runde are not, since a best run or a table
   size is no progress you accumulate), `lineOne` where the line has a singular
   form for n = 1 (the two year counts), and `measure`, the condition.

   measure(ctx, subject) -> { steps: [{ sessionId, at, count }], count, of?, gameId?, closed? }
   `count` is the current running value; `of` overrides the progress denominator
   where the target is not a threshold (Alles gespielt: the shelf's size).
   `closed` says the entry can NEVER be earned any more (Gründungsmitglied once
   the first evening has passed without the member): an unearned closed entry is
   left out of its holder's list altogether, rather than shown as an open tile
   with a chance it does not have (operator, 2026-10-02). It is derived like
   everything else, so deleting the first session can reopen it. */
const BADGE_CATALOGUE = [
  // --- A. a member of a round ---------------------------------------------
  { key: 'firstWin', holder: 'member', glyph: 'ti-crown', measure: (c, mid) => badgeFirst(c.sessions.filter((s) => badgeWon(s, mid))) },
  { key: 'regular', holder: 'member', glyph: 'ti-star', tiers: [10, 25, 50, 100, 250], counted: true, measure: (c, mid) => badgeRunning(c.joined(mid)) },
  { key: 'streak', holder: 'member', glyph: 'ti-bolt', tiers: [3, 5, 7], measure: badgeMeasureStreak },
  { key: 'versatile', holder: 'member', glyph: 'ti-dice-5', tiers: [3, 6, 10, 20], counted: true, measure: (c, mid) => badgeDistinctGames(c.sessions.filter((s) => badgeWon(s, mid))) },
  { key: 'allPlayed', holder: 'member', glyph: 'ti-checkbox', counted: true, measure: (c, mid) => badgeShelfPlayed(c, c.joined(mid)) },
  { key: 'teamPlayer', holder: 'member', glyph: 'ti-users', measure: badgeMeasureTeamPlayer },
  { key: 'host', holder: 'member', glyph: 'ti-home-heart', tiers: [10, 25, 50], counted: true, measure: badgeMeasureHost },
  { key: 'comeback', holder: 'member', glyph: 'ti-rocket', n: BADGE_COMEBACK_DROUGHT, secret: true, measure: badgeMeasureComeback },
  { key: 'explorer', holder: 'member', glyph: 'ti-world-search', tiers: [5, 10, 25], counted: true, measure: badgeMeasureExplorer },
  { key: 'founder', holder: 'member', glyph: 'ti-seedling', measure: badgeMeasureFounder },
  { key: 'firstChoice', holder: 'member', glyph: 'ti-thumb-up', tiers: [5, 10, 25], counted: true, measure: badgeMeasureFirstChoice },
  { key: 'specialist', holder: 'member', glyph: 'ti-target', tiers: [5, 10, 25], counted: true, measure: (c, mid) => badgeBestPerGame(c.sessions.filter((s) => badgeWon(s, mid))) },
  { key: 'present', holder: 'member', glyph: 'ti-infinity', tiers: [10, 25, 50], measure: badgeMeasurePresent },
  { key: 'variety', holder: 'member', glyph: 'ti-arrows-shuffle', tiers: [10, 25, 50], counted: true, measure: (c, mid) => badgeDistinctGames(c.joined(mid)) },
  { key: 'defender', holder: 'member', glyph: 'ti-shield', measure: badgeMeasureDefender },
  { key: 'beginnersLuck', holder: 'member', glyph: 'ti-clover', secret: true, measure: badgeMeasureBeginnersLuck },
  { key: 'rematch', holder: 'member', glyph: 'ti-swords', secret: true, measure: badgeMeasureRematch },
  { key: 'double', holder: 'member', glyph: 'ti-stopwatch', n: BADGE_WINDOW_HOURS, secret: true, measure: badgeMeasureDouble },
  // --- B. the round ---------------------------------------------------------
  { key: 'founded', holder: 'round', glyph: 'ti-flag', measure: (c) => badgeFirst(c.sessions) },
  { key: 'sessions', holder: 'round', glyph: 'ti-calendar', tiers: [10, 25, 50, 100, 250, 500], counted: true, measure: (c) => badgeRunning(c.sessions) },
  { key: 'shelf', holder: 'round', glyph: 'ti-archive', tiers: [25, 50, 100, 200], counted: true, measure: badgeMeasureShelf },
  { key: 'unanimous', holder: 'round', glyph: 'ti-heart', secret: true, measure: (c) => badgeFirst(c.sessions.filter((s) => badgeUnanimous(c, s))) },
  { key: 'tie', holder: 'round', glyph: 'ti-scale', secret: true, measure: (c) => badgeFirst(c.sessions.filter((s) => badgeTiedVote(c, s))) },
  { key: 'bigTable', holder: 'round', glyph: 'ti-confetti', tiers: BADGE_BIG_TABLE_TIERS, measure: badgeMeasureBigTable },
  { key: 'completed', holder: 'round', glyph: 'ti-circle-check', measure: badgeMeasureCompleted },
  { key: 'evergreen', holder: 'round', glyph: 'ti-flame', tiers: BADGE_EVERGREEN_TIERS, counted: true, measure: (c) => badgeBestPerGame(c.sessions, true) },
  { key: 'openHouse', holder: 'round', glyph: 'ti-door', tiers: [5, 10, 25], counted: true, measure: (c) => badgeRunning(c.sessions.filter((s) => Array.isArray(s.guests) && s.guests.length)) },
  { key: 'twoTables', holder: 'round', glyph: 'ti-layout-columns', measure: (c) => badgeFirst(c.sessions.filter((s) => s.parentSessionId)) },
  { key: 'campaign', holder: 'round', glyph: 'ti-book', tiers: [5, 10, 25], counted: true, measure: (c) => badgeRunning(c.sessions.filter((s) => c.deps.sessionEnding(s) === 'ongoing')) },
  { key: 'allWin', holder: 'round', glyph: 'ti-heart-handshake', measure: (c) => badgeFirst(c.sessions.filter((s) => badgeAllWon(c, s))) },
  { key: 'vintage', holder: 'round', glyph: 'ti-calendar-check', n: BADGE_VINTAGE_MONTHS, measure: badgeMeasureVintage },
  { key: 'anniversary', holder: 'round', glyph: 'ti-cake', tiers: [1, 2, 3], counted: true, lineOne: true, measure: (c) => badgeYearsSince(c.sessions[0] && c.sessions[0].createdAt, c.now) },
  { key: 'marathon', holder: 'round', glyph: 'ti-run', n: BADGE_WINDOW_HOURS, secret: true, measure: badgeMeasureMarathon },
  { key: 'rediscovered', holder: 'round', glyph: 'ti-refresh', secret: true, measure: badgeMeasureRediscovered },
  { key: 'againstTheTide', holder: 'round', glyph: 'ti-arrow-back-up', secret: true, measure: (c) => badgeFirst(c.sessions.filter((s) => badgeAgainstTheTide(c, s))) },
  { key: 'complete', holder: 'round', glyph: 'ti-books', secret: true, measure: (c) => badgeShelfPlayed(c, c.sessions) },
  // --- C. the account, across all its rounds --------------------------------
  { key: 'accountSessions', holder: 'account', glyph: 'ti-cards', tiers: [25, 100, 250, 500, 1000], counted: true, measure: (c) => badgeTotal(c.stats.sessions) },
  { key: 'accountWins', holder: 'account', glyph: 'ti-trophy', tiers: [10, 25, 50, 100, 250], counted: true, measure: (c) => badgeTotal(c.stats.wins) },
  { key: 'accountRounds', holder: 'account', glyph: 'ti-world', tiers: [2, 3, 5], counted: true, measure: (c) => badgeTotal(c.stats.rounds) },
  { key: 'accountYears', holder: 'account', glyph: 'ti-hourglass', tiers: [1, 2, 3], counted: true, lineOne: true, measure: (c) => badgeYearsSince(c.createdAt, c.now) },
  { key: 'accountGames', holder: 'account', glyph: 'ti-puzzle', tiers: [10, 25, 50, 100], counted: true, measure: (c) => badgeTotal(c.stats.gamesPlayed) },
];

// --- helpers every condition shares ------------------------------------------

const badgeStep = (s, count) => ({ sessionId: s.id, at: s.createdAt || null, count });

// A yes/no condition: earned at the first session in `list`.
function badgeFirst(list) {
  return list.length ? { steps: [badgeStep(list[0], 1)], count: 1 } : { steps: [], count: 0 };
}

// A plain count: one step per session in `list`.
function badgeRunning(list) {
  return { steps: list.map((s, i) => badgeStep(s, i + 1)), count: list.length };
}

// A number with no session behind it (the account tier's totals).
function badgeTotal(n) {
  const count = Number.isFinite(n) ? n : 0;
  return { steps: [{ sessionId: null, at: null, count }], count };
}

const badgeWon = (s, mid) => (s.winnerIds || []).includes(mid);

// Milliseconds from session `a` to session `b`; NaN (failing every bound) when
// either is undated.
const badgeGap = (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

// Distinct games among `list`, one step per game first seen (Vielseitig, Querbeet).
function badgeDistinctGames(list) {
  const seen = new Set();
  const steps = [];
  list.forEach((s) => {
    if (!s.chosenGameId || seen.has(s.chosenGameId)) return;
    seen.add(s.chosenGameId);
    steps.push(badgeStep(s, seen.size));
  });
  return { steps, count: seen.size };
}

/* The most sessions of ONE game among `list` — a running maximum, one step per
   new best (Dauerbrenner over every play, Spezialist over a member's wins).
   With `naming`, each step carries the game that set the new best, so every
   tier names the game that crossed IT (g1 at 10, g2 at 25 once it overtook
   g1), and `gameId` is the game holding the running best — the one the count
   and the condition line talk about. Only Dauerbrenner names its game: the
   renderer prints `gameId` as „Dauerbrenner mit …" wherever it is present. */
function badgeBestPerGame(list, naming) {
  const plays = {};
  const steps = [];
  let best = 0;
  let gameId = null;
  list.forEach((s) => {
    if (!s.chosenGameId) return;
    const n = (plays[s.chosenGameId] = (plays[s.chosenGameId] || 0) + 1);
    if (n <= best) return;
    best = n;
    gameId = s.chosenGameId;
    steps.push(naming ? { ...badgeStep(s, best), gameId } : badgeStep(s, best));
  });
  return naming ? { steps, count: best, gameId } : { steps, count: best };
}

/* Every game on the shelf played at least once among `list` (Alles gespielt:
   the member's sessions; Vollständig: the round's).

   „Earned stays earned" (handover A5): the shelf a session is judged against is
   the games on today's shelf that had ALREADY been added by then, so a game
   added next month cannot reach back and un-earn it. Progress, while unearned,
   is against today's whole shelf. */
function badgeShelfPlayed(c, list) {
  const shelf = c.round.games.filter(c.deps.isActiveGame);
  const played = new Set();
  let hit = null;
  list.forEach((s) => {
    if (s.chosenGameId) played.add(s.chosenGameId);
    if (hit) return;
    const then = shelf.filter((g) => !g.createdAt || !s.createdAt || g.createdAt <= s.createdAt);
    if (then.length && then.every((g) => played.has(g.id))) hit = s;
  });
  const count = shelf.filter((g) => played.has(g.id)).length;
  return { steps: hit ? [badgeStep(hit, 1)] : [], count, of: shelf.length };
}

// Whole years since `iso`; each anniversary is its own date (Konto Jahre from
// the account's createdAt, Jubiläum from the round's first finished session).
function badgeYearsSince(iso, now) {
  const start = Date.parse(iso);
  if (!Number.isFinite(start)) return { steps: [], count: 0 };
  const steps = [];
  for (let n = 1; ; n++) {
    const d = new Date(start);
    d.setUTCFullYear(d.getUTCFullYear() + n);
    if (d.getTime() > now) break;
    steps.push({ sessionId: null, at: d.toISOString(), count: n });
  }
  return { steps, count: steps.length };
}

// A night that was a CONTEST: more than one party, and not ended as „Kein
// Sieger"/„Fortsetzung folgt" (#1038). The Pokale streak's own filter, so
// Serienheld cannot be earned by logging solo plays (#895) and Comeback's
// drought cannot be run up by them either.
function badgeIsContest(c, s) {
  const e = c.deps.sessionEnding(s);
  return c.deps.sessionPartyCount(c.round, s) > 1 && e !== 'noWinner' && e !== 'ongoing';
}

// --- A. member conditions ------------------------------------------------------

// Contested wins in a row among the sessions the member joined. `count` is the
// longest run so far, one step per new best, so 5 and 7 are dated at the
// session that extended the best run to them; a shared win (several winnerIds) still counts —
// the mark is about this member, not about winning alone.
function badgeMeasureStreak(c, mid) {
  const steps = [];
  let run = 0;
  let best = 0;
  c.joined(mid).filter((s) => badgeIsContest(c, s)).forEach((s) => {
    run = badgeWon(s, mid) ? run + 1 : 0;
    if (run > best) { best = run; steps.push(badgeStep(s, best)); }
  });
  return { steps, count: best };
}

// Won as part of a TEAM (#575): the member's party at a winning session was a
// resolved team, i.e. at least MIN_TEAM_SIZE people.
function badgeMeasureTeamPlayer(c, mid) {
  return badgeFirst(c.sessions.filter((s) => badgeWon(s, mid)
    && c.deps.sessionPartyGroups(c.round, s).some((p) => p.team && p.personIds.includes(mid))));
}

// The member's own box was the played game: they own it (`ownerIds`, #971),
// they were at the table, and they did not come without their shelf (#1002 —
// then somebody else's copy was on the table).
function badgeMeasureHost(c, mid) {
  return badgeRunning(c.joined(mid).filter((s) => {
    const g = c.game(s.chosenGameId);
    return g && (g.ownerIds || []).includes(mid) && !(s.withoutShelfIds || []).includes(mid);
  }));
}

// A contested win after at least `goal` contested sessions without one —
// counted from the member's first session, so a first win after a long wait is
// a comeback too.
function badgeMeasureComeback(c, mid) {
  let drought = 0;
  const hits = [];
  c.joined(mid).filter((s) => badgeIsContest(c, s)).forEach((s) => {
    if (!badgeWon(s, mid)) { drought += 1; return; }
    if (drought >= BADGE_COMEBACK_DROUGHT) hits.push(s);
    drought = 0;
  });
  return badgeFirst(hits);
}

// Distinct games the member played within a week of the game joining the shelf.
function badgeMeasureExplorer(c, mid) {
  const seen = new Set();
  const steps = [];
  c.joined(mid).forEach((s) => {
    const g = c.game(s.chosenGameId);
    if (!g || seen.has(g.id) || !g.createdAt || !s.createdAt) return;
    const age = Date.parse(s.createdAt) - Date.parse(g.createdAt);
    if (!(age >= 0 && age <= BADGE_EXPLORER_DAYS * BADGE_DAY_MS)) return;
    seen.add(g.id);
    steps.push(badgeStep(s, seen.size));
  });
  return { steps, count: seen.size };
}

// At the table of the round's first evening — dated at the member's own table
// when that evening was split. Once that evening exists without them, closed.
function badgeMeasureFounder(c, mid) {
  const ev = c.evenings[0];
  const s = ev && ev.sessions.find((x) => c.isJoined(mid, x));
  return ev && !s ? { ...badgeFirst([]), closed: true } : badgeFirst(s ? [s] : []);
}

// Sessions the member joined in which they gave the PLAYED game the top rating
// (Einstimmig's top). A direct pick asked nobody, so it holds no rating to find
// — no separate sessionHasVotes guard: a break-on-purpose showed it could never
// decide anything the rating lookup had not.
function badgeMeasureFirstChoice(c, mid) {
  const top = c.deps.TILE_VALUE.length - 1;
  return badgeRunning(c.joined(mid).filter((s) => {
    const v = s.chosenGameId && ((s.votes || {})[mid] || {})[s.chosenGameId];
    return !!v && v.rating === top;
  }));
}

// The longest run of consecutive round EVENINGS the member was at — a best run,
// one step per new best (Serienheld's shape). An evening split across tables
// counts once, at whichever table they sat.
function badgeMeasurePresent(c, mid) {
  const steps = [];
  let run = 0;
  let best = 0;
  c.evenings.forEach((ev) => {
    const s = ev.sessions.find((x) => c.isJoined(mid, x));
    run = s ? run + 1 : 0;
    if (run > best) { best = run; steps.push(badgeStep(s, best)); }
  });
  return { steps, count: best };
}

// A contested win of a game, then a win at the NEXT contested session of that
// game the member joined.
function badgeMeasureDefender(c, mid) {
  const lastWon = {};
  const hits = [];
  c.joined(mid).filter((s) => s.chosenGameId && badgeIsContest(c, s)).forEach((s) => {
    const won = badgeWon(s, mid);
    if (won && lastWon[s.chosenGameId]) hits.push(s);
    lastWon[s.chosenGameId] = won;
  });
  return badgeFirst(hits);
}

// A contested win at the round's FIRST evening with that game — every table of
// a split debut counts as that first play.
function badgeMeasureBeginnersLuck(c, mid) {
  const debut = {};
  return badgeFirst(c.sessions.filter((s) => {
    const gid = s.chosenGameId;
    if (!gid) return false;
    if (!(gid in debut)) debut[gid] = c.eveningKey(s);
    return debut[gid] === c.eveningKey(s) && badgeWon(s, mid) && badgeIsContest(c, s);
  }));
}

// Two CONSECUTIVE evenings of the round played the same game with the member at
// both, both contested: no win in the first, a win in the second.
function badgeMeasureRematch(c, mid) {
  const hits = [];
  let prev = {};
  c.evenings.forEach((ev) => {
    const cur = {};
    ev.sessions.forEach((s) => {
      if (s.chosenGameId && c.isJoined(mid, s) && badgeIsContest(c, s)) cur[s.chosenGameId] = s;
    });
    Object.keys(cur).forEach((gid) => {
      if (prev[gid] && !badgeWon(prev[gid], mid) && badgeWon(cur[gid], mid)) hits.push(cur[gid]);
    });
    prev = cur;
  });
  return badgeFirst(hits);
}

// Two contested wins within BADGE_WINDOW_HOURS of each other.
function badgeMeasureDouble(c, mid) {
  const hits = [];
  let prev = null;
  c.joined(mid).filter((s) => badgeWon(s, mid) && badgeIsContest(c, s)).forEach((s) => {
    if (prev && badgeGap(prev, s) <= BADGE_WINDOW_MS) hits.push(s);
    prev = s;
  });
  return badgeFirst(hits);
}

// --- B. round conditions ---------------------------------------------------------

// Games on the shelf today, dated by when each was added. No session produces
// this one, so its steps carry no sessionId.
function badgeMeasureShelf(c) {
  const games = c.round.games.filter(c.deps.isActiveGame)
    .slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  return {
    steps: games.map((g, i) => ({ sessionId: null, at: g.createdAt || null, count: i + 1 })),
    count: games.length,
  };
}

// The most people at one table so far — a running maximum, one step per new
// best (Serienheld's shape), so 12 and 16 are dated at the first session that
// size. Guests count: the mark is about the evening, not about a seat.
function badgeMeasureBigTable(c) {
  const steps = [];
  let best = 0;
  c.sessions.forEach((s) => {
    const n = c.deps.sessionPeople(c.round, s).length;
    if (n > best) { best = n; steps.push(badgeStep(s, best)); }
  });
  return { steps, count: best };
}

// The first game marked durchgespielt (#250) that still is.
function badgeMeasureCompleted(c) {
  const at = c.round.games.filter((g) => g.completed && g.completedAt).map((g) => g.completedAt).sort()[0];
  return at ? { steps: [{ sessionId: null, at, count: 1 }], count: 1 } : { steps: [], count: 0 };
}

// Gemeinsam gewonnen: everyone at the table, guests included, is a winner — and
// there were at least two of them, since a solo play is not „gemeinsam".
function badgeAllWon(c, s) {
  const people = c.deps.sessionPeople(c.round, s);
  return people.length >= 2 && people.every((p) => badgeWon(s, p.id));
}

// Jahrgang: a finished session in each of BADGE_VINTAGE_MONTHS consecutive
// calendar months (UTC, like Konto Jahre).
function badgeMeasureVintage(c) {
  const hits = [];
  let prev = null;
  let run = 0;
  c.sessions.forEach((s) => {
    const d = new Date(s.createdAt);
    if (!Number.isFinite(d.getTime())) return;
    const month = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (month === prev) return;
    run = prev !== null && month === prev + 1 ? run + 1 : 1;
    prev = month;
    if (run === BADGE_VINTAGE_MONTHS) hits.push(s);
  });
  return badgeFirst(hits);
}

// Marathon: three EVENINGS starting within BADGE_WINDOW_HOURS — so the tables of
// one split are one evening, never a Marathon on their own.
function badgeMeasureMarathon(c) {
  const ev = c.evenings;
  const hits = [];
  ev.forEach((e, i) => {
    if (i >= 2 && badgeGap(ev[i - 2].sessions[0], e.sessions[0]) <= BADGE_WINDOW_MS) {
      hits.push(e.sessions[e.sessions.length - 1]);
    }
  });
  return badgeFirst(hits);
}

// Wiederentdeckt: the game's previous play in the round — or, never played, the
// day it joined the shelf — lies at least BADGE_REDISCOVERED_DAYS back.
function badgeMeasureRediscovered(c) {
  const lastPlay = {};
  return badgeFirst(c.sessions.filter((s) => {
    const gid = s.chosenGameId;
    if (!gid) return false;
    const g = c.game(gid);
    const since = gid in lastPlay ? lastPlay[gid] : g && g.createdAt;
    lastPlay[gid] = s.createdAt;
    return !!since && Date.parse(s.createdAt) - Date.parse(since) >= BADGE_REDISCOVERED_DAYS * BADGE_DAY_MS;
  }));
}

/* Voters: everyone at the table (guests included) who rated at least one game.
   A direct-pick session asks nobody, so it has no vote at all and neither
   condition below can fire on it. */
function badgeVoters(c, s) {
  return c.deps.sessionPeople(c.round, s).filter((p) => {
    const byGame = s.votes && s.votes[p.id];
    return byGame && Object.values(byGame).some((v) => v && Number.isFinite(v.rating));
  });
}

// Einstimmig: at least two voters, and every one gave the played game the top
// rating. One voter agreeing with themselves is not a group being unanimous.
function badgeUnanimous(c, s) {
  if (!s.chosenGameId || !c.deps.sessionHasVotes(s)) return false;
  const top = c.deps.TILE_VALUE.length - 1;
  const vs = badgeVoters(c, s);
  return vs.length >= 2 && vs.every((p) => {
    const v = s.votes[p.id][s.chosenGameId];
    return v && v.rating === top;
  });
}

/* The vote's places, ranked exactly as the result screen ranks it
   (views-session-result-tafel.js) — the Spielwirbel-Score per game, sorted on the unclamped
   value, then `computePlaces` over the DISPLAYED number — so a mark agrees with
   the podium the table actually saw. A game nobody rated has no place and is
   left out: [{ gid, place }], best first. */
function badgeVotePlaces(c, s) {
  const people = c.deps.sessionPeople(c.round, s);
  const rows = (s.gameIds || []).filter((gid) => c.game(gid)).map((gid) => {
    const ratings = [];
    people.forEach((p) => {
      const v = (s.votes[p.id] || {})[gid];
      if (v && Number.isFinite(v.rating)) ratings.push(v.rating);
    });
    const sc = c.deps.scoreRatings(ratings);
    return { gid, score: sc ? sc.score : 0, shown: sc ? Math.max(c.deps.SCORE_MIN, sc.score) : 0, count: ratings.length };
  }).sort((a, b) => b.score - a.score);
  const places = c.deps.computePlaces(rows);
  return rows.map((r, i) => ({ gid: r.gid, place: places[i] })).filter((r) => r.place !== null);
}

// Unentschieden: the vote's first place is shared.
function badgeTiedVote(c, s) {
  return c.deps.sessionHasVotes(s) && badgeVotePlaces(c, s).filter((r) => r.place === 1).length >= 2;
}

/* Gegen den Strom: the played game took the vote's LAST place, with at least
   three games ranked. A shared last place still counts — unless every game
   shares first, where the played game was last and first at once and nobody
   went against anything. */
function badgeAgainstTheTide(c, s) {
  if (!s.chosenGameId || !c.deps.sessionHasVotes(s)) return false;
  const ranked = badgeVotePlaces(c, s);
  if (ranked.length < BADGE_TIDE_MIN_GAMES) return false;
  const last = Math.max(...ranked.map((r) => r.place));
  const own = ranked.find((r) => r.gid === s.chosenGameId);
  return last > 1 && !!own && own.place === last;
}

// --- evaluation ------------------------------------------------------------------

// The thresholds an entry is earned at: its tiers, or 1 for a yes/no mark.
const badgeThresholds = (def) => def.tiers || [1];

/* One definition + its measurement -> one public entry, or null for an
   unearned entry that can no longer be earned (`closed`). Generic on purpose:
   every condition above only reports counts, and this is the one place that
   turns them into states, tiers, dates and progress. */
function badgeEvaluate(def, m, latestId) {
  if (m.closed && !m.steps.length) return null;
  const history = [];
  badgeThresholds(def).forEach((th) => {
    const hit = m.steps.find((st) => st.count >= th);
    if (!hit) return;
    const h = { tier: def.tiers ? th : null, sessionId: hit.sessionId, at: hit.at };
    if (hit.gameId !== undefined) h.gameId = hit.gameId;
    history.push(h);
  });
  const earned = history.length > 0;
  const next = badgeThresholds(def).find((th) => m.count < th);
  let count = null;
  let of = null;
  if (def.counted && !(def.secret && !earned)) {
    if (m.of !== undefined) {
      if (!earned) { count = m.count; of = m.of; }
    } else if (next !== undefined) {
      count = m.count; of = next;
    }
  }
  let state = 'locked';
  if (earned) state = 'earned';
  else if (def.secret) state = 'secret';
  else if (count) state = 'progress';
  const last = history[history.length - 1];
  const entry = {
    key: def.key,
    holder: def.holder,
    glyph: def.glyph,
    secret: !!def.secret,
    state,
    tier: def.tiers && earned ? last.tier : null,
    count,
    of,
    earnedAt: earned ? { sessionId: last.sessionId, at: last.at } : null,
    history,
    isNew: !!latestId && history.some((h) => h.sessionId === latestId),
  };
  if (m.gameId !== undefined) entry.gameId = m.gameId;
  return entry;
}

function badgeDeps(deps) {
  return deps || {
    sessionPeople, sessionPartyGroups, sessionPartyCount, sessionEnding, sessionHasVotes,
    scoreRatings, TILE_VALUE, SCORE_MIN, computePlaces, isActiveGame,
  };
}

// The shared context every round condition reads: the finished sessions in
// the order they happened, and two memoised lookups.
function badgeRoundContext(round, opts) {
  const o = opts || {};
  const sessions = (round.sessions || [])
    .filter((s) => s.finished)
    .slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const byId = new Map((round.games || []).map((g) => [g.id, g]));
  const joinedCache = new Map();
  const eveningKey = (s) => s.parentSessionId || s.id;
  // Legacy sessions without `memberIds` count everyone as joined — the
  // memberStats convention, so Stammgast and the member page agree.
  const isJoined = (mid, s) => !Array.isArray(s.memberIds) || s.memberIds.includes(mid);
  // The finished sessions grouped into evenings (see the header), in order.
  const evenings = [];
  const byEvening = new Map();
  sessions.forEach((s) => {
    let ev = byEvening.get(eveningKey(s));
    if (!ev) { ev = { sessions: [] }; byEvening.set(eveningKey(s), ev); evenings.push(ev); }
    ev.sessions.push(s);
  });
  return {
    round: { ...round, games: round.games || [], members: round.members || [] },
    sessions,
    evenings,
    eveningKey,
    now: Number.isFinite(o.now) ? o.now : Date.now(),
    deps: badgeDeps(o.deps),
    game: (gid) => (gid ? byId.get(gid) || null : null),
    isJoined,
    joined: (mid) => {
      if (!joinedCache.has(mid)) {
        joinedCache.set(mid, sessions.filter((s) => isJoined(mid, s)));
      }
      return joinedCache.get(mid);
    },
  };
}

/* Every round and member entry for one round snapshot.
   opts: { deps (Node callers), now (Jubiläum's clock; default Date.now()) }. */
function roundBadges(round, opts) {
  const c = badgeRoundContext(round, opts);
  const latest = c.sessions[c.sessions.length - 1];
  const latestId = latest ? latest.id : null;
  const of = (holder, subject) => BADGE_CATALOGUE
    .filter((d) => d.holder === holder)
    .map((d) => badgeEvaluate(d, d.measure(c, subject), latestId))
    .filter(Boolean);
  const members = {};
  c.round.members.forEach((m) => { members[m.id] = of('member', m.id); });
  return { round: of('round'), members };
}

/* The earnings a given session produced — every entry (and every tier) whose
   first satisfying session it was: the result moment's marks, and the hub's
   „N neue Abzeichen seit …" line. Members first, in catalogue and seat order,
   then the round, so a renderer that shows „at most two" shows the members'
   first (handover §3.4). Session-less earnings (Regal, Durchgespielt)
   are never attributed to a session. */
function newSince(round, sessionId, opts) {
  const all = roundBadges(round, opts);
  const out = [];
  const collect = (entries, memberId) => entries.forEach((e) => e.history.forEach((h) => {
    if (sessionId && h.sessionId === sessionId) {
      const x = { key: e.key, holder: e.holder, memberId, tier: h.tier, sessionId: h.sessionId, at: h.at };
      if (h.gameId !== undefined) x.gameId = h.gameId;
      out.push(x);
    }
  }));
  Object.keys(all.members).forEach((mid) => collect(all.members[mid], mid));
  collect(all.round, null);
  return out;
}

/* The five account-tier entries, from the aggregate lib/user-stats.js already
   computes (`sessions`, `wins`, `rounds`, `gamesPlayed`) plus the account's createdAt. Totals
   only, never a round or a person — the profile-stats disclosure rule. Only
   Jahre has a date; the play totals have no single session behind them. */
function accountBadges(stats, createdAt, now) {
  const c = { stats: stats || {}, createdAt, now: Number.isFinite(now) ? now : Date.now() };
  return BADGE_CATALOGUE
    .filter((d) => d.holder === 'account')
    .map((d) => badgeEvaluate(d, d.measure(c), null));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BADGE_CATALOGUE, roundBadges, newSince, accountBadges,
    BADGE_EXPLORER_DAYS, BADGE_BIG_TABLE_TIERS, BADGE_COMEBACK_DROUGHT, BADGE_EVERGREEN_TIERS,
    BADGE_WINDOW_HOURS, BADGE_VINTAGE_MONTHS, BADGE_REDISCOVERED_DAYS, BADGE_TIDE_MIN_GAMES,
  };
}
