'use strict';

/*
 * Session comments (issue #1782) — a thread per session, on the round chat's
 * table. A message is either round-level (`session_id` NULL) or a comment on
 * one session of that round, so moderation, quotas, erasure, the read marker
 * and the report path stay one implementation (lib/repo/migrations/
 * 20261112120000_round_messages.js has the table's own reasoning).
 *
 * The FK cascades from `sessions`, so every path that deletes a session row —
 * deleteSession, a game delete or transfer that leaves a session with no games,
 * the round's own cascade — takes its comments in the same statement.
 * Referential actions bypass RLS, which is what lets the cascade reach rows
 * the deleting transaction's tenant scope would otherwise have to name.
 *
 * Purely additive: every existing row is a round-level message and stays NULL,
 * so there is no data-rewriting step to run under FORCE RLS
 * (.claude/rules/rls-blocks-data-migrations.md).
 */

exports.up = async (knex) => {
  await knex.raw(`
ALTER TABLE round_messages
  ADD COLUMN IF NOT EXISTS session_id text REFERENCES sessions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS round_messages_session_idx ON round_messages(session_id) WHERE session_id IS NOT NULL;
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS round_messages_session_idx');
  await knex.raw('ALTER TABLE round_messages DROP COLUMN IF EXISTS session_id');
};
