'use strict';

/* „Wie war's?" verdicts on a session blob (#1838) — the two mutations both repo
   backends run inside their session lock, written once so the JSON and the
   Postgres blob cannot come to differ.

   Shape: `session.verdicts[personId][gameId] = { rating }`, an ABSENT key when
   there are none, so a session nobody gave a verdict on stays byte-identical to
   one written before the feature (the `durationMinutes` convention). Kept apart
   from `votes` on purpose: votes drive the result, the tally, the vote weights
   and the share stages, none of which may move after the fact. */

// Set, replace or clear (rating === null) one person's verdict on one game.
// Prunes empty maps on the way out, so clearing the last verdict removes the key.
function setVerdict(s, personId, gameId, rating) {
  const all = s.verdicts && typeof s.verdicts === 'object' ? s.verdicts : {};
  const own = { ...(all[personId] && typeof all[personId] === 'object' ? all[personId] : {}) };
  if (rating == null) delete own[gameId];
  else own[gameId] = { rating };
  const next = { ...all };
  if (Object.keys(own).length) next[personId] = own;
  else delete next[personId];
  if (Object.keys(next).length) s.verdicts = next;
  else delete s.verdicts;
}

// A game leaving a session takes its verdicts with it, as it takes its votes.
function dropVerdicts(s, gameIds) {
  if (!s.verdicts || typeof s.verdicts !== 'object') return;
  for (const pid of Object.keys(s.verdicts)) {
    for (const gid of gameIds) setVerdict(s, pid, gid, null);
  }
}

module.exports = { setVerdict, dropVerdicts };
