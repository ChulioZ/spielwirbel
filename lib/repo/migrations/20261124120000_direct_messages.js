'use strict';

/*
 * Direct messages between friends (issue #1783).
 *
 * A conversation joins two ACCOUNTS, never a tenant, so — like `friendships`,
 * `inbox` and `round_message_reads` — both tables are global and NOT under RLS.
 * They are absent from TENANT_METHODS and reached only from
 * lib/routes/direct-messages.js, which scopes every query to the authenticated
 * caller AND checks the friendship there; RLS stays un-widened.
 *
 * `direct_messages` — one row per message. The pair is stored in canonical
 * order (`user_lo` <= `user_hi`, lexicographic, the friendships convention), so
 * one index serves "this conversation" whichever side asks. It is keyed by the
 * PAIR rather than by a friendship id on purpose: ending a friendship deletes
 * its row, and the history has to survive that (only new messages close).
 * `author_user_id` is promoted because erasure, the export and the per-author
 * quota select by it; the text and timestamps live in `data`. `seq` orders the
 * conversation and is what read markers and paging compare.
 *
 * `direct_message_reads` — one row per (reader, other party): the highest seq
 * the reader has seen in that conversation. No content.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS direct_messages (
  id text PRIMARY KEY,
  user_lo text NOT NULL,
  user_hi text NOT NULL,
  author_user_id text NOT NULL,
  data jsonb NOT NULL,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS direct_messages_pair_idx ON direct_messages(user_lo, user_hi, seq);
CREATE INDEX IF NOT EXISTS direct_messages_hi_idx ON direct_messages(user_hi, seq);
CREATE INDEX IF NOT EXISTS direct_messages_author_idx ON direct_messages(author_user_id);

CREATE TABLE IF NOT EXISTS direct_message_reads (
  user_id text NOT NULL,
  other_user_id text NOT NULL,
  last_seq bigint NOT NULL,
  PRIMARY KEY (user_id, other_user_id)
);
CREATE INDEX IF NOT EXISTS direct_message_reads_other_idx ON direct_message_reads(other_user_id);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS direct_message_reads');
  await knex.raw('DROP TABLE IF EXISTS direct_messages');
};
