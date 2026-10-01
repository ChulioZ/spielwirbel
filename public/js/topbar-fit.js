/* Spielwirbel – how many top-bar buttons fit beside the home link (#1460).

   Pure numbers, no DOM, in its own file so it can be unit-tested without
   dragging a DOM file into the coverage report
   (.claude/rules/frontend-helper-modules-and-coverage.md). The measuring and
   folding half is topbar-overflow.js.

   Whether a button fits is decided from MEASURED widths, never from a per-design
   breakpoint: the designs differ in button size, gap, padding and wordmark, and
   the Programmheft keeps its wordmark on phones (P2.5), so any width threshold
   would be right for one design and wrong for the next. */

'use strict';

// Rounding slack. The widths come from getBoundingClientRect, and four designs
// fit six buttons at 360–390px with 0px to spare — without it, a sub-pixel
// rounding difference would fold a button in a bar that visibly fits.
const TOPBAR_FIT_SLACK = 0.5;

// The width of a row of items laid out with `gap` between neighbours.
function topbarRowWidth(widths, gap) {
  if (!widths.length) return 0;
  return widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
}

// How many candidates stay in the bar, counted from the front of `widths`.
//
// - `available`: the bar's content box (its width minus its padding);
// - `fixed`: the widths of what never folds (home link, the round name at its
//   minimum), in any order;
// - `widths`: the candidates in PRIORITY order, highest first, so the last one
//   folds first;
// - `more`: the „…" button's width, reserved only when something folds.
//
// Never negative: when not even one candidate fits beside „…", every one folds
// and the bar holds the fixed items plus „…".
function topbarKeep({ available, gap, fixed = [], widths = [], more = 0 }) {
  const fits = (row) => topbarRowWidth(row, gap) <= available + TOPBAR_FIT_SLACK;
  if (fits([...fixed, ...widths])) return widths.length;
  for (let keep = widths.length - 1; keep > 0; keep--) {
    if (fits([...fixed, ...widths.slice(0, keep), more])) return keep;
  }
  return 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { topbarKeep, topbarRowWidth, TOPBAR_FIT_SLACK };
}
