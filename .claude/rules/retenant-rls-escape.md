# Moving rows BETWEEN tenants under FORCE RLS (#266) — the two facts that cost the effort

`claimDefaultTenant` (the "claim the 'default' tenant" go-live step, #266)
rewrites `tenant_id` on every round-scoped row from the legacy `'default'` tenant
to a real account's tenant. That is a **cross-tenant WRITE**, which the
tenant-isolation policy makes impossible under any single `app.tenant_id`. Two
non-obvious PostgreSQL facts (verified empirically on PG 16, not from docs — the
docs read as if neither were true) decide how the escape must be shaped. Get
either wrong and you burn an afternoon watching `UPDATE 0` or "new row violates
row-level security policy" with no idea why.

## Fact 1 — an UPDATE's WHERE triggers SELECT policies; a moved row must be VISIBLE, not just pass WITH CHECK

`UPDATE … SET tenant_id = X WHERE tenant_id = 'default'` reads columns in its
`WHERE`, so Postgres applies the **SELECT** policies to the scan. A
`FOR UPDATE`-only escape grants no SELECT visibility, so the scan sees **zero
rows** and the UPDATE silently matches nothing — looks exactly like the escape
"not working". And separately: moving a row to a new tenant needs the **new** row
to be visible under a `USING`, not merely to pass `WITH CHECK`. Measured: a policy
`USING (tenant_id = app.tenant_id) WITH CHECK (true)` **rejects** the move (new
`tenant_id` fails the scoped `USING`), while `USING (true) WITH CHECK (true)`
allows it. So the mover needs cross-tenant **SELECT** as well as UPDATE.

## Fact 2 — you cannot "relax only the WITH CHECK" of the tenant policy with a sibling policy

Permissive policies OR-combine for USING, but you **cannot** add a second
permissive policy whose `WITH CHECK` is `true` and expect the tenant policy's
scoped `WITH CHECK` to be OR-relaxed away. Measured: `iso.WITH_CHECK(scoped)` +
`sibling.WITH_CHECK(true)`, new row still rejected. The reliable shape is a
**self-contained escape** that admits the move on its own, exactly like the
read-only admin escape (#268) — never an edit to the tenant policy (that reopens
the cross-tenant-DELETE hole `.claude/rules/admin-moderation-surface.md` §2 warns
about).

## The shape that works (migration `20260724130000_retenant.js`)

A **pair** of additive policies per round table, gated on a transaction-local
`app.retenant='on'` flag (set only inside `rtx()` in `lib/repo/postgres.js`):

```
<t>_retenant_read   FOR SELECT  USING (app.retenant = 'on')
<t>_retenant_write  FOR UPDATE  USING (app.retenant = 'on') WITH CHECK (app.retenant = 'on')
```

- With the flag set, the mover can **SELECT and UPDATE** rows across tenants (the
  read escape is what makes the `WHERE` scan and the moved row visible).
- **INSERT and DELETE ignore both** (a `FOR SELECT`/`FOR UPDATE` policy contributes
  nothing to them), so they still consult only the tenant policy — the dangerous
  cross-tenant DELETE (governed by USING alone, no WITH CHECK) stays closed.
- The flag is transaction-local, so it dies at COMMIT and never leaks to the next
  pooled checkout, like `app.admin` / `app.tenant_id`.

## The load-bearing consequence: the method's WHERE is the scope, not the policy

Because the flag **also widens SELECT**, an *unqualified* `UPDATE rounds SET
tenant_id = X` under the escape would move **every** tenant's rows. So
`claimDefaultTenant`'s `.where({ tenant_id: 'default' })` is **load-bearing**, not
decoration — it, not the policy, is what confines the move to the source. Do not
drop it, and do not generalise the method into "move any tenant anywhere".

## Verifying — plain role only, and break it once

The contract suite's connection is a **superuser and bypasses RLS entirely**, so
it proves the *logic* (rows moved, children follow) but nothing about the policy.
`test/repo.postgres.test.js` proves the policy through a dedicated **plain role**:
flag → the WHERE-scoped move works and SELECT is cross-tenant, but cross-tenant
DELETE returns 0 rows and cross-tenant INSERT is refused; plus the actual
`claimDefaultTenant` run end-to-end **as the plain role via a child process**
(`admin-moderation-surface.md` §3). It was verified by recreating the escape as
`FOR ALL` (the cross-tenant-DELETE mistake) and watching the DELETE assertion go
red. Any change here gets the same treatment.

**Related:** `.claude/rules/admin-moderation-surface.md` (§2 the read-only escape
this mirrors, §3 the plain-role discipline), `.claude/rules/tenancy-rls.md` (the
FORCE-RLS/superuser-bypass model), `.claude/rules/accounts-mode-gate.md` (layered
mode, which makes the `'default'` data unreachable and so needs this claim).
