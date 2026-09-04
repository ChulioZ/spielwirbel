/* Spielwirbel – the face of a rating on the 0–5 scale (#890).

   One glyph per rung: the trash for the zero (#797 made "gar nicht" the bottom
   of the scale rather than a separate flag) and the five mood faces for 1–5.

   Its own file because three screens draw the same scale and must draw it
   identically: the vote card (views-session.js), the shared-link vote card
   (views-vote-link.js) and the session result distribution
   (views-session.js's showResults). It lived inside the first two as a private
   `const MOODS` and the chart would have been the third copy — a drift there
   does not throw, it just renders a different face for the same number on the
   screen the group reads seconds after pressing the tile.

   Deliberately NOT in vote-scale.js or vote-score.js: the server requires both
   of those (lib/recommend.js, lib/session-split.js, lib/repo/json.js) and their
   rules are restated in SQL — Tabler icon class names have no business there.
   Dependency-free and tiny by design
   (.claude/rules/frontend-helper-modules-and-coverage.md).
   Load order: see index.html — before core.js and its view consumers. */

'use strict';

// The five faces of 1–5, in order. Declared exactly ONCE in the codebase —
// test/phone-width-overflow.test.js derives the distribution chart's bar count
// from this array, so a second copy would let the two disagree about how many
// rungs the scale has.
const MOODS = ['ti-mood-cry', 'ti-mood-sad', 'ti-mood-neutral', 'ti-mood-smile', 'ti-mood-crazy-happy'];

// The Tabler class for one rung of the scale, zero included.
const ratingFace = (n) => (n === 0 ? 'ti-trash' : MOODS[n - 1]);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MOODS, ratingFace };
}
