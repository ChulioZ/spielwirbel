/* Spielwirbel – the Regal-Steckbrief (#1173): what a shelf adds up to.

   A round that imported its collection holds a shelf full of provider metadata
   (player range, playing time, weight, categories, mechanics, designers — see
   provider-info-fields.js) and, before this, nothing that read it back. This
   turns the ACTIVE shelf into bands and the gaps a draw will hit („für 6+
   Personen: nur 2 Spiele", „über 120 Min.: kein Spiel").

   PURE and dependency-free, with the module.exports guard, so the bands are
   unit-tested from Node (.claude/rules/frontend-helper-modules-and-coverage.md).
   It returns DATA, never text: the card, the detail screen and the share image
   phrase it through t()/tn(), so the builder has no locale to get wrong.

   The seat question is not re-derived here. It arrives as `deps.fitsPlayerCount`
   (draw-pool.js) for the reason hub-insights.js's header states: a public/js
   file cannot require() a sibling, and a second copy of "which table sizes does
   this box plus its owned expansions seat" is exactly the union-vs-hull trap
   .claude/rules/expansions-widen-by-union.md exists for. So a 3–4 base with a
   solo 1–1 expansion counts at 1, 3 and 4 — never at 2.

   Loaded as a classic script before hub-cards.js; it declares only prefixed
   names, since every public/js file shares one global scope. */

'use strict';

// How many games with provider data a shelf needs before its profile says
// anything. Below it every band is "under three" and the card would be a list
// of gaps that are really just a small shelf. Eight clears the demo's big round
// (nine games, all resolved) and not its two small ones.
const SHELF_PROFILE_MIN_GAMES = 8;
// A band holding fewer games than this is a GAP worth a sentence (#1173).
const SHELF_PROFILE_FEW = 3;
// How many mechanics, categories and designers the profile names.
const SHELF_PROFILE_TOP = 5;
// The table sizes the seat bands ask about. The last one is „6+": a game
// counts there when it seats ANY table of six or more.
const SHELF_SEAT_BANDS = [2, 3, 4, 5, 6];
// Upper bound for the 6+ probe. A box declaring 99 players is a party game that
// seats "everyone"; probing further buys nothing and bounds the loop.
const SHELF_SEAT_PROBE_MAX = 99;
// Playing-time bands by the game's OWN MAXIMUM — the containment reading the
// draw filter uses (#1025, fitsMetadataFilters): a 30–60 game is a "31–60"
// game, because an evening that has 30 minutes cannot be sure to finish it.
const SHELF_TIME_BANDS = [
  { key: 'upTo30', max: 30 },
  { key: 'to60', max: 60 },
  { key: 'to120', max: 120 },
  { key: 'over120', max: Infinity },
];
// BGG weight bands: light < 2.0, medium 2.0–3.4, heavy ≥ 3.5.
const SHELF_WEIGHT_BANDS = [
  { key: 'light', max: 2 },
  { key: 'medium', max: 3.5 },
  { key: 'heavy', max: Infinity },
];

const shelfNum = (v) => typeof v === 'number' && Number.isFinite(v);
const shelfList = (v) => Array.isArray(v) && v.length > 0;

// Whether a game carries provider data this profile reads. The player range is
// deliberately NOT one of them: it is also typed by hand on every free-text
// game, so it says nothing about whether the shelf was linked.
function shelfHasData(game) {
  const g = game || {};
  return shelfNum(g.maxPlaytime) || shelfNum(g.weight) || shelfList(g.categories) || shelfList(g.mechanics);
}

// Whether the game declares ANY seat information. A box with no range at all
// is "any table size" to the draw pool (fitsOwnRange), which is the right
// answer THERE — an unfilled range must never hide a game from a draw. Here it
// would count one unknown box in every band and hide exactly the gaps the
// profile exists to show, so such a game is UNKNOWN and counted apart.
function shelfSeatKnown(game) {
  if (typeof game.minPlayers === 'number' || typeof game.maxPlayers === 'number') return true;
  return (game.expansions || []).some((e) => e && typeof e.minPlayers === 'number' && typeof e.maxPlayers === 'number');
}

// The seat bands one game counts in: every band its range (plus its owned
// expansions) covers. 6+ probes from six up to the widest declared maximum; an
// open top (no maxPlayers on the box) is answered by fitsPlayerCount at six.
function shelfSeatBands(game, fits) {
  const tops = [game.maxPlayers, ...(game.expansions || []).map((e) => e && e.maxPlayers)]
    .filter((v) => typeof v === 'number');
  const top = Math.min(SHELF_SEAT_PROBE_MAX, Math.max(6, ...tops));
  return SHELF_SEAT_BANDS.filter((n) => {
    if (n < 6) return fits(game, n);
    for (let k = 6; k <= top; k++) if (fits(game, k)) return true;
    return false;
  });
}

// One dimension's bands. `bandOf` names the band a game falls into, or null
// when the game has no value; `null` comes back when too few games carry the
// value for the bands to mean anything — the dimension is then left out rather
// than drawn as a row of gaps.
function shelfDimension(games, keys, bandsOf) {
  const counts = new Map(keys.map((k) => [k, 0]));
  let known = 0;
  games.forEach((g) => {
    const bands = bandsOf(g);
    if (!bands) return;
    known++;
    bands.forEach((k) => counts.set(k, counts.get(k) + 1));
  });
  if (known < SHELF_PROFILE_MIN_GAMES) return null;
  return { known, unknown: games.length - known, bands: keys.map((key) => ({ key, n: counts.get(key) })) };
}

// The names in one list field the round RATES best (#1556): ranked by the mean
// shelf score of their games, not by how many games carry them — a count says
// what was bought, the score what was enjoyed.
//
// Only games with a score count, for the value AND for `n`: an unscored box
// says nothing about taste, so it must neither drag a mean down nor pad the
// count shown beside it. "Scored" is exactly what the Regal shows a score for
// (shelfScore: rated, or played often enough to earn the prior) — the list and
// the shelf must never disagree about which games have a number. A name needs
// two scored games to lead anything; on a small shelf the top five would
// otherwise be five singletons riding one game's score.
//
// Ranked on the UNCLAMPED mean, like every ranking (core.js displayScore); a
// tie goes to more evidence (more scored games), then by name so the order is
// stable across renders.
//
// `keep` narrows a game's list before counting — the designers pass
// `deps.creditedDesigners`, so BGG's `(Uncredited)` sentinel never reads as one
// designer behind every party game (#1505).
function shelfTop(games, field, scoreOf, keep = (list) => list) {
  const byName = new Map();
  games.forEach((g) => {
    if (!Array.isArray(g[field])) return;
    const score = scoreOf(g);
    if (!shelfNum(score)) return;
    new Set(keep(g[field])).forEach((name) => {
      if (typeof name !== 'string' || !name) return;
      const acc = byName.get(name) || { sum: 0, n: 0 };
      acc.sum += score;
      acc.n += 1;
      byName.set(name, acc);
    });
  });
  return [...byName.entries()]
    .filter(([, acc]) => acc.n >= 2)
    .map(([name, acc]) => ({ name, score: acc.sum / acc.n, n: acc.n }))
    .sort((a, b) => b.score - a.score || b.n - a.n || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, SHELF_PROFILE_TOP);
}

/* The profile of a shelf, or null when it has too little data to say anything.

   `games` is the ACTIVE shelf (isActiveGame) — a wished or archived game reaches
   no draw, so it has no place in "what can this shelf do".
   `deps` is { fitsPlayerCount } from draw-pool.js, { creditedDesigners } from
   provider-info-fields.js and { scoreOf } — a game's shelf score or null, read
   from the caller's roundScoreIndex (game-stats.js) — all handed in for the
   same reason (see the header): this file cannot require() a sibling.

   Returns { linked, total, seats, time, weight, mechanics, categories,
   designers, gaps }:
   each of seats/time/weight is { known, unknown, bands: [{ key, n }] } or null;
   each of mechanics/categories/designers is [{ name, score, n }] (shelfTop);
   `gaps` lists every seat/time band under SHELF_PROFILE_FEW as { dim, key, n }, emptiest
   first (a band with NOTHING is the stronger statement), dimension order
   otherwise. */
function shelfProfile(games, deps) {
  const shelf = (games || []).filter(Boolean);
  const linked = shelf.filter(shelfHasData).length;
  if (linked < SHELF_PROFILE_MIN_GAMES) return null;
  const fits = deps.fitsPlayerCount;

  const seats = shelfDimension(shelf, SHELF_SEAT_BANDS.map(String), (g) =>
    (shelfSeatKnown(g) ? shelfSeatBands(g, fits).map(String) : null));
  const time = shelfDimension(shelf, SHELF_TIME_BANDS.map((b) => b.key), (g) =>
    (shelfNum(g.maxPlaytime) ? [SHELF_TIME_BANDS.find((b) => g.maxPlaytime <= b.max).key] : null));
  const weight = shelfDimension(shelf, SHELF_WEIGHT_BANDS.map((b) => b.key), (g) =>
    (shelfNum(g.weight) ? [SHELF_WEIGHT_BANDS.find((b) => g.weight < b.max).key] : null));

  // Weight is drawn as bars but never listed as a gap (#1173 review): a light
  // family shelf has no heavy game on purpose — that is a taste, not a hole a
  // draw will hit, and „Schwer: kein Spiel" on every such shelf reads as a
  // reproach.
  const gaps = [];
  [['seats', seats], ['time', time]].forEach(([dim, d]) => {
    if (!d) return;
    d.bands.forEach((b) => { if (b.n < SHELF_PROFILE_FEW) gaps.push({ dim, key: b.key, n: b.n }); });
  });
  // Array.prototype.sort is stable, so equal counts keep the dimension order.
  gaps.sort((a, b) => a.n - b.n);

  return {
    linked,
    total: shelf.length,
    seats,
    time,
    weight,
    mechanics: shelfTop(shelf, 'mechanics', deps.scoreOf),
    categories: shelfTop(shelf, 'categories', deps.scoreOf),
    designers: shelfTop(shelf, 'designers', deps.scoreOf, deps.creditedDesigners),
    gaps,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    shelfProfile,
    shelfHasData,
    SHELF_PROFILE_MIN_GAMES,
    SHELF_PROFILE_FEW,
    SHELF_PROFILE_TOP,
    SHELF_SEAT_BANDS,
    SHELF_TIME_BANDS,
    SHELF_WEIGHT_BANDS,
  };
}
