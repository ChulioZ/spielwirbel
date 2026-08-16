/* Spielwirbel – title comparison: how well a provider hit's title answers the
   typed query (scoreHit), and whether a typed title is already on the round's
   shelf (existingTitleState). Both fold through the same foldTitle, which is
   why they share a file. Pure and dependency-free, so it works both as a
   shared-scope frontend script (browser global) and as a CommonJS module the
   test suite can require. Load order: see index.html (before
   views-round-lookup.js). */

'use strict';

// Fold a string to a comparable form before any tier check: ß→ss, diacritics
// stripped, and every run of non-letter/non-digit characters collapsed to a
// single space. Mirrors norm() in lib/providers/bgg.js, which already does
// this for BGG's ranking *within* its own results.
//
// The collapse is what fixes #317: the tiers below tokenize on whitespace, so
// a query like "… Quedlinburg - Megabox" used to yield a dead "-" token that
// can never prefix a real word. That one token made the loose tier's every()
// fail, scoring an obviously-correct hit 0 — indistinguishable from a
// completely unrelated title, at which point the row order fell through to
// provider priority alone.
//
// Letters are matched by Unicode property, not [a-z]: stripping whole scripts
// would fold e.g. "Catan Двубоят" down to a bare "catan".
function foldTitle(s) {
  return String(s || '')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Query-match relevance tier (higher = better), on folded strings. Exact-match
// tiers only — no fuzzy/edit-distance matching, deliberately (see
// .claude/rules/add-game-lookup-provider.md).
function scoreHit(title, q) {
  const s = foldTitle(title);
  const query = foldTitle(q);
  if (!s || !query) return 0;
  if (s === query) return 5; // exact title
  if (s.startsWith(query)) return 4; // title starts with the query
  const words = s.split(' ');
  if (words.some((w) => w.startsWith(query))) return 3; // query at a word boundary
  if (s.includes(query)) return 2; // query anywhere as a substring
  const qTokens = query.split(' ').filter(Boolean);
  if (qTokens.length && qTokens.every((qt) => words.some((w) => w.startsWith(qt))))
    return 1; // loose: every query token is a word-prefix in the title
  return 0; // no match
}

// Whether a typed title already names a game in this round, and if so which
// shelf it sits on: 'active' | 'archived' | null (#524). Drives a non-blocking
// hint in the add-game sheet — a duplicate is usually a mistake, but not always
// (two physical copies, a base game next to a standalone edition), so the
// answer must never gate saving.
//
// Deliberately folded through foldTitle rather than compared on a plain
// trim+lowercase: this is advisory, so an over-eager hint costs nothing while a
// missed one is the whole defect. Folding catches the near-misses a person
// actually types — "Cafe International" for „Café International", "Strasse" for
// „Straße", "Catan Seefahrer" for „Catan: Seefahrer".
//
// 'active' wins outright over 'archived', so every game is checked rather than
// returning on the first hit: a title held by both an archived and an active
// game is, to the person typing, simply already on the shelf.
function existingTitleState(games, title) {
  const key = foldTitle(title);
  if (!key) return null;
  let archived = null;
  for (const g of games || []) {
    if (foldTitle(g && g.title) !== key) continue;
    if (!g.retired && !g.completed) return 'active';
    archived = 'archived';
  }
  return archived;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scoreHit, foldTitle, existingTitleState };
}
