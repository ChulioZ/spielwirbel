/* Spielwirbel – Abzeichen (#1386/#1387): the catalogue and its derivation.

   An Abzeichen is an earned mark a round, a member of a round, or an account
   collects by playing. NOTHING here is stored: every state is derived on demand
   from the round snapshot, exactly like `gameStats` (game-stats.js) — sessions
   are the single source of truth, so deleting a session removes the marks it
   produced, and changing a threshold below re-dates every round at once.

   The catalogue is the ★ core set of docs/design/handover-abzeichen-2026-09-26.md
   §2 with the decisions of docs/design/pruefung-abzeichen-2026-09-26.md finding 4:
   22 entries (9 member · 9 round · 4 account), Stammgast and the round's
   Sessions with four tiers, everything else three at most, and exactly three
   secrets (Comeback · Einstimmig · Unentschieden).

   The public API — the rendering slices (#1388 Klassisch, #1389 the account
   tier, the design skins) build on these and nothing else:

     roundBadges(round, opts)   -> { round: [entry], members: { [mid]: [entry] } }
     newSince(round, sid, opts) -> [{ key, holder, memberId, tier, sessionId, at }]
     accountBadges(stats, createdAt, now) -> [entry]
     BADGE_CATALOGUE            -> the 22 definitions, in display order

   One entry:
     { key, holder, glyph, secret,
       state: 'earned' | 'progress' | 'locked' | 'secret',
       tier,      // the highest tier reached (tiered entries only), else null
       count, of, // progress toward the NEXT threshold; null when nothing to count
       earnedAt,  // { sessionId, at } of the latest earning, else null
       history,   // every earning, oldest first: [{ tier, sessionId, at }]
       isNew,     // an earning came from the round's latest finished session
       gameId }   // Dauerbrenner only: the game that carries the count
   `sessionId` is null for the three round entries no session produces (Regal,
   Durchgespielt, Rückblick geteilt) and for the account tier.

   The replay: every condition walks the round's FINISHED sessions in
   `createdAt` order — when the evening happened, the Pokale streak's rule
   (views-pokale.js), since `finishedAt` moves when an old session is
   re-finished — and reports its running count as `steps`. A threshold is earned
   at the first step reaching it, which is what makes a tier's date, the
   Chronik row and `newSince` derivable with no stored field.

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
const BADGE_BIG_TABLE = 8;
// Comeback: contested sessions without a win before the one that ends it.
const BADGE_COMEBACK_DROUGHT = 10;
// Dauerbrenner: plays of one game.
const BADGE_EVERGREEN_PLAYS = 10;

/* Each definition: key (code identifier; the strings live under badges.<key>.*),
   holder, glyph (a class declared in public/fonts/tabler-icons.css — the four
   X17 sheets' choices), `tiers` for a tiered entry OR `goal` for a single
   count threshold, `n` for a yes/no entry whose condition line still states a
   number (Comeback, Große Runde) — each is the {n} of the condition line —
   `secret`, `counted` (whether an unearned entry shows „7 / 10"), and
   `measure`, the condition.

   measure(ctx, subject) -> { steps: [{ sessionId, at, count }], count, of?, gameId? }
   `count` is the current running value; `of` overrides the progress denominator
   where the target is not a threshold (Alles gespielt: the shelf's size). */
const BADGE_CATALOGUE = [
  // --- A. a member of a round ---------------------------------------------
  { key: 'firstWin', holder: 'member', glyph: 'ti-crown', measure: (c, mid) => badgeFirst(c.sessions.filter((s) => badgeWon(s, mid))) },
  { key: 'regular', holder: 'member', glyph: 'ti-star', tiers: [10, 25, 50, 100], counted: true, measure: (c, mid) => badgeRunning(c.joined(mid)) },
  { key: 'streak', holder: 'member', glyph: 'ti-bolt', goal: 3, measure: badgeMeasureStreak },
  { key: 'versatile', holder: 'member', glyph: 'ti-dice-5', tiers: [3, 6, 10], counted: true, measure: badgeMeasureVersatile },
  { key: 'allPlayed', holder: 'member', glyph: 'ti-checkbox', counted: true, measure: badgeMeasureAllPlayed },
  { key: 'teamPlayer', holder: 'member', glyph: 'ti-users', measure: badgeMeasureTeamPlayer },
  { key: 'host', holder: 'member', glyph: 'ti-home-heart', goal: 10, counted: true, measure: badgeMeasureHost },
  { key: 'comeback', holder: 'member', glyph: 'ti-rocket', n: BADGE_COMEBACK_DROUGHT, secret: true, measure: badgeMeasureComeback },
  { key: 'explorer', holder: 'member', glyph: 'ti-world-search', goal: 5, counted: true, measure: badgeMeasureExplorer },
  // --- B. the round ---------------------------------------------------------
  { key: 'founded', holder: 'round', glyph: 'ti-flag', measure: (c) => badgeFirst(c.sessions) },
  { key: 'sessions', holder: 'round', glyph: 'ti-calendar', tiers: [10, 50, 100, 250], counted: true, measure: (c) => badgeRunning(c.sessions) },
  { key: 'shelf', holder: 'round', glyph: 'ti-archive', tiers: [25, 50, 100], counted: true, measure: badgeMeasureShelf },
  { key: 'unanimous', holder: 'round', glyph: 'ti-heart', secret: true, measure: (c) => badgeFirst(c.sessions.filter((s) => badgeUnanimous(c, s))) },
  { key: 'tie', holder: 'round', glyph: 'ti-scale', secret: true, measure: (c) => badgeFirst(c.sessions.filter((s) => badgeTiedVote(c, s))) },
  { key: 'bigTable', holder: 'round', glyph: 'ti-confetti', n: BADGE_BIG_TABLE, measure: (c) => badgeFirst(c.sessions.filter((s) => c.deps.sessionPeople(c.round, s).length >= BADGE_BIG_TABLE)) },
  { key: 'completed', holder: 'round', glyph: 'ti-circle-check', measure: badgeMeasureCompleted },
  { key: 'evergreen', holder: 'round', glyph: 'ti-flame', goal: BADGE_EVERGREEN_PLAYS, counted: true, measure: badgeMeasureEvergreen },
  { key: 'recapShared', holder: 'round', glyph: 'ti-share', measure: badgeMeasureRecapShared },
  // --- C. the account, across all its rounds --------------------------------
  { key: 'accountSessions', holder: 'account', glyph: 'ti-cards', tiers: [25, 100, 500], counted: true, measure: (c) => badgeTotal(c.stats.sessions) },
  { key: 'accountWins', holder: 'account', glyph: 'ti-trophy', tiers: [10, 50], counted: true, measure: (c) => badgeTotal(c.stats.wins) },
  { key: 'accountRounds', holder: 'account', glyph: 'ti-world', tiers: [2, 5], counted: true, measure: (c) => badgeTotal(c.stats.rounds) },
  { key: 'accountYears', holder: 'account', glyph: 'ti-hourglass', tiers: [1, 2, 3], counted: true, measure: badgeMeasureYears },
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

// A night that was a CONTEST: more than one party, and not ended as „Kein
// Sieger"/„Fortsetzung folgt" (#1038). The Pokale streak's own filter, so
// Serienheld cannot be earned by logging solo plays (#895) and Comeback's
// drought cannot be run up by them either.
function badgeIsContest(c, s) {
  const e = c.deps.sessionEnding(s);
  return c.deps.sessionPartyCount(c.round, s) > 1 && e !== 'noWinner' && e !== 'ongoing';
}

// --- A. member conditions ------------------------------------------------------

// Three contested wins in a row among the sessions the member joined. `count`
// is the longest run so far; a shared win (several winnerIds) still counts —
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

// Distinct games won with. Every win counts, as memberStats' `wins` does.
function badgeMeasureVersatile(c, mid) {
  const seen = new Set();
  const steps = [];
  c.sessions.forEach((s) => {
    if (!badgeWon(s, mid) || !s.chosenGameId || seen.has(s.chosenGameId)) return;
    seen.add(s.chosenGameId);
    steps.push(badgeStep(s, seen.size));
  });
  return { steps, count: seen.size };
}

/* Every game on the shelf played at least once with the member present.

   „Earned stays earned" (handover A5): the shelf a session is judged against is
   the games on today's shelf that had ALREADY been added by then, so a game
   added next month cannot reach back and un-earn it. Progress, while unearned,
   is against today's whole shelf. */
function badgeMeasureAllPlayed(c, mid) {
  const shelf = c.round.games.filter(c.deps.isActiveGame);
  const played = new Set();
  let hit = null;
  c.joined(mid).forEach((s) => {
    if (s.chosenGameId) played.add(s.chosenGameId);
    if (hit) return;
    const then = shelf.filter((g) => !g.createdAt || !s.createdAt || g.createdAt <= s.createdAt);
    if (then.length && then.every((g) => played.has(g.id))) hit = s;
  });
  const count = shelf.filter((g) => played.has(g.id)).length;
  return { steps: hit ? [badgeStep(hit, 1)] : [], count, of: shelf.length };
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

// The first game marked durchgespielt (#250) that still is.
function badgeMeasureCompleted(c) {
  const at = c.round.games.filter((g) => g.completed && g.completedAt).map((g) => g.completedAt).sort()[0];
  return at ? { steps: [{ sessionId: null, at, count: 1 }], count: 1 } : { steps: [], count: 0 };
}

// One game played `goal` times. `gameId` names the game the count belongs to:
// the first one to reach the goal once earned, else today's most-played.
function badgeMeasureEvergreen(c) {
  const plays = {};
  const steps = [];
  let best = 0;
  let gameId = null;
  c.sessions.forEach((s) => {
    if (!s.chosenGameId) return;
    const n = (plays[s.chosenGameId] = (plays[s.chosenGameId] || 0) + 1);
    if (n <= best) return;
    best = n;
    // Frozen once the goal is reached: the mark names the game that earned it.
    if (best <= BADGE_EVERGREEN_PLAYS) gameId = s.chosenGameId;
    steps.push(badgeStep(s, best));
  });
  return { steps, count: best, gameId };
}

/* The first period recap shared (#800). Sharing the card is today a purely
   client-side act (views-period-recap.js `shareRecapCard`) that stores nothing,
   so the round snapshot holds no signal for it. The condition reads a
   `recap_shared` activity from `opts.activities` so the slice that records the
   share needs no change here; until something writes one, this entry stays
   locked. */
function badgeMeasureRecapShared(c) {
  const at = (c.activities || []).filter((a) => a && a.type === 'recap_shared' && a.at).map((a) => a.at).sort()[0];
  return at ? { steps: [{ sessionId: null, at, count: 1 }], count: 1 } : { steps: [], count: 0 };
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

/* Unentschieden: the vote's first place is shared. Ranked exactly as the result
   screen ranks it (views-session.js) — the Spielwirbel-Score per game, sorted
   on the unclamped value, then `computePlaces` over the DISPLAYED number — so
   the mark agrees with the podium the table actually saw. */
function badgeTiedVote(c, s) {
  if (!c.deps.sessionHasVotes(s)) return false;
  const people = c.deps.sessionPeople(c.round, s);
  const rows = (s.gameIds || []).filter((gid) => c.game(gid)).map((gid) => {
    const ratings = [];
    people.forEach((p) => {
      const v = (s.votes[p.id] || {})[gid];
      if (v && Number.isFinite(v.rating)) ratings.push(v.rating);
    });
    const sc = c.deps.scoreRatings(ratings);
    return { score: sc ? sc.score : 0, shown: sc ? Math.max(c.deps.SCORE_MIN, sc.score) : 0, count: ratings.length };
  }).sort((a, b) => b.score - a.score);
  return c.deps.computePlaces(rows).filter((p) => p === 1).length >= 2;
}

// --- C. the account --------------------------------------------------------------

// Whole years since the account was created; each anniversary is its date.
function badgeMeasureYears(c) {
  const start = Date.parse(c.createdAt);
  if (!Number.isFinite(start)) return { steps: [], count: 0 };
  const steps = [];
  for (let n = 1; ; n++) {
    const d = new Date(start);
    d.setUTCFullYear(d.getUTCFullYear() + n);
    if (d.getTime() > c.now) break;
    steps.push({ sessionId: null, at: d.toISOString(), count: n });
  }
  return { steps, count: steps.length };
}

// --- evaluation ------------------------------------------------------------------

// The thresholds an entry is earned at: its tiers, its single goal, or 1.
const badgeThresholds = (def) => def.tiers || [def.goal || 1];

/* One definition + its measurement -> one public entry. Generic on purpose:
   every condition above only reports counts, and this is the one place that
   turns them into states, tiers, dates and progress. */
function badgeEvaluate(def, m, latestId) {
  const history = [];
  badgeThresholds(def).forEach((th) => {
    const hit = m.steps.find((st) => st.count >= th);
    if (hit) history.push({ tier: def.tiers ? th : null, sessionId: hit.sessionId, at: hit.at });
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
  return {
    round: { ...round, games: round.games || [], members: round.members || [] },
    sessions,
    activities: o.activities,
    deps: badgeDeps(o.deps),
    game: (gid) => (gid ? byId.get(gid) || null : null),
    // Legacy sessions without `memberIds` count everyone as joined — the
    // memberStats convention, so Stammgast and the member page agree.
    joined: (mid) => {
      if (!joinedCache.has(mid)) {
        joinedCache.set(mid, sessions.filter((s) => !Array.isArray(s.memberIds) || s.memberIds.includes(mid)));
      }
      return joinedCache.get(mid);
    },
  };
}

/* Every round and member entry for one round snapshot.
   opts: { activities (for Rückblick geteilt), deps (Node callers) }. */
function roundBadges(round, opts) {
  const c = badgeRoundContext(round, opts);
  const latest = c.sessions[c.sessions.length - 1];
  const latestId = latest ? latest.id : null;
  const of = (holder, subject) => BADGE_CATALOGUE
    .filter((d) => d.holder === holder)
    .map((d) => badgeEvaluate(d, d.measure(c, subject), latestId));
  const members = {};
  c.round.members.forEach((m) => { members[m.id] = of('member', m.id); });
  return { round: of('round'), members };
}

/* The earnings a given session produced — every entry (and every tier) whose
   first satisfying session it was: the result moment's marks, and the hub's
   „N neue Abzeichen seit …" line. Members first, in catalogue and seat order,
   then the round, so a renderer that shows „at most two" shows the members'
   first (handover §3.4). Session-less earnings (Regal, Durchgespielt,
   Rückblick geteilt) are never attributed to a session. */
function newSince(round, sessionId, opts) {
  const all = roundBadges(round, opts);
  const out = [];
  const collect = (entries, memberId) => entries.forEach((e) => e.history.forEach((h) => {
    if (sessionId && h.sessionId === sessionId) {
      out.push({ key: e.key, holder: e.holder, memberId, tier: h.tier, sessionId: h.sessionId, at: h.at });
    }
  }));
  Object.keys(all.members).forEach((mid) => collect(all.members[mid], mid));
  collect(all.round, null);
  return out;
}

/* The four account-tier entries, from the aggregate lib/user-stats.js already
   computes (`sessions`, `wins`, `rounds`) plus the account's createdAt. Totals
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
    BADGE_EXPLORER_DAYS, BADGE_BIG_TABLE, BADGE_COMEBACK_DROUGHT, BADGE_EVERGREEN_PLAYS,
  };
}
