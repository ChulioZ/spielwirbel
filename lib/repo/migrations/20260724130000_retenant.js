'use strict';

/*
 * A cross-tenant re-tenant WRITE escape in the round tables' RLS (issue #266).
 *
 * The "claim the 'default' tenant" operation (lib/repo/postgres.js
 * claimDefaultTenant) rewrites tenant_id on every round-scoped row from the
 * legacy single-group 'default' tenant to a real account's tenant, so the owner's
 * freshly-registered account can finally see the pre-tenancy data once accounts
 * mode is on (otherwise that data becomes unreachable — no request ever acts as
 * 'default' in layered mode). That is inherently a CROSS-tenant write, and the
 * tenant-isolation policy makes it impossible under any single app.tenant_id.
 *
 * Two facts about UPDATE under FORCE RLS shape this (both verified empirically on
 * Postgres 16 before the design was settled):
 *   - Moving a row to a new tenant needs the NEW row to be VISIBLE, not merely to
 *     pass WITH CHECK: a scoped `USING (tenant_id = app.tenant_id)` rejects the
 *     moved row even with `WITH CHECK (true)`. So a FOR-UPDATE-only escape is not
 *     enough — the mover also needs SELECT visibility of the moved rows.
 *   - Multiple permissive policies do NOT OR their WITH CHECK the way one might
 *     hope; you cannot "relax only the WITH CHECK" of the tenant policy with a
 *     sibling policy. The reliable shape is a self-contained escape.
 *
 * So, exactly like the read-only admin escape (20260720140000_moderation.js) — and
 * following the same discipline (`.claude/rules/admin-cross-tenant-escape.md` §1:
 * leave the tenant policy UNTOUCHED, add SEPARATE, additive policies) — this adds a
 * pair gated on a transaction-local `app.retenant='on'` flag set solely inside
 * claimDefaultTenant's `rtx()`:
 *
 *   <t>_retenant_read   FOR SELECT  USING (app.retenant = 'on')
 *   <t>_retenant_write  FOR UPDATE  USING (app.retenant = 'on')
 *                                   WITH CHECK (app.retenant = 'on')
 *
 * With the flag set, the mover can SELECT and UPDATE (re-label) rows across
 * tenants — but INSERT and, critically, DELETE ignore both (a FOR SELECT/FOR
 * UPDATE policy contributes nothing to them), so they still consult ONLY the
 * tenant policy: the dangerous cross-tenant DELETE (governed by USING alone, no
 * WITH CHECK) stays closed. Because the flag ALSO widens SELECT, an *unqualified*
 * UPDATE would move EVERY tenant's rows — so claimDefaultTenant's
 * `WHERE tenant_id = 'default'` is load-bearing (it, not the policy, is what scopes
 * the move to the source). The flag is transaction-local via set_config(..., true),
 * so it dies at COMMIT and never reaches the next pooled checkout, like app.admin.
 *
 * All of this is proven through a PLAIN ROLE in test/repo.postgres.test.js (the
 * contract suite's superuser bypasses RLS): flag → move works WHERE-scoped, but
 * cross-tenant DELETE = 0 rows and cross-tenant INSERT is refused. See
 * .claude/rules/retenant-rls-escape.md.
 */

const RLS_TABLES = ['rounds', 'members', 'games', 'sessions', 'activities'];

const RETENANT_POLICY = RLS_TABLES.map((t) => `
DROP POLICY IF EXISTS ${t}_retenant_read ON ${t};
CREATE POLICY ${t}_retenant_read ON ${t}
  FOR SELECT
  USING (current_setting('app.retenant', true) = 'on');
DROP POLICY IF EXISTS ${t}_retenant_write ON ${t};
CREATE POLICY ${t}_retenant_write ON ${t}
  FOR UPDATE
  USING (current_setting('app.retenant', true) = 'on')
  WITH CHECK (current_setting('app.retenant', true) = 'on');
`).join('\n');

const DROP_RETENANT_POLICY = RLS_TABLES
  .map((t) => `DROP POLICY IF EXISTS ${t}_retenant_read ON ${t};\nDROP POLICY IF EXISTS ${t}_retenant_write ON ${t};`)
  .join('\n');

exports.up = async (knex) => {
  await knex.raw(RETENANT_POLICY);
};

exports.down = async (knex) => {
  await knex.raw(DROP_RETENANT_POLICY);
};
