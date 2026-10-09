'use strict';

/* The order a round's sessions are READ in: by `createdAt`, insertion order as
   the tiebreak (#1616).

   Until sessions could be logged after the fact, insertion order WAS time
   order, and two dozen readers relied on it without saying so — the Chronik's
   newest-first list, the „last session" ticket, the badge walk, the recap's
   per-period lists. A session logged today for an evening three weeks ago is
   inserted LAST while belonging in the middle, and every one of those readers
   would place it as the newest. Sorting once where both backends assemble a
   round makes the array chronological for every reader at the same time,
   rather than asking each of them to remember.

   `createdAt` is compared as the raw string: every writer stores
   `toISOString()` output (played-on.js normalises the one user-supplied value
   into that form), which sorts lexically in time order. A row with no stamp
   sorts first — it predates the field. `Array.prototype.sort` is stable, so
   equal stamps (the tables of one split, written in the same instant) keep
   their insertion order. */

const stampOf = (s) => (s && typeof s.createdAt === 'string' ? s.createdAt : '');

// Returns a NEW array; the input is left alone so the JSON backend's live
// tree is never reordered by a read.
function sortSessionsByDate(sessions) {
  return (sessions || []).slice().sort((a, b) => {
    const x = stampOf(a);
    const y = stampOf(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

module.exports = { sortSessionsByDate };
