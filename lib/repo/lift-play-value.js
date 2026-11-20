'use strict';

/* What one Discover-lift play is worth (#1838), shared by both repo backends.

   A play is a pick (`PICK_VALUE`) unless the table said „Wie war's?"; then
   each verdict replaces its seat's share (`playValue`, public/js/vote-score.js).
   Valued through `playEvidence` itself over a one-session round, so the public
   podium and the Regal cannot come to disagree about what a play with verdicts
   is worth. `round` needs only `members` (ids), which is all sessionPeople
   reads to decide who sat at the table. */

const { PICK_VALUE, playEvidence } = require('../../public/js/vote-score');
const { sessionPeople } = require('../../public/js/session-people');

function liftPlayValue(round, session) {
  if (!session || !session.chosenGameId) return PICK_VALUE;
  const ev = playEvidence({ members: (round && round.members) || [], sessions: [session] }, sessionPeople);
  const e = ev.get(session.chosenGameId);
  return e ? e.sum : PICK_VALUE;
}

module.exports = { liftPlayValue, PICK_VALUE };
