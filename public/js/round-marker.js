/* Spielwirbel – a round's COLOUR MARKER (#1187): the one thing a round still
   owns about how it looks once designs became per-ACCOUNT (#1184).

   A round stores a design-NEUTRAL index 0–7. Each design maps that index onto
   its own eight colours (`markers` in designs.js), so the same round reads as
   Tannenfilz in Der Tisch and as Salbei in Klassisch with no translation table
   anywhere — and two people in one round, on different designs, still see the
   same round as "the green one" in their own vocabulary. That is the whole
   reason the stored value is an index rather than a hex.

   This file is deliberately dependency-free (module.exports guard): the SERVER
   requires it — both repo backends stamp a marker in createRound, and
   lib/routes/marker.js validates against MARKER_COUNT — while the browser loads
   it as a shared-scope script. One list, no copy
   (.claude/rules/shared-constants-across-the-stack.md).

   THE RETIRED ROUND DESIGNS STILL MATTER, AS DATA (#1202). Rounds owned a
   design — eight palettes, one dark palette, seven worlds — until the flip
   removed every one of them from the code. The stored `background` blob stays on
   the rounds that picked one (there is no migration, CLAUDE.md), and a round that
   predates markers stores NO index. So the one thing left of a retired design is
   the marker it becomes, decided here from the stored blob alone: by its `id`
   (#903 and later), or by its page hex for a round saved before designs had ids.
   Neither needs the retired registry, which is what lets this file stay
   dependency-free. */

'use strict';

// Eight, everywhere. Every design declares exactly this many markers, and
// test/round-marker.test.js asserts it for each — a design with seven would
// leave index 7 rendering `undefined` for the rounds that already hold it.
const MARKER_COUNT = 8;

/* Every retired design id → the marker index it becomes, decided once
   (#1187) and pinned case-by-case in the specs. The eight LIGHT palettes keep
   their own order, so a Salbei round stays sage; everything else is mapped by
   the nearest accent hue, which is a judgement recorded here rather than a
   computation, because "nearest" over eight hand-tuned accents is not a formula
   anyone should have to re-derive.

   Obsidian is in this table and NOT in the first eight: it is the one dark
   palette, and the marker set is the eight light ones (the issue's own list).
   Its violet accent is what puts it on Lavendel.

   This table is read-time only — there is no migration (CLAUDE.md), so a round
   that never picked a marker resolves through here on every render, for as long
   as its `background` survives. It OUTLIVES the worlds on purpose: the flip
   (#1202) deleted their code, but not the rounds that wore them, and a Forest
   round that stored no index must still come out sage rather than whatever its
   id hashes to. An id missing from it is not an error, it falls through to the
   deterministic default, which is why the specs enumerate all sixteen rather
   than trusting the lookup to complain. */
const LEGACY_MARKER_INDEX = {
  // The eight light palettes, in their own order.
  standard: 0,
  blaugrau: 1,
  salbei: 2,
  rose: 3,
  lavendel: 4,
  sand: 5,
  schiefer: 6,
  pfirsich: 7,
  // The dark palette and the seven worlds, by nearest accent hue.
  obsidian: 4, // #b98df0 violet   → Lavendel
  forest: 2,   // #356427 green    → Salbei
  ocean: 1,    // #0e6690 blue     → Blaugrau
  scifi: 6,    // #4fb3ef steel    → Schiefer
  chess: 0,    // #38343f near-ink → Standard (the neutral default)
  horror: 2,   // #9fdc70 green    → Salbei
  dinos: 2,    // #0f6b5f teal     → Salbei
  burg: 7,     // #e8825a ember    → Pfirsich
};

/* A round saved before designs had ids (pre-#903) stored only the palette's page
   hex. Only the eight light palettes existed then, so only their pages appear
   here — a world's page hex without an id was never a world. Lower-case, and
   compared lower-cased, because the stored value came from a colour input. */
const LEGACY_PAGE_DESIGN = {
  '#f4f1ea': 'standard',
  '#eef2f7': 'blaugrau',
  '#eaf1ea': 'salbei',
  '#f6ecf1': 'rose',
  '#efedf8': 'lavendel',
  '#f6efe2': 'sand',
  '#e9eef3': 'schiefer',
  '#f8ede6': 'pfirsich',
};

// The retired design id a stored `background` stands for, or null.
function legacyDesignId(bg) {
  if (!bg || bg.type !== 'theme') return null;
  if (bg.id && Object.prototype.hasOwnProperty.call(LEGACY_MARKER_INDEX, bg.id)) return bg.id;
  const page = bg.page ? String(bg.page).toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(LEGACY_PAGE_DESIGN, page) ? LEGACY_PAGE_DESIGN[page] : null;
}

/* The marker a round gets when nothing else decides one: a stable hash of its
   id, so two rounds created in the same second do not both come out Standard
   and a round looks the same on every device before anyone picks.

   FNV-1a over the id, `Math.imul` to keep the multiply in 32 bits (a plain `*`
   silently loses precision past 2^53 and would make the hash platform-dependent
   in a way no test would notice). The VALUE is stored at creation rather than
   recomputed on read — see createRound in both backends — precisely so changing
   this function later cannot re-colour existing rounds. */
function markerIndexFromId(roundId) {
  const s = String(roundId || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % MARKER_COUNT;
}

const isMarkerIndex = (n) => Number.isInteger(n) && n >= 0 && n < MARKER_COUNT;

/* The index a round renders with, in priority order: what it stored, then what
   its retired design maps to, then the deterministic default. */
function resolveMarker(round) {
  if (round && isMarkerIndex(round.marker)) return round.marker;
  const designId = legacyDesignId(round && round.background);
  if (designId) return LEGACY_MARKER_INDEX[designId];
  return markerIndexFromId(round && round.id);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MARKER_COUNT, LEGACY_MARKER_INDEX, LEGACY_PAGE_DESIGN, legacyDesignId, markerIndexFromId, isMarkerIndex, resolveMarker,
  };
}
