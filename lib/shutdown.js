'use strict';

/*
 * Graceful shutdown — the SIGTERM/SIGINT handler server.js installs.
 *
 * WHY THIS EXISTS. Node's default action for SIGTERM is to terminate the
 * process immediately. Railway sends SIGTERM to the outgoing container on every
 * deploy (and this repo auto-deploys on push to main), so without a handler each
 * deploy cut whatever was in flight — a vote being submitted, a cover upload —
 * mid-response, and destroyed the knex pool by process death rather than by
 * draining it.
 *
 * WHY IT IS A FACTORY IN lib/ RATHER THAN INLINE IN server.js. server.js is the
 * one file that may call app.listen() (.claude/rules/automated-tests.md), so it
 * is also the one file no spec can require — anything written there is untested
 * by construction. Taking the collaborators as arguments lets the whole drain be
 * driven by doubles in test/shutdown.test.js without opening a port. Same shape,
 * and same reason, as createReadyz() in lib/observability.js.
 */

// How long to wait for the drain before giving up and exiting non-zero. Well
// under any platform's SIGTERM->SIGKILL grace so the process reports its own
// outcome instead of being killed mid-drain.
const DEFAULT_TIMEOUT_MS = 10_000;

// server.close() stops new connections and resolves once the in-flight ones have
// finished — which is the whole guarantee this module exists to buy.
//
// It deliberately does NOT also call server.closeIdleConnections(). That call
// reads as necessary (idle keep-alive sockets from Railway's edge would
// otherwise hold the drain open until the force-exit timer, on every deploy) and
// it is not: since Node 19, close() is documented to end connections "not
// sending a request or waiting for a response" itself, and this repo's floor is
// Node >=22. Measured on both node:22-slim (the production base image) and
// Node 26, with a genuinely open idle keep-alive socket: close() calls back in
// 0-1 ms either way. So the extra call is dead on every supported version — kept
// out rather than kept "just in case", because a line whose stated reason is
// fiction is worse than no line. Don't re-add it without re-measuring.
function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      // ERR_SERVER_NOT_RUNNING just means something else already closed it,
      // which is a successful outcome for a drain, not a failure.
      if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') reject(err);
      else resolve();
    });
  });
}

function createShutdown({ server, repo, scheduler, logger, timeoutMs = DEFAULT_TIMEOUT_MS, exit = process.exit }) {
  let draining = false;
  let finished = false;

  return async function shutdown(signal) {
    // A second signal (an impatient orchestrator, Ctrl-C twice) must not start a
    // parallel drain — repo.end() twice would reject on an already-destroyed pool
    // and turn a clean shutdown into a reported failure.
    if (draining) return;
    draining = true;
    logger.info({ event: 'shutdown_started', signal });

    // Bounded, so a wedged connection can delay the exit but never prevent it.
    const forced = setTimeout(() => {
      logger.warn({ event: 'shutdown_timeout', signal, timeoutMs });
      finish(1);
    }, timeoutMs);
    // Unref'd: once the drain is done this timer must not be the reason the
    // process is still alive.
    forced.unref();

    function finish(code) {
      if (finished) return;
      finished = true;
      clearTimeout(forced);
      exit(code);
    }

    try {
      // Stop first, so no new demo-purge tick starts against a pool that is
      // about to be destroyed. A tick already in flight is left to be cut short:
      // the purge is idempotent and re-runs at boot (lib/scheduler.js), so
      // waiting on it would buy nothing and could outlast the timeout.
      scheduler.stop();
      await closeServer(server);
      await repo.end();
      logger.info({ event: 'shutdown_complete', signal });
      finish(0);
    } catch (err) {
      logger.error({ event: 'shutdown_failed', signal, err: err.message });
      finish(1);
    }
  };
}

module.exports = { createShutdown, DEFAULT_TIMEOUT_MS };
