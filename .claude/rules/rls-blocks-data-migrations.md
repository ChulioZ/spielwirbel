---
paths:
  - "lib/repo/migrations/**"
  - "lib/repo/postgres.js"
---
# A data-rewriting migration matches ZERO rows under FORCE RLS — and reports success

Every round table (`rounds`, `members`, `games`, `sessions`, `activities`) has
row-level security with **FORCE**, and FORCE is what makes the policies bind the
table **owner** — which is the role the app and the Knex CLI connect as
(`20260719000000_initial_schema.js` says so, and that is the whole reason FORCE
is there). A migration runs with `app.tenant_id` unset, so the tenant policy's
`tenant_id = current_setting('app.tenant_id', true)` compares against NULL and is
never true.

So the natural way to write a one-off data rewrite —

```js
exports.up = async (knex) => {
  await knex.raw(`UPDATE sessions SET data = jsonb_set(data, …)`);   // 0 rows
};
```

— **updates nothing, throws nothing, and is recorded in `knex_migrations` as
done.** There is no second chance: the migration will never run again.

## Measured, not assumed (2026-09-05, Postgres 18)

Locally the connecting role is `postgres`, a **superuser**, and superusers bypass
RLS entirely — so a probe run as the default role passes and proves nothing. Hand
the table to a plain owner to reproduce production's role:

```sql
CREATE ROLE plainowner LOGIN PASSWORD 'p' NOSUPERUSER;
GRANT ALL ON ALL TABLES IN SCHEMA public TO plainowner;
ALTER TABLE sessions OWNER TO plainowner;
```

Connected as `plainowner`, `UPDATE sessions SET … WHERE tenant_id = 'probe'`
reported **`rowCount: 0`** against a row that was demonstrably there. That
asymmetry is the trap in miniature: **the environment where you develop the
migration is the one where the bug cannot appear.**

## The shape that works

Lift FORCE for the rewrite and put it back, both inside the migration's own
transaction — DDL is transactional in Postgres, so a failure rolls the lift back
with it and the window cannot outlive the statement:

```js
await knex.raw('ALTER TABLE sessions NO FORCE ROW LEVEL SECURITY');
try { await knex.raw(REWRITE); }
finally { await knex.raw('ALTER TABLE sessions FORCE ROW LEVEL SECURITY'); }
```

Then **verify, and throw**: re-run the migration's own "is there anything left to
do" predicate and fail loudly if it still matches. A data migration that can
silently do nothing is the one shape that must not ship, and the verification is
four lines.

Three notes on the alternatives, so they are not re-derived:

- **`SET row_security = off` does not work.** It makes a query that *would* apply
  a policy raise an error rather than bypassing it; it is a safety valve for
  `pg_dump`, not an escape hatch.
- **A temporary escape policy** (the shape `20260724130000_retenant.js` used for
  the cross-tenant re-tenant write) is equivalent, and costs the same
  `ACCESS EXCLUSIVE` lock — `CREATE POLICY` takes one too. Prefer the two ALTERs;
  they are shorter and cannot be left behind.
- **Enumerating tenants first does not help.** `SELECT DISTINCT tenant_id FROM
  sessions` is filtered by the same policy, so it returns nothing.

## Test it by calling `up()` directly

`migrate.latest()` has already run by the time a spec boots, so the rewrite is
exercised by requiring the migration file and calling `exports.up(knex)` against
seeded rows. That is not a workaround: the rewrite has to be **re-runnable**
anyway, because Railway's zero-downtime deploy overlaps the outgoing and incoming
containers and the previous build can keep writing the old shape for a few
seconds after the migration has run
(`.claude/rules/deploy-invariants-are-pinned-in-code.md`). Assert that FORCE is
back afterwards too — `SELECT relforcerowsecurity FROM pg_class WHERE relname =
'sessions'` — since a migration that leaves it lifted disables the tenant
isolation layer for the owner role with nothing else in the suite able to see it.

## Why this had never come up

CLAUDE.md's convention is that the repo keeps **no one-time migration code**, so
until #909 every Knex migration here was pure DDL — and DDL is not subject to
RLS. The first migration that had to touch rows is the first that could hit this.
Expect the next one to hit it too.

**Related:** `20260719000000_initial_schema.js` (where FORCE is set, and why),
`.claude/rules/admin-cross-tenant-escape.md` (the two standing escapes and the
discipline for adding one), `.claude/rules/postgres-backend.md`,
`.claude/rules/break-the-code-on-purpose.md` (a migration that silently matches
nothing is a green run guarding nothing — the same family),
`.claude/rules/data-json-external-edits.md` (the JSON backend's equivalent trap,
where a running server discards the edit instead).
