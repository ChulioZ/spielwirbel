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

// Sanitize ONE person's column for a per-device write (#209).
//
// Deliberately stricter than the hot-seat `/results` path, which the data layer
// takes leniently: that one arrives from a closure the wizard just filled, while
// this is called once per person, mid-session, by whichever device that person is
// holding. So it keeps only games this session actually drew — a vote for a game
// that was never on the table would otherwise land in `gameStats()` and move a
// rating average that no screen can explain.
//
// The output shape matches the hot-seat path exactly, guests included: a member
// entry carries `{ rating, retire }`, a guest entry only `{ rating }` — the same
// asymmetry `dropGuestRetireFlags()` produces in the route, for the same reason
// (#458). An entry with neither a rating nor a flag is dropped rather than stored
// as an empty vote, so "submitted nothing" stays distinguishable from "has not
// voted" — which is what `votedPersonIds` above reads.
//
// It lives here rather than in lib/routes/sessions.js (its home until #652)
// because the public vote-link route now writes through the same path, and a
// second copy of these rules is how a link voter's column would quietly acquire
// a retire flag the in-app one refuses.
function sanitizePersonVotes(raw, session, personId) {
  const isGuest = (session.guests || []).some((g) => g.id === personId);
  const drawn = new Set(session.gameIds || []);
  const out = {};
  Object.keys(raw && typeof raw === 'object' ? raw : {}).forEach((gid) => {
    if (!drawn.has(gid)) return;
    const v = raw[gid];
    if (!v || typeof v !== 'object') return;
    const n = Number(v.rating);
    const rating = Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
    const retire = !isGuest && v.retire === true;
    if (rating === null && !retire) return;
    out[gid] = isGuest ? { rating } : { rating, retire };
  });
  return out;
}

// Who may have a column written for them: the members who joined plus this
// session's guests. Shared for the same reason as the sanitizer — the public
// route must admit exactly the people the in-app one does, no more.
function sessionParticipantIds(session) {
  const joined = new Set(session.memberIds || []);
  (session.guests || []).forEach((g) => joined.add(g.id));
  return joined;
}

module.exports = {
  isVotingOpen,
  votedPersonIds,
  redactRoundVotes,
  sanitizePersonVotes,
  sessionParticipantIds,
};
