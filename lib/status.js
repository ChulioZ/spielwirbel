'use strict';

/*
 * Instance metrics for the operator panel (issue #274, reshaped by #404).
 *
 * It began as a go-live checklist: "how is this instance ACTUALLY configured?",
 * so #219 could be verified from the app instead of by reading Railway's env-var
 * list. Go-live was executed on 2026-07-24 and every config row then answered
 * the same way on every deploy forever, so those rows are gone — pending
 * migrations, the deployed commit, built assets, mail degrading to the outbox,
 * the two secret-distinctness checks and the BGG token are back to being
 * diagnosed from Railway's env vars and logs.
 *
 * What replaced them is the opposite kind of number: the instance has been
 * publicly registrable since the go-live and there was no way to see how that is
 * going without opening a database console. trackEvent (#261) writes
 * round_created / session_created as log lines, but those are per-event,
 * searchable only in Railway, and have no historical backfill — they cannot
 * answer "how many accounts exist right now". A state count can.
 *
 * TWO RULES, both load-bearing and both older than the reshape:
 *
 * 1. NEVER return a secret — not in full, not truncated, not hashed-and-shown.
 *    Every field here is a number or a derived boolean. The panel is
 *    password-gated, not secret-cleared, and a screenshot of it must be
 *    harmless. test/status.test.js sweeps the whole serialized response for
 *    planted secret values, so a field added later that echoes one fails without
 *    anyone remembering to extend it. That the counts are aggregates is the same
 *    rule applied to personal data: no name, no address, no id.
 * 2. Read every value PER CALL, never at module load, so the answer describes
 *    the process as it is now and a test can drive it deterministically — the
 *    same reason lib/app.js reads its rate-limit ceilings and lib/admin.js its
 *    config per call (.claude/rules/security-middleware.md).
 *
 * Read-only by construction: there is no writer here and the panel offers no
 * editing. Env vars stay a deliberate Railway action.
 */

const quota = require('./quota');
const repo = require('./repo');
const demo = require('./demo');

async function instanceStatus() {
  // One reference instant for every time-dependent number, so the demo liveness
  // cut-off and the metrics' 7/30-day windows cannot describe two moments.
  const now = new Date().toISOString();

  return {
    // The ceilings are inert unless accounts are on
    // (.claude/rules/per-tenant-quotas.md), so `enforced` is the field that
    // matters — the numbers alone would read as protection that isn't there.
    // The panel pairs each ceiling with metrics.peaks (the highest value anyone
    // currently holds) so "is someone about to hit this?" is answerable.
    quotas: {
      enforced: quota.enforced(),
      roundsPerTenant: quota.roundsPerTenant(),
      gamesPerRound: quota.gamesPerRound(),
      tagsPerRound: quota.tagsPerRound(),
    },

    metrics: {
      ...await repo.instanceMetrics(now),
      // Assembled here rather than inside instanceMetrics: `live` must stay the
      // number the MAX_LIVE_DEMOS cap itself enforces (the same
      // countLiveDemoUsers predicate the mint checks), and a second liveness
      // definition in the repo could drift from it — the exact-complements
      // property .claude/rules/guest-demo-accounts.md relies on. Every other
      // metric EXCLUDES demo tenants; this row is the one that reports them.
      demo: { live: await repo.countLiveDemoUsers(now), max: demo.maxLiveDemos() },
    },
  };
}

module.exports = { instanceStatus };
