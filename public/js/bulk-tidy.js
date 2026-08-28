/* Spielwirbel – what a bulk shelf-tidying selection costs the round (#832).
   Shared by the Regal's selection mode, the three off-shelf screens and the
   "Spiele verschieben" sheet — three screens that take games away from a round
   and must warn about the same consequence in the same words.
   Dependency-free and pure, so it is unit-testable from Node
   (.claude/rules/frontend-helper-modules-and-coverage.md).
   Part of the frontend; all files share one global script scope. */

// Do any of the selected games actually carry session history?
//
// The confirm has to state that removing a game erases it from past sessions —
// which is true, not obvious, and not undoable. But a shelf-tidying selection of
// never-played games loses nothing, and a warning that cries wolf on every
// selection is a warning people learn to click through, so the wording is chosen
// from this answer rather than always assuming the worst.
//
// `gameIds` is a Set or an array; `round.sessions` may be absent on a summary
// payload, in which case nothing is known to be at risk.
function selectionTouchesHistory(round, gameIds) {
  const ids = gameIds instanceof Set ? gameIds : new Set(gameIds || []);
  if (!ids.size) return false;
  return ((round && round.sessions) || []).some((s) => (s.gameIds || []).some((x) => ids.has(x)));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { selectionTouchesHistory };
}
