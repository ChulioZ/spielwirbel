'use strict';

/*
 * Admin sessions — the operator panel's `aid` cookie, made server-side after
 * the 2026-10-22 Railway env-var leak (lib/admin.js has the reasoning).
 *
 * Global, NOT tenant-scoped and NOT under RLS, exactly like `admin_passkeys`:
 * the operator has no tenant. `id` is the SHA-256 of the cookie value, never the
 * value itself. `credential_id` (the passkey that opened the session) and
 * `expires_at` are promoted out of the jsonb because the two bulk deletes — end
 * a removed key's sessions, purge the expired — filter on them.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS admin_sessions (
  id text PRIMARY KEY,
  credential_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS admin_sessions');
};
