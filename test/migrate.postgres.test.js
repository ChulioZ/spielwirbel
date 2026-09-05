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

  /* ---------------------------------------------------------------- #909 --
     The retire-vote data migration (20260905120000_drop_retire_votes).

     Driven by calling the migration's `up()` DIRECTLY rather than through
     `migrate.latest()`, which has already run by the time this file boots: the
     rewrite has to be re-runnable anyway (a row written by the still-serving
     previous container during a zero-downtime deploy is exactly the case), so
     exercising it that way is both the honest test and the cheaper one.

     This is the one part of the file that WRITES to the round tables, under a
     tenant id of its own. `test/repo.postgres.test.js` truncates them, and CI
     runs the two files with --test-concurrency=1, so the two never overlap. */
  const dropRetireVotes = require('../lib/repo/migrations/20260905120000_drop_retire_votes');
  const knex = require('knex')(require('../knexfile'));
  const T = 'mig909';

  const seed = async (votes) => {
    const rid = `r-${T}-${Math.random().toString(36).slice(2, 10)}`;
    const sid = `s-${rid}`;
    await knex.raw('INSERT INTO rounds (id, tenant_id, name) VALUES (?, ?, ?)', [rid, T, 'M']);
    await knex.raw('INSERT INTO sessions (id, round_id, tenant_id, data) VALUES (?, ?, ?, ?)', [
      sid, rid, T, JSON.stringify({ id: sid, gameIds: ['g1'], done: true, votes }),
    ]);
    return sid;
  };
  const votesOf = async (sid) =>
    (await knex.raw(`SELECT data->'votes' AS v FROM sessions WHERE id = ?`, [sid])).rows[0].v;

  after(async () => {
    await knex.raw('DELETE FROM rounds WHERE tenant_id = ?', [T]);
    await knex.destroy();
  });

  test('the migration rewrites both legacy vote shapes and leaves no retire key', async () => {
    const sid = await seed({
      ann: { g1: { rating: 5, retire: false } },
      // Retire-only: the flag WAS the vote, so dropping it alone would delete
      // the opinion. It becomes the 1 — the bottom of the surviving scale.
      bo: { g1: { rating: null, retire: true } },
      // The legacy contradiction (#797 let retirement win). The stored rating
      // is kept: with the shelf signal gone it is the only opinion in the row,
      // which deliberately REVERSES the old precedence.
      cy: { g1: { rating: 4, retire: true } },
      // `retire` as the STRING "true" — never `=== true`, so it was never a
      // retirement. It keeps its (absent) rating and just loses the key.
      dee: { g1: { rating: null, retire: 'true' } },
    });

    await dropRetireVotes.up(knex);

    assert.deepEqual(await votesOf(sid), {
      ann: { g1: { rating: 5 } },
      bo: { g1: { rating: 1 } },
      cy: { g1: { rating: 4 } },
      dee: { g1: { rating: null } },
    });
  });

  test('the migration is re-runnable and leaves clean rows untouched', async () => {
    const clean = await seed({ ann: { g1: { rating: 3 } } });
    const legacy = await seed({ bo: { g1: { rating: null, retire: true } } });
    await dropRetireVotes.up(knex);
    await dropRetireVotes.up(knex);
    assert.deepEqual(await votesOf(clean), { ann: { g1: { rating: 3 } } });
    assert.deepEqual(await votesOf(legacy), { bo: { g1: { rating: 1 } } });
  });

  test('malformed vote blobs are stepped over, not thrown on', async () => {
    // jsonb_each ERRORS on a non-object, so an unguarded rewrite would take the
    // whole migration — and therefore the deploy — down over one bad row.
    const weird = await seed({ ann: 'not-an-object', bo: { g1: 7 } });
    const empty = await seed({});
    await assert.doesNotReject(() => dropRetireVotes.up(knex));
    assert.deepEqual(await votesOf(weird), { ann: 'not-an-object', bo: { g1: 7 } });
    assert.deepEqual(await votesOf(empty), {});
  });

  test('a session with no votes key at all survives the rewrite', async () => {
    const rid = `r-${T}-novotes`;
    await knex.raw('INSERT INTO rounds (id, tenant_id, name) VALUES (?, ?, ?)', [rid, T, 'M']);
    await knex.raw('INSERT INTO sessions (id, round_id, tenant_id, data) VALUES (?, ?, ?, ?)', [
      `s-${rid}`, rid, T, JSON.stringify({ id: `s-${rid}`, gameIds: [] }),
    ]);
    await assert.doesNotReject(() => dropRetireVotes.up(knex));
    const row = (await knex.raw('SELECT data FROM sessions WHERE id = ?', [`s-${rid}`])).rows[0].data;
    assert.deepEqual(row, { id: `s-${rid}`, gameIds: [] });
  });

  test('the migration REFUSES to finish when the rewrite changed nothing', async () => {
    /* The verification is the whole reason this migration cannot silently do
       nothing (.claude/rules/rls-blocks-data-migrations.md), so it needs a guard
       of its own — otherwise it is a check nobody has watched fail, in a file
       whose entire subject is checks that pass while doing nothing.

       Driven by handing `up()` a knex whose `raw` swallows just the UPDATE, so
       the real predicate runs against real rows with the rewrite disabled. That
       is the exact production failure: RLS filters the UPDATE to zero rows while
       everything else succeeds. */
    const sid = await seed({ bo: { g1: { rating: null, retire: true } } });
    const blind = {
      raw: (sql, bindings) =>
        (/^\s*UPDATE sessions/.test(sql) ? Promise.resolve({ rowCount: 0 }) : knex.raw(sql, bindings)),
    };

    await assert.rejects(() => dropRetireVotes.up(blind), /still carry a retire flag/);

    // The row is untouched (the whole migration rolls back with the throw in
    // production), and FORCE is back even on the failure path.
    assert.deepEqual(await votesOf(sid), { bo: { g1: { rating: null, retire: true } } });
    const r = await knex.raw(`SELECT relforcerowsecurity AS f FROM pg_class WHERE relname = 'sessions'`);
    assert.equal(r.rows[0].f, true);

    await dropRetireVotes.up(knex);   // and the real one still cleans it up
    assert.deepEqual(await votesOf(sid), { bo: { g1: { rating: 1 } } });
  });

  test('FORCE ROW LEVEL SECURITY is restored on sessions afterwards', async () => {
    // The rewrite is cross-tenant by nature, so it lifts FORCE for the duration
    // (see the migration's header). Leaving it lifted would silently disable the
    // tenant-isolation layer for the owner role the app connects as — the one
    // failure here that no test elsewhere could see.
    await dropRetireVotes.up(knex);
    const r = await knex.raw(`SELECT relforcerowsecurity AS f FROM pg_class WHERE relname = 'sessions'`);
    assert.equal(r.rows[0].f, true);
  });
}
