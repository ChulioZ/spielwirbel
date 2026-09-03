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
   the display order [2 | 1 | 3] so the winner stands in the middle.

   Returns { single, cols: [{ rank, shown, hidden, spacer }] }. `single` marks
   the degenerate stage — one distinct place occupied, i.e. every entry tied or
   only one ranked entry at all — which the callers render as one SHARED TOP
   STEP: the winner's own pedestal, widened to hold the tied entries side by
   side (#879). What that looks like is entirely CSS's (`.podium--single`).

   THE CROWN IS CENTRAL WHENEVER IT SHARES THE STAGE, which is why an unheld
   rank beside it is kept as an empty `spacer` column rather than dropped.
   Dropping it reads fine in the abstract and is wrong on screen: two occupied
   ranks then sit side by side, putting the winner at one END — {1,2} as
   [1st | 2nd] and the genuinely common {1,1,3} (two games tied for the win) as
   [1st | 3rd]. That is a milder version of the very thing #836 fixed, so the
   slot is held open and the crown never moves. Nothing is held open when there
   is no crown to centre: an absent rank 1 leaves the remaining ranks packed.

   A SINGLE held rank keeps its slots too (#879), for a different reason — one
   column has no centring problem, so this is about the SILHOUETTE. The stepped
   profile is what makes the stage read as a podium at all, and a lone pedestal
   has none; the empty 2nd and 3rd risers restore it and say what the tie
   actually means, that nobody is standing below the top step. CSS hides them
   where they would squeeze the shared step (styles.css).

   BOTH kinds of held-open slot are painted (#889) — only the shared step's were
   until then, so {1,2} and {1,1,3} spent their third of the stage on a hole
   while the degenerate case got a silhouette. What a riser looks like is CSS's,
   but which slots get one follows from the two paragraphs above, not from how
   the stage happens to be flagged. */
function podiumColumns(items, cap) {
  const max = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : PODIUM_MAX_PER_RANK;
  const held = [];
  [2, 1, 3].forEach((rank) => {
    const at = items.filter((it) => it.place === rank);
    if (!at.length) return;
    held.push({ rank, shown: at.slice(0, max), hidden: Math.max(0, at.length - max) });
  });
  const single = held.length === 1;
  if (held.length === 3 || !held.some((c) => c.rank === 1)) {
    return { single, cols: held };
  }
  const cols = [2, 1, 3].map(
    (rank) => held.find((c) => c.rank === rank) || { rank, shown: [], hidden: 0, spacer: true }
  );
  return { single, cols };
}

/* The column skeleton both podiums share: crown (rank 1 only), the entries, the
   overflow count, the pedestal. Kept a pure string builder rather than a DOM
   renderer so it stays require-able from Node and fully covered — the two
   callers differ only in what an entry contains and what its base says.

   `buildParts` is a CALLBACK returning { entries, more, base } as already-escaped
   HTML, not a plain object, and that is load-bearing: a spacer column has an
   EMPTY `shown`, so a caller reading `shown[0]` to label its pedestal (Pokale
   needs the step's win count) throws before this function ever sees the column.
   Passing a callback means content is only ever computed for a column that has
   some.

   `--multi` is set from the entry count rather than left to CSS `:has()`,
   because it is the hook the covers and avatars shrink on once a rank fills. */
function podiumColHtml(col, buildParts) {
  // An empty slot holding the crown's centre: no pedestal, no crown, and nothing
  // to announce — CSS draws it as a low riser at that rank's own height, so the
  // markup carries no content at all.
  if (col.spacer)
    return `<div class="podium__col podium__col--${col.rank} podium__col--spacer" aria-hidden="true"></div>`;
  const parts = buildParts(col);
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
