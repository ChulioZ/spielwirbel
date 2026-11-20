/* Spielwirbel – the session result's PHASE (#1846): which moment of the
   evening the results screen is showing, so its columns can follow the phase
   instead of a fixed DOM split.

     deciding — nothing chosen yet (a voted session, a tie, a cancelled one, a
                lobby closed with nobody voting). One column: the ranking.
     table    — a game is chosen and not played yet. The evening's one action
                („Als gespielt markieren") lives in the aside, pinned.
     picking  — played, the winner picker open („Fertig" is the action).
     played   — played, picker closed: the record.
     solo     — a solo direct-play session, which has no ranking to show.

   Pure and dependency-free so a Node spec can require it; the DOM half
   (resultPlace, result-compose.js) reads it on every phase change. Part of the
   frontend; all files share one global script scope. */

const RESULT_PHASES = ['deciding', 'table', 'picking', 'played', 'solo'];

function resultPhaseOf({ chosenId, finished, cancelled, pickerOpen, solo }) {
  if (solo) return 'solo';
  if (cancelled || !chosenId) return 'deciding';
  if (!finished) return 'table';
  return pickerOpen ? 'picking' : 'played';
}

// The designs that draw the evening's column to the RIGHT of the ranking
// (T4.4, B4.3, P4.3). Klassisch, Ocean and Forest keep it on the left. The
// DOM order is the same for all six — head, aside, main — so this only moves
// the aside visually from the two-column width up, and a phone reads the band
// before the ranking in every design (#1846, defect 2).
const RESULT_ASIDE_END = ['tisch', 'bruecke', 'programmheft'];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RESULT_PHASES, RESULT_ASIDE_END, resultPhaseOf };
}
