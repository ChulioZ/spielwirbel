/* Spielwirbel – a round's data, downloaded by anyone who can open it (#1702).

   One zip: a CSV per table for spreadsheets plus `round.json`, the round
   exactly as the API returned it, so nothing the CSVs flatten away is lost.

   BUILT IN THE BROWSER, on purpose. The numbers a CSV states have to be the
   numbers the screens state, and the shelf's score only exists here:
   `roundScoreIndex` (game-stats.js) reads half a dozen shared-scope siblings
   and has no `module.exports`, so a server-side export would have to restate
   it — the drift `.claude/rules/shared-constants-across-the-stack.md` exists
   to prevent. Here every derived value comes from the function the screen
   calls: the score and play count from `roundScoreIndex` (the Regal's own
   index), playing time from `gamePlaytime`, outcome and ending from
   `sessionOutcome`/`sessionEnding`, the date from `isDateOnlySession`, people
   from `sessionPeople`/`sessionRaters`/`sessionTeams`. It also needs no route:
   the round snapshot every grantee already reads is the whole input, so the
   export exposes nothing a grantee could not already see, on both backends.

   The zip is fflate's (`js/vendor/fflate.min.js`,
   `.claude/rules/vendored-frontend-library.md`); this file is its only
   caller, hence the global comment below rather than a `frontendGlobals`
   entry.

   CSV: UTF-8 with a BOM (Excel otherwise reads umlauts and Hangul as
   mojibake), CRLF, RFC 4180 quoting, ISO-8601 dates. Headers are English —
   they are a data format, not UI copy. A TEXT cell that starts with a
   formula character is prefixed with an apostrophe: a member named
   „=HYPERLINK(…)" is ordinary user text here and a live formula in a
   spreadsheet. Numbers are never prefixed, so a negative score stays a
   number. */

/* global fflate */
'use strict';

// One cell. Numbers and booleans are data; everything else is text, and text
// is where both the quoting and the formula guard apply.
function exportCsvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let s = String(value);
  if (CSV_FORMULA_LEAD.test(s)) s = `'${s}`; // the set lib/csv.js defuses too (csv-formula.js)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// A whole table: header row, then one row per entry, BOM first.
function exportCsv(header, rows) {
  const lines = [header, ...rows].map((r) => r.map(exportCsvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const exportPad = (n) => String(n).padStart(2, '0');

// The LOCAL calendar day and time of an instant. Local because a logged
// evening is stored at 20:00 of the day the user picked, in their zone
// (played-on.js) — the UTC day can be the wrong one.
function exportLocalDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: '', time: '' };
  return {
    day: `${d.getFullYear()}-${exportPad(d.getMonth() + 1)}-${exportPad(d.getDate())}`,
    time: `${exportPad(d.getHours())}:${exportPad(d.getMinutes())}`,
  };
}

// A round name is free text, so the filename gets only [a-z0-9-]. Accents fold
// to their base letter; a name with nothing left (Hangul, emoji) falls back to
// "round" rather than producing "spielwirbel--2026-10-20.zip".
function roundExportSlug(name) {
  const slug = String(name || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40).replace(/-+$/, '');
  return slug || 'round';
}

function roundExportFilename(round, now) {
  return `spielwirbel-${roundExportSlug(round.name)}-${exportLocalDay(now.toISOString()).day}.zip`;
}

// The six tables, as { 'games.csv': text, … }. Pure over the round snapshot.
function roundExportTables(round) {
  const games = round.games || [];
  const sessions = round.sessions || [];
  const members = round.members || [];
  const tags = round.tags || [];
  const gameTitle = new Map(games.map((g) => [g.id, g.title]));
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const tagName = new Map(tags.map((tg) => [tg.id, tg.name]));
  const list = (xs) => xs.filter((x) => x !== undefined && x !== null && x !== '').join('; ');

  // Every game, not only the active shelf: `games` only narrows which entries
  // the index carries (game-stats.js), and an off-shelf game's detail page
  // states exactly this number.
  const index = roundScoreIndex(round, games);
  const gameState = (g) => {
    if (g.wish) return 'wished';
    if (g.retired) return 'retired';
    if (g.completed) return 'completed';
    if (g.guestGame) return 'guest';
    return 'active';
  };
  const gamesCsv = exportCsv(
    ['game_id', 'title', 'state', 'min_players', 'max_players', 'min_playtime', 'max_playtime',
      'weight', 'bgg_id', 'owners', 'tags', 'expansions', 'score', 'ratings', 'plays'],
    games.map((g) => {
      const st = index.byGame[g.id] || {};
      const pt = gamePlaytime(g);
      // What the pill prints: `displayScore` floors it at the scale's zero, and
      // `fmtAvg` shows one decimal.
      const score = Number.isFinite(st.score) ? Number(displayScore(st.score).toFixed(1)) : null;
      const bgg = g.source && g.source.provider === 'bgg' ? g.source.externalId : null;
      return [
        g.id, g.title, gameState(g), g.minPlayers, g.maxPlayers, pt.minPlaytime, pt.maxPlaytime,
        g.weight, bgg,
        list((g.ownerIds || []).map((id) => memberName.get(id))),
        list((g.tagIds || []).map((id) => tagName.get(id))),
        list((g.expansions || []).map((e) => e && e.title)),
        score, st.count || 0, index.plays.get(g.id) || 0,
      ];
    })
  );

  const sessionRows = [];
  const voteRows = [];
  const pointRows = [];
  sessions.forEach((s) => {
    const when = exportLocalDay(s.createdAt);
    const dateOnly = isDateOnlySession(s);
    const people = sessionPeople(round, s);
    const raters = sessionRaters(round, s);
    const byId = new Map(raters.map((p) => [p.id, p]));
    const name = (id) => (byId.get(id) || { name: memberName.get(id) || '' }).name;
    sessionRows.push([
      s.id, when.day, dateOnly ? '' : when.time, sessionOutcome(s), sessionEnding(s) || '',
      s.chosenGameId || '', gameTitle.get(s.chosenGameId) || '',
      list((s.winnerIds || []).map(name)),
      list(people.filter((p) => !p.guest).map((p) => p.name)),
      list(people.filter((p) => p.guest).map((p) => p.name)),
      list(sessionTeams(round, s).map((tm) => tm.people.map((p) => p.name).join(' + '))),
      s.parentSessionId || '',
      list(s.childSessionIds || []),
    ]);
    // `sessionRaters`, as `rawGameStats` iterates: a person removed after
    // rating still counts for the shelf, so their votes belong in the table
    // the score is built from.
    raters.forEach((p) => {
      const byGame = (s.votes || {})[p.id] || {};
      Object.keys(byGame).forEach((gid) => {
        const v = byGame[gid];
        if (!v || !Number.isFinite(v.rating)) return;
        voteRows.push([s.id, when.day, p.id, p.name, p.guest, gid, gameTitle.get(gid) || '', v.rating]);
      });
    });
    Object.keys(s.scores || {}).forEach((pid) => {
      const p = byId.get(pid);
      pointRows.push([s.id, when.day, pid, p ? p.name : '', !!(p && p.guest),
        s.chosenGameId || '', gameTitle.get(s.chosenGameId) || '', s.scores[pid]]);
    });
  });

  return {
    'games.csv': gamesCsv,
    'sessions.csv': exportCsv(
      ['session_id', 'date', 'time', 'outcome', 'ending', 'game_id', 'game', 'winners',
        'members', 'guests', 'teams', 'parent_session_id', 'split_into'],
      sessionRows),
    'votes.csv': exportCsv(
      ['session_id', 'date', 'person_id', 'person', 'guest', 'game_id', 'game', 'rating'], voteRows),
    'points.csv': exportCsv(
      ['session_id', 'date', 'person_id', 'person', 'guest', 'game_id', 'game', 'points'], pointRows),
    'members.csv': exportCsv(
      ['member_id', 'name', 'color', 'retired'],
      members.map((m) => [m.id, m.name, m.color, !!m.retired])),
    'tags.csv': exportCsv(
      ['tag_id', 'name', 'icon', 'games'],
      tags.map((tg) => [tg.id, tg.name, tg.icon, games.filter((g) => (g.tagIds || []).includes(tg.id)).length])),
  };
}

// The zip's bytes. `round.json` is the snapshot as fetched — the "complete
// round as stored" the CSVs cannot carry (session logs, filters, cover paths).
function roundExportZip(round) {
  const enc = new TextEncoder();
  const files = {};
  Object.entries(roundExportTables(round)).forEach(([n, text]) => { files[n] = enc.encode(text); });
  files['round.json'] = enc.encode(`${JSON.stringify(round, null, 2)}\n`);
  return fflate.zipSync(files, { level: 6 });
}

// The settings row's action. `fetchRoundFresh`, not `fetchRound`: the latter
// answers from the stale-while-revalidate cache first, and a backup must not be
// whatever this tab last saw. The fetch is `api()`'s, which the server logs on
// its own; what follows touches no server at all, so its catch reports
// (`.claude/rules/caught-client-faults-are-invisible.md`).
async function downloadRoundExport(rid) {
  let round;
  try { round = await fetchRoundFresh(rid); }
  catch (e) { toast(e.message, { tone: 'error' }); return; }
  try {
    const bytes = roundExportZip(round);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = roundExportFilename(round, new Date());
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (err) {
    reportClientError('round_export', err);
    toast(t('roundSettings.exportFailed'), { tone: 'error' });
  }
}
