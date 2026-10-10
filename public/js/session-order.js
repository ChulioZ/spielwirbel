/* Spielwirbel – the two orders a round's sessions are read in (#1616, #1622).

   Shared by both repo backends and the frontend, so it lives here with the
   module.exports guard (.claude/rules/shared-constants-across-the-stack.md).

   ## Chronological: `sortSessionsByDate`

   By `createdAt`, insertion order as the tiebreak. Until sessions could be
   logged after the fact, insertion order WAS time order, and two dozen readers
   relied on it without saying so — the Chronik, the „last session" ticket, the
   badge walk, the recap's per-period lists. A session logged today for an
   evening three weeks ago is inserted LAST while belonging in the middle, and
   every one of those readers would place it as the newest. Sorting once where
   both backends assemble a round makes the array chronological for every
   reader at the same time, rather than asking each of them to remember.

   `createdAt` is compared as the raw string: every writer stores
   `toISOString()` output (played-on.js normalises the one user-supplied value
   into that form), which sorts lexically in time order. A row with no stamp
   sorts first — it predates the field. `Array.prototype.sort` is stable, so
   equal stamps (the tables of one split, written in the same instant) keep
   their insertion order: on a tie the later-inserted session is the newer.

   ## Newest first: `newestSessionsFirst` — every descending reader uses this

   A descending comparator over the same stamps gets ties WRONG: the stable
   sort keeps equal stamps in their ascending insertion order, so the session
   entered first lands on top. Live sessions carry millisecond stamps and
   almost never tie, but every session logged for one past day is stored at
   the same 20:00 local (played-on.js), and so is one redated with „Datum
   ändern" — two sessions logged for one day listed backwards (#1622).

   So ties break by DESCENDING position in the input: the arrays come from the
   repo in the order above, where a later position is the newer session. It is
   an index tiebreak and not "ascending, then reverse()" so that a filtered
   subset — the usual input — keeps working. A row with no stamp sorts last.
   `stamp` reads something other than `createdAt` (the Chronik's mixed entries
   carry `at`). Postgres restates the same rule in SQL as
   `ORDER BY createdAt DESC, seq DESC`. */

'use strict';

const sessionOrderStamp = (v) => (typeof v === 'string' ? v : '');

// Returns a NEW array; the input is left alone so the JSON backend's live
// tree is never reordered by a read.
function sortSessionsByDate(sessions) {
  return (sessions || []).slice().sort((a, b) => {
    const x = sessionOrderStamp(a && a.createdAt);
    const y = sessionOrderStamp(b && b.createdAt);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

function newestSessionsFirst(list, stamp = (s) => s && s.createdAt) {
  return (list || [])
    .map((item, i) => ({ item, i, k: sessionOrderStamp(stamp(item)) }))
    .sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : b.i - a.i))
    .map((e) => e.item);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sortSessionsByDate, newestSessionsFirst };
}
