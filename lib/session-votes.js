'use strict';

/* Vote secrecy while a session is still collecting votes (#209, widened in #655).

   `GET /api/rounds/:rid` ships every session's `votes` verbatim, and always did.
   That was harmless only while the hot-seat wizard kept every vote in a closure
   and POSTed the whole map at the end — there was simply nothing on the server to
   leak until the session was over.

   Since #655 there is no hot-seat mode: EVERY session collects each person's
   column the moment they submit it, from the lobby or through a shared vote link
   (#652). So the same untouched endpoint would hand the second voter the first
   voter's ratings — precisely what the handover screen's "don't peek" and the
   finale gate exist to prevent, delivered as JSON instead.

   So while a session is OPEN its vote VALUES are removed from the payload and
   only `votedIds` — who has already submitted — is left behind. That is exactly
   what the lobby needs to render "offen / abgestimmt" and nothing more. Once
   voting is closed (`done`) the full map goes out unchanged: that is the reveal,
   and every results/Chronik screen reads it.

   This used to be gated on a `deviceVoting` flag. Removing that condition made
   the redaction apply to every session rather than to an opt-in subset — one
   condition fewer, and it fails in the safe direction (it can only ever redact
   more, never less). */

// A session is open from the draw until someone closes voting. Cancelled counts
// as closed: nothing more will be collected, and a cancelled session's votes are
// already shown on its results screen.
//
// A direct-pick session (#532) is created `done: true` and so is never open —
// it has no voting phase at all, which is why this needs no mode check.
function isVotingOpen(session) {
  return !!session && !session.done && !session.cancelled;
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
// The output shape is `{ rating }` and nothing else, identically for a member
// and a guest. It carried a second `retire` key for members only between #797
// and #909, which is the whole of what the guest asymmetry here ever was; with
// the option gone there is no per-role branch left to get wrong. An entry with
// no valid rating is dropped rather than stored as an empty vote, so "submitted
// nothing" stays distinguishable from "has not voted" — which is what
// `votedPersonIds` above reads.
//
// It lives here rather than in lib/routes/sessions.js (its home until #652)
// because the public vote-link route now writes through the same path, and a
// second copy of these rules is how a link voter's column would quietly acquire
// a shape the in-app one refuses.
function sanitizePersonVotes(raw, session) {
  const drawn = new Set(session.gameIds || []);
  const out = {};
  Object.keys(raw && typeof raw === 'object' ? raw : {}).forEach((gid) => {
    if (!drawn.has(gid)) return;
    const v = raw[gid];
    if (!v || typeof v !== 'object') return;
    const n = Number(v.rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) return;
    out[gid] = { rating: n };
  });
  return out;
}

/* Normalise a LEGACY `/results` payload: no `retire` key may be stored (#909).
 *
 * That route is the pre-#655 hot-seat wizard's, kept alive only because the
 * service worker serves the shell cache-first — so a browser still holding a
 * bundle old enough to offer a retirement control can still POST one here. It
 * takes a member's column leniently (`z.unknown()`), which is why this is a
 * normaliser rather than a validator: the point is not to reject the request,
 * it is to make sure the vote survives in the shape the readers understand.
 *
 * Same mapping as the two data migrations, and it has to stay that way — a
 * retire-ONLY vote becomes the 1, because there the flag WAS the vote and
 * dropping it alone would silently delete the opinion; a flag beside a stored
 * rating just goes. `=== true` deliberately, matching the jsonb comparison the
 * Postgres side spells by hand: the STRING "true" was never a retirement.
 *
 * It replaced `dropGuestRetireFlags()`, which stripped the flag from GUEST
 * columns only (#458) while a member's was a legitimate vote. There is no such
 * thing as a legitimate one any more, so the per-role branch collapsed into
 * this. Delete it with the route.
 */
function normalizeLegacyVotes(votes) {
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(votes)) return votes;
  Object.values(votes).forEach((byGame) => {
    if (!isObj(byGame)) return;
    Object.values(byGame).forEach((v) => {
      if (!isObj(v) || !('retire' in v)) return;
      if (v.retire === true && !Number.isFinite(v.rating)) v.rating = 1;
      delete v.retire;
    });
  });
  return votes;
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
  normalizeLegacyVotes,
  sessionParticipantIds,
};
