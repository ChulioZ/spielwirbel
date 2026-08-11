/* Spielwirbel – the predicates that decide which games a session draw may pick
   from: is the game in the active collection, does its player range fit the
   table, and — since #725 — does it match the filters over BGG's imported
   metadata. Plus, since #653, what an owned EXPANSION contributes to that range
   and the one length bound the expansion editor offers. Pure and
   dependency-free, so it works both as a shared-scope frontend script (browser
   global) and as a CommonJS module the server and the test suite can require.
   Load order: see index.html.

   It is ONE file because both sides answer the same question (#634): lib/draw.js
   builds the real pool and showStartSession() renders the live preview of it, so
   a drifted copy means the preview offers games the draw cannot pick — or hides
   ones it can — silently, with no error anywhere
   (.claude/rules/shared-constants-across-the-stack.md). Until #634 the two were
   held together only by "the two must agree" comments. */

'use strict';

// A game is in the active collection when it sits in neither archive (#250) and
// is not merely wished for (#560). The draw pool, the direct-pick guard in the
// sessions route and the setup screen's preview all share this predicate, so a
// further state added here closes every draw path at once rather than leaving
// the game playable by id — which is how the wish list stays a list of things
// the group does NOT own. It is NOT the whole of "active" everywhere: the taste
// stats drop retired games only
// (.claude/rules/active-games-filter-sites.md).
function isActiveGame(game) {
  return !game.retired && !game.completed && !game.wish;
}

// Whether the game's OWN box admits a table of `playerCount`, ignoring anything
// the round owns for it. Expansions are folded in by fitsPlayerCount below.
//
// `playerCount` is a PARTY count, not a headcount — members plus guests, with
// each team counting once (#575) — and it stays a parameter on purpose: the
// arithmetic that produces it differs per caller (the route reads a stored
// session, the setup screen reads live pickers), and deriving it here from
// `round.members` would silently drop guests and flatten teams
// (.claude/rules/session-teams.md §2).
//
// An absent min/max means "any table size", which is why each clause is guarded
// by a typeof rather than defaulting the bound to 0/Infinity: a game whose range
// was never filled in must stay drawable at every count.
function fitsOwnRange(game, playerCount) {
  return (
    (typeof game.minPlayers !== 'number' || playerCount >= game.minPlayers) &&
    (typeof game.maxPlayers !== 'number' || playerCount <= game.maxPlayers)
  );
}

// Whether ONE owned expansion admits a table of `playerCount` (#653).
//
// The absent-range rule is the exact OPPOSITE of the base game's above, and
// that asymmetry is the trap: on the box, "no numbers" means "any table size",
// so reading an expansion the same way lets a single expansion BGG has no
// counts for make its game drawable at every count. An expansion therefore
// widens only over a range it declares IN FULL — a lone bound states no
// interval, and treating it as an open one would push a 3–4 game down to solo
// (bare max) or up to infinity (bare min).
//
// The cost is under-admission on a half-declared expansion, which is the safe
// direction and is fixable: the detail page lets the range be typed in.
function expansionAdmits(expansion, playerCount) {
  const min = expansion && expansion.minPlayers;
  const max = expansion && expansion.maxPlayers;
  if (typeof min !== 'number' || typeof max !== 'number') return false;
  return playerCount >= min && playerCount <= max;
}

// Whether the round can seat `playerCount` at this game with what it owns: the
// base box, or any owned expansion.
//
// A UNION of the admitted counts, never a HULL of the bounds. Hulling a 3–4
// base with a 1–1 solo expansion yields 1–4, which admits a table of 2 that no
// box in the cupboard supports — a pool that looks right and is wrong.
function fitsPlayerCount(game, playerCount) {
  if (fitsOwnRange(game, playerCount)) return true;
  return (game.expansions || []).some((e) => expansionAdmits(e, playerCount));
}

// The owned expansions a table of `playerCount` actually NEEDS — empty when the
// base box already seats them. Derived from the same predicate as the pool, so
// the results screen's „Braucht Erweiterung: …" line can never name a different
// set than the draw used.
function requiredExpansions(game, playerCount) {
  if (fitsOwnRange(game, playerCount)) return [];
  return (game.expansions || []).filter((e) => expansionAdmits(e, playerCount));
}

// ---- The filters over BGG's imported metadata (#725) -----------------------
//
// #724 imports playing time, complexity, minimum age, categories and mechanics;
// this is what makes them shape a draw. They are deliberately NOT tags: a tag is
// the round's own hand-assigned vocabulary (#238), these are provider facts
// nobody maintains, and expressing them as tags would mean every round keeping a
// parallel copy of what BGG already knows.
//
// The three ladders are the values the UI OFFERS and the values the server
// ACCEPTS — one list, because a client offering a step the route rejects is the
// palette bug in .claude/rules/shared-constants-across-the-stack.md. Membership,
// not a range, is what `normalizeMetadataFilters` validates against, so the two
// sides cannot even disagree about the granularity.
const PLAYTIME_CHOICES = [30, 45, 60, 90, 120, 180];
const AGE_CHOICES = [6, 8, 10, 12, 14, 16, 18];
// BGG's weight is a 1–5 float; the bounds a user picks are whole steps.
const WEIGHT_CHOICES = [1, 2, 3, 4, 5];

// Whether a game passes the metadata filters. Every filter field is nullable /
// empty meaning "unfiltered".
//
// THE RULE THAT IS EASY TO GET BACKWARDS: an absent value ON THE GAME passes
// every filter — the same reasoning as `fitsOwnRange`'s typeof guards above. A
// game BGG has no playtime for must stay drawable, or the first touch of any
// filter silently hides every storefront game, every hand-typed one, and (on an
// instance without BGG_API_TOKEN) the entire shelf. Under-filtering is
// recoverable — the user sees a game they can skip; over-filtering hides games
// with nothing on screen to say so.
function fitsMetadataFilters(game, filters) {
  const f = filters || {};
  const g = game || {};
  // Playing time is an INTERVAL test against the lower bound, never a comparison
  // against a synthesised average (#724 §1): BGG's 20–600 spreads are real, and
  // filtering on the maximum would drop such a game from every realistic
  // evening. Permissive is the safe direction here too — the draw only produces
  // candidates people then vote on, and the info sheet shows the full range.
  if (isNumber(f.maxPlaytime) && isNumber(g.minPlaytime) && g.minPlaytime > f.maxPlaytime) return false;
  if (isNumber(f.weightMin) && isNumber(g.weight) && g.weight < f.weightMin) return false;
  if (isNumber(f.weightMax) && isNumber(g.weight) && g.weight > f.weightMax) return false;
  // "The youngest at the table is N" — so a game passes when its own minimum age
  // is at most N.
  if (isNumber(f.youngestAge) && isNumber(g.minAge) && g.minAge > f.youngestAge) return false;
  return matchesAnyOf(g.categories, f.categories) && matchesAnyOf(g.mechanics, f.mechanics);
}

function isNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// OR within one list, AND between the two (categories vs. mechanics). The OR is
// deliberately unlike the tag chips sitting right above these controls, and the
// reason is vocabulary size: a game carries 3–8 categories drawn from BGG's ~84,
// so AND-ing two picks collapses the pool to near-zero, while round tags are few
// and chosen precisely so AND is meaningful.
function matchesAnyOf(values, picked) {
  if (!Array.isArray(picked) || picked.length === 0) return true; // unfiltered
  if (!Array.isArray(values) || values.length === 0) return true; // absent on the game
  return picked.some((x) => values.includes(x));
}

// Which metadata filters this shelf can offer at all, derived from the games
// themselves rather than from BGG's vocabulary. A 15-game Regal offers the ~8
// categories those games carry, not all ~84 — self-pruning (the list shrinks and
// grows with the shelf), needing no configuration, and structurally unable to
// offer a filter that yields an empty pool.
//
// A shelf carrying none of a field reports it unavailable, and the UI drops that
// control entirely rather than rendering an empty one — the same thing the tag
// field already does with no round tags.
function metadataFilterOptions(games) {
  const list = Array.isArray(games) ? games : [];
  const anyNumber = (key) => list.some((g) => isNumber((g || {})[key]));
  const valuesOf = (key) => {
    const seen = new Set();
    list.forEach((g) => {
      const vs = (g || {})[key];
      if (Array.isArray(vs)) vs.forEach((v) => { if (typeof v === 'string' && v) seen.add(v); });
    });
    return [...seen].sort();
  };
  return {
    playtime: anyNumber('minPlaytime'),
    weight: anyNumber('weight'),
    age: anyNumber('minAge'),
    categories: valuesOf('categories'),
    mechanics: valuesOf('mechanics'),
  };
}

// Whether anything at all can be offered — what decides that the whole
// disclosure is rendered.
function hasMetadataFilterOptions(options) {
  const o = options || {};
  return !!(o.playtime || o.weight || o.age || (o.categories || []).length || (o.mechanics || []).length);
}

// Coerce anything — a request body, a stored #252 preset, a hand-crafted blob —
// into the canonical filter shape, dropping every value this shelf cannot offer.
//
// `options` is what makes the "drop a vanished referent" rule one function
// instead of three: a category no game carries any more, and a numeric filter on
// a field nothing on the shelf has, are both filters the user can neither see
// nor clear — so leaving either in place would show an active-filter count over
// a control that is not on screen.
function normalizeMetadataFilters(raw, options) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const o = options || {};
  const step = (v, choices, available) =>
    (available && choices.includes(v) ? v : null);
  const pick = (v, allowed) => {
    if (!Array.isArray(v)) return [];
    const ok = new Set(Array.isArray(allowed) ? allowed : []);
    return [...new Set(v.filter((x) => typeof x === 'string' && ok.has(x)))];
  };
  const out = {
    maxPlaytime: step(src.maxPlaytime, PLAYTIME_CHOICES, o.playtime),
    weightMin: step(src.weightMin, WEIGHT_CHOICES, o.weight),
    weightMax: step(src.weightMax, WEIGHT_CHOICES, o.weight),
    youngestAge: step(src.youngestAge, AGE_CHOICES, o.age),
    categories: pick(src.categories, o.categories),
    mechanics: pick(src.mechanics, o.mechanics),
  };
  // An inverted range admits nothing at all, so a hand-crafted one would answer
  // "No matching games" over a shelf that is fine. Swapping (rather than
  // dropping a bound) is done HERE, in the shared function, so the preview and
  // the draw cannot disagree about what an inverted range means.
  if (out.weightMin !== null && out.weightMax !== null && out.weightMin > out.weightMax) {
    const lo = out.weightMax;
    out.weightMax = out.weightMin;
    out.weightMin = lo;
  }
  return out;
}

// How many of the controls are actively filtering — the disclosure's badge, and
// what keeps a collapsed filter from being forgotten. The complexity RANGE
// counts once however many of its two bounds are set: it is one control, and a
// badge that reads 2 for one visible row is a number nobody can reconcile.
function countMetadataFilters(filters) {
  const f = filters || {};
  return (
    (f.maxPlaytime !== null && f.maxPlaytime !== undefined ? 1 : 0) +
    (isNumber(f.weightMin) || isNumber(f.weightMax) ? 1 : 0) +
    (f.youngestAge !== null && f.youngestAge !== undefined ? 1 : 0) +
    ((f.categories || []).length ? 1 : 0) +
    ((f.mechanics || []).length ? 1 : 0)
  );
}

// How long a hand-typed expansion name may be. Here rather than in lib/quota.js
// because — unlike the per-game CAP, which the client only ever learns about
// from a 403 — this is a bound the UI *offers*: it is the free-text input's
// `maxlength` and the route's zod `.max()`, i.e. exactly the drift shape
// .claude/rules/shared-constants-across-the-stack.md exists for.
const EXPANSION_TITLE_MAX = 120;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isActiveGame,
    fitsPlayerCount,
    requiredExpansions,
    EXPANSION_TITLE_MAX,
    fitsMetadataFilters,
    metadataFilterOptions,
    hasMetadataFilterOptions,
    normalizeMetadataFilters,
    countMetadataFilters,
    PLAYTIME_CHOICES,
    AGE_CHOICES,
    WEIGHT_CHOICES,
  };
}
