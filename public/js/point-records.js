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

/* ## Scoring categories (#1780)

   A game may carry `scoreCategories: [{ id, name, removed? }]` — the round's own
   score sheet („Vögel · Eier · Boni"). A session then stores, BESIDE the totals,
   `scoreParts: { seatId: { categoryId: int } }`. Beside rather than inside:
   `session.scores` stays `{ seatId: int }`, so every reader that predates
   categories (records, the profile, badges, BG Stats, the export, the operator
   counts) keeps reading the total that still decides everything, and a session
   recorded before categories existed is simply one without parts.

   Ids, not names, key the parts, so renaming a category keeps its history.
   Removing one keeps it in the list as `removed: true` WHEN a session still holds
   values for it — the sheet hides it, the export still names it — and drops it
   outright when nothing does. Re-adding a removed name revives its id, and with
   it its history.

   A part only counts while the seat's parts SUM to its stored total
   (`seatScoreParts`): the route enforces that on write, but a total edited by a
   client that predates categories would otherwise leave stale parts behind that
   no longer add up — read as absent, never as wrong. */
const SCORE_CATEGORY_MAX = 12;
const SCORE_CATEGORY_NAME_MAX = 30;

// The game's stored categories (every state), malformed entries skipped.
function scoreCategoryList(game) {
  const list = game && Array.isArray(game.scoreCategories) ? game.scoreCategories : [];
  return list.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string');
}

// The categories the sheet shows, in the round's order.
function activeScoreCategories(game) {
  return scoreCategoryList(game).filter((c) => !c.removed);
}

/* The editor's ordered list merged into the stored one, for PATCH …/games/:gid.
   `incoming` is `[{ id?, name }]` — the active list as the user left it; an entry
   with an id renames that category, one without is new (or revives a removed
   category of the same name). `usedIds` are the category ids some session still
   holds values for: a stored category missing from `incoming` survives as
   `removed` only if it is in there. Returns `{ list }` or `{ error }`. */
function mergeScoreCategories(stored, incoming, { mintId, usedIds }) {
  if (!Array.isArray(incoming)) return { error: 'scoreCategories must be an array' };
  if (incoming.length > SCORE_CATEGORY_MAX) return { error: 'Too many scoring categories' };
  const known = new Map(scoreCategoryList({ scoreCategories: stored }).map((c) => [c.id, c]));
  const removedByName = new Map();
  known.forEach((c) => { if (c.removed) removedByName.set(c.name.toLocaleLowerCase(), c.id); });
  const ids = new Set();
  const names = new Set();
  const list = [];
  for (const entry of incoming) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') return { error: 'Invalid scoring category' };
    const name = entry.name.trim();
    if (!name || name.length > SCORE_CATEGORY_NAME_MAX) return { error: 'Invalid scoring category name' };
    const key = name.toLocaleLowerCase();
    if (names.has(key)) return { error: 'Duplicate scoring category' };
    names.add(key);
    let cid = entry.id;
    if (cid !== undefined && cid !== null) {
      if (typeof cid !== 'string' || !known.has(cid)) return { error: 'Unknown scoring category' };
    } else {
      cid = removedByName.get(key);
      if (!cid || ids.has(cid)) cid = mintId();
    }
    if (ids.has(cid)) return { error: 'Duplicate scoring category' };
    ids.add(cid);
    list.push({ id: cid, name });
  }
  known.forEach((c, cid) => {
    if (!ids.has(cid) && usedIds && usedIds.has(cid)) list.push({ id: cid, name: c.name, removed: true });
  });
  return { list };
}

/* A sheet's per-category points, checked against the totals it was sent with
   and the game's categories (any state — an old session may hold a removed
   one's value). `{ seatId: { categoryId: int } }`; a seat with an empty object is
   dropped. Every listed seat must carry a total equal to the sum of its parts.
   Returns the normalized map ({} for none) or null when anything is invalid. */
function parseScoreParts(raw, scores, game) {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const known = new Set(scoreCategoryList(game).map((c) => c.id));
  const out = {};
  for (const [seat, parts] of Object.entries(raw)) {
    if (!parts || typeof parts !== 'object' || Array.isArray(parts)) return null;
    const entries = Object.entries(parts);
    if (!entries.length) continue;
    if (!Object.prototype.hasOwnProperty.call(scores, seat) || !isValidPoints(scores[seat])) return null;
    let sum = 0;
    const clean = {};
    for (const [cid, v] of entries) {
      if (!known.has(cid) || !isValidPoints(v)) return null;
      clean[cid] = v;
      sum += v;
    }
    if (sum !== scores[seat]) return null;
    out[seat] = clean;
  }
  return out;
}

// Does this seat's breakdown add up to its total? Shared by the read and the
// keep-on-resave paths below.
function partsMatchTotal(parts, total) {
  if (!parts || typeof parts !== 'object' || !isValidPoints(total)) return false;
  const values = Object.values(parts);
  return values.length > 0 && values.every(isValidPoints) && values.reduce((a, b) => a + b, 0) === total;
}

// The stored parts that still add up to these totals — what a re-save that sent
// no `parts` (a client predating categories) keeps.
function consistentScoreParts(parts, scores) {
  const out = {};
  if (!parts || typeof parts !== 'object' || !scores) return out;
  Object.keys(parts).forEach((seat) => {
    if (Object.prototype.hasOwnProperty.call(scores, seat) && partsMatchTotal(parts[seat], scores[seat])) out[seat] = parts[seat];
  });
  return out;
}

// One seat's breakdown on one session, or null when it has none that adds up.
function seatScoreParts(session, seatId) {
  const all = session && session.scoreParts;
  const scores = session && session.scores;
  if (!all || typeof all !== 'object' || !scores || typeof scores !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(all, seatId)) return null;
  return partsMatchTotal(all[seatId], scores[seatId]) ? all[seatId] : null;
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
   guest's too; two parties tied on a record-breaking score both carry it.

   With `catId` (#1780) the same derivation runs over ONE scoring category's
   values instead of the totals — same direction, same parties, same "earlier"
   — which is what per-category records and bests are. */
function gamePointRecords(round, game, deps, catId) {
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
      const points = catId ? (seatScoreParts(s, party.id) || {})[catId] : scores[party.id];
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

/* Per-category records for the Spielepass (#1780): one entry per ACTIVE category
   that some play has a value for, in the round's order —
   `[{ category, record: { points, party, session } }]`. A removed category's
   record is not shown (its values stay in the export). */
function gameCategoryRecords(round, game, deps) {
  return activeScoreCategories(game)
    .map((category) => ({ category, record: gamePointRecords(round, game, deps, category.id).record }))
    .filter((e) => e.record);
}

/* One member's per-category bests in one round (#1780), for the member page's
   „Bestleistungen" disclosure: `[{ game, categories: [{ category, points,
   session }] }]`, games in round.games order, only games where the member has at
   least one. Same "members only, never a team" rule as the total best. */
function memberCategoryBests(round, mid, deps) {
  const d = deps || { sessionPartyGroups, sortSessionsByDate };
  const byGame = new Map();
  ((round && round.sessions) || []).forEach((s) => {
    if (!s || !s.finished || s.cancelled || !s.chosenGameId || !s.scoreParts) return;
    if (!byGame.has(s.chosenGameId)) byGame.set(s.chosenGameId, []);
    byGame.get(s.chosenGameId).push(s);
  });
  const out = [];
  ((round && round.games) || []).forEach((game) => {
    const sessions = byGame.get(game.id);
    if (!sessions) return;
    const sub = { ...round, sessions };
    const categories = [];
    activeScoreCategories(game).forEach((category) => {
      const best = gamePointRecords(sub, game, d, category.id).bests.get(mid);
      if (best) categories.push({ category, points: best.points, session: best.session });
    });
    if (categories.length) out.push({ game, categories });
  });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    POINTS_MIN, POINTS_MAX, AUTOMA_NAME_MAX, isValidPoints, parseAutoma, pointsBeat,
    gamePointRecords, sessionPointLines, memberPointRecords,
    SCORE_CATEGORY_MAX, SCORE_CATEGORY_NAME_MAX, scoreCategoryList, activeScoreCategories,
    mergeScoreCategories, parseScoreParts, consistentScoreParts, seatScoreParts,
    gameCategoryRecords, memberCategoryBests,
  };
}
