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

/* How a played session ENDED when nobody won (#1038).

   `finished: true` plus an empty `winnerIds` used to be the ONLY way to say
   "no winner", and nine screens read it as "not recorded yet" — the Loose Ends
   card listed a lost coop night as a gap to fix forever, the results title said
   „wurde gespielt." and stopped there. Three things happen all the time and had
   no representation: the table lost, the game is not about winning, and the
   campaign session is over while the campaign is not.

   ONE stored key with three values rather than three booleans, for the reason
   `split` is derived above: two flags can disagree, one field cannot. The
   invariant against `winnerIds` is the other half — a session has winners, or
   an ending, or neither, never both — and it is enforced at the route (400) as
   well as here, where winners simply outrank a stored ending so a hand-crafted
   blob still renders something coherent.

   An ALLOWLIST, not a denylist: an unknown value reads as `unrecorded` rather
   than reaching a render site that has no icon and no label for it. */
const ENDINGS = ['lost', 'noWinner', 'ongoing'];

// For a PLAYED session: 'won' | 'lost' | 'noWinner' | 'ongoing' | 'unrecorded'.
// null for every other outcome — an open, cancelled or split session did not
// come to an end that this question is about, and a caller that renders the
// answer blindly must get nothing rather than „Gespielt – ohne Sieger".
//
// The one question every render site asks, for the same reason `sessionOutcome`
// is: a site that branches on `winnerIds.length` itself fails silently the day
// an ending exists, which is exactly what this file's header describes
// happening to `cancelled`.
function sessionEnding(session) {
  if (sessionOutcome(session) !== 'played') return null;
  if ((session.winnerIds || []).length) return 'won';
  return ENDINGS.includes(session.ending) ? session.ending : 'unrecorded';
}

/* What each ending is CALLED and what it looks like — the `session-log.js`
   shape (one map from a stored value to the i18n key that phrases it), for the
   same reason: five screens render a finished session in one line, and an
   ending with no phrase renders as nothing at all.

   The `ti-mood-*` faces are deliberately not reused — they are the vote scale,
   and a skull beside a 1-star face would read as a rating. All three codepoints
   were taken from the bundled woff2's own cmap
   (.claude/rules/tabler-icon-codepoints.md). */
const ENDING_LABELS = {
  lost: { key: 'sessions.endLost', icon: 'ti-skull', title: 'result.titleLost', line: 'result.endedLost' },
  noWinner: { key: 'sessions.endNoWinner', icon: 'ti-scale', title: 'result.titleNoWinner', line: 'result.endedNoWinner' },
  ongoing: { key: 'sessions.endOngoing', icon: 'ti-player-track-next', title: 'result.titleOngoing', line: 'result.endedOngoing' },
};

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
  module.exports = {
    sessionChildIds, sessionOutcome, isSplitParent, sessionHasVotes, sessionEnding, ENDINGS, ENDING_LABELS,
  };
}
