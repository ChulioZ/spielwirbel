/* Spielwirbel – podium: arrange ranked entries into podium columns. Pure and
   dependency-free, so it works both as a shared-scope frontend script (browser
   global) and as a CommonJS module the test suite can require. Load order: see
   index.html.

   ONE CALLER: the Pokale tab (views-pokale.js). This was briefly shared with the
   session results screen; #897 split them, because the two screens had opposite
   problems. Results already lists every game in ranked rows, so a stage there
   restated the ranking in a second visual language — it now opens with a winner
   spotlight instead. Pokale has no such list, so the stage IS the content and
   the celebratory silhouette had to come back.

   Two ideas live in here, and they pull against each other:

   1. A COLUMN IS A RANK, NOT AN ENTRY (#836). Places are tie-aware
      (`computePlaces` in ranking.js, `rankOf` in views-pokale.js), so a
      column-per-entry stage grew with every tie: an ordinary evening — one
      winner and a three-way tie for 2nd — emitted four fixed-width columns and
      wrapped on a phone, which cost the stage everything it is for. The
      pedestals stopped reading as steps, and since the arrangement is
      [2 | 1 | 3] the crowned winner landed at the BOTTOM RIGHT.

   2. RANK IS THE PEDESTAL'S HEIGHT, AND A TIE MUST NOT GROW IT (#891, #897).
      Entries used to stack UPWARD from the pedestal, so the more members shared
      a low place the taller that column: one winner plus a three-way tie for
      3rd overtopped the crowned winner — the one claim a podium exists to make,
      contradicted by its own geometry. That is why entries now lie SIDEWAYS on
      the step (styles.css), as short chips that wrap rather than as cards that
      stack. Height stays the rank's, growth goes into width.
      See `.claude/rules/rank-encodings-must-not-be-growable-by-ties.md` for the
      measured crossover — the tie size past which even a chip stack wins. */

'use strict';

/* Group `items` (each carrying a `place`) into at most three rank columns, in
   the display order [2 | 1 | 3] so the winner stands in the middle.

   Returns { single, cols: [{ rank, shown, spacer }] }. `single` marks the
   degenerate stage — one distinct place occupied, i.e. every entry tied or only
   one ranked entry at all — which the caller renders as one SHARED TOP STEP:
   the winner's own pedestal, widened to hold the tied entries side by side
   (#879). What that looks like is entirely CSS's (`.podium--single`).

   NOTHING IS CAPPED. There was a `PODIUM_MAX_PER_RANK` of 3 with a „+N weitere"
   spill while entries stacked upward — a column had no width to grow into, so
   the cap was the only thing keeping a crowded place off the winner's silhouette.
   Entries lying sideways grow into width instead, so every tied member stands on
   the step and nobody has to be explained away into a count.

   THE CROWN IS CENTRAL WHENEVER IT SHARES THE STAGE, which is why an unheld
   rank beside it is kept as an empty `spacer` column rather than dropped.
   Dropping it reads fine in the abstract and is wrong on screen: two occupied
   ranks then sit side by side, putting the winner at one END — {1,2} as
   [1st | 2nd] and the genuinely common {1,1,3} (two members tied for the win) as
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
function podiumColumns(items) {
  const held = [];
  [2, 1, 3].forEach((rank) => {
    const at = items.filter((it) => it.place === rank);
    if (at.length) held.push({ rank, shown: at });
  });
  const single = held.length === 1;
  if (held.length === 3 || !held.some((c) => c.rank === 1)) {
    return { single, cols: held };
  }
  const cols = [2, 1, 3].map((rank) => held.find((c) => c.rank === rank) || { rank, shown: [], spacer: true });
  return { single, cols };
}

/* One column: crown (rank 1 only), the entries lying sideways on the step, and
   the pedestal carrying the rank numeral plus — when the place is shared — the
   tie marker. Kept a pure string builder rather than a DOM renderer so it stays
   require-able from Node and fully covered.

   `entryHtml` is a CALLBACK returning one entry as already-escaped HTML, so a
   spacer column (empty `shown`, no content at all) never asks the caller to
   build anything.

   THE PEDESTAL'S LABEL IS THIS FUNCTION'S, not the caller's, and it carries the
   rank and the tie and NOTHING ELSE. It used to carry the win count too, read
   off `shown[0]` — sound only while the ranking IS the win count, which #895
   ends by ranking on the Siegwertung while still showing the raw count. Tie-mates
   then differ, so the count belongs to the member (the entry), and the step
   states only what is true of everyone standing on it. Only the marker's WORDING
   comes in as `sharedLabel`, because a module Node can require has no `t()`. */
function podiumColHtml(col, entryHtml, sharedLabel) {
  // An empty slot holding the crown's centre: no pedestal, no crown, and nothing
  // to announce — CSS draws it as a low riser at that rank's own height, so the
  // markup carries no content at all.
  if (col.spacer)
    return `<div class="podium__col podium__col--${col.rank} podium__col--spacer" aria-hidden="true"></div>`;
  // `--multi` is set from the entry count rather than left to CSS `:has()`,
  // because it is the hook the entries lie down on once a rank fills.
  const multi = col.shown.length > 1 ? ' podium__col--multi' : '';
  return (
    `<div class="podium__col podium__col--${col.rank}${multi}">` +
    (col.rank === 1 ? '<i class="ti ti-crown podium__crown" aria-hidden="true"></i>' : '') +
    `<div class="podium__entries">${col.shown.map(entryHtml).join('')}</div>` +
    '<div class="podium__base">' +
    `<span class="podium__rank">${col.rank}</span>` +
    (col.shown.length > 1 ? `<span class="podium__shared">${sharedLabel}</span>` : '') +
    '</div>' +
    '</div>'
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { podiumColumns, podiumColHtml };
}
