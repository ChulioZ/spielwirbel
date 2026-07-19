'use strict';

/*
 * Knex configuration (issue #211) — the ONE source of truth shared by:
 *   - the app's Postgres backend (lib/repo/postgres.js requires this and builds
 *     its knex instance from it), and
 *   - the Knex CLI (`npm run migrate` / `migrate:make` / `migrate:rollback`),
 *     which looks for ./knexfile.js by default.
 *
 * Connection tuning mirrors the pre-Knex `pg.Pool` (see the comments below):
 * TLS opt-in via DATABASE_SSL, TCP keep-alive, and a warm pool so a sporadic
 * hosted deploy isn't paying fresh TCP+auth on every burst. Note tarn (Knex's
 * pool) does NOT share pg.Pool's `idleTimeoutMillis: 0 == never evict` meaning
 * (0 would reap aggressively), so warmth is kept via min>0 + a long idle
 * timeout instead.
 */

const path = require('path');

module.exports = {
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    // Managed Postgres usually needs TLS; opt in with DATABASE_SSL=true (the CI
    // service container and local dev containers don't). Over a private network
    // (e.g. Railway's) leave it off — the handshake is pure per-connection cost.
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    // Keep pooled connections warm (TCP keep-alive) so a hosted DB / proxy is
    // less likely to drop them idle, which would force a slow reconnect.
    keepAlive: true,
  },
  pool: {
    min: 2,
    max: 10,
    // The app's traffic is sporadic bursts; reconnecting per burst adds real
    // latency to a hosted Postgres. Keep a couple of connections always warm
    // (min) and don't reap burst connections for a while (30 min) — the intent
    // of the old pool's "never evict", expressed in tarn's terms.
    idleTimeoutMillis: 30 * 60 * 1000,
    // Attach a logging error listener to every raw connection so a server/proxy
    // killing an idle connection is logged and discarded, never an unhandled
    // 'error' that crashes the process (the old pool.on('error') behaviour).
    afterCreate: (conn, done) => {
      conn.on('error', (err) => {
        require('./lib/observability').logger.warn({ event: 'pg_pool_idle_error', message: err.message });
      });
      done(null, conn);
    },
  },
  migrations: {
    // Absolute so the CLI and the app resolve the same dir regardless of cwd.
    directory: path.join(__dirname, 'lib', 'repo', 'migrations'),
    tableName: 'knex_migrations',
  },
};
