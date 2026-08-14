'use strict';

/*
 * Background jobs (the seam specified in #427, and which #338 would have shared
 * before it was closed). One named job per entry; today only the demo purge.
 *
 * WHY THIS IS NOT WIRED IN lib/app.js. The test suite imports createApp() dozens
 * of times, and a timer started there would leave every one of those apps
 * holding an open handle — `node --test` would then hang after the last
 * assertion instead of exiting, which presents as a stuck CI run with no failing
 * test to point at. So server.js starts the scheduler, once, after
 * `await repo.init()`, and nothing else does.
 *
 * Two smaller properties, both deliberate:
 *
 *  - EACH JOB IS EXPORTED AND RUNNABLE DIRECTLY, so a test drives `runJob(name)`
 *    and asserts on the result rather than waiting on a timer. A job that can
 *    only be observed by sleeping is a job that ends up untested.
 *  - THE INTERVAL IS `unref()`ed, so a pending tick never keeps the process
 *    alive on its own. Combined with the boot-time run below, a deploy that
 *    restarts more often than the interval still purges every time it boots.
 *
 * Multi-replica note: production can run more than one instance (#215), and
 * then every replica runs this loop and they overlap. That is safe rather than
 * merely tolerated — the purge is idempotent (it re-reads what is expired each
 * tick, and eraseAccount on an already-erased id answers null, which the
 * caller skips), so a double sweep does the work once and no-ops the rest.
 */

const { logger } = require('./observability');
const demo = require('./demo');
const voteLink = require('./vote-link');
const prices = require('./prices');
const publicStats = require('./public-stats');
const corpus = require('./corpus');
const storage = require('./storage');

// How often the loop ticks. Long on purpose: every job here is a TTL sweep whose
// deadline is measured in hours (demos) or days (vote links), so a tighter
// interval would buy nothing and cost a database query per replica per tick.
//
// Nothing user-facing waits on a tick, which is what makes that safe: a demo is
// unusable the moment it expires because its tokens are rejected, an expired vote
// link is refused by the route's own gate, and a too-old stored price is refused
// by the fallback's own age check — all independently of when this sweep gets
// round to deleting the row.
const TICK_MS = 15 * 60 * 1000;

// name -> { enabled(), run() }. `enabled` is consulted per tick, never cached,
// so flipping the env var takes effect without a restart.
const JOBS = {
  purgeExpiredDemos: {
    enabled: () => demo.demoEnabled(),
    run: () => demo.purgeExpiredDemos(storage),
  },
  // Vote links past their TTL (#652). Always enabled — unlike the demo, there is
  // no env switch that can turn the feature off, so a row can always exist and
  // therefore always needs sweeping. The link stops WORKING at the same cutoff
  // via the route's own gate, so this job is the retention half only: it is what
  // makes docs/legal/retention.md's "deleted" true rather than aspirational.
  purgeExpiredVoteLinks: {
    enabled: () => true,
    run: () => voteLink.purgeExpiredVoteLinks(),
  },
  // Stored last-known prices past the age at which they may still be shown
  // (#688). Always enabled, for the reason the vote-link sweep is: rows written
  // while PRICES_ENABLED was on must still be cleaned up after it is switched
  // off, and gating this on the feature flag would strand them forever — with
  // docs/legal/retention.md still promising they go.
  purgeStoredPrices: {
    enabled: () => true,
    run: () => prices.purgeStoredPrices(),
  },
  // The public statistics payload (#564). Unlike the three sweeps above this is
  // not a TTL purge but a cache rebuild, and it is the one job whose `enabled()`
  // gates an OUTBOUND call: an instance that has not opted in makes no provider
  // request at all, rather than merely keeping the result unpublished.
  //
  // A tick interval measured in minutes is far finer than this needs — the
  // numbers move over days — but rebuilding costs one aggregate read plus at
  // most a handful of memoized provider hops, and sharing the existing loop is
  // cheaper than a second timer with its own cadence.
  rebuildPublicStats: {
    enabled: () => publicStats.publicStatsEnabled(),
    run: () => publicStats.rebuild(),
  },
  // Filling in the BGG corpus's per-game attributes (#681). Unlike every job
  // above it makes OUTBOUND requests as its whole purpose, so two properties
  // matter more here than elsewhere:
  //
  //  - it is BOUNDED PER TICK (BGG_CORPUS_BATCHES_PER_TICK batches of 20 ids),
  //    not "enrich everything". A 5000-game corpus is 250 requests; spending
  //    them over hours is what BGG's "few requests, not fast ones" asks for, and
  //    it means no single tick sits in a long outbound loop.
  //  - it does nothing at all without a token, rather than one query per tick
  //    discovering the same thing.
  //
  // Nothing user-facing waits on a tick here either: a not-yet-enriched row is
  // simply a row the consuming features have less to say about.
  enrichBggCorpus: {
    enabled: () => corpus.enrichEnabled(),
    run: () => corpus.enrich(),
  },
};

// Run one job by name, regardless of the tick loop. Returns the job's own result
// (or null when it is disabled), so a test can assert on what it did.
async function runJob(name) {
  const job = JOBS[name];
  if (!job) throw new Error(`Unknown scheduled job: ${name}`);
  if (!job.enabled()) return null;
  return job.run();
}

// One pass over every enabled job. A throwing job must not take the others down
// with it, nor kill the interval — so each is caught and logged individually.
async function tick() {
  for (const name of Object.keys(JOBS)) {
    try {
      await runJob(name);
    } catch (err) {
      logger.error({ event: 'scheduled_job_failed', job: name, err: err.message });
    }
  }
}

let timer = null;

function start() {
  if (timer) return timer;
  // Run once at boot as well as on the interval: a container that restarts more
  // often than TICK_MS would otherwise never reach a tick at all.
  tick().catch(() => {});
  timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  timer.unref();
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { JOBS, TICK_MS, runJob, tick, start, stop };
