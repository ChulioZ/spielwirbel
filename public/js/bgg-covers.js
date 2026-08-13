/* Spielwirbel – BGG edition covers (#519): which of a game's per-edition box
   arts to offer first, and which duplicates to drop.
   Pure and dependency-free, so it works both as a shared-scope frontend script
   (browser global) and as a CommonJS module the test suite can require. Load
   order: see index.html (before cover-picker.js). */

'use strict';

// The value BGG writes in a version's `<link type="language">` for each UI
// locale we ship. Only the languages the app itself speaks are mapped: the sort
// exists to put "the edition on our table" first, and a locale we cannot even
// render the UI in is not that. An unmapped locale simply gets the
// English-first order, which is BGG's own lingua franca.
const BGG_LANGUAGES = { de: 'German', en: 'English' };

// BGG's language value for a UI locale, or null. Two letters, matching how
// detectLocale() reads navigator.language (.claude/rules/locale-set-is-data.md).
function bggCoverLanguage(locale) {
  const code = String(locale || '').slice(0, 2).toLowerCase();
  return Object.prototype.hasOwnProperty.call(BGG_LANGUAGES, code) ? BGG_LANGUAGES[code] : null;
}

// Rank one cover: 0 = an edition in the reader's language, 1 = an English
// edition, 2 = everything else. English is a *separate* tier rather than part
// of "the rest" because it is the fallback almost every group can read; in an
// English UI tiers 0 and 1 coincide and collapse to one group, which is correct.
function coverRank(cover, want) {
  const langs = (cover && cover.languages) || [];
  if (want && langs.includes(want)) return 0;
  return langs.includes('English') ? 1 : 2;
}

// Order a game's edition covers for a reader of `locale`, then drop duplicates.
//
// SORT FIRST, DEDUPE SECOND, and that order is the whole point: several editions
// legitimately share one thumbnail (measured 2026-07-28 — Ark Nova's 35 covers
// are 19 distinct URLs, Catan's 135 are 126), so whichever member of a duplicate
// group survives is the one whose label the user reads. Deduping first would
// keep BGG's arbitrary first entry and could label a cover "Chinese edition" for
// a German reader looking at the German printing's own box.
//
// The sort is by rank only, so BGG's own order survives inside each tier — a
// stable sort is guaranteed by the spec (ES2019), and the tiers are the only
// opinion this helper has.
//
// Deduping is not cosmetic: without it the grid shows the same box art nine
// times in a row (Ark Nova's German printings), which reads as a broken picker.
function sortEditionCovers(covers, locale) {
  const want = bggCoverLanguage(locale);
  const seen = new Set();
  return (Array.isArray(covers) ? covers : [])
    .filter((c) => c && c.imageUrl)
    .slice()
    .sort((a, b) => coverRank(a, want) - coverRank(b, want))
    .filter((c) => {
      if (seen.has(c.imageUrl)) return false;
      seen.add(c.imageUrl);
      return true;
    });
}

// What a picked cover says about its PRINTING, in the shape the game row stores
// (#742): BGG's edition name, its year and its own language values. Null when the
// cover carries none of the three — the routes read that as "no edition", which
// is what keeps the key absent on a game whose cover says nothing about the box.
//
// Note the rename: a cover's own field is `edition` (the name), while the stored
// object is `edition: { name, … }`. Converting here rather than at three call
// sites is what stops one of them shipping `{ edition: 'Deutsche Erstausgabe' }`.
//
// `languages` is the half that does real work — the server maps it onto the price
// aggregator's edition codes — so it is kept even for a cover with no name and no
// year, which `editionLabel` then renders as nothing at all.
function editionFromCover(cover) {
  const name = (cover && cover.edition) || '';
  const year = (cover && cover.year) || null;
  const languages = (cover && Array.isArray(cover.languages) ? cover.languages : [])
    .map(String)
    .filter(Boolean);
  if (!name && year === null && !languages.length) return null;
  return { name, year, languages };
}

// One line of context: "German edition · 2019", either half alone, or '' when BGG
// has neither. Kept here rather than in the renderer so the "no label at all"
// case is unit-testable — an edition with no name and no year must not render a
// stray separator. Used under a cover tile in the picker AND under the cover on
// the game detail page, so the two can never phrase one printing differently.
function editionLabel(edition) {
  return [(edition && edition.name) || '', (edition && edition.year) || '']
    .filter(Boolean)
    .join(' · ');
}

function coverCaption(cover) {
  return editionLabel(editionFromCover(cover));
}

// The picked edition flattened onto a request body, the way `POST /games` and
// `PATCH /games/:gid` read it — those are multipart, so a nested object would
// arrive as '[object Object]' (the same reason `source` rides as three fields).
//
// All three keys are ALWAYS present, including for a cover that names no
// printing: an omitted key leaves the stored edition in place, so a new cover
// would keep the previous box's label and its price edition. Empty values are how
// the routes are told to clear it.
function editionFields(cover) {
  const ed = editionFromCover(cover);
  return {
    editionName: ed ? ed.name : '',
    editionYear: ed && ed.year != null ? ed.year : '',
    editionLanguages: ed ? ed.languages : [],
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BGG_LANGUAGES,
    bggCoverLanguage,
    coverRank,
    sortEditionCovers,
    coverCaption,
    editionFromCover,
    editionLabel,
    editionFields,
  };
}
