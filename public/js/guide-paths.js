/* Spielwirbel – where the „Was spielen wir heute?" guide lives in each language
   (issue #1171).

   ONE table, two readers: lib/guide.js and lib/routes/guide.js serve and link
   the pages from it, and the landing screen (views-landing.js) links the reader's
   own language from it. A hand-copied second list on either side would be the
   palette bug of #420 — the client offering a URL the server no longer answers —
   so both sides read this file
   (.claude/rules/shared-constants-across-the-stack.md). Dependency-free and tiny
   by design (.claude/rules/frontend-helper-modules-and-coverage.md).

   A slug is the search phrase in that language, lowercased and hyphenated, so
   the URL itself reads as the answer to the query. Korean keeps its Hangul: a
   browser and a search result both show it decoded, and a romanisation nobody
   types would buy nothing. Everything that puts a slug into a URL a machine
   reads — the canonical, the hreflang set, the sitemap, the router's lookup —
   goes through encodeURI, never the raw string.

   CHANGING A SLUG ORPHANS THE OLD URL: nothing redirects it, and whatever a
   search engine had indexed under it starts answering with the SPA. Treat a
   published slug as permanent. */

'use strict';

const GUIDE_SLUGS = {
  en: 'what-should-we-play-tonight',
  de: 'was-spielen-wir-heute',
  es: 'a-que-jugamos-hoy',
  fr: 'on-joue-a-quoi-ce-soir',
  it: 'a-cosa-giochiamo-stasera',
  nl: 'wat-spelen-we-vanavond',
  pt: 'o-que-vamos-jogar-hoje',
  fi: 'mita-pelataan-tanaan',
  ko: '오늘-무슨-보드게임-할까',
};

// The guide's path for a locale, DECODED (`/ko/오늘-…`). An unknown locale gets
// the German page — the reference text, and the x-default of the hreflang set —
// rather than a path that would fall through to the SPA.
function guidePath(loc) {
  const code = Object.prototype.hasOwnProperty.call(GUIDE_SLUGS, loc) ? loc : 'de';
  return `/${code}/${GUIDE_SLUGS[code]}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GUIDE_SLUGS, guidePath };
}
