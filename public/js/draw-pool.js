/* Spielwirbel – the two predicates that decide which games a session draw may
   pick from: is the game in the active collection, and does its player range fit
   the table. Pure and dependency-free, so it works both as a shared-scope
   frontend script (browser global) and as a CommonJS module the server and the
   test suite can require. Load order: see index.html.

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

// Whether a game's player range admits a table of `playerCount`.
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
function fitsPlayerCount(game, playerCount) {
  return (
    (typeof game.minPlayers !== 'number' || playerCount >= game.minPlayers) &&
    (typeof game.maxPlayers !== 'number' || playerCount <= game.maxPlayers)
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isActiveGame, fitsPlayerCount };
}
