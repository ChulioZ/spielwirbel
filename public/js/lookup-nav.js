/* Spielwirbel – lookup keyboard navigation: which suggestion is active (#542).
   Pure and dependency-free, so it works both as a shared-scope frontend script
   (browser global) and as a CommonJS module the test suite can require. Load
   order: see index.html (before views-round-lookup.js). */

'use strict';

// The lookup menu follows the editable-combobox pattern: DOM focus never leaves
// the input, and ArrowDown/ArrowUp move an *active option* that Enter picks. So
// the "which row is highlighted" state is a plain index into a flat option list
// — one entry per pickable provider, in visual order — and that arithmetic is
// all this file is.
//
// Deliberately only Down/Up: the combobox's input is editable, so ArrowLeft/
// ArrowRight and Home/End must keep moving the caret (APG). That is also why a
// merged row contributes one option per provider to the SAME vertical list
// rather than needing a second, horizontal axis to reach its badges.
//
// `active` is the current index (-1 when nothing is active), `count` the number
// of options. Returns the next index, or **null** when the key is not one this
// widget handles — the caller uses that to decide whether to preventDefault, so
// a key we don't own keeps its native behaviour.
function nextLookupIndex(active, count, key) {
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null;
  if (!Number.isInteger(count) || count < 1) return null;
  // A stale index (the list shrank under an in-flight re-render) reads as "no
  // active option" rather than moving relative to a row that no longer exists.
  const cur = Number.isInteger(active) && active >= 0 && active < count ? active : -1;
  if (key === 'ArrowDown') return cur < 0 ? 0 : (cur + 1) % count;
  return cur < 0 ? count - 1 : (cur - 1 + count) % count;
}

// Find an option again after a re-render. The menu re-renders on every provider
// arrival (a slow provider adds rows and re-sorts), so an index alone would slide
// the highlight onto a different game mid-keystroke. Options are therefore
// re-located by *identity* — the group key plus the provider — and a selection
// whose option is gone (the re-sort dropped it past MAX_SUGGESTIONS) clears to
// -1 rather than snapping to an arbitrary neighbour.
function lookupOptionIndex(options, ref) {
  if (!ref || !Array.isArray(options)) return -1;
  return options.findIndex((o) => o && o.key === ref.key && o.provider === ref.provider);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { nextLookupIndex, lookupOptionIndex };
}
