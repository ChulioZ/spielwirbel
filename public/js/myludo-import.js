'use strict';

/* Spielwirbel – the Myludo shelf import (#1758): the pure half. Parses a
   Myludo collection export (JSON) in the browser, suggests a BoardGameGeek
   match per row, decides which base game an expansion row belongs to, and
   builds the one request body POST …/games/import receives. The sheet that
   renders all of it is myludo-import-view.js.

   The file never leaves the device: only the rows the user picks are sent,
   and only the fields below.

   Myludo's export is one top-level ARRAY, one object per game, keys in French.
   The fields read here and their two awkward shapes:
     Titre      the title (possibly the French one)
     Édition    the publication year — the second matching signal
     Type       "basegame" | "standalone" | "extension"
     Joueur(s)  ALWAYS a string: "2 — 4" (em dash with spaces) or "2"
     Durée      MIXED: a number (90) or a string range ("30 — 45")
     Gamme(s)   the product line — how an expansion finds its base game
   There is no BGG id anywhere in the file (`ID` is Myludo's own), which is why
   every row needs a search. Ratings (`Note …`) are never read: ratings in this
   app come only from session votes.

   Pure and DOM-free, with the `module.exports` guard. `foldTitle` is
   lookup-score.js's, reached at CALL time (never at load time — the
   load-order trap), so a spec puts it on `globalThis` before calling. */

// The most rows one import may carry — the parser refuses a bigger file and
// the route bounds the request body with the same number.
const MYLUDO_IMPORT_MAX = 2000;
// What a title may hold once it arrives: the play import's bound for a game
// created from another app's data (lib/routes/session-import.js).
const MYLUDO_TITLE_MAX = 200;
// Expansions one row may carry to its base game — the route's bound too.
const MYLUDO_EXPANSIONS_MAX = 100;

// "2 — 4", "2-4", "2", 90 → { min, max }; anything without a positive number →
// null. Every run of digits counts, so the separator (em dash, en dash, hyphen,
// "à") does not matter, and a reversed range is put the right way round.
function parseMyludoRange(v) {
  let nums;
  if (typeof v === 'number') nums = Number.isFinite(v) ? [Math.round(v)] : [];
  else if (typeof v === 'string') nums = (v.match(/\d+/g) || []).map(Number);
  else return null;
  nums = nums.filter((n) => n >= 1);
  if (!nums.length) return null;
  const a = nums[0];
  const b = nums.length > 1 ? nums[1] : a;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

const myludoText = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

// The shelf export → rows. Throws `not_myludo` for a file that is not an array
// of objects carrying `Titre` (a BG Stats file, a CSV, any other JSON), and
// `too_many` past MYLUDO_IMPORT_MAX. A JSON syntax error surfaces as the
// SyntaxError JSON.parse throws — the view treats both as "wrong file".
//
// Lenient within a valid file: a row without a title is skipped, every other
// missing field is simply absent from the row.
function parseMyludoShelf(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(data)) throw new Error('not_myludo');
  const objects = data.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  // An empty array is a valid, empty shelf; a non-empty one must look like
  // Myludo somewhere, or it is some other app's export.
  if (data.length && !objects.some((r) => Object.prototype.hasOwnProperty.call(r, 'Titre'))) {
    throw new Error('not_myludo');
  }
  if (objects.length > MYLUDO_IMPORT_MAX) throw new Error('too_many');
  const rows = [];
  objects.forEach((r, i) => {
    const title = myludoText(r.Titre).slice(0, MYLUDO_TITLE_MAX).trim();
    if (!title) return;
    const year = parseInt(r['Édition'], 10);
    const lines = (Array.isArray(r['Gamme(s)']) ? r['Gamme(s)'] : []).map(myludoText).filter(Boolean);
    rows.push({
      key: `r${i}`,
      title,
      year: year >= 1 ? year : null,
      expansion: myludoText(r.Type).toLowerCase() === 'extension',
      lines,
      players: parseMyludoRange(r['Joueur(s)']),
      playtime: parseMyludoRange(r['Durée']),
    });
  });
  return rows;
}

// The suggested BGG hit for one row, from the lookup search's results
// ({ providerId, title, year }), plus whether it is SURE enough to preselect:
//
//   same folded title + same year (or no year on either side)  → sure
//   same folded title, different year                          → offered, not sure
//   a title starting with the row's, same year                 → offered, not sure
//   anything else                                              → no suggestion
//
// The year difference is common and not a mismatch by itself: Myludo's
// `Édition` may be the year of the printing the user owns, BGG's the original
// release. So it is offered but not preselected as certain. Exact tiers only,
// like the add-game search (.claude/rules/add-game-lookup-provider.md).
function myludoMatch(row, hits) {
  const key = foldTitle(row.title);
  const list = (hits || []).filter((h) => h && h.providerId);
  const exact = list.filter((h) => foldTitle(h.title) === key);
  const sameYear = (h) => !row.year || !h.year || h.year === row.year;
  const sure = exact.find(sameYear);
  if (sure) return { hit: sure, sure: true };
  if (exact.length) return { hit: exact[0], sure: false };
  const near = list.find((h) => row.year && h.year === row.year && foldTitle(h.title).startsWith(`${key} `));
  return near ? { hit: near, sure: false } : { hit: null, sure: false };
}

// Which base game each EXPANSION row belongs to, by name: Myludo's export
// carries no link between an expansion and its game, only the product line
// (`Gamme(s)`) and the title. A base candidate is a non-expansion row of this
// import or a game already on the shelf; the answer per expansion key is
// `{ rowKey }`, `{ gameId }` or null (reported as skipped).
//
// Two signals, in this order:
//   1. a line the expansion names equals a base row's line or a base title
//   2. the expansion's title starts with a base title followed by a word
//      break ("Cascadia - Alpine Lakes" → "Cascadia") — the longest wins, so
//      "Catan Junior …" does not land on "Catan"
// An import row wins over a shelf game of the same name: that is the box the
// user is bringing in right now.
function attachMyludoExpansions(rows, shelf) {
  const bases = [
    ...rows.filter((r) => !r.expansion).map((r) => ({
      ref: { rowKey: r.key }, title: foldTitle(r.title), lines: r.lines.map(foldTitle),
    })),
    ...(shelf || []).filter((g) => g && g.id && !g.wish && !g.guestGame && !Array.isArray(g.expansionOf))
      .map((g) => ({ ref: { gameId: g.id }, title: foldTitle(g.title), lines: [] })),
  ].filter((b) => b.title);
  const out = new Map();
  for (const r of rows.filter((x) => x.expansion)) {
    const lines = r.lines.map(foldTitle).filter(Boolean);
    let base = bases.find((b) => lines.some((l) => l === b.title || b.lines.includes(l)));
    if (!base) {
      const own = foldTitle(r.title);
      base = bases
        .filter((b) => own !== b.title && own.startsWith(`${b.title} `))
        .sort((a, b) => b.title.length - a.title.length)[0];
    }
    out.set(r.key, base ? base.ref : null);
  }
  return out;
}

// The game of the round a row already IS, or null — which keeps the row out
// of the import, and gives an expansion of it a shelf game to join. A linked
// row matches by its BGG id (a title match would wrongly catch BGG's several
// games under one name), an unlinked one by folded title. The route applies
// the same two tests inside the write; this only decides what the preview
// shows.
function myludoShelfMatch(choice, row, games) {
  const list = (games || []).filter((g) => g && g.id);
  if (choice && choice.bggId) {
    return list.find((g) => g.source && g.source.provider === 'bgg'
      && String(g.source.externalId) === String(choice.bggId)) || null;
  }
  const key = foldTitle(row.title);
  return list.find((g) => foldTitle(g.title) === key) || null;
}

// The request body for POST …/games/import. `choices` maps a row key to
// { bggId, title } for a linked row or null for an unlinked one; `picked` is
// the set of selected row keys; `attach` is attachMyludoExpansions' map.
//
// Linked rows send the BGG hit's title and id (the cover and the BGG player
// range are filled server-side afterwards, like a collection import);
// unlinked rows send the file's title, players and playing time. Expansions
// travel INSIDE their base game's row, or in `attach` for a base game already
// on the shelf — an expansion whose base is neither picked nor on the shelf is
// left out, which is exactly the "skipped" count the preview shows.
function buildMyludoImport(rows, { choices, picked, attach }) {
  const entry = (row, asExpansion) => {
    const c = choices.get(row.key);
    const linked = c && c.bggId ? { title: String(c.title || row.title).slice(0, MYLUDO_TITLE_MAX), bggId: Number(c.bggId) } : { title: row.title };
    const players = row.players ? { minPlayers: row.players.min, maxPlayers: row.players.max } : {};
    if (asExpansion) return { ...linked, ...players };
    return { ...linked, ...players, ...(!linked.bggId && row.playtime ? { playtime: row.playtime } : {}) };
  };
  const games = [];
  const byRow = new Map();
  const onShelf = new Map();
  for (const row of rows) {
    if (row.expansion || !picked.has(row.key)) continue;
    const g = entry(row, false);
    byRow.set(row.key, g);
    games.push(g);
  }
  let skipped = 0;
  for (const row of rows) {
    if (!row.expansion || !picked.has(row.key)) continue;
    const ref = attach.get(row.key);
    const parent = ref && ref.rowKey ? byRow.get(ref.rowKey) : null;
    if (parent) {
      (parent.expansions = parent.expansions || []).push(entry(row, true));
    } else if (ref && ref.gameId) {
      const list = onShelf.get(ref.gameId) || [];
      list.push(entry(row, true));
      onShelf.set(ref.gameId, list);
    } else {
      skipped += 1;
    }
  }
  return {
    body: { games, attach: [...onShelf].map(([gameId, expansions]) => ({ gameId, expansions })) },
    skipped,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MYLUDO_IMPORT_MAX,
    MYLUDO_TITLE_MAX,
    MYLUDO_EXPANSIONS_MAX,
    parseMyludoRange,
    parseMyludoShelf,
    myludoMatch,
    attachMyludoExpansions,
    myludoShelfMatch,
    buildMyludoImport,
  };
}
