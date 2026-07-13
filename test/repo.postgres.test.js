'use strict';

/*
 * The data-access-layer contract against the PostgreSQL backend (issue #127).
 *
 * Runs only when DATABASE_URL is set (CI's Postgres service container, or a local
 * container) — otherwise every case is skipped, so plain `npm test` stays green
 * without a database. Selects the Postgres backend via the same DATABASE_URL the
 * app uses, ensures the schema, and starts from truncated tables so the shared
 * contract (test/support/repo-contract.js) sees a clean store.
 *
 * Run locally, e.g.:
 *   docker run -d -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:16
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres \
 *     node --test test/repo.postgres.test.js
 */

const { test, before, after } = require('node:test');

if (!process.env.DATABASE_URL) {
  test('postgres backend contract (skipped: set DATABASE_URL to run)', { skip: true }, () => {});
} else {
  const { Client } = require('pg');
  const repo = require('../lib/repo'); // DATABASE_URL is set -> Postgres backend

  before(async () => {
    await repo.init(); // ensure schema (idempotent)
    const c = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    await c.connect();
    await c.query('TRUNCATE rounds, members, games, sessions, activities CASCADE');
    await c.end();
  });

  // Release the pool so the test process can exit.
  after(async () => {
    await repo.end();
  });

  require('./support/repo-contract')(repo);
}
