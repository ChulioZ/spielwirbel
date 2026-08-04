'use strict';

// Graceful shutdown (lib/shutdown.js) — the handler server.js installs on
// SIGTERM/SIGINT. Railway sends SIGTERM to the outgoing container on every
// deploy and Node's DEFAULT action is an immediate exit, so without this an
// in-flight request (a vote being submitted, a cover upload) is cut
// mid-response and the knex pool is never drained.
//
// Driven entirely through injected doubles: nothing here may open a port (see
// .claude/rules/automated-tests.md — only server.js listens), and a spec that
// waited on a real socket close would be timing-dependent for no added proof.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createShutdown } = require('../lib/shutdown');

// One shared array records the order across all four doubles — the ordering is
// the substance of most of these specs, not an incidental detail.
function harness({ close = 'ok', end = 'ok' } = {}) {
  const order = [];
  const exits = [];
  let onExit;
  const exited = new Promise((resolve) => { onExit = resolve; });

  // Note the double deliberately has NO closeIdleConnections(): close() already
  // ends idle keep-alive sockets on every Node this repo supports (see
  // lib/shutdown.js), so re-adding that call should fail here rather than pass
  // quietly as harmless redundancy.
  const server = {
    close(cb) {
      order.push('server.close');
      if (close === 'ok') setImmediate(() => cb());
      if (close === 'error') setImmediate(() => cb(new Error('close failed')));
      if (close === 'slow') setTimeout(() => { order.push('server.closed'); cb(); }, 20);
      // 'hang': never calls back — the case the timeout fallback exists for.
    },
  };
  const repo = {
    async end() {
      order.push('repo.end');
      if (end === 'error') throw new Error('pool destroy failed');
    },
  };
  const scheduler = { stop() { order.push('scheduler.stop'); } };
  const logged = [];
  const logger = {
    info: (f) => logged.push({ level: 'info', ...f }),
    warn: (f) => logged.push({ level: 'warn', ...f }),
    error: (f) => logged.push({ level: 'error', ...f }),
  };
  const exit = (code) => { exits.push(code); onExit(code); };

  return { order, exits, exited, logged, server, repo, scheduler, logger, exit };
}

const build = (h, opts = {}) => createShutdown({
  server: h.server,
  repo: h.repo,
  scheduler: h.scheduler,
  logger: h.logger,
  exit: h.exit,
  ...opts,
});

test('drains in order — scheduler, server, data backend — then exits 0', async () => {
  const h = harness();
  await build(h)('SIGTERM');

  assert.deepEqual(h.order, [
    // The scheduler stops FIRST so no new demo-purge tick can start against a
    // pool that is about to be destroyed.
    'scheduler.stop',
    'server.close',
    'repo.end',
  ]);
  assert.deepEqual(h.exits, [0]);
});

test('does not destroy the pool until in-flight requests have finished', async () => {
  // The point of the whole module: a request still being served when SIGTERM
  // lands must complete. server.close() is what waits for it, so the drain has
  // to AWAIT it — firing repo.end() alongside would destroy the connection the
  // in-flight handler is still querying on. A synchronous double cannot tell a
  // sequential await from a fire-and-forget, so this one calls back late.
  const h = harness({ close: 'slow' });
  await build(h)('SIGTERM');

  assert.deepEqual(h.order, ['scheduler.stop', 'server.close', 'server.closed', 'repo.end']);
});

test('a second signal is ignored while the first is still draining', async () => {
  const h = harness();
  const shutdown = build(h);

  await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

  assert.deepEqual(h.exits, [0], 'exit must fire exactly once');
  assert.equal(h.order.filter((c) => c === 'repo.end').length, 1, 'must not drain twice');
});

test('exits non-zero instead of hanging when the server never finishes closing', async () => {
  const h = harness({ close: 'hang' });
  build(h, { timeoutMs: 5 })('SIGTERM');

  // The force-exit timer is unref'd in production so it can never be the reason
  // a drained process lingers. In the real server the open socket and the pool
  // keep the loop alive so it still fires — but here every collaborator is a
  // double, so that timer is the ONLY pending work and the loop can empty
  // before it runs. Node's runner then reports "Promise resolution is still
  // pending but the event loop has already resolved" and cancels the REST of
  // the file, which reads as four unrelated failures. Hold the loop open for
  // the wait. (Green on this machine, red on all three CI Node versions.)
  const keepAlive = setInterval(() => {}, 1000);
  const code = await h.exited;
  clearInterval(keepAlive);

  assert.equal(code, 1);
  assert.ok(
    h.logged.some((l) => l.level === 'warn' && l.event === 'shutdown_timeout'),
    'the forced exit must be logged, not silent',
  );
});

test('exits non-zero when the data backend fails to close', async () => {
  const h = harness({ end: 'error' });
  await build(h)('SIGTERM');

  assert.deepEqual(h.exits, [1]);
  assert.ok(h.logged.some((l) => l.level === 'error' && l.event === 'shutdown_failed'));
});

test('does not force-exit after a clean shutdown', async () => {
  const h = harness();
  await build(h, { timeoutMs: 5 })('SIGTERM');

  // The timeout timer must be cleared, or a process that drained cleanly gets a
  // spurious exit(1) a moment later — which on Railway reads as a crash loop.
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(h.exits, [0]);
});

test('records the signal it is shutting down for', async () => {
  const h = harness();
  await build(h)('SIGINT');

  const started = h.logged.find((l) => l.event === 'shutdown_started');
  assert.ok(started, 'shutdown must be observable in the logs');
  assert.equal(started.signal, 'SIGINT');
});
