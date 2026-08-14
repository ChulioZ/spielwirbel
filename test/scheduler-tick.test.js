'use strict';

/*
 * The scheduler's tick loop (lib/scheduler.js) — specifically that two ticks
 * never run at once in one process.
 *
 * `setInterval` fires on a fixed cadence regardless of whether the previous
 * callback finished, so a tick that outlives TICK_MS gets a second one started
 * on top of it. That was harmless while every job was a fast TTL sweep, and
 * stopped being so once a job spends its time on OUTBOUND requests: overlapping
 * corpus passes read the same head of the enrichment queue and spend BGG's
 * patience twice for one batch of rows (#774).
 *
 * This is a PER-PROCESS guard and deliberately not more: two replicas still
 * overlap, which lib/scheduler.js's header explains is safe because every job
 * is idempotent. What the flag removes is one process racing itself, which
 * needs no coordination to fix.
 */

require('./helpers'); // side effects: an isolated DATA_DIR before the store loads

const { test } = require('node:test');
const assert = require('node:assert/strict');

const scheduler = require('../lib/scheduler');
const observability = require('../lib/observability');

// Make exactly one job live, running `run`, and hand back the undo. Every other
// job is switched off rather than left running: a tick is all-jobs-or-nothing,
// so a sweep of the real ones would make these cases depend on their timing.
function onlyJob(run) {
  const saved = Object.fromEntries(
    Object.entries(scheduler.JOBS).map(([name, job]) => [name, { enabled: job.enabled, run: job.run }]),
  );
  for (const job of Object.values(scheduler.JOBS)) job.enabled = () => false;
  const [first] = Object.keys(scheduler.JOBS);
  scheduler.JOBS[first].enabled = () => true;
  scheduler.JOBS[first].run = run;
  return () => {
    for (const [name, j] of Object.entries(saved)) Object.assign(scheduler.JOBS[name], j);
  };
}

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('a tick already in flight is SKIPPED rather than run on top of', async (t) => {
  let runs = 0;
  const gate = deferred();
  const restore = onlyJob(() => { runs += 1; return gate.promise; });
  const lines = [];
  const warn = observability.logger.warn.bind(observability.logger);
  observability.logger.warn = (obj) => { lines.push(obj); return warn(obj); };
  t.after(() => { restore(); observability.logger.warn = warn; });

  const first = scheduler.tick();
  // Not awaited above: the first tick is parked inside the job, which is exactly
  // the state setInterval would fire the second one into.
  //
  // The overlapping tick is RACED rather than awaited, and that is not caution
  // about flakiness — without the guard it joins the parked job and waits on a
  // gate this line has not reached yet, so a bare `await` deadlocks the suite.
  // A hang is a useless red: it names no assertion and wedges CI. Racing turns
  // the same failure into `'pending' !== false`.
  const overlapping = scheduler.tick();
  const outcome = await Promise.race([
    overlapping,
    new Promise((r) => { setTimeout(() => r('pending'), 50); }),
  ]);
  assert.equal(outcome, false, 'the overlapping tick reports it did nothing');
  assert.equal(runs, 1, 'the job ran once, not twice');
  // Logged rather than silently dropped — a tick that chronically overruns its
  // interval is a real condition (too many corpus batches per tick, say), and
  // the skip is the only place it is observable.
  assert.equal(lines.filter((l) => l.event === 'scheduled_tick_skipped').length, 1);

  gate.resolve();
  assert.equal(await first, true);
  await overlapping; // never left dangling, guard or no guard

  // The guard releases: the NEXT scheduled tick must run normally, or one long
  // pass would wedge the loop for the life of the process.
  const second = deferred();
  second.resolve();
  scheduler.JOBS[Object.keys(scheduler.JOBS)[0]].run = () => { runs += 1; return second.promise; };
  assert.equal(await scheduler.tick(), true);
  assert.equal(runs, 2);
});

test('a THROWING job still releases the guard', async (t) => {
  const restore = onlyJob(async () => { throw new Error('job exploded'); });
  t.after(restore);

  // tick() catches per job, so this resolves — the point is the flag, which a
  // guard written without `finally` would leave set forever on the first throw,
  // silently ending all scheduled work until the next deploy.
  assert.equal(await scheduler.tick(), true);
  assert.equal(await scheduler.tick(), true);
});
