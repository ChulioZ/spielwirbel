'use strict';

/*
 * The moderation log's 3-year retention purge (#311, deciding #140's promise).
 *
 * The published privacy policy (§12, lib/legal.js) and docs/legal/vvt.md row 10
 * promise that moderation-log entries holding personal data — e-mail addresses,
 * redacted-text `previous` evidence — are deleted THREE YEARS AFTER THE END OF
 * THE YEAR of the action (§§ 195, 199 BGB, the #140 operator decision). Until
 * this shipped that promise was kept by a documented manual January review with
 * no tooling behind it, and a compliance step that fires once a year is exactly
 * the kind that gets missed — at which point the published statement becomes a
 * false one (Art. 5(1)(e), Art. 13(2)(a) DSGVO).
 *
 * WHY THIS DOES ALMOST NOTHING UNTIL 2030. The year-end scheme means the
 * earliest entries that can ever expire are 2026's, and they become deletable on
 * 2030-01-01. So every run before then deletes zero rows by construction. That
 * is the point rather than a defect: the job is wired, exercised and observable
 * now, so nothing has to be remembered in four years' time.
 */

const repo = require('./repo');
const { logger } = require('./observability');

// Entries dated before January 1 (UTC) of the current year minus three are
// deletable. Fixed by #140, not a knob: a run during 2030 purges everything
// dated before 2027-01-01.
const RETENTION_YEARS = 3;

function moderationLogCutoff(now = Date.now()) {
  const year = new Date(now).getUTCFullYear() - RETENTION_YEARS;
  return new Date(Date.UTC(year, 0, 1)).toISOString();
}

/* One sweep. Idempotent — it re-derives the cutoff each run and deletes what is
 * already past it — which is what makes it safe for the overlapping processes a
 * zero-downtime deploy produces, exactly like the demo and vote-link sweeps.
 *
 * THE AUDIT RECORD IS WRITTEN ONLY WHEN SOMETHING WAS DELETED, and that is a
 * deliberate narrowing of the issue, which also asked for one on "the very first
 * run, so there is evidence the job is wired at all". That made sense against
 * the boot-time job the issue imagined; against the 15-minute scheduler this
 * actually joined it would write one entry per deploy — tens per year, in the
 * one log an operator reads by hand, for a job that will do nothing until 2030.
 * A list people learn to scroll past is worse than no list, the same argument
 * `news.js` makes for its own budget.
 *
 * The evidence that it is wired is the pino line below, emitted every run. It is
 * what docs/legal/retention.md's January review now points at for the years
 * before the first real deletion.
 *
 * The record carries COUNTS AND DATES ONLY, never personal data — it has to be
 * safely displayable in the panel and safely purgeable by this very job.
 */
async function purgeModerationLog(now = Date.now()) {
  const cutoff = moderationLogCutoff(now);
  const deleted = await repo.purgeModerationLog(cutoff);
  logger.info({ event: 'retention_purge_ran', scope: 'moderation_log', cutoff, deleted });
  if (deleted > 0) {
    await repo.logModeration({
      action: 'retention_purge',
      target: 'moderation_log',
      reason: `${deleted} entries dated before ${cutoff} deleted`,
      at: new Date(now).toISOString(),
      tenantId: null,
    });
  }
  return deleted;
}

module.exports = { RETENTION_YEARS, moderationLogCutoff, purgeModerationLog };
