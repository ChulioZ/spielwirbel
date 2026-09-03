/* Spielwirbel – podium: arrange ranked entries into podium tiers. Pure and
   dependency-free, so it works both as a shared-scope frontend script (browser
   global) and as a CommonJS module the test suite can require. Load order: see
   index.html.

   The one idea in here: RANK IS POSITION, NEVER HEIGHT (#891).

   The stage used to be three side-by-side columns whose pedestal height carried
   the rank. But a tie adds ENTRIES, and entries stack UPWARD from the pedestal,
   so the more games shared a low place the taller that column's silhouette:
   one winner plus a three-way tie for 3rd made the bronze column overtop the
   crowned winner. The one claim a podium exists to make, contradicted by its
   own geometry — and worse the further down the tie sat. Ties are the norm
   rather than an edge case, since places are tie-aware and `computePlaces`
   (ranking.js) ties on the *displayed* one-decimal average.

   A tier stacks the ranks downward instead and lets a tie grow SIDEWAYS, which
   is the one direction that says nothing about rank. #836, #879, #888 and #889
   each fixed a sub-case inside the column encoding; none of them could reach
   the inversion, because the inversion was the encoding. */

'use strict';

/* Group `items` (each carrying a `place`) into the held ranks 1–3, in display
   order [1, 2, 3] — best on top, which is the whole ranking claim.

   Returns [{ rank, shown }]. AN UNHELD RANK IS SIMPLY ABSENT: the column layout
   held its slot open to keep the crown central and to give a lone pedestal a
   stepped silhouette, and both reasons die with the columns. The winner is now
   the top row by construction, and the staircase is drawn by the tiers' indent
   (styles.css), so a held-open slot would buy nothing and cost a blank tier.

   NOTHING IS CAPPED either. The column cap existed because a column has no
   width to grow into — a fifth tied entry had to become a „+N" count somebody
   then has to explain. A row has width, so every tied entry renders and the
   tier wraps. */
function podiumTiers(items) {
  const tiers = [];
  [1, 2, 3].forEach((rank) => {
    const at = items.filter((it) => it.place === rank);
    if (at.length) tiers.push({ rank, shown: at });
  });
  return tiers;
}

/* The tier skeleton both podiums share: a rank marker on the left (crown on
   rank 1, the numeral, and the shared-place label), entries flowing right.
   Kept a pure string builder rather than a DOM renderer so it stays
   require-able from Node and fully covered — the two callers differ only in
   what one entry contains.

   `buildParts` stays a CALLBACK returning { entries } as already-escaped HTML.
   Its original reason is gone (a spacer column had an empty `shown`, so a
   caller reading `shown[0]` threw before this function saw the column, and
   there are no spacers now); it is kept because the callers build a list of
   DOM-shaped strings per tier and there is no value in materialising that for
   a tier this function might not render.

   THE SHARED-PLACE MARKER IS THIS FUNCTION'S, not either caller's — that keeps
   the tie label, which is the semantic half of the fix, in one place for both
   screens. Only its WORDING comes in as `sharedLabel`, because a module Node
   can require has no `t()`. */
function podiumTierHtml(tier, buildParts, sharedLabel) {
  const parts = buildParts(tier);
  return (
    `<div class="podium__tier podium__tier--${tier.rank}">` +
    '<div class="podium__marker">' +
    (tier.rank === 1 ? '<i class="ti ti-crown podium__crown" aria-hidden="true"></i>' : '') +
    `<span class="podium__rank">${tier.rank}</span>` +
    (tier.shown.length > 1 ? `<span class="podium__shared">${sharedLabel}</span>` : '') +
    '</div>' +
    `<div class="podium__entries">${parts.entries}</div>` +
    '</div>'
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { podiumTiers, podiumTierHtml };
}
