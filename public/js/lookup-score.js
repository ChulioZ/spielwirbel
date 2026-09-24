/* Spielwirbel – title comparison: how well a provider hit's title answers the
   typed query (scoreHit), the order the merged hits are shown in
   (rankLookupHits), whether a typed title is already on the round's shelf
   (existingTitleState), and where a picked hit already sits in the round
   (hitShelfState). The first three fold through the same foldTitle, which is
   why they share a file; the fourth is existingTitleState's id-based twin.
   Pure and dependency-free, so it works both as a
   shared-scope frontend script (browser global) and as a CommonJS module the
   test suite can require. Load order: see index.html (before
   lookup.js). */

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

// The order merged provider hits are shown in, capped at `max`: best title
// match first, then registry priority, then the shorter title (a base game
// before its "…: Big Box"), then the provider's own order. Each hit carries the
// `score`/`prio`/`order` searchAllProviders (lookup.js) stamped on it.
//
// Shared by the dropdown (attachLookup) and Der Tisch's inline result list
// (#1264), so the two can never rank one query differently. Pure, and returns
// a new array — the caller's accumulator keeps growing as providers arrive.
function rankLookupHits(hits, max) {
  return (hits || []).slice()
    .sort((a, b) => b.score - a.score || a.prio - b.prio ||
      (a.title || '').trim().length - (b.title || '').trim().length || a.order - b.order)
    .slice(0, max);
}

// Where a provider hit already sits in this round (#1264): 'shelf' | 'wish' |
// 'archived' | null. Der Tisch's search-first add sheet draws one state per
// result row from it — „Im Regal", „Auf der Wunschliste", or an add button.
//
// Matched on the provider link (`game.source`), deliberately NOT on the title
// the way existingTitleState is. That one is an advisory hint and can afford to
// be over-eager; this one decides whether a row offers its add button at all,
// and BGG holds several distinct games under one exact name („Scout", #790) —
// a title match would take the button off every one of them. A manually
// entered game with no link therefore matches nothing, and the typed-title
// hint in the „Selbst eintragen" form is still there to catch it.
//
// The shelf wins over a wish and a wish over the archive, so every game is
// checked rather than returning on the first match: to the person adding, a
// game that is on the shelf is on the shelf, whatever else is also true.
function hitShelfState(games, hit) {
  if (!hit || !hit.provider || hit.providerId == null) return null;
  const id = String(hit.providerId);
  let wish = false;
  let archived = false;
  for (const g of games || []) {
    const src = g && g.source;
    if (!src || src.provider !== hit.provider || String(src.externalId) !== id) continue;
    if (g.wish) wish = true;
    else if (g.retired || g.completed) archived = true;
    else return 'shelf';
  }
  if (wish) return 'wish';
  return archived ? 'archived' : null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scoreHit, foldTitle, existingTitleState, rankLookupHits, hitShelfState };
}
