/* Spielwirbel – podium: arrange ranked entries into podium columns. Pure and
   dependency-free, so it works both as a shared-scope frontend script (browser
   global) and as a CommonJS module the test suite can require. Load order: see
   index.html.

   The one idea in here: A COLUMN IS A RANK, NOT AN ENTRY (#836). Places are
   tie-aware (`computePlaces` in ranking.js, `rankOf` in views-pokale.js), so a
   perfectly ordinary evening — one winner and a three-way tie for 2nd — used to
   emit four fixed-width columns and let the row wrap. On a phone that wrapped
   into two ragged rows, which cost the stage everything it is for: the pedestals
   stopped reading as steps, and because the arrangement is [2 | 1 | 3] the
   crowned winner landed at the BOTTOM RIGHT.

   With a rank per column there are at most three of them, so the stage never
   wraps at any width and the crown stays central by construction. */

'use strict';

/* How many entries one rank shows before the rest collapse into a „+N" count.
   Deliberately ONE number rather than a per-breakpoint pair: the views render on
   navigation and locale change, not on resize, so a width-dependent cap chosen
   at render time would go stale the moment a phone is rotated. Bounding it is
   safe because nothing is lost — the session results screen lists every game in
   full in the ranked rows below the podium, and Pokale drops every member past
   the three steps into the `podium__rest` line. */
const PODIUM_MAX_PER_RANK = 3;

/* Group `items` (each carrying a `place`) into at most three rank columns, in
   the display order [2 | 1 | 3] so a lone winner stands in the middle. Ranks
   nobody holds are dropped, so the order degrades sensibly: {1,3} renders as
   [1 | 3] rather than leaving a hole where 2nd would have been.

   Returns { single, cols: [{ rank, shown, hidden }] }. `single` marks the
   degenerate stage — one distinct place occupied, i.e. every entry tied or only
   one ranked entry at all — which the callers render as one wide crowned band
   instead of a lone pedestal floating on an empty stage. */
function podiumColumns(items, cap) {
  const max = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : PODIUM_MAX_PER_RANK;
  const cols = [];
  [2, 1, 3].forEach((rank) => {
    const at = items.filter((it) => it.place === rank);
    if (!at.length) return;
    cols.push({ rank, shown: at.slice(0, max), hidden: Math.max(0, at.length - max) });
  });
  return { single: cols.length === 1, cols };
}

/* The column skeleton both podiums share: crown (rank 1 only), the entries, the
   overflow count, the pedestal. Kept a pure string builder rather than a DOM
   renderer so it stays require-able from Node and fully covered — the two
   callers differ only in what an entry contains and what its base says, which
   they pass in as already-escaped HTML.

   `--multi` is set from the entry count rather than left to CSS `:has()`,
   because it is the hook the covers and avatars shrink on once a rank fills. */
function podiumColHtml(col, parts) {
  const multi = col.shown.length > 1 ? ' podium__col--multi' : '';
  return (
    `<div class="podium__col podium__col--${col.rank}${multi}">` +
    (col.rank === 1 ? '<i class="ti ti-crown podium__crown" aria-hidden="true"></i>' : '') +
    `<div class="podium__entries">${parts.entries}</div>` +
    (col.hidden && parts.more ? `<span class="podium__more">${parts.more}</span>` : '') +
    `<div class="podium__base">${parts.base}</div>` +
    '</div>'
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PODIUM_MAX_PER_RANK, podiumColumns, podiumColHtml };
}
