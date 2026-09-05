/* Spielwirbel – the curated member-avatar palette.
   Its own file so it can be the SINGLE source of truth: the frontend loads it as
   a shared-scope script (before core.js) and lib/routes/members.js requires it as a
   CommonJS module to validate PATCH ../members/:mid. It used to be hand-copied
   into both, and #145 darkened only the frontend copy — so six of the eight
   swatches the UI offered were rejected with `400 Invalid color` (#420).
   Dependency-free and tiny by design (.claude/rules/frontend-helper-modules-and-coverage.md). */

'use strict';

// Fixed, friendly palette for member avatars. A member keeps "their" color
// everywhere in the app; assignment is by position in round.members, which is
// append-only, so colors stay stable for the life of the round.
// Every entry carries initials (.avatar, .nr-seat__avatar), so each one is tuned
// to clear 4.5:1 against white (#145 — the original palette sat at 3.4–3.9:1).
// Hues are the originals; six were darkened 7–15% to reach the bar, slate blue
// and berry already cleared it. Keep any new color at ≥4.5:1 on white.
//
// "White initials" was literally true until #904. A dark design paints these
// through memberTone() (core.js), which lifts the stored hex toward white so the
// disc does not sink into the page — the ink then flips with it, to --on-accent.
// The hex here is unchanged either way, which is what keeps this file the single
// value lib/routes/members.js validates against.
const MEMBER_COLORS = [
  '#c6522c', // coral
  '#198663', // teal
  '#726bc7', // violet
  '#a66815', // amber
  '#c34d74', // pink
  '#2f6f9e', // slate blue
  '#54821d', // green
  '#993556', // berry
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MEMBER_COLORS };
}
