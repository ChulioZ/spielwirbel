/* Spielwirbel – per-player points on a finished session (#1630): the bounds a
   score may take, and the bests and records derived from them.

   Called "points" in code, never "score": the Spielwirbel-Score (vote-score.js)
   already owns `SCORE_MIN` and the word, and a second meaning under one name in
   one global scope is how a reader picks up the wrong one. The stored field is
   still `session.scores`, as the issue named it.

   ## The bounds are shared with the route

   `POINTS_MIN`/`POINTS_MAX` are what the sheet's inputs offer and what
   `PUT …/sessions/:sid/scores` accepts, so they live in ONE file both require
   (.claude/rules/shared-constants-across-the-stack.md): a drifted server copy
   would 400 a value the sheet let through.

   ## Bests and records are DERIVED, never stored

   Like the rating averages (game-stats.js), everything here is computed on
   demand from the round's sessions, so deleting or re-dating a session, or
   clearing its points, corrects every best and record with no write anywhere.

   Who can hold what:
     - a MEMBER playing as themselves has a personal best per game;
     - a TEAM's score counts for the group record only — a shared result is not
       a personal one, so it never becomes any member's best;
     - a GUEST's score shows on its session and can hold the group record, but a
       guest has no personal best: guest ids are minted per session, so there is
       no person to carry a best across evenings
       (.claude/rules/session-guests-are-not-members.md);
     - an AUTOMA (#1672) holds nothing at all. It is `session.automa`, a field
       of its own and never a party, so sessionPartyGroups cannot return it and
       no best or record below can see it — a hard-difficulty bot cannot end up
       owning a game's record, and a solo evening against one stays solo for
       every people-counting reader (isContestSession, the win rate, badges).

   „Neuer Rekord" means strictly better than that member's best in EARLIER
   sessions of the same game. A first score is not a record (there was nothing
   to beat) and neither is a tie. "Earlier" is by session date, never insertion
   order — a session logged after the fact (#1616) is inserted last while
   belonging in the middle — so the sessions are sorted with the same
   `sortSessionsByDate` both repo backends use.

   Pure and DOM-free. The two siblings it needs are INJECTED (`deps`), the
   member-stats.js shape: a public/js file cannot require() a sibling, so a spec
   passes the real modules and the browser falls back to the shared global
   scope. Under Node a forgotten `deps` throws rather than taking a quiet second
   path. */

'use strict';

// Whole numbers only, negatives allowed — golf-style and penalty games go below
// zero, and nobody's table game scores past five digits.
const POINTS_MIN = -9999;
const POINTS_MAX = 99999;

function isValidPoints(v) {
  return Number.isInteger(v) && v >= POINTS_MIN && v <= POINTS_MAX;
}

/* The automa/bot opponent of a solo or co-op play (#1672): `{ name, points? }`,
   absent when unused. ONE per session — a list would be the second party model
   this file just avoided. Points are optional because several automas score
   nothing; the outcome (won / „Verloren") stays the user's call either way and
   is never inferred from comparing points. Shared with the route, which
   validates against the same bounds. */
const AUTOMA_NAME_MAX = 40;

// The stored automa normalized ({ name, points? }), or null when the input is
// not a valid one. The route stores what this returns; a reader passing a
// session's field gets null for anything malformed.
function parseAutoma(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.name !== 'string') return null;
  const name = v.name.trim();
  if (!name || name.length > AUTOMA_NAME_MAX) return null;
  if (v.points === undefined || v.points === null) return { name };
  return isValidPoints(v.points) ? { name, points: v.points } : null;
}

// Is `a` strictly better than `b` for a game played in this direction?
function pointsBeat(a, b, lowWins) {
  return lowWins ? a < b : a > b;
}

/* Every scored play of one game, oldest first, plus the bests and the record.

   A play counts when the session is finished, not cancelled, played this game
   (`chosenGameId`) and carries points. Each play's lines are the session's
   parties (sessionPartyGroups — one per team, one per un-teamed person) that
   have a score, best first in the game's direction; a party with no score is
   simply not listed. Ties in a line keep party order, so the sheet's order
   decides who is named first.

   Returns
     plays:  [{ session, lines: [{ party, points, newRecord, groupRecord }] }]  oldest first
     bests:  Map memberId -> { points, session }   (members only)
     record: { points, party, session } | null    (the earliest to reach it)

   `groupRecord` (#1631) marks the line that broke the ROUND's record: strictly
   better than the record standing before this session, and the session's own
   best. Like `newRecord`, the first scored play breaks nothing — there was no
   record to beat. A team's line can carry it (a shared result can hold the group
   record, and the operator decided it counts for every member of that team), a
   guest's too; two parties tied on a record-breaking score both carry it. */
function gamePointRecords(round, game, deps) {
  const d = deps || { sessionPartyGroups, sortSessionsByDate };
  const lowWins = !!(game && game.lowScoreWins);
  const gid = game && game.id;
  const bests = new Map();
  let record = null;
  const plays = [];
  d.sortSessionsByDate((round && round.sessions) || []).forEach((s) => {
    if (!s || !s.finished || s.cancelled || s.chosenGameId !== gid) return;
    const scores = s.scores && typeof s.scores === 'object' ? s.scores : null;
    if (!scores) return;
    const lines = [];
    const before = record;
    d.sessionPartyGroups(round, s).forEach((party) => {
      const points = scores[party.id];
      if (!isValidPoints(points)) return;
      const member = !party.team && !party.people[0].guest;
      let newRecord = false;
      if (member) {
        const prev = bests.get(party.id);
        newRecord = !!prev && pointsBeat(points, prev.points, lowWins);
        if (!prev || newRecord) bests.set(party.id, { points, session: s });
      }
      if (!record || pointsBeat(points, record.points, lowWins)) record = { points, party, session: s };
      lines.push({ party, points, newRecord, groupRecord: false });
    });
    if (!lines.length) return;
    if (before && pointsBeat(record.points, before.points, lowWins)) {
      lines.forEach((l) => { l.groupRecord = l.points === record.points; });
    }
    // Stable, so equal points keep the party order.
    lines.sort((a, b) => (pointsBeat(a.points, b.points, lowWins) ? -1 : pointsBeat(b.points, a.points, lowWins) ? 1 : 0));
    plays.push({ session: s, lines });
  });
  return { plays, bests, record };
}

// One session's lines, with its „neuer Rekord" marks — read off the whole
// game's history, since whether a score beat a best depends on every earlier
// evening. Empty when the session has no points (or no chosen game).
function sessionPointLines(round, session, deps) {
  const game = ((round && round.games) || []).find((g) => g.id === (session && session.chosenGameId));
  if (!game) return [];
  const play = gamePointRecords(round, game, deps).plays.find((p) => p.session.id === session.id);
  return play ? play.lines : [];
}

/* One member's record book in one round (#1631): the member page's „Bestleistungen",
   the account-wide merge in lib/user-stats.js, and the two record Abzeichen all
   read THIS, so the page, the profile and the badges cannot count differently.

   Returns
     bests:   [{ game, points, session }]  the member's personal best per game,
              in round.games order (members only — a team score is never one)
     held:    [gameId] — games whose CURRENT group record is the member's: their
              own line or a team's they played in (operator, #1631: a team record
              counts for every member of the team), including a tie at the record
              in the session that set it
     records: [{ session, gameId }]  every line where the member (or their team)
              broke the round's record, oldest first
     bettered:[{ session, gameId }]  every „neuer Rekord" of theirs, oldest first

   The sessions are grouped by game before the per-game pass, so each game's
   history is sorted alone rather than the whole round once per game — the
   badges call this once per member per page. */
function memberPointRecords(round, mid, deps) {
  const d = deps || { sessionPartyGroups, sortSessionsByDate };
  const byGame = new Map();
  ((round && round.sessions) || []).forEach((s) => {
    if (!s || !s.finished || s.cancelled || !s.chosenGameId || !s.scores) return;
    if (!byGame.has(s.chosenGameId)) byGame.set(s.chosenGameId, []);
    byGame.get(s.chosenGameId).push(s);
  });
  const mine = (party) => party.personIds.includes(mid);
  const bests = [];
  const records = [];
  const bettered = [];
  const held = [];
  ((round && round.games) || []).forEach((game) => {
    const sessions = byGame.get(game.id);
    if (!sessions) return;
    const r = gamePointRecords({ ...round, sessions }, game, d);
    const best = r.bests.get(mid);
    if (best) bests.push({ game, points: best.points, session: best.session });
    // Every party that reached the record IN the session that set it holds it —
    // a tie there is shared, as `groupRecord` marks both lines; `record.party`
    // names only the first, for display. A later tie beats nothing, so it does not.
    const setting = r.record && r.plays.find((p) => p.session === r.record.session);
    if (setting && setting.lines.some((l) => l.points === r.record.points && mine(l.party))) held.push(game.id);
    r.plays.forEach((p) => p.lines.forEach((l) => {
      if (!mine(l.party)) return;
      if (l.groupRecord) records.push({ session: p.session, gameId: game.id });
      if (l.newRecord) bettered.push({ session: p.session, gameId: game.id });
    }));
  });
  // A member sits in one party per session and a session plays one game, so a
  // session appears at most once in each list — safe to key the entries by it.
  const byDate = (list) => {
    const of = new Map(list.map((e) => [e.session, e]));
    return d.sortSessionsByDate([...of.keys()]).map((s) => of.get(s));
  };
  return { bests, held, records: byDate(records), bettered: byDate(bettered) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { POINTS_MIN, POINTS_MAX, AUTOMA_NAME_MAX, isValidPoints, parseAutoma, pointsBeat, gamePointRecords, sessionPointLines, memberPointRecords };
}
