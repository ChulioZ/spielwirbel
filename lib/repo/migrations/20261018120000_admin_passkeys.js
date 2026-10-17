'use strict';

/*
 * Admin passkeys (issue #1670) — the operator panel's second factor.
 *
 * Global, NOT tenant-scoped and NOT under RLS, exactly like `moderation_log`:
 * the operator is not an account and has no tenant, so there is nothing to
 * scope by. The repo methods are absent from TENANT_METHODS and reached only
 * from the admin-gated lib/routes/admin/.
 *
 * `id` is the WebAuthn credential id (globally unique by spec); the primary key
 * turns a duplicate enrollment into a no-op. Everything else — public key,
 * signature counter, transports, label, timestamps — lives in the jsonb, the
 * row shape the other global stores use.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS admin_passkeys (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  seq bigserial
);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS admin_passkeys');
};
