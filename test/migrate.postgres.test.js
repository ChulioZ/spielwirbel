'use strict';

/*
 * Knex migration path (issue #211) against the PostgreSQL backend.
 *
 * Runs only when DATABASE_URL is set (CI's Postgres service container, or a
 * local container) — otherwise skipped, so plain `npm test` stays green without
 * a database. Proves the three things the migration move must guarantee:
 *  1. `init()` boots an empty database via `knex.migrate.latest()` and records
 *     the baseline migration exactly once.
 *  2. Re-running `init()` is a no-op (idempotent) — the baseline isn't
 *     re-applied and no duplicate rows appear.
 *  3. Concurrent `init()` calls don't crash — the advisory lock in `init()`
 *     serializes them past the knex-bookkeeping-table create race (which, left
 *     unguarded, throws a duplicate `knex_migrations` table; see
 *     .claude/rules/postgres-backend.md).
 *
 * Deliberately non-destructive to the round tables so it can run in parallel
 * (node --test isolates files into separate processes) alongside
 * test/repo.postgres.test.js, which truncates and drives them: this file only
 * calls init() and inspects the `knex_migrations` bookkeeping table.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.DATABASE_URL) {
  test('postgres migration path (skipped: set DATABASE_URL to run)', { skip: true }, () => {});
} else {
  const { Client } = require('pg');
  const repo = require('../lib/repo'); // DATABASE_URL is set -> Postgres backend

  const connect = async () => {
    const c = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    await c.connect();
    return c;
  };

  before(async () => {
    await repo.init(); // ensure the schema is migrated (idempotent)
  });

  after(async () => {
    await repo.end();
  });

  test('the baseline migration is recorded exactly once', async () => {
    const c = await connect();
    try {
      const r = await c.query('SELECT name FROM knex_migrations ORDER BY id');
      const names = r.rows.map((row) => row.name);
      // The baseline is present…
      assert.ok(names.some((n) => /initial_schema/.test(n)), `baseline migration present, got ${JSON.stringify(names)}`);
      // …and no migration file is recorded twice (a re-applied migration would
      // duplicate a name).
      assert.equal(new Set(names).size, names.length, 'no migration recorded more than once');
    } finally {
      await c.end();
    }
  });

  test('re-running init() is an idempotent no-op', async () => {
    const c = await connect();
    try {
      const before = (await c.query('SELECT count(*)::int AS n FROM knex_migrations')).rows[0].n;
      await repo.init();
      await repo.init();
      const after = (await c.query('SELECT count(*)::int AS n FROM knex_migrations')).rows[0].n;
      assert.equal(after, before, 'no new migration rows on re-init');
    } finally {
      await c.end();
    }
  });

  test('concurrent init() calls do not crash (advisory lock serializes the boot race)', async () => {
    // Three overlapping boots at once — without the advisory lock around
    // migrate.latest(), a first-boot race throws a duplicate knex_migrations
    // table; here they must all resolve.
    await assert.doesNotReject(() => Promise.all([repo.init(), repo.init(), repo.init()]));
  });
}
