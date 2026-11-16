'use strict';

/*
 * Operator-confirmed scoring categories per BoardGameGeek game (#1787).
 *
 * #1780 lets every round type its own „Wertungskategorien" for a game, so ten
 * rounds playing Wingspan type the same five names ten times. The operator can
 * confirm one round-defined set as the game's BASE for every round (the admin
 * card „Wertungskategorien", lib/routes/admin/game-categories.js). It is the
 * sibling of the direction confirmation in lib/game-scoring.js (#1786) and
 * follows the same shape for the same reasons:
 *
 * THE CONFIRMATION IS AN OVERLAY ON READ, never a write into tenant data. The
 * repo facade (lib/repo/index.js `forTenant`) passes every round and game read
 * through `overlayRoundCategories`/`overlayGameCategories`:
 *
 *   - the game's sheet becomes the base categories first (global ids, the
 *     confirmed names, `locked: true`), then the round's own categories that
 *     match none of them — its EXTRAS, for an expansion say — with their own ids;
 *   - a round category whose normalised name matches a base category is MAPPED
 *     onto it (`scoreCategoryMap: { localId: globalId }`), and every session's
 *     `scoreParts` of that game is re-keyed on read, so its history shows under
 *     the confirmed name and per-category records run over the global id.
 *
 * Stored parts keep their round-local ids: a write translates global ids back
 * (`toStoredParts`). So revoking a confirmation restores every round's own sheet
 * exactly, and a confirmation writes nothing into any tenant. The one thing a
 * revoke cannot give back is a value typed DURING the confirmation into a base
 * category the round never had: it is stored under the global id, which the
 * round's own sheet does not list, so it stops showing (its seat's total, which
 * decides everything, is unaffected).
 *
 * Global ids are DERIVED from the BGG id and the normalised confirmed name, not
 * minted: revoking and re-confirming the same set gives the same ids back, so
 * the values above reappear rather than staying orphaned.
 *
 * Only BGG-linked games take part — the BGG id is a game's only identity across
 * rounds (lib/game-scoring.js `bggIdOf`).
 */

const crypto = require('crypto');
const { bggIdOf } = require('./game-scoring');
const {
  SCORE_CATEGORY_MAX, SCORE_CATEGORY_NAME_MAX, scoreCategoryList, activeScoreCategories,
} = require('../public/js/point-records');

// Case, surrounding whitespace and inner runs of whitespace do not make two
// names different (the issue's rule). Display keeps the typed case.
const normCategoryName = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const tidyCategoryName = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');

// A set's identity: its normalised names IN ORDER — order counts.
const categorySetKey = (names) => (names || []).map(normCategoryName).join('\u0001');

function globalCategoryId(bggId, name) {
  return `g${crypto.createHash('sha256').update(`${bggId}\n${normCategoryName(name)}`).digest('hex').slice(0, 12)}`;
}

/* The stored base for a confirmation: `[{ id, name, match }]`. `original` is the
   set as rounds typed it, `names` the operator's spelling (same length — only
   spelling may change, never the set). `match` holds both normalised forms, so a
   round that typed the uncorrected spelling still maps onto the base.
   Returns `{ base }` or `{ error }`. */
function buildCategoryBase(bggId, original, names) {
  if (!Array.isArray(original) || !Array.isArray(names) || original.length !== names.length) {
    return { error: 'names_mismatch' };
  }
  if (!names.length || names.length > SCORE_CATEGORY_MAX) return { error: 'invalid_names' };
  const seen = new Set();
  const base = [];
  for (let i = 0; i < names.length; i += 1) {
    const name = tidyCategoryName(names[i]);
    if (!name || name.length > SCORE_CATEGORY_NAME_MAX) return { error: 'invalid_names' };
    const key = normCategoryName(name);
    if (seen.has(key)) return { error: 'duplicate_names' };
    seen.add(key);
    const match = [...new Set([key, normCategoryName(original[i])])];
    base.push({ id: globalCategoryId(bggId, name), name, match });
  }
  // A corrected name must not collide with another position's original spelling,
  // or one round category would match two base categories.
  const owners = new Map();
  for (const b of base) {
    for (const m of b.match) {
      if (owners.has(m) && owners.get(m) !== b.id) return { error: 'duplicate_names' };
      owners.set(m, b.id);
    }
  }
  return { base };
}

// The base category a round category name maps onto, or null.
function baseFor(base, name) {
  const key = normCategoryName(name);
  return base.find((b) => b.match.includes(key)) || null;
}

/* Mutates and returns `game` — a SNAPSHOT, as in lib/game-scoring.js. Every
   stored category is considered, removed ones included: a tombstone still holds
   old sessions' values, and those should show under the confirmed name too. */
function overlayGameCategories(game, confirmed) {
  if (!game || !confirmed || !confirmed.size) return game;
  const id = bggIdOf(game);
  const base = id && confirmed.get(id);
  if (!base || !base.length) return game;
  const map = {};
  const extras = [];
  for (const c of scoreCategoryList(game)) {
    const b = baseFor(base, c.name);
    if (b) map[c.id] = b.id;
    else extras.push(c);
  }
  game.scoreCategories = [...base.map((b) => ({ id: b.id, name: b.name, locked: true })), ...extras];
  game.scoreCategoriesLocked = base.length;
  if (Object.keys(map).length) game.scoreCategoryMap = map;
  else delete game.scoreCategoryMap;
  return game;
}

/* Re-key one session's parts through a game's map. Two round categories that
   both map onto one base category (only possible with whitespace variants that
   #1780's own duplicate check let through) are summed, so the seat's breakdown
   still adds up to its total. */
function mapScoreParts(parts, map) {
  if (!parts || typeof parts !== 'object' || !map) return parts;
  const out = {};
  for (const [seat, own] of Object.entries(parts)) {
    if (!own || typeof own !== 'object') { out[seat] = own; continue; }
    const next = {};
    for (const [cid, v] of Object.entries(own)) {
      const key = map[cid] || cid;
      next[key] = Object.prototype.hasOwnProperty.call(next, key) && Number.isInteger(next[key]) && Number.isInteger(v)
        ? next[key] + v : v;
    }
    out[seat] = next;
  }
  return out;
}

function overlayRoundCategories(round, confirmed) {
  if (!round || !Array.isArray(round.games) || !confirmed || !confirmed.size) return round;
  const maps = new Map();
  round.games.forEach((g) => {
    overlayGameCategories(g, confirmed);
    if (g.scoreCategoryMap) maps.set(g.id, g.scoreCategoryMap);
  });
  if (maps.size && Array.isArray(round.sessions)) {
    round.sessions.forEach((s) => {
      const map = s && s.scoreParts && maps.get(s.chosenGameId);
      if (map) s.scoreParts = mapScoreParts(s.scoreParts, map);
    });
  }
  return round;
}

/* The write side of the points route: `parts` keyed by the EFFECTIVE ids (what
   the sheet showed) back to what is stored. A base category the round matched is
   stored under its round-local id; one the round never had keeps the global id. */
function toStoredParts(parts, map) {
  if (!parts || !map) return parts;
  const inverse = {};
  Object.entries(map).forEach(([local, global]) => { if (!inverse[global]) inverse[global] = local; });
  return mapScoreParts(parts, inverse);
}

/* A category edit on a game with a confirmed base (PATCH …/games/:gid). The
   editor sends the effective list; its first entries must be the base, unchanged
   and in order — no rename, removal or reordering. Returns `{ extras }` (the rest)
   or `{ error, status }`. An extra may not take a base category's name: on read
   it would vanish into the base, which reads as the edit being lost. */
function splitLockedEdit(incoming, base) {
  if (!Array.isArray(incoming)) return { error: 'scoreCategories must be an array', status: 400 };
  if (incoming.length > SCORE_CATEGORY_MAX) return { error: 'Too many scoring categories', status: 400 };
  for (let i = 0; i < base.length; i += 1) {
    const e = incoming[i];
    if (!e || e.id !== base[i].id || typeof e.name !== 'string' || e.name.trim() !== base[i].name) {
      return { error: 'scoring_categories_locked', status: 409 };
    }
  }
  const extras = incoming.slice(base.length);
  const ids = new Set(base.map((b) => b.id));
  for (const e of extras) {
    if (e && ids.has(e.id)) return { error: 'scoring_categories_locked', status: 409 };
    if (e && typeof e.name === 'string' && baseFor(base, e.name)) return { error: 'Duplicate scoring category', status: 400 };
  }
  return { extras };
}

/* What mergeScoreCategories receives for that edit, over the RAW stored list:
   the round's own categories that map onto the base (kept exactly as stored, so
   a revoke gives the same sheet back), then the extras as edited. */
function storedEditList(rawGame, base, extras) {
  const matched = activeScoreCategories(rawGame).filter((c) => baseFor(base, c.name)).map((c) => ({ id: c.id, name: c.name }));
  return [...matched, ...extras];
}

/* The category view of one game built FRESH: the stored game with the stored
   setting applied, bypassing the overlay's cache. For the points route, where a
   stale cache would validate against one sheet and store against another.
   `getSetting` is injected (repo.getGameCategorySetting): this module cannot
   require the repo, which requires it. */
async function freshCategoryView(scoped, getSetting, rid, gid) {
  const game = await scoped.getStoredGame(rid, gid);
  if (!game) return null;
  const id = bggIdOf(game);
  const setting = id ? await getSetting(id) : null;
  if (setting && setting.state === 'confirmed' && Array.isArray(setting.categories)) {
    overlayGameCategories(game, new Map([[id, setting.categories]]));
  }
  return game;
}

/* The admin list's state for one game, the #1786 rule widened: a dismissal
   lasts until one more round defines a set OR a set nobody had before appears. */
function categoryState(setting, rounds, sets) {
  if (!setting) return 'open';
  if (setting.state === 'confirmed') return 'confirmed';
  if (setting.state === 'dismissed'
    && rounds <= (Number(setting.dismissedAtRounds) || 0)
    && sets <= (Number(setting.dismissedAtSets) || 0)) return 'dismissed';
  return 'open';
}

const mostCommon = (counts) => [...counts.entries()]
  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0];

/* Fold the backends' per-(round, BGG id) rows into one entry per BGG id.

   Each row is `{ bggId, sets: [[name, …], …], titles }` — the distinct ACTIVE
   category lists a round's games with that id carry — and holds no round id:
   the repo method drops it before anything leaves (the payload sweep in
   test/game-categories-admin.test.js). A set's display spelling is the most
   common one among the rounds that share it. */
function foldCategoryRounds(rows) {
  const byId = new Map();
  for (const r of rows || []) {
    const id = String(r.bggId);
    const e = byId.get(id) || { bggId: id, rounds: 0, sets: new Map(), titles: new Map() };
    e.rounds += 1;
    const keys = new Set();
    for (const names of r.sets || []) {
      const key = categorySetKey(names);
      if (!key || keys.has(key)) continue;
      keys.add(key);
      const s = e.sets.get(key) || { key, rounds: 0, spellings: new Map() };
      s.rounds += 1;
      const shown = names.map(tidyCategoryName).join('\u0001');
      s.spellings.set(shown, (s.spellings.get(shown) || 0) + 1);
      e.sets.set(key, s);
    }
    for (const t of r.titles || []) {
      const title = String(t || '').trim();
      if (title) e.titles.set(title, (e.titles.get(title) || 0) + 1);
    }
    byId.set(id, e);
  }
  return [...byId.values()].map((e) => ({
    bggId: e.bggId,
    rounds: e.rounds,
    title: (mostCommon(e.titles) || [null])[0],
    sets: [...e.sets.values()]
      .map((s) => ({ key: s.key, names: mostCommon(s.spellings)[0].split('\u0001'), rounds: s.rounds }))
      .sort((a, b) => b.rounds - a.rounds || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  }));
}

module.exports = {
  normCategoryName,
  categorySetKey,
  globalCategoryId,
  buildCategoryBase,
  overlayGameCategories,
  overlayRoundCategories,
  mapScoreParts,
  toStoredParts,
  splitLockedEdit,
  freshCategoryView,
  storedEditList,
  categoryState,
  foldCategoryRounds,
};
