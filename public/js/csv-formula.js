/* Spielwirbel – the leading characters that make a spreadsheet read a CSV cell
   as a formula. Its own file so both CSV writers defuse the SAME set: the
   browser's round export (round-export.js) reads it as a shared-scope global
   and lib/csv.js (the operator's downloads) requires it. They were two
   identical regex literals, so widening one would have left the other open.
   OWASP's set; TAB and CR are included because both can lead a cell the same way.
   Dependency-free and tiny by design (.claude/rules/frontend-helper-modules-and-coverage.md). */

'use strict';

const CSV_FORMULA_LEAD = /^[=+\-@\t\r]/;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CSV_FORMULA_LEAD };
}
