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
 * Multi-replica note: production runs more than one instance (#215), so every
 * replica runs this loop and they overlap. That is safe rather than merely
 * tolerated — the purge is idempotent (it re-reads what is expired each tick,
 * and eraseAccount on an already-erased id answers null, which the caller
 * skips), so a double sweep does the work once and no-ops the rest.
 */

const { logger } = require('./observability');
const demo = require('./demo');
const storage = require('./storage');

// How often the loop ticks. Long on purpose: the only job is a TTL sweep whose
// deadline is measured in hours, so a tighter interval would buy nothing and
// cost a database query per replica per tick.
const TICK_MS = 15 * 60 * 1000;

// name -> { enabled(), run() }. `enabled` is consulted per tick, never cached,
// so flipping the env var takes effect without a restart.
const JOBS = {
  purgeExpiredDemos: {
    enabled: () => demo.demoEnabled(),
    run: () => demo.purgeExpiredDemos(storage),
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
