'use strict';

/*
 * Drop the cross-tenant re-tenant WRITE escape added in 20260724130000_retenant.js
 * (issue #405).
 *
 * That pair of policies existed solely for the one-time "claim the 'default'
 * tenant" go-live step (#266), which re-tenanted the pre-accounts 'default' data
 * into a real account. That step was executed on production during the #219
 * go-live (2026-07-24); the claim action and its `rtx()` caller are removed with
 * this issue, so the escape has no remaining caller. Keeping a standing
 * cross-tenant SELECT + UPDATE escape in the live database — gated only on a
 * transaction-local `app.retenant='on'` flag — is unexercised power, so it goes.
 *
 * The tenant-isolation policies are untouched (this only removes the additive
 * escape pair), so tenant scoping is byte-for-byte unchanged. `down()` recreates
 * the escape exactly as 20260724130000_retenant.js created it, so a rollback
 * restores the previous schema; the original migration file stays untouched (it
 * already ran in production).
 */

const RLS_TABLES = ['rounds', 'members', 'games', 'sessions', 'activities'];

const DROP_RETENANT_POLICY = RLS_TABLES
  .map((t) => `DROP POLICY IF EXISTS ${t}_retenant_read ON ${t};\nDROP POLICY IF EXISTS ${t}_retenant_write ON ${t};`)
  .join('\n');

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

exports.up = async (knex) => {
  await knex.raw(DROP_RETENANT_POLICY);
};

exports.down = async (knex) => {
  await knex.raw(RETENANT_POLICY);
};
