'use strict';

/*
 * In-app user feedback (issue #260).
 *
 * A global `feedback` table: what users tell the operator about the app itself.
 * Deliberately NOT tenant-scoped and NOT under RLS, exactly like `users` and
 * `moderation_log` — it is data addressed TO the operator, who by definition
 * reads it across every tenant, so scoping it to one would defeat its purpose.
 * The submitter's tenant/user id is recorded INSIDE `data.context` as ordinary
 * metadata (so the operator can tell who to follow up with) rather than as an
 * isolation boundary.
 *
 * Same row shape as moderation_log — id + data jsonb + a `seq bigserial` that
 * both preserves insertion order and backs the newest-first read.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS feedback (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS feedback_seq_idx ON feedback(seq DESC);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS feedback');
};
