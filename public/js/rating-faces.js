/* Spielwirbel – the face of a rating on the 1–5 scale (#890), and the scale's
   own ends (#909).

   One glyph per rung: five mood faces, one per rating. There is no sixth rung —
   #797's trash tile (a retirement proposal as the zero of a 0–5 scale) was
   removed again in #909, so the scale a voter sees and the faces that draw it
   are the same five things.

   Its own file because three screens draw the same scale and must draw it
   identically: the vote card (views-session.js), the shared-link vote card
   (views-vote-link.js) and the session result distribution
   (views-session.js's showResults). It lived inside the first two as a private
   `const MOODS` and the chart would have been the third copy — a drift there
   does not throw, it just renders a different face for the same number on the
   screen the group reads seconds after pressing the tile.

   THE BOUNDS LIVE HERE, and that is the point (#909). They used to be
   `RATING_MIN`/`RATING_MAX` in vote-scale.js, beside the retire-precedence rule
   that was the file's real content; with that rule gone, two constants
   restating `MOODS.length` from a second file could only ever drift from it.
   Here `RATING_MAX` IS the number of faces, so "the scale and its glyphs
   disagree about how many rungs there are" is not a state the code can express.

   Deliberately NOT in vote-score.js: the server requires that one
   (lib/recommend.js, lib/session-split.js, lib/repo/json.js) and its rules are
   restated in SQL — Tabler icon class names have no business there.
   Dependency-free and tiny by design
   (.claude/rules/frontend-helper-modules-and-coverage.md).
   Load order: see index.html — before core.js and its view consumers. */

'use strict';

// The five faces of 1–5, in order. Declared exactly ONCE in the codebase —
// test/phone-width-overflow.test.js derives the distribution chart's bar count
// from this array, so a second copy would let the two disagree about how many
// rungs the scale has.
const MOODS = ['ti-mood-cry', 'ti-mood-sad', 'ti-mood-neutral', 'ti-mood-smile', 'ti-mood-crazy-happy'];

// The scale's ends. `RATING_MAX` is derived rather than written: see the header.
const RATING_MIN = 1;
const RATING_MAX = MOODS.length;

// The Tabler class for one rung of the scale.
const ratingFace = (n) => MOODS[n - 1];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MOODS, RATING_MIN, RATING_MAX, ratingFace };
}
