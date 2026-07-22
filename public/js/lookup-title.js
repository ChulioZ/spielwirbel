/* Spielwirbel – lookup titles: which name a picked provider match fills in.
   Pure and dependency-free, so it works both as a shared-scope frontend script
   (browser global) and as a CommonJS module the test suite can require. Load
   order: see index.html (before views-round-lookup.js). */

'use strict';

// The title to fill in for a picked match, given the search hit `r` and the
// detail response `d`.
//
// Normally the detail response wins: a store's *search* listing is often
// shortened or decorated ("… – Standard Edition"), while the product page
// carries the real name.
//
// BoardGameGeek is the exception, and it is why this helper exists (#117). BGG
// answers a search with the name that MATCHED — for a German query that is the
// game's German alternate name — whereas its detail hop always reports the
// item's primary name, which is usually the original-language one. Letting
// detail win there would visibly undo the localization the user just picked
// from the dropdown ("Die Siedler von Catan" snapping back to "CATAN"), and BGG
// is now the only source of localized titles: the Wikidata label lookup that
// used to provide them was removed with the Wikidata search index.
//
// Returns '' when neither side has a title, so callers can gate on a falsy
// result.
function pickedTitle(r, d) {
  if (r && r.provider === 'bgg' && r.title) return r.title;
  return (d && d.title) || (r && r.title) || '';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pickedTitle };
}
