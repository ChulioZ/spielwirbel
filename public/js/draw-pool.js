/* Spielwirbel – the two predicates that decide which games a session draw may
   pick from: is the game in the active collection, and does its player range fit
   the table — plus, since #653, what an owned EXPANSION contributes to that
   range and the one length bound the expansion editor offers. Pure and
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

// A game is in the active collection when it sits in NEITHER archive (#250).
// The draw pool, the direct-pick guard in the sessions route and the setup
// screen's preview all share this predicate, so a third archive state added here
// closes every draw path at once rather than leaving the archived game playable
// by id. It is NOT the whole of "active" everywhere — the taste stats drop
// retired games only (.claude/rules/active-games-filter-sites.md).
function isActiveGame(game) {
  return !game.retired && !game.completed;
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

// How long a hand-typed expansion name may be. Here rather than in lib/quota.js
// because — unlike the per-game CAP, which the client only ever learns about
// from a 403 — this is a bound the UI *offers*: it is the free-text input's
// `maxlength` and the route's zod `.max()`, i.e. exactly the drift shape
// .claude/rules/shared-constants-across-the-stack.md exists for.
const EXPANSION_TITLE_MAX = 120;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isActiveGame, fitsPlayerCount, requiredExpansions, EXPANSION_TITLE_MAX };
}
