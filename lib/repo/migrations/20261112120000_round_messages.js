'use strict';

/*
 * Round chat (issue #1781) — one message thread per round.
 *
 * `round_messages` is ROUND DATA, so it is tenant-scoped exactly like
 * `activities`: a `tenant_id` column, FORCE ROW LEVEL SECURITY with the same
 * `<t>_tenant_isolation` policy, and the moderation migration's additive
 * SELECT-only `<t>_admin_read` escape. A grantee reaches it the way they reach
 * every other row of a shared round — by acting as the owner tenant for the
 * request (.claude/rules/round-grant-resolver.md), so RLS stays un-widened.
 *
 * The escape is needed twice, and both uses only READ under it: the operator
 * removing a reported message, and erasing an account's messages in OTHER
 * tenants' rounds. Each resolves (tenant, id) under atx() and then deletes
 * through the ordinary tx(tenant) path — a DELETE inside atx() matches nothing
 * (.claude/rules/admin-cross-tenant-escape.md §1/§3).
 *
 * `round_id` cascades from `rounds`, so deleting a round — or erasing the
 * tenant that owns it — takes its thread with it in the same statement.
 * `author_user_id` is promoted because erasure and the access export select by
 * it; the text and timestamps live in `data`. `seq` orders the thread and is
 * what read markers and paging compare.
 *
 * `round_message_reads` — one row per (account, round): the highest `seq` the
 * account has seen. Keyed by ACCOUNT, like `price_watches`, so global and
 * without RLS: it holds no content, and a grantee's marker on someone else's
 * round must be deletable when THAT account is erased. Its FK to `rounds` makes
 * a deleted round drop the markers too (referential actions bypass RLS).
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS round_messages (
  id text PRIMARY KEY,
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  author_user_id text NOT NULL,
  data jsonb NOT NULL,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS round_messages_round_idx ON round_messages(round_id, seq);
CREATE INDEX IF NOT EXISTS round_messages_author_idx ON round_messages(author_user_id);
CREATE INDEX IF NOT EXISTS round_messages_tenant_idx ON round_messages(tenant_id);

ALTER TABLE round_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS round_messages_tenant_isolation ON round_messages;
CREATE POLICY round_messages_tenant_isolation ON round_messages
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS round_messages_admin_read ON round_messages;
CREATE POLICY round_messages_admin_read ON round_messages
  FOR SELECT
  USING (current_setting('app.admin', true) = 'on');

CREATE TABLE IF NOT EXISTS round_message_reads (
  user_id text NOT NULL,
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  last_seq bigint NOT NULL,
  PRIMARY KEY (user_id, round_id)
);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS round_message_reads');
  await knex.raw('DROP TABLE IF EXISTS round_messages');
};
