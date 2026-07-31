/* Spielwirbel – the browser tab / window title, assembled per view (#522).
   Pure string joining, no DOM, in its own file so it can be unit-tested without
   dragging a view file into the coverage report
   (.claude/rules/frontend-helper-modules-and-coverage.md). The DOM half is
   `setDocTitle` in core.js, next to its sibling `setContext`.

   Shape: `<screen> – <round> · Spielwirbel`. The trail runs most-specific
   first, because a browser tab, a history entry and a bookmark all truncate
   from the RIGHT — so the part that distinguishes this screen from the next one
   has to come before the part they share. The brand stays last for the same
   reason it is worth repeating at all: it identifies the tab among a dozen
   others only while there is room for it. */

'use strict';

// Between the screen and the round it belongs to.
const DOC_TITLE_SEP = ' – ';
// Between the trail and the brand — a different mark on purpose, so the brand
// reads as the app rather than as one more level of the hierarchy.
const DOC_TITLE_BRAND_SEP = ' · ';

// Join `parts` (most specific first) with `brand`.
//
// Empty parts are dropped rather than rendered as gaps, which is what lets a
// caller pass a value that is only sometimes present without branching at the
// call site — and, more importantly, what keeps a not-yet-loaded round from
// producing "Regal –  · Spielwirbel". With nothing left, the brand alone is the
// title; it is never empty, so `document.title` can never be blanked by a
// screen that forgot to name itself.
function docTitle(parts, brand) {
  const trail = (parts || [])
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter(Boolean);
  const name = String(brand == null ? '' : brand).trim();
  if (!trail.length) return name;
  if (!name) return trail.join(DOC_TITLE_SEP);
  return trail.join(DOC_TITLE_SEP) + DOC_TITLE_BRAND_SEP + name;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { docTitle, DOC_TITLE_SEP, DOC_TITLE_BRAND_SEP };
}
