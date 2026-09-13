/* Spielwirbel – which members of a round are still PLAYING (#1006).

   A retired member keeps every reference history holds — `votes[memberId]`,
   `winnerIds`, team lists, activity attribution — so `sessionPeople()`
   deliberately keeps resolving them and every past result stays byte-identical.
   What they leave is the PERSON-FACING, forward-looking surfaces: the session
   setup list, team building, the member strips, rankings, streaks and trophies.

   Its own tiny, dependency-free file so it can be the one definition those
   surfaces filter through — and so it is requirable from Node without dragging a
   view file into the coverage report
   (.claude/rules/frontend-helper-modules-and-coverage.md).

   NOT for resolving an id that history already holds: `memberHex` indexes into
   the FULL list (a filtered one would re-colour everyone after a retirement),
   the Chronik resolves actor ids, and the member page has to open for a retired
   member or there would be no way to bring them back. */

'use strict';

const memberIsActive = (m) => !!m && !m.retired;

// The members still playing, in round order.
const activeMembers = (round) => ((round && round.members) || []).filter(memberIsActive);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { memberIsActive, activeMembers };
}
