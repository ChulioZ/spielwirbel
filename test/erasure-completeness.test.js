'use strict';

/*
 * Art. 17 / Art. 15 / Art. 20 completeness (#1036, criterion L-013).
 *
 * `eraseAccount` and `exportAccountData` name the global, non-RLS stores ONE AT
 * A TIME — `round_grants`, `invitations`, `inbox`, `friendships`, `feed_events`,
 * `session_vote_links` — and nothing derives the true table list to diff against
 * either. Add a seventh global table (the repo has added five since the initial
 * schema) and the miss is total silence: no error, no red test, an erasure that
 * reports success while leaving rows behind, and an export that under-answers an
 * Art. 15 request.
 *
 * WHY THIS DERIVES THE TABLES FROM A LIVE DATABASE RATHER THAN SCANNING THE
 * MIGRATIONS. The migrations create tables through `knex.raw` with raw
 * `CREATE TABLE` SQL, so a scan over those files enumerates a string pattern
 * rather than a schema — and would be invisible the day somebody writes one
 * through `knex.schema.createTable`, or adds a table from a `DO $$` block. The
 * `postgres` CI job already runs against a real migrated database, so
 * `information_schema` is the cheaper and stricter source.
 *
 * The classification is derived too: a table carrying `tenant_id` is reached by
 * the `rounds` cascade inside the tenant `tx`; one without it is global and must
 * be disposed of explicitly.
 *
 * NAMED FOR WHAT IT COVERS, not for a module — there is no `erasure.js`
 * anywhere, so this cannot silently overwrite another spec
 * (.claude/rules/test-file-names-collide-silently.md).
 *
 * Run locally, e.g.:
 *   docker run -d -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:18
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres \
 *     node --test test/erasure-completeness.test.js
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

/*
 * WHAT EACH GLOBAL TABLE'S DISPOSITION IS, and WHY.
 *
 * This map is the hand-maintained half and it is meant to be: the point is not
 * to avoid writing a list, it is that a table MISSING from the list fails
 * loudly instead of defaulting to "fine". Every entry states a reason, the way
 * `test/token-budget.test.js`'s allowlist does
 * (.claude/rules/shared-constants-across-the-stack.md's inventory discipline).
 *
 *   erase  — `eraseAccount` must remove this account's rows. Checked
 *            BEHAVIOURALLY below, not by reading the source.
 *   export — `exportAccountData` must answer with a key for it.
 *   why    — required for anything that is not both.
 */
const GLOBAL_DISPOSITION = {
  users: {
    erase: true,
    export: false,
    why: 'the account row itself: erased last, and the export is OF this account — '
      + 'the route serializes the profile from its own read, not from this table',
  },
  round_grants: { erase: true, export: true },
  invitations: { erase: true, export: true },
  inbox: { erase: true, export: true },
  friendships: { erase: true, export: true },
  feed_events: { erase: true, export: true },
  session_vote_links: {
    erase: true,
    export: false,
    why: 'a LIVE capability token (#652). Erased like everything else, but writing '
      + 'one into a data export would hand the requester a working credential in a '
      + 'file they are about to email themselves',
  },
  moderation_log: {
    erase: false,
    export: false,
    why: 'operator data ABOUT tenants, deliberately outliving erasure — the record '
      + 'that a takedown happened is the legal basis for having acted (see the '
      + 'comment above the erase route in lib/routes/admin.js) and is retained '
      + 'for three years (docs/legal/retention.md)',
  },
  feedback: {
    erase: false,
    export: false,
    why: 'a message addressed to the operator, stored without a user id — the '
      + 'optional reply address is the submitter\'s own opt-in and is deleted '
      + 'through the operator inbox (#272), not through account erasure',
  },
  contact_notices: {
    erase: false,
    export: false,
    why: 'DSA notice-and-action records, same shape as moderation_log: no user id, '
      + 'and the record of a notice must survive the account it was about',
  },
  bgg_corpus: { erase: false, export: false, why: 'third-party game metadata; holds no personal data' },
  bgg_corpus_meta: { erase: false, export: false, why: 'ingest bookkeeping; holds no personal data' },
  last_prices: { erase: false, export: false, why: 'cached third-party prices per game; holds no personal data' },
};

// knex's own bookkeeping is not a store of ours at all.
const NOT_A_STORE = (name) => /^knex_/.test(name);

if (!process.env.DATABASE_URL) {
  test('erasure/export completeness (skipped: set DATABASE_URL to run)', { skip: true }, () => {});
} else {
  const { Client } = require('pg');
  const repo = require('../lib/repo'); // DATABASE_URL is set -> Postgres backend

  let client;
  let tables; // [{ name, tenantScoped }]

  before(async () => {
    await repo.init();
    client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    await client.connect();
    const { rows } = await client.query(`
      SELECT t.tablename AS name,
             EXISTS (SELECT 1 FROM information_schema.columns c
                      WHERE c.table_schema = 'public'
                        AND c.table_name = t.tablename
                        AND c.column_name = 'tenant_id') AS tenant_scoped
        FROM pg_tables t
       WHERE t.schemaname = 'public'
       ORDER BY t.tablename`);
    tables = rows
      .filter((r) => !NOT_A_STORE(r.name))
      .map((r) => ({ name: r.name, tenantScoped: r.tenant_scoped }));

    /* Start from empty. The counts below are ABSOLUTE — the point is "nothing
       survives", not "my rows went" — and a Postgres database persists between
       local runs where the JSON backend gets a fresh temp DATA_DIR. Same
       discovered TRUNCATE as test/repo.postgres.test.js, and safe only because
       the CI job runs these files with --test-concurrency=1. */
    await client.query(`
      DO $$
      DECLARE tables text;
      BEGIN
        SELECT string_agg(quote_ident(tablename), ', ') INTO tables
          FROM pg_tables
         WHERE schemaname = 'public' AND tablename NOT LIKE 'knex\\_%';
        IF tables IS NOT NULL THEN
          EXECUTE 'TRUNCATE ' || tables || ' CASCADE';
        END IF;
      END $$;`);
  });

  after(async () => {
    if (client) await client.end();
    await repo.end();
  });

  /* The anti-vacuous floor, and it counts something a broken derivation would
     LOSE. A query that returned nothing, or a filter that excluded everything,
     would satisfy every per-table loop below by iterating zero times — which is
     the exact failure `.claude/rules/source-scanning-guards-enumerate-shapes.md`
     describes for a scan whose floor counts attempts rather than hits. */
  test('the schema really was derived: both classes of table are present', () => {
    assert.ok(tables.length >= 14, `expected the real schema, saw ${tables.length} tables`);
    assert.ok(tables.some((t) => t.tenantScoped), 'no tenant-scoped table found');
    assert.ok(tables.filter((t) => !t.tenantScoped).length >= 8, 'no global tables found');
  });

  /* THE ONE THAT CATCHES A NEW TABLE. Everything else here checks behaviour we
     already believe; this checks that somebody THOUGHT about a store at all. */
  test('every global table has a declared erasure/export disposition', () => {
    const undeclared = tables
      .filter((t) => !t.tenantScoped)
      .map((t) => t.name)
      .filter((name) => !(name in GLOBAL_DISPOSITION));
    assert.deepEqual(
      undeclared, [],
      'a global table with no entry in GLOBAL_DISPOSITION: decide whether eraseAccount '
      + 'must delete it, whether exportAccountData must answer with it, or why neither — '
      + 'and write the reason down. Silence here is an Art. 17 gap.',
    );
  });

  test('a disposition that is not both erase AND export states its reason', () => {
    for (const [name, d] of Object.entries(GLOBAL_DISPOSITION)) {
      if (d.erase && d.export) continue;
      assert.ok(d.why && d.why.length > 20, `${name}: an exception needs a written reason`);
    }
  });

  test('every declared table still exists — the list cannot rot into dead names', () => {
    // The inverse half, and the reason the list stays trustworthy: a dropped
    // table must lose its entry, exactly as `test/token-budget.test.js` requires
    // of a file that shrinks back under budget.
    const live = new Set(tables.map((t) => t.name));
    const stale = Object.keys(GLOBAL_DISPOSITION).filter((n) => !live.has(n));
    assert.deepEqual(stale, [], 'GLOBAL_DISPOSITION names a table that no longer exists');
  });

  test('exportAccountData answers with a key for every table declared exportable', async () => {
    const { id: uid } = await repo.createUser({ tenantId: 't-export-probe', createdAt: new Date().toISOString() });
    const out = await repo.exportAccountData(uid, 't-export-probe');
    // The payload's key names are the export's own vocabulary, not table names —
    // so the mapping is stated here rather than guessed from the table.
    const KEY_FOR = {
      round_grants: 'grants',
      invitations: 'invitations',
      inbox: 'inbox',
      friendships: 'friendships',
      feed_events: 'feedEvents',
    };
    for (const [table, d] of Object.entries(GLOBAL_DISPOSITION)) {
      if (!d.export) continue;
      const key = KEY_FOR[table];
      assert.ok(key, `${table} is declared exportable but this spec has no key name for it`);
      assert.ok(key in out, `exportAccountData omits ${key} (table ${table})`);
    }
    await repo.eraseAccount(uid);
  });

  /* The behavioural half: seed a real row in every global table declared
     erasable, erase the account, and count what survives.
     A source scan for `knex('inbox')` would pass against a delete whose WHERE
     clause is wrong, which is the failure this shape exists to exclude. */
  test('eraseAccount leaves NO row behind in any table declared erasable', async () => {
    const tenant = 't-erase-probe';
    const now = new Date().toISOString();
    const { id: uid } = await repo.createUser({ tenantId: tenant, createdAt: now, username: 'eraseprobe' });
    const { id: other } = await repo.createUser({ tenantId: 't-erase-other', createdAt: now, username: 'eraseother' });

    const round = await repo.createRound(tenant, { name: 'Erasure', members: ['Ann'], owner: null });
    const { session } = { session: await repo.createSession(tenant, round.id, {
      createdAt: now, gameIds: [], votes: {}, chosenGameId: null, chosenAt: null,
      finished: false, finishedAt: null, winnerIds: [], cancelled: false, cancelledAt: null, done: false,
    }) };

    await repo.createGrant({ roundId: round.id, ownerTenantId: tenant, userId: other, role: 'editor' });
    await repo.createInvitation({
      roundId: round.id, ownerTenantId: tenant, inviterUserId: uid, inviteeUserId: other, role: 'editor',
    });
    await repo.addInboxItem(uid, { type: 'test', createdAt: now });
    await repo.createFriendRequest({ requesterUserId: uid, addresseeUserId: other });
    await repo.addFeedEvent(uid, { type: 'session_played', title: 'Catan', at: now });
    await repo.createSessionVoteLink({ tenantId: tenant, roundId: round.id, sessionId: session.id });

    // Every fixture landed — otherwise the counts below are all zero before the
    // erase and the whole test passes against an eraseAccount that does nothing.
    const countFor = async (table) => {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
      return rows[0].n;
    };
    const erasable = Object.entries(GLOBAL_DISPOSITION)
      .filter(([, d]) => d.erase)
      .map(([name]) => name)
      .filter((name) => name !== 'users'); // two users exist; counted separately below
    for (const table of erasable) {
      assert.ok(await countFor(table) > 0, `fixture failed to seed ${table}`);
    }

    const res = await repo.eraseAccount(uid);
    assert.ok(res && res.tenantId === tenant, `erase refused: ${JSON.stringify(res)}`);

    for (const table of erasable) {
      assert.equal(await countFor(table), 0, `${table} still holds rows after erasure`);
    }
    assert.equal(await repo.getUserById(uid), null, 'the account row itself is gone');
    assert.ok(await repo.getUserById(other), 'and the other account is untouched');

    await repo.eraseAccount(other);
  });

  test('the rounds cascade reaches every tenant-scoped table', async () => {
    const tenant = 't-cascade-probe';
    const now = new Date().toISOString();
    const { id: uid } = await repo.createUser({ tenantId: tenant, createdAt: now, username: 'cascadeprobe' });
    const round = await repo.createRound(tenant, { name: 'Kaskade', members: ['Ann'], owner: null });
    await repo.createGame(tenant, round.id, { title: 'Catan', minPlayers: 1, maxPlayers: 4 });
    await repo.createSession(tenant, round.id, {
      createdAt: now, gameIds: [], votes: {}, chosenGameId: null, chosenAt: null,
      finished: false, finishedAt: null, winnerIds: [], cancelled: false, cancelledAt: null, done: false,
    });

    const scoped = tables.filter((t) => t.tenantScoped).map((t) => t.name);
    assert.ok(scoped.length >= 4, `expected the round tables, saw ${scoped.join(', ')}`);
    const countFor = async (table) => {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [tenant]);
      return rows[0].n;
    };
    for (const table of scoped) {
      assert.ok(await countFor(table) > 0, `fixture failed to seed the tenant-scoped ${table}`);
    }

    await repo.eraseAccount(uid);
    for (const table of scoped) {
      assert.equal(await countFor(table), 0, `${table} survived the rounds cascade`);
    }
  });
}
