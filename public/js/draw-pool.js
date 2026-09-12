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

// Whether the party at the table can actually put this box on it (#971).
//
// TRUE when nobody is recorded as the game's owner, or at least one owner is
// among `memberIds`. The absent case is the load-bearing one and it is the same
// rule `fitsOwnRange` applies to a missing player range: a shelf nobody has
// marked up must behave exactly as it did before this existed, or the feature
// would empty every round's pool on the day it shipped. An EMPTY list means the
// same as an absent key — since #976 a clearing PATCH REMOVES the key in both
// backends (absent-key parity), so the `[]` branch is defensive: it covers a
// caller that hands the predicate a list it assembled itself.
//
// `memberIds` is the SEATS that joined, never guests: a guest is ephemeral and
// owns nothing (.claude/rules/session-guests-are-not-members.md), so a game owned
// only by somebody outside the round cannot be expressed and stays ownerless —
// i.e. drawable. That is this feature's own accepted failure mode (#971), and it
// errs toward offering a game rather than hiding one, which is the recoverable
// direction: an over-filtered pool hides games with nothing on screen to say so.
//
// An owner id no longer in `round.members` simply never matches, the way the tag
// filter ignores a deleted tag — a hand-edited file or an old export cannot blank
// a screen.
function ownedByParty(game, memberIds) {
  const owners = (game || {}).ownerIds;
  if (!Array.isArray(owners) || owners.length === 0) return true;
  const party = Array.isArray(memberIds) ? memberIds : [];
  return owners.some((x) => party.includes(x));
}

// The seats whose SHELF is at the table (#1002) — the joining seats minus the
// people who came without their games (straight from work, or the evening is at
// somebody else's place). This, not the raw seat list, is what `ownedByParty`
// above must be handed by both sides of the draw.
//
// It is a function rather than a `filter` written twice because the reduction is
// the whole feature: a drifted copy would make the setup screen's preview offer
// boxes the draw refuses, or hide ones it would produce, with nothing on screen
// to explain either (.claude/rules/shared-constants-across-the-stack.md).
//
// Nothing away returns the seats UNCHANGED — the same array, so the overwhelming
// majority of draws take a path that is byte-identical to the pre-#1002 one.
//
// Everyone away returns `[]`, and that is deliberate rather than a degenerate
// case to guard: it means no box in the cupboard is here, so only the games
// nobody is recorded as owning stay drawable. Note `drawPool`'s clause tests
// `!memberIds`, and an empty ARRAY is truthy — so the owner filter still applies
// at `[]` instead of silently switching itself off, which is the one way this
// could have failed quietly.
function shelfParty(memberIds, withoutShelfIds) {
  const seats = Array.isArray(memberIds) ? memberIds : [];
  const away = Array.isArray(withoutShelfIds) ? withoutShelfIds : [];
  if (away.length === 0) return seats;
  return seats.filter((x) => !away.includes(x));
}

// THE MULTI-TABLE POOL PREDICATE IS `fitsSomeTable` IN public/js/table-split.js
// (#796). A session split across several tables asks "can this box seat SOME
// table of at least three?" instead of "does it seat exactly this party?", so it
// is a sibling of the function above and not a different `playerCount`. It sits
// in table-split.js because these are classic scripts over one global lexical
// scope and MIN_TABLE_PARTIES — which every other user of is in that file —
// cannot be declared twice. Both sides of the draw apply it identically, exactly
// like the two predicates here (.claude/rules/active-games-filter-sites.md).

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
// BGG's weight is a 1–5 float, and real shelves cluster hard in the 2–3 band, so
// whole steps left "nothing heavier than a mid-weight" unsayable (#855).
//
// WRITTEN AS LITERALS, never generated with `v += 0.5`: membership is tested with
// `includes`, i.e. exact float equality against the double a client's JSON `2.5`
// parses to. Halves are exactly representable so a loop would happen to work
// here — but the same loop at 0.1 yields 2.2999999999999994 and would silently
// drop every filter. The literal list is what keeps this safe if the step is
// ever revisited.
const WEIGHT_CHOICES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

// Whether a game passes the metadata filters. Every filter field is nullable /
// empty meaning "unfiltered".
//
// THE RULE THAT IS EASY TO GET BACKWARDS: an absent value ON THE GAME passes
// every filter — the same reasoning as `fitsOwnRange`'s typeof guards above. A
// game BGG has no playtime for must stay drawable, or the first touch of any
// filter silently hides every hand-typed game and (on an
// instance without BGG_API_TOKEN) the entire shelf. Under-filtering is
// recoverable — the user sees a game they can skip; over-filtering hides games
// with nothing on screen to say so.
function fitsMetadataFilters(game, filters) {
  const f = filters || {};
  const g = game || {};
  // Playing time is a CONTAINMENT test (#1025), reversing the overlap doctrine
  // of #724/#1001/#1023: "at most M" reads the game's OWN maximum, "at least N"
  // its own minimum. If you say you have two hours you want to be sure you
  // finish — not a game that merely *might* come in under the wire by running at
  // its absolute floor.
  //
  // What makes this right despite BGG's wide spreads: its min/max mostly tracks
  // PLAYER COUNT rather than variance at one table, so a 60–120 game is "60 at
  // two players, 120 at four" and `maxPlaytime` IS the honest worst case at a
  // full table. The class that genuinely loses is campaign/legacy/epic games,
  // where the top of the range is a different activity (Toriki 20–600, TI4
  // 240–480) — and those are games a group PLANS, never draws. Accepted
  // deliberately; `test/draw-pool.test.js` asserts the loss so it reads as a
  // decision rather than a regression.
  //
  // Rejected: interpolating expected playtime for the party size. The app knows
  // the count, so it is theoretically better — and it is a guess wearing the
  // clothes of precision, where a filter someone sets by hand must above all be
  // predictable.
  //
  // Both bounds stay INCLUSIVE: a game pinned at the ceiling (120–120 under "at
  // most 120") takes exactly two hours and belongs in the pool.
  if (isFiniteNum(f.maxPlaytime) && isFiniteNum(g.maxPlaytime) && g.maxPlaytime > f.maxPlaytime)
    return false;
  if (isFiniteNum(f.minPlaytime) && isFiniteNum(g.minPlaytime) && g.minPlaytime < f.minPlaytime)
    return false;
  if (isFiniteNum(f.weightMin) && isFiniteNum(g.weight) && g.weight < f.weightMin) return false;
  if (isFiniteNum(f.weightMax) && isFiniteNum(g.weight) && g.weight > f.weightMax) return false;
  // "The youngest at the table is N" — so a game passes when its own minimum age
  // is at most N.
  if (isFiniteNum(f.youngestAge) && isFiniteNum(g.minAge) && g.minAge > f.youngestAge) return false;
  // EXCLUSION runs before inclusion, and it is unconditional (#1003): a game
  // carrying an excluded value is out even when it also carries an included one.
  // The alternative — letting an include rescue it — makes an exclusion
  // unreachable on exactly the games it is aimed at, silently.
  if (excludesAnyOf(g.categories, f.excludeCategories)) return false;
  if (excludesAnyOf(g.mechanics, f.excludeMechanics)) return false;
  return matchesAnyOf(g.categories, f.categories) && matchesAnyOf(g.mechanics, f.mechanics);
}

// Named `isFiniteNum` rather than the obvious `isNumber`: these files share ONE
// global scope, `no-redeclare` is off there, and a second file declaring a name
// this generic would silently take over for everyone, load order deciding
// (.claude/rules/eslint-frontend-shared-scope.md).
function isFiniteNum(v) {
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

// The EXCLUDE direction (#1003), and its combinator is the exact OPPOSITE of the
// one above: ANY excluded value present removes the game (AND-NOT), where any
// included value present keeps it (OR). That asymmetry is deliberate and is the
// thing a later reader will try to "fix" into symmetry.
//
// The reason is the same vocabulary-size argument that makes inclusion an OR: a
// game carries 3–8 of BGG's ~84 categories, so requiring ALL of the excluded
// values to be present before rejecting would mean "anything but Party Game"
// hardly ever rejects anything. Same shape as the tri-state tag chips, where an
// excluded tag rejects on its own in both combination modes.
//
// An absent field on the game excludes NOTHING, the same permissiveness rule the
// include side follows: a game BGG knows no categories for carries none of the
// excluded ones. Get that backwards and the first exclusion hides every
// hand-typed game and, on an instance without BGG_API_TOKEN, the entire shelf.
function excludesAnyOf(values, excluded) {
  if (!Array.isArray(excluded) || excluded.length === 0) return false; // unfiltered
  if (!Array.isArray(values) || values.length === 0) return false; // absent on the game
  return excluded.some((x) => values.includes(x));
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
  const anyNumber = (key) => list.some((g) => isFiniteNum((g || {})[key]));
  const valuesOf = (key) => {
    const seen = new Set();
    list.forEach((g) => {
      const vs = (g || {})[key];
      if (Array.isArray(vs)) vs.forEach((v) => { if (typeof v === 'string' && v) seen.add(v); });
    });
    return [...seen].sort();
  };
  return {
    // The two playtime controls are gated SEPARATELY, each on the field its own
    // clause reads. #1025 UN-CROSSED this pair: under containment "at most M"
    // compares the game's maxPlaytime and "at least N" its minPlaytime, so each
    // flag names the field it now reads. (It was crossed while the clauses were
    // overlap tests — if you find a rule or comment still describing a crossing,
    // it predates #1025.) One shared flag would let a shelf whose games carry
    // only a lower bound render an "at most" control that every game passes,
    // i.e. one that can never do anything — the inverse of the empty pool this
    // function exists to rule out.
    playtimeMin: anyNumber('minPlaytime'),
    playtimeMax: anyNumber('maxPlaytime'),
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
  return !!(o.playtimeMax || o.playtimeMin || o.weight || o.age ||
    (o.categories || []).length || (o.mechanics || []).length);
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
    maxPlaytime: step(src.maxPlaytime, PLAYTIME_CHOICES, o.playtimeMax),
    minPlaytime: step(src.minPlaytime, PLAYTIME_CHOICES, o.playtimeMin),
    weightMin: step(src.weightMin, WEIGHT_CHOICES, o.weight),
    weightMax: step(src.weightMax, WEIGHT_CHOICES, o.weight),
    youngestAge: step(src.youngestAge, AGE_CHOICES, o.age),
    categories: pick(src.categories, o.categories),
    mechanics: pick(src.mechanics, o.mechanics),
    // The exclude lists are pruned against the SAME option list (#1003) — one
    // chip per value, three states, so a value the shelf no longer carries has
    // to vanish from both directions or an active-filter count sits over a chip
    // that is not on screen.
    excludeCategories: pick(src.excludeCategories, o.categories),
    excludeMechanics: pick(src.excludeMechanics, o.mechanics),
  };
  // A value in BOTH lists is unrepresentable in the UI (one chip holds one
  // state) and reachable only from a hand-crafted preset. Exclusion is the
  // stronger statement and `fitsMetadataFilters` already lets it win, so the
  // include entry is dropped here — which is what keeps the chip able to paint
  // exactly one state, rather than picking one arbitrarily at render time.
  out.categories = out.categories.filter((v) => !out.excludeCategories.includes(v));
  out.mechanics = out.mechanics.filter((v) => !out.excludeMechanics.includes(v));
  // An inverted range admits nothing at all, so a hand-crafted one would answer
  // "No matching games" over a shelf that is fine. Swapping (rather than
  // dropping a bound) is done HERE, in the shared function, so the preview and
  // the draw cannot disagree about what an inverted range means.
  //
  // BOTH pairs, since #1025. The playtime pair was deliberately NOT swapped
  // while its clauses were overlap tests reading opposite ends of the game's
  // range — "at least 120, at most 30" then asked for a game whose spread
  // covered both, which is a real query and exactly a 20–600 campaign. Under
  // containment it asks for a game that both finishes inside 30 and runs at
  // least 120, which nothing can satisfy, so it joins complexity.
  const swap = (minKey, maxKey) => {
    if (out[minKey] !== null && out[maxKey] !== null && out[minKey] > out[maxKey]) {
      const lo = out[maxKey];
      out[maxKey] = out[minKey];
      out[minKey] = lo;
    }
  };
  swap('weightMin', 'weightMax');
  swap('minPlaytime', 'maxPlaytime');
  return out;
}

// How many of the controls are actively filtering — the disclosure's badge, and
// what keeps a collapsed filter from being forgotten. The complexity RANGE
// counts once however many of its two bounds are set: it is one control, and a
// badge that reads 2 for one visible row is a number nobody can reconcile.
function countMetadataFilters(filters) {
  const f = filters || {};
  return (
    // The playtime BOUNDS are one control, exactly like the complexity range
    // below: one visible row, so a badge of 2 over it could not be reconciled.
    // Kept on the loose `!= null` test rather than `isFiniteNum` on purpose —
    // lib/routes/sessions.js calls this on the RAW request body to decide
    // whether to wait for the metadata backfill, where a garbage value costing
    // one needless wait is the safe direction.
    ((f.minPlaytime !== null && f.minPlaytime !== undefined) ||
      (f.maxPlaytime !== null && f.maxPlaytime !== undefined) ? 1 : 0) +
    (isFiniteNum(f.weightMin) || isFiniteNum(f.weightMax) ? 1 : 0) +
    (f.youngestAge !== null && f.youngestAge !== undefined ? 1 : 0) +
    // One chip ROW is one control however it filters (#1003), so an included and
    // an excluded category together still count 1 — the same reasoning the
    // complexity range and the playtime pair get.
    ((f.categories || []).length || (f.excludeCategories || []).length ? 1 : 0) +
    ((f.mechanics || []).length || (f.excludeMechanics || []).length ? 1 : 0)
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
    ownedByParty,
    shelfParty,
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
