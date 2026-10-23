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
// counts there when it seats ANY table of six or more. The first is solo
// (#1666), which is drawn but never a gap — see shelfBandIsGap.
const SHELF_SEAT_BANDS = [1, 2, 3, 4, 5, 6];
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
// game, so it says nothing about whether the shelf was linked — and for the same
// reason this reads the PROVIDER's playing time, never a hand-set one (#1627).
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
// expansions) covers. 6+ is `fitsFrom` (draw-pool.js `fitsPlayerCountFrom`),
// the same probe the Regal's „8+" filter reads (#1667), so the two cannot
// disagree about "seats any table this big or bigger".
function shelfSeatBands(game, fits, fitsFrom) {
  const top = SHELF_SEAT_BANDS[SHELF_SEAT_BANDS.length - 1];
  return SHELF_SEAT_BANDS.filter((n) => (n < top ? fits(game, n) : fitsFrom(game, n)));
}

// Titles in reading order, for a list whose count says nothing about score.
const shelfByTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''));

// One dimension's bands. `bandOf` names the band a game falls into, or null
// when the game has no value; `null` comes back when too few games carry the
// value for the bands to mean anything — the dimension is then left out rather
// than drawn as a row of gaps.
//
// Each band carries the GAMES it counts (#1668), and `n` is their length, so
// the number on the screen's button and the list it opens cannot disagree.
function shelfDimension(games, keys, bandsOf) {
  const members = new Map(keys.map((k) => [k, []]));
  let known = 0;
  games.forEach((g) => {
    const bands = bandsOf(g);
    if (!bands) return;
    known++;
    bands.forEach((k) => members.get(k).push(g));
  });
  if (known < SHELF_PROFILE_MIN_GAMES) return null;
  return {
    known,
    unknown: games.length - known,
    bands: keys.map((key) => {
      const list = members.get(key).sort(shelfByTitle);
      return { key, n: list.length, games: list };
    }),
  };
}

// The names in one list field the round RATES best (#1556): ranked by the mean
// shelf score of their games, not by how many games carry them — a count says
// what was bought, the score what was enjoyed.
//
// Only games with a score count, for the value AND for `n`: an unscored box
// says nothing about taste, so it must neither drag a mean down nor pad the
// count shown beside it. "Scored" is exactly what the Regal shows a score for
// (shelfScore: rated on some evening, or played at least once) — the list and
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
      const acc = byName.get(name) || { sum: 0, games: [] };
      acc.sum += score;
      acc.games.push(g);
      byName.set(name, acc);
    });
  });
  return [...byName.entries()]
    .filter(([, acc]) => acc.games.length >= 2)
    // The games behind the name (#1668), best score first: that is what the
    // mean was taken over, and `n` is their length by construction.
    .map(([name, acc]) => ({
      name,
      score: acc.sum / acc.games.length,
      n: acc.games.length,
      games: acc.games.sort((a, b) => scoreOf(b) - scoreOf(a) || shelfByTitle(a, b)),
    }))
    .sort((a, b) => b.score - a.score || b.n - a.n || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, SHELF_PROFILE_TOP);
}

// Whether a band is thin enough to be marked as a GAP. The bars, the tiles, the
// share image and the gap list all ask this one function, so none of them can
// disagree with the others about solo. Solo never is a gap (#1666): most group
// shelves hold no solo game on purpose — a taste, not a hole a draw will hit —
// and „Für 1 Person: kein Spiel" would scold them for it. (Weight is the other
// taste, but it is kept out of the gap LIST below, not out of the bar marking.)
function shelfBandIsGap(dim, band) {
  if (dim === 'seats' && band.key === '1') return false;
  return band.n < SHELF_PROFILE_FEW;
}

/* The profile of a shelf, or null when it has too little data to say anything.

   `games` is the ACTIVE shelf (isActiveGame) — a wished or archived game reaches
   no draw, so it has no place in "what can this shelf do".
   `deps` is { fitsPlayerCount, fitsPlayerCountFrom } from draw-pool.js, { creditedDesigners } from
   provider-info-fields.js and { scoreOf } — a game's shelf score or null, read
   from the caller's roundScoreIndex (game-stats.js) — all handed in for the
   same reason (see the header): this file cannot require() a sibling.

   Returns { linked, total, seats, time, weight, mechanics, categories,
   designers, gaps }:
   each of seats/time/weight is { known, unknown, bands: [{ key, n, games }] } or null;
   each of mechanics/categories/designers is [{ name, score, n, games }] (shelfTop);
   `gaps` lists every band shelfBandIsGap names as { dim, key, n, games }, emptiest
   first (a band with NOTHING is the stronger statement), dimension order
   otherwise. */
function shelfProfile(games, deps) {
  const shelf = (games || []).filter(Boolean);
  const linked = shelf.filter(shelfHasData).length;
  if (linked < SHELF_PROFILE_MIN_GAMES) return null;
  const fits = deps.fitsPlayerCount;
  const fitsFrom = deps.fitsPlayerCountFrom;

  const seats = shelfDimension(shelf, SHELF_SEAT_BANDS.map(String), (g) =>
    (shelfSeatKnown(g) ? shelfSeatBands(g, fits, fitsFrom).map(String) : null));
  // The round's own playing time where it set one (#1627). Injected like
  // fitsPlayerCount, since a public/js file cannot require a sibling; a caller
  // passing none reads the provider pair, which is what every game without an
  // override carries anyway.
  const maxTime = (g) => (deps.gamePlaytime ? deps.gamePlaytime(g).maxPlaytime : g.maxPlaytime);
  const time = shelfDimension(shelf, SHELF_TIME_BANDS.map((b) => b.key), (g) =>
    (shelfNum(maxTime(g)) ? [SHELF_TIME_BANDS.find((b) => maxTime(g) <= b.max).key] : null));
  const weight = shelfDimension(shelf, SHELF_WEIGHT_BANDS.map((b) => b.key), (g) =>
    (shelfNum(g.weight) ? [SHELF_WEIGHT_BANDS.find((b) => g.weight < b.max).key] : null));

  // Weight is drawn as bars but never listed as a gap (#1173 review): a light
  // family shelf has no heavy game on purpose, and „Schwer: kein Spiel" on every
  // such shelf reads as a reproach.
  const gaps = [];
  [['seats', seats], ['time', time]].forEach(([dim, d]) => {
    if (!d) return;
    d.bands.forEach((b) => { if (shelfBandIsGap(dim, b)) gaps.push({ dim, key: b.key, n: b.n, games: b.games }); });
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

/* The Steckbrief TILE's one sentence (#1683): what this shelf mostly is, as
   one clause per dimension — „Meist für 2–4 Personen · bis 60 Min. · leicht bis
   mittel". Returns clause DESCRIPTORS; the view turns them into words, so this
   stays pure and the wording stays in the language files.

   Each clause names the dimension's DOMINANT RANGE: the shortest contiguous
   run of bands holding at least SHELF_HEADLINE_SHARE of the games that carry
   the value. Ties in length go to the run that holds more games, then to the
   earlier one. A clause is left out when its run spans EVERY band (that says
   nothing) or when the dimension is null (too few games carry it).

   SEATS ASK THE QUESTION DIFFERENTLY, because a game counts in every seat band
   it can be played at (shelfSeatBands) — a 2–4 game is in 2, 3 and 4. „Covering
   ⅔ of the games" would then be won by a single middle band that nearly every
   game happens to include, and „Meist für 3 Personen" is not what the shelf is.
   So the seat run is the LONGEST run whose every band seats at least that share
   of the games: „most of the shelf can be played at each of 2, 3 and 4". With
   no band at the share, the clause is left out.

   Returns [{ dim, from, to }] in dimension order (band keys; from === to for a
   single band), or [] when no clause survives — the tile then renders nothing,
   the null-or-nothing contract every hub card keeps. */
const SHELF_HEADLINE_SHARE = 2 / 3;

function shelfHeadlineRun(dim, d) {
  if (!d || !d.known) return null;
  const counts = d.bands.map((b) => b.n);
  const need = d.known * SHELF_HEADLINE_SHARE;
  const keys = d.bands.map((b) => b.key);
  let best = null;
  if (dim === 'seats') {
    let start = -1;
    for (let i = 0; i <= counts.length; i++) {
      if (i < counts.length && counts[i] >= need) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        if (!best || i - start > best[1] - best[0] + 1) best = [start, i - 1];
        start = -1;
      }
    }
  } else {
    for (let len = 1; len <= counts.length && !best; len++) {
      let held = -1;
      for (let i = 0; i + len <= counts.length; i++) {
        const sum = counts.slice(i, i + len).reduce((a, b) => a + b, 0);
        if (sum >= need && sum > held) { held = sum; best = [i, i + len - 1]; }
      }
    }
  }
  if (!best || (best[0] === 0 && best[1] === counts.length - 1)) return null;
  return { dim, from: keys[best[0]], to: keys[best[1]] };
}

function shelfHeadline(p) {
  if (!p) return [];
  return ['seats', 'time', 'weight']
    .map((dim) => shelfHeadlineRun(dim, p[dim]))
    .filter(Boolean);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    shelfProfile,
    shelfHasData,
    shelfBandIsGap,
    shelfHeadline,
    SHELF_HEADLINE_SHARE,
    SHELF_PROFILE_MIN_GAMES,
    SHELF_PROFILE_FEW,
    SHELF_PROFILE_TOP,
    SHELF_SEAT_BANDS,
    SHELF_TIME_BANDS,
    SHELF_WEIGHT_BANDS,
  };
}
