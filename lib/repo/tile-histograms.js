'use strict';

/* One canonical order for a list of per-tile histograms (#1721).

   `publicGameAggregates` hands back one histogram per rated evening, and the
   shelf score is folded from them by a floating-point SUM. The two backends
   would otherwise list the evenings in two different orders (the JSON tree's
   round/session order against whatever the SQL group-by emits), and a float sum
   taken in a different order can differ in its last bit — enough to flip a tie
   on the Discover podium between backends. Sorting both the same way makes the
   folded number identical by construction. Shared so the order cannot drift. */
function compareTileHistograms(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

module.exports = { compareTileHistograms };
