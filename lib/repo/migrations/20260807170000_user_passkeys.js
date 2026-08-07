'use strict';

/*
 * Passkey lookup index (issue #418).
 *
 * Usernameless login resolves an account from a credential id alone, via
 * `data->'identities' @> '[{"type":"passkey","credentialId":"…"}]'` — the only
 * read in the app that searches the users table by something other than id,
 * e-mail or username, and the only one with no equality expression an ordinary
 * btree could index.
 *
 * `jsonb_path_ops` rather than the default `jsonb_ops`: it indexes only the
 * paths-plus-values needed by the containment operator `@>`, which is the sole
 * operator this read uses. That makes the index materially smaller and faster
 * than the default, at the cost of key-existence operators (`?`, `?|`, `?&`)
 * it cannot serve — none of which this column is queried with.
 *
 * No backfill and no column: passkeys live inside the existing `identities`
 * array that every account already carries, so an account without one simply
 * contributes no matching element (CLAUDE.md: no permanent migration code).
 */

exports.up = async (knex) => {
  await knex.raw(
    "CREATE INDEX IF NOT EXISTS users_identities_idx ON users USING gin ((data->'identities') jsonb_path_ops)",
  );
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS users_identities_idx');
};
