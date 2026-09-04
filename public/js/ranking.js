/* Spielwirbel – ranking: tie-aware podium places. Pure and dependency-free, so
   it works both as a shared-scope frontend script (browser global) and as a
   CommonJS module the test suite can require. Load order: see index.html. */

'use strict';

// Standard competition ranking ("1, 2, 2, 4") over rows already sorted
// descending by score. Two rows tie iff their numbers match at the *displayed*
// one-decimal precision, so what the user sees as an equal `X,X` is treated as
// equal. Unrated rows (count === 0, shown as "–") get no place (null): they
// never take a podium slot or a medal. Returns an array of places aligned to
// `rows`.
//
// It reads `shown` — the number actually PRINTED — rather than the value the
// rows were sorted by. Since #893 those differ: the Spielwirbel-Score can go
// negative and every screen clamps it at 0,0, so two vetoed games sorting −0,3
// and −5,0 both read „0,0" and must share a place, while still sorting in the
// right order above. The caller owns the clamp (`displayScore` in core.js);
// keeping it there is what lets this file stay dependency-free instead of
// growing a second copy of the floor.
function computePlaces(rows) {
  let prevKey = null;
  let prevPlace = 0;
  return rows.map((r, i) => {
    if (!r.count) return null;
    const key = r.shown.toFixed(1);
    if (key === prevKey) return prevPlace;
    prevKey = key;
    prevPlace = i + 1;
    return prevPlace;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computePlaces };
}
