# The PostgreSQL data-access backend (lib/repo/postgres.js) — gotchas

Issue #127 added a second data-access backend behind `DATABASE_URL`
(`lib/repo/index.js` picks `postgres.js` when it's set, else `json.js`). Both
implement the same contract (`.claude/rules/data-access-layer.md`); the shared
suite `test/support/repo-contract.js` runs against **both** — JSON in
`test/repo.test.js`, Postgres in `test/repo.postgres.test.js`. When you add a repo
method, implement it in **both** backends and it's covered by the one contract.

**Since #211 the backend is built on [Knex](https://knexjs.org):** the fluent
query builder replaces the hand-written parameterized SQL, and versioned
migration files under `lib/repo/migrations/` replace the old inline
`CREATE TABLE IF NOT EXISTS` template. The knex instance is built from the shared
root `knexfile.js` (the same config the `knex` CLI uses). Not a full ORM — RLS,
the tenant `set_config`, advisory locks and `FOR UPDATE` still use `knex.raw()`.

Non-obvious things that cost effort — keep them:

- **JSONB writes: `J()` (JSON.stringify) EVERY value; reads come back parsed.**
  Knex/pg serialize a plain **object** to JSON fine, but turn a JS **array** into
  a Postgres *array literal* (`{...}`) — a raw array binding into a `jsonb` column
  throws `22P02` (or silently corrupts). So pass `data: J(value)` on every jsonb
  insert/update (`recommendation_runs` is an array — this is not optional), and
  use `mergeData(patch)` (= `knex.raw('data || ?::jsonb', [J(patch)])`) for a
  patch merge. pg casts the text to jsonb on assignment. Don't rely on "objects
  happen to work" — stringify uniformly so a value that turns out to be an array
  can't corrupt the column. Reads are parsed by pg's jsonb parser → JS objects.

- **A single transaction runs on ONE connection — no concurrent queries on it.**
  Inside `tx(tenant, fn)`/`qt` (a `knex.transaction`), `await` queries **one at a
  time**; firing them concurrently on the same `trx` errors. That's why
  `childrenOf` awaits its three SELECTs sequentially. `getRound`/`listRounds` use
  `Promise.all`, but only across **independent `qt()` calls** — each
  `knex.transaction()` checks out its **own** pooled connection, so they truly
  parallelize (and each carries its own tenant `set_config`). Never `Promise.all`
  builders sharing one `trx`.

- **Backend parity of *absent* keys.** The JSON model omits some keys until
  written (a fresh round has no `recommendationRuns`; a fresh member no `color`).
  Postgres matches this: `recommendation_runs` defaults to **NULL** and `assemble`
  emits `recommendationRuns` only when non-null; member/game/session fields live in
  a `data jsonb` blob so "key absent" round-trips naturally. `background` is the
  exception — always present (may be `null`), because the JSON model always sets
  it. If you add a sometimes-absent field, don't give its column a non-null
  default, or the two backends will disagree and the contract test will catch it.

- **jsonb does not preserve key order.** Postgres normalizes jsonb keys, so a
  round/game serialized from Postgres has a different key *order* than from JSON.
  This is cosmetic (the frontend and `assert.deepEqual` are order-independent);
  don't try to "fix" it.

- **Lifecycle.** `server.js` must `await repo.init()` before `listen()` — since
  #211 that runs `knex.migrate.latest()` (pending migrations), not inline DDL;
  `json.init()` is a no-op. `end()` is `knex.destroy()`; tests selecting the
  Postgres backend must `await repo.end()` in an `after()` hook or the pool keeps
  the process alive. `test/repo.postgres.test.js` and `test/migrate.postgres.test.js`
  both **skip** entirely without `DATABASE_URL`, so plain `npm test` and the
  `coverage:ci` gate never touch Postgres (and `postgres.js` isn't loaded there,
  so it isn't coverage-gated — the dedicated `postgres` CI job with a service
  container, which runs both files, is what exercises it).

- **Migrations, and why `init()` STILL holds an advisory lock.** Schema evolution
  is now versioned files in `lib/repo/migrations/` (`npm run migrate` = `knex
  migrate:latest`; `npm run migrate:make -- <name>` to add one) — NOT edits to the
  baseline `20260719000000_initial_schema.js`, which mirrors the old DDL as
  idempotent `IF NOT EXISTS` so applying it to the already-live prod DB (schema
  present, no `knex_migrations` row) is a safe no-op that just records the
  baseline. Knex's own migration lock guards *running* migrations but **not** the
  first `CREATE` of its bookkeeping tables on an empty catalog — the same
  `pg_class` race the raw backend hit (#202). Verified empirically: without a
  lock, two simultaneous first-boots crash with a duplicate `knex_migrations`
  table; with it, they serialize. So `init()` keeps wrapping `migrate.latest()` in
  `pg_advisory_xact_lock` (the lock-holding tx stays open while migrate runs on
  other pooled connections, so a second booter blocks until the first finishes).
  Don't "simplify" it away trusting knex's lock alone. `test/migrate.postgres.test.js`
  asserts the baseline records once, re-init is a no-op, and concurrent `init()`
  doesn't crash.

**Why the storage shape is tables-of-jsonb, not fully normalized:** the roadmap
(§3) explicitly allows JSONB for the messy bits (votes maps, activity payloads),
and the app never queries sessions/votes by field in SQL — routes fetch a whole
round and filter in JS. So each entity is a row with a `data jsonb` (plus promoted
columns only for FKs/ordering/`tenant_id`). Since #136 every round table carries
`tenant_id`, every round-scoped method is tenant-first, and the tables sit under
forced Row-Level Security — the gotchas (superuser bypass, the tx/qt tenant
plumbing, the `TRUNCATE` exemption) live in `.claude/rules/tenancy-rls.md`.
Fuller normalization (a `session_votes` table, real `users`/`tenants`) is later
roadmap work, not a gap to fix here.
