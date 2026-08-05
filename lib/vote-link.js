'use strict';

/* Vote-link expiry (#652). The logic half; `lib/routes/vote-link.js` applies the
   gate and `lib/scheduler.js` runs the sweep — the same split as lib/demo.js and
   its purge job, and for the same reason: a job that only a timer can reach is a
   job no test can drive.

   ## Why an age limit exists at all

   The five deletion points (voting closed, cancelled, session deleted, round
   deleted, account erased) all key off something *happening*. A session that is
   drawn, shared, and then simply abandoned — nobody closes it, the round stays,
   the account stays — hits none of them. `openBallot` refuses only `done` and
   `cancelled` sessions, so without this the link would keep working **forever**,
   and an abandoned draw is an ordinary thing (the Start tab renders a ticket for
   one).

   That made `docs/legal/retention.md`'s "deleted when voting ends" untrue for
   exactly that case, which is the reason this is a correctness fix rather than
   tidying: the published retention statement has to describe what actually
   happens.

   ## Why 30 days

   A vote link's useful life is one evening. #612's pre-meetup case stretches that
   to perhaps a week, so 30 days is an order of magnitude of headroom for any real
   group while keeping a forgotten link from staying live for months. Tunable per
   deployment, read per call like every other ceiling in this app
   (.claude/rules/security-middleware.md). */

const repo = require('./repo');

const DEFAULT_TTL_DAYS = 30;

function ttlDays() {
  const n = Number(process.env.VOTE_LINK_TTL_DAYS);
  // A zero or negative value would expire every link the instant it is minted,
  // i.e. silently disable the feature. Fall back rather than honour that.
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_DAYS;
}

// Links created before this instant are expired. Returned as an ISO string
// because that is how `createdAt` is stored in both backends, so the comparison
// is a plain lexicographic one — ISO-8601 UTC sorts chronologically as text.
function voteLinkCutoff(now = Date.now()) {
  return new Date(now - ttlDays() * 24 * 60 * 60 * 1000).toISOString();
}

// The GATE's half. A link with no `createdAt` at all counts as expired rather
// than as ageless: the field is written by both backends on every insert, so a
// row without one is malformed, and failing closed is the only safe reading for
// something whose whole job is to authorize a write.
function isVoteLinkExpired(link, now = Date.now()) {
  if (!link || !link.createdAt) return true;
  return link.createdAt < voteLinkCutoff(now);
}

// The SWEEP's half — the retention record's other end. Idempotent (it re-derives
// the cutoff each run and deletes what is already past it), which is what makes
// it safe for the overlapping processes a zero-downtime deploy produces, exactly
// like the demo purge (.claude/rules/guest-demo-accounts.md).
//
// Deleting a row here can never revoke access that the gate would still have
// granted: both read the same cutoff, so the sweep only ever removes rows the
// gate is already refusing.
async function purgeExpiredVoteLinks() {
  return repo.deleteExpiredSessionVoteLinks(voteLinkCutoff());
}

module.exports = { ttlDays, voteLinkCutoff, isVoteLinkExpired, purgeExpiredVoteLinks, DEFAULT_TTL_DAYS };
