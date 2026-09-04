/* Spielwirbel – what became of one session (#796).

   Until multi-table mode a session had two booleans and everything read them
   directly: `finished` meant played, `cancelled` meant nothing was played. A
   parent session that was SPLIT across several tables is neither — it holds a
   real vote, it was never played, and it is not an abandoned evening either.

   Adding a third boolean would have made two flags able to disagree with the
   child links, so the outcome is DERIVED instead: a session is `'split'`
   exactly when it carries child session ids, which is the same fact the screens
   render links from. One source of truth, nothing to keep in step.

   The reason this is a shared file rather than a line in a view: sixteen sites
   branch on `cancelled`, and every one of them fails SILENTLY when it meets a
   split parent — the Chronik would draw it with the played icon, the share text
   would describe an evening nobody played, the hub would offer to resume it.
   A predicate repeated at sixteen sites is the drift shape
   .claude/rules/active-games-filter-sites.md exists for.

   Pure and dependency-free, so it works both as a shared-scope frontend script
   and as a CommonJS module the server and the test suite require.
   Load order: see index.html — before core.js. */

'use strict';

// The children a split parent spawned, as a plain array. Absent means none, the
// same absent-key convention `guests` and `teams` use — a normal session grows
// no key at all, so its blob stays byte-identical across both backends
// (.claude/rules/postgres-backend.md).
function sessionChildIds(session) {
  const ids = session && session.childSessionIds;
  return Array.isArray(ids) ? ids : [];
}

// What became of this session: 'open' | 'played' | 'cancelled' | 'split'.
//
// `split` is tested FIRST, ahead of `cancelled`, and the order is load-bearing
// rather than arbitrary. The route refuses to cancel a session that already has
// children, so the combination cannot arise through the API — but a screen that
// says „Abgebrochen" while listing the three tables it spawned underneath is
// incoherent in a way that "split" never is. The children are a material fact
// (real sessions exist and point back at this one); `cancelled` is a flag.
function sessionOutcome(session) {
  if (!session) return 'open';
  if (sessionChildIds(session).length) return 'split';
  if (session.cancelled) return 'cancelled';
  if (session.finished) return 'played';
  return 'open';
}

// The one question most call sites actually ask.
function isSplitParent(session) {
  return sessionOutcome(session) === 'split';
}

// Did anybody vote at all (#915)?
//
// Not an outcome, but the same kind of question and the same failure shape. A
// direct-play session is created with `votes: {}` (`lib/routes/sessions.js`), so
// it reaches the results screen having asked nobody anything — and every
// vote-derived piece rendered its EMPTY state instead of being absent: six
// full-height distribution tracks all filled to 0px, a bare „–" where the score
// goes, and a Chronik line reading „1 Spiel bewertet" over zero votes. #890's
// empty rung is right ("an unvoted rung is an empty SLOT") and wrong here: it
// states something about a vote nobody was ever asked for.
//
// Derived from the votes the same screens tally, never stored, so no flag can
// drift away from them. A person entry with no game in it is somebody who was
// asked and never answered, which is still no vote.
function sessionHasVotes(session) {
  const votes = session && session.votes;
  if (!votes || typeof votes !== 'object') return false;
  return Object.values(votes).some(
    (byGame) => byGame && typeof byGame === 'object' && Object.keys(byGame).length > 0
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sessionChildIds, sessionOutcome, isSplitParent, sessionHasVotes };
}
