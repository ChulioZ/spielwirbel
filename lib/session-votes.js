'use strict';

/* Vote secrecy for sessions that collect votes from more than one device (#209).

   The hot-seat wizard keeps every vote in a closure and POSTs the whole map in
   one request at the very end, so until a session is over there is simply
   nothing on the server to leak. Per-device voting breaks that property: each
   person's column is written the moment they submit it, while the session is
   still running and the others have not voted yet.

   That matters because `GET /api/rounds/:rid` ships every session's `votes`
   verbatim. Without this module the second voter's client would receive the
   first voter's ratings — precisely what the handover screen's "don't peek" and
   the finale gate exist to prevent, handed over in a JSON payload instead.

   So while such a session is OPEN its vote VALUES are removed from the payload
   and only `votedIds` — the set of people who have already submitted — is left
   behind. That is exactly what the lobby needs to render "offen / abgestimmt"
   and nothing more. Once voting is closed (`done`) the full map goes out
   unchanged: that is the reveal, and every existing results/Chronik screen
   reads it.

   Sessions without `deviceVoting` are untouched in every state, so the hot-seat
   path is byte-for-byte what it was. */

// A device-voting session is open from the draw until someone closes voting.
// Cancelled counts as closed: nothing more will be collected, and a cancelled
// session's votes are already shown on its results screen.
function isVotingOpen(session) {
  return !!(session && session.deviceVoting) && !session.done && !session.cancelled;
}

// Who has actually submitted. The hot-seat wizard seeds `votes[personId] = {}`
// for everyone up front, so presence of the key proves nothing — only a
// non-empty map means a person has voted. Getting this wrong would show every
// participant as done the instant the session started.
function votedPersonIds(session) {
  const votes = (session && session.votes) || {};
  return Object.keys(votes).filter((pid) => {
    const byGame = votes[pid];
    return !!byGame && typeof byGame === 'object' && Object.keys(byGame).length > 0;
  });
}

// Strip in-flight vote values from a round SNAPSHOT on its way to the client.
//
// Pure: returns a new object graph for the sessions it changes and leaves the
// input untouched. The repo's reads are documented as deep-cloned snapshots, so
// mutating in place would be safe today — but this runs on every round read, and
// a redactor that quietly edits the store if that ever changes is not a trade
// worth making for one avoided allocation.
function redactRoundVotes(round) {
  if (!round || !Array.isArray(round.sessions)) return round;
  if (!round.sessions.some(isVotingOpen)) return round;
  return {
    ...round,
    sessions: round.sessions.map((s) =>
      isVotingOpen(s) ? { ...s, votes: {}, votedIds: votedPersonIds(s) } : s
    ),
  };
}

module.exports = { isVotingOpen, votedPersonIds, redactRoundVotes };
