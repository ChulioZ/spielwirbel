/* Spielwirbel – importing a play history (#1665): the pure half.

   Two sources, one shape. A BG Stats export is parsed HERE, in the browser —
   the file never leaves the device, only the plays the user picked do. BGG
   plays arrive already parsed from `GET …/lookup/plays` (lib/providers/bgg.js
   `parsePlays`) and are normalised here into the same shape:

     { source, sourceId, playedOn, dateOnly, dayKey, incomplete, location,
       game: { key, bggId, title, coop }, players: [{ key, name, win, score, team }],
       ending? }

   Everything after that — what is pre-selected, who each source player is in
   this round, which games need creating, and the request batches — is source
   blind and lives here too, so the sheet (play-import-view.js) only renders.

   The BG Stats format is the app's JSON backup. It is not formally documented;
   its shape is what several independent open-source readers of it agree on
   (top-level games/players/locations/plays, `playerScores[]` keyed by
   `playerRefId`, scores as strings, `playDate` as local "YYYY-MM-DD hh:mm:ss").
   The parser is lenient for that reason: an unknown field is ignored, a missing
   optional one defaults, and only a file with no `plays` array is refused.

   Pure and DOM-free, with the `module.exports` guard, so the suite can require
   it and lib/routes/session-import.js can share its constants
   (.claude/rules/shared-constants-across-the-stack.md). */

'use strict';

// The sources a session's `importRef` may name — validated by the route.
const IMPORT_SOURCES = ['bgstats', 'bgg'];
// Plays per request. The client splits a larger selection into batches; the
// route refuses more, and lib/app.js gives this path a 1 MB body ceiling.
const IMPORT_BATCH_MAX = 200;
// The longest person/game/play key the route accepts. Keys are built here from
// source ids and names, so this bounds a name-derived key too.
const IMPORT_KEY_MAX = 120;

const importPad = (n) => String(n).padStart(2, '0');
const importFold = (s) => String(s || '').trim().toLowerCase();
const importKey = (prefix, raw) => `${prefix}:${String(raw)}`.slice(0, IMPORT_KEY_MAX);

// An integer score, or undefined. BG Stats stores scores as strings and may
// hold „12.5" or „—"; an invented total is worse than none, so a non-integer
// is dropped rather than rounded (the route accepts integers only).
function importScore(raw) {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = Number(String(raw).trim());
  return Number.isInteger(n) ? n : undefined;
}

// A local wall-clock "YYYY-MM-DD hh:mm[:ss]" → an ISO instant in THIS device's
// zone, which is the zone the play was logged in (the #1080/#1616 lesson: a
// calendar day is local, never UTC). Null for anything unparseable.
function localStampToIso(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(stamp || ''));
  if (!m) return null;
  const [, y, mo, d, h = '20', mi = '00', s = '00'] = m;
  const date = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  if (date.getFullYear() !== +y || date.getMonth() !== +mo - 1 || date.getDate() !== +d) return null;
  return date.toISOString();
}

function dayKeyOf(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${importPad(d.getMonth() + 1)}-${importPad(d.getDate())}`;
}

// Whether a play's day is one the server will store: not before `minDay`
// (played-on.js `PLAYED_ON_MIN`, injected — a public/js file cannot require a
// sibling, and a copied date would drift) and not in the future. A play outside
// that range is left out of the preview: the route would refuse its whole batch,
// possibly after earlier batches had already been written.
function importDayInRange(playedOn, { minDay, now = new Date() }) {
  if (minDay && dayKeyOf(playedOn) < minDay) return false;
  return Date.parse(playedOn) <= now.getTime();
}

// A BG Stats backup → normalised plays plus the location names (the preview's
// third filter). Throws on a file that is not an export at all, so the sheet
// can say „not a BG Stats file" rather than „no plays".
function parseBgStatsExport(json, { minDay = null, now = new Date() } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || typeof data !== 'object' || !Array.isArray(data.plays)) {
    throw new Error('not_bgstats');
  }
  const games = new Map((Array.isArray(data.games) ? data.games : []).map((g) => [g && g.id, g]));
  const players = new Map((Array.isArray(data.players) ? data.players : []).map((p) => [p && p.id, p]));
  const locations = new Map((Array.isArray(data.locations) ? data.locations : []).map((l) => [l && l.id, l]));
  const plays = [];
  for (const play of data.plays) {
    if (!play || typeof play !== 'object') continue;
    const game = games.get(play.gameRefId);
    const title = game && String(game.name || game.bggName || '').trim();
    if (!title) continue;
    const playedOn = localStampToIso(play.playDate);
    if (!playedOn || !importDayInRange(playedOn, { minDay, now })) continue;
    const bggId = game.bggId > 0 ? Number(game.bggId) : null;
    const coop = game.cooperative === true;
    const scores = Array.isArray(play.playerScores) ? play.playerScores : [];
    const people = scores.map((ps) => {
      const p = players.get(ps && ps.playerRefId);
      const name = p && String(p.name || '').trim();
      if (!name) return null;
      return {
        key: importKey('bgs', ps.playerRefId),
        name,
        win: ps.winner === true,
        score: importScore(ps.score),
        ...(play.usesTeams && ps.team ? { team: String(ps.team).slice(0, 60) } : {}),
      };
    }).filter(Boolean);
    const loc = locations.get(play.locationRefId);
    plays.push({
      source: 'bgstats',
      sourceId: String(play.uuid || `${play.gameRefId}@${play.playDate}`).slice(0, IMPORT_KEY_MAX),
      playedOn,
      // A BG Stats play carries a time of day, so it is shown with it.
      dateOnly: false,
      dayKey: dayKeyOf(playedOn),
      incomplete: play.ignored === true,
      location: loc && loc.name ? String(loc.name) : '',
      game: { key: bggId ? importKey('bgg', bggId) : importKey('title', importFold(title)), bggId, title, coop },
      players: people,
      // A co-op the whole table lost: BG Stats marks nobody as winner.
      ...(coop && people.length && !people.some((p) => p.win) ? { ending: 'lost' } : {}),
    });
  }
  const locationNames = [...new Set(plays.map((p) => p.location).filter(Boolean))].sort();
  return { plays, locations: locationNames };
}

// BGG plays (as `parsePlays` returns them) → normalised plays. A BGG play has a
// DAY only, so it is stored at the 20:00 stand-in and marked date-only (#1629),
// and `quantity` N becomes N sessions on that day, since a session holds one
// play (#1616). `playedOnInstant` is played-on.js's, injected because a
// public/js file cannot require() a sibling.
function normaliseBggPlays(raw, { playedOnInstant, minDay = null, now = new Date() }) {
  const plays = [];
  for (const play of raw || []) {
    if (!play || !play.date || !play.game || !play.game.title) continue;
    const playedOn = playedOnInstant(play.date, now);
    if (!playedOn || !importDayInRange(playedOn, { minDay, now })) continue;
    const bggId = play.game.bggId || null;
    const players = (play.players || []).map((p, i) => ({
      // BGG has no stable id for a non-user player, only the name typed in —
      // so the name IS the key, folded, which is also what makes „Anna" in two
      // plays one person to match. A nameless row gets its position.
      key: importKey('bggp', importFold(p.name) || `#${i}`),
      name: String(p.name || '').trim() || `#${i + 1}`,
      win: p.win === true,
      score: importScore(p.score),
      ...(p.me ? { me: true } : {}),
    }));
    const n = Math.max(1, Math.min(20, play.quantity || 1));
    for (let k = 0; k < n; k++) {
      plays.push({
        source: 'bgg',
        sourceId: n > 1 ? `${play.id}#${k + 1}` : String(play.id),
        playedOn,
        dateOnly: true,
        dayKey: play.date,
        incomplete: play.incomplete === true,
        location: play.location || '',
        game: { key: bggId ? importKey('bgg', bggId) : importKey('title', importFold(play.game.title)), bggId, title: play.game.title, coop: false },
        players,
      });
    }
  }
  return plays;
}

// Who each distinct source player is in this round, pre-selected: a member
// whose name matches case-insensitively, the linked account's own seat for the
// BGG player who IS the account, else a new member for someone who played
// more than once and a guest for a one-off — the regulars become seats, a
// visitor does not crowd the round's member list.
function suggestPeople(plays, members, { meMemberId } = {}) {
  const byKey = new Map();
  for (const play of plays) {
    for (const p of play.players) {
      const entry = byKey.get(p.key) || { key: p.key, name: p.name, plays: 0, me: false };
      entry.plays += 1;
      if (p.me) entry.me = true;
      byKey.set(p.key, entry);
    }
  }
  const byName = new Map(members.filter((m) => !m.retired).map((m) => [importFold(m.name), m.id]));
  return [...byKey.values()].map((e) => {
    let choice;
    if (e.me && meMemberId) choice = { memberId: meMemberId };
    else if (byName.has(importFold(e.name))) choice = { memberId: byName.get(importFold(e.name)) };
    else if (e.plays > 1) choice = { newMember: e.name };
    else choice = { guest: e.name };
    return { key: e.key, name: e.name, plays: e.plays, choice };
  }).sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name));
}

// Which round game each source game is: the same BGG id in ANY state (retired
// and wished included — the round has it), else the same title, else a new
// game, retired by default so the shelf does not fill with everything ever
// played.
function suggestGames(plays, games) {
  const byKey = new Map();
  for (const play of plays) {
    const e = byKey.get(play.game.key) || { ...play.game, plays: 0 };
    e.plays += 1;
    byKey.set(play.game.key, e);
  }
  const bySource = new Map(games.filter((g) => g.source && g.source.provider === 'bgg')
    .map((g) => [String(g.source.externalId), g.id]));
  const byTitle = new Map(games.map((g) => [importFold(g.title), g.id]));
  return [...byKey.values()].map((e) => {
    const existing = (e.bggId && bySource.get(String(e.bggId))) || byTitle.get(importFold(e.title));
    return {
      key: e.key,
      title: e.title,
      bggId: e.bggId,
      plays: e.plays,
      choice: existing ? { gameId: existing } : { create: { shelf: false } },
    };
  }).sort((a, b) => b.plays - a.plays || a.title.localeCompare(b.title));
}

// Is this play already in the round? `imported` when a session carries its
// exact importRef; `probable` when a session on the same local day plays the
// same game with the same members — what a play this app pushed to BG Stats
// (#485) looks like coming back, since the export is not known to keep the id
// we sent.
function duplicateState(play, sessions, { gameId, memberIds }) {
  for (const s of sessions) {
    const ref = s.importRef;
    if (ref && ref.source === play.source && ref.id === play.sourceId) return 'imported';
  }
  if (!gameId || !memberIds.length) return null;
  const want = [...memberIds].sort().join(',');
  for (const s of sessions) {
    if (s.cancelled || !s.finished || s.chosenGameId !== gameId) continue;
    if (dayKeyOf(s.createdAt) !== play.dayKey) continue;
    if ([...(s.memberIds || [])].sort().join(',') === want) return 'probable';
  }
  return null;
}

// The member ids a play resolves to under the current people choices — used
// for the duplicate check and the „nobody left at the table" check.
function playMemberIds(play, peopleByKey) {
  const ids = [];
  for (const p of play.players) {
    const c = peopleByKey.get(p.key);
    if (c && c.memberId && !ids.includes(c.memberId)) ids.push(c.memberId);
  }
  return ids;
}

// Does a play pass the preview's filters? `from`/`to` are local day keys.
function playPassesFilter(play, { from, to, location, matchedOnly }, peopleByKey) {
  if (from && play.dayKey < from) return false;
  if (to && play.dayKey > to) return false;
  if (location && play.location !== location) return false;
  if (matchedOnly && !play.players.some((p) => {
    const c = peopleByKey.get(p.key);
    return c && c.memberId;
  })) return false;
  return true;
}

// The request bodies for the chosen plays, in batches of IMPORT_BATCH_MAX. The
// FIRST carries every person and game mapping the selection needs, so the
// route can refuse an over-quota import before writing any session; `resolve`
// rewrites the mappings for the next batch from a response's new ids.
function buildImportBatches(source, plays, people, games) {
  const usedPeople = new Set(plays.flatMap((p) => p.players.map((x) => x.key)));
  const usedGames = new Set(plays.map((p) => p.game.key));
  const peopleBody = people
    .filter((p) => usedPeople.has(p.key) && p.choice)
    .map((p) => ({ key: p.key, ...p.choice }));
  const gamesBody = games.filter((g) => usedGames.has(g.key)).map((g) => (g.choice.gameId
    ? { key: g.key, gameId: g.choice.gameId }
    : { key: g.key, create: { title: g.title, ...(g.bggId ? { bggId: g.bggId } : {}), shelf: !!g.choice.create.shelf } }));
  const wire = (play) => ({
    id: play.sourceId,
    playedOn: play.playedOn,
    dateOnly: play.dateOnly,
    gameKey: play.game.key,
    ...(play.ending ? { ending: play.ending } : {}),
    players: play.players.map((p) => ({
      key: p.key,
      win: p.win,
      ...(p.score !== undefined ? { score: p.score } : {}),
      ...(p.team ? { team: p.team } : {}),
    })),
  });
  const batches = [];
  for (let i = 0; i < plays.length; i += IMPORT_BATCH_MAX) {
    batches.push(plays.slice(i, i + IMPORT_BATCH_MAX).map(wire));
  }
  return { source, people: peopleBody, games: gamesBody, batches };
}

// After a batch answered with new ids, name those seats and games by id from
// now on, so the next batch does not create them a second time.
function resolveCreated(plan, response) {
  const people = plan.people.map((p) => (response.people && response.people[p.key]
    ? { key: p.key, memberId: response.people[p.key] } : p));
  const games = plan.games.map((g) => (response.games && response.games[g.key]
    ? { key: g.key, gameId: response.games[g.key] } : g));
  return { ...plan, people, games };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    IMPORT_SOURCES,
    IMPORT_BATCH_MAX,
    IMPORT_KEY_MAX,
    importScore,
    importDayInRange,
    localStampToIso,
    parseBgStatsExport,
    normaliseBggPlays,
    suggestPeople,
    suggestGames,
    duplicateState,
    playMemberIds,
    playPassesFilter,
    buildImportBatches,
    resolveCreated,
  };
}
