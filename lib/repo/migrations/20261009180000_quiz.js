'use strict';

/*
 * The weekly community quiz (issue #743).
 *
 * GLOBAL and un-scoped, with no RLS and no tenant_id, like `price_watches` and
 * the inbox. A round is built from public BGG corpus facts and belongs to no
 * tenant; a submission belongs to an ACCOUNT and is reached only from the quiz
 * routes, which scope every query to the caller's own id.
 *
 * `quiz_rounds` is keyed by the ISO week (`2026-W41`, Berlin time), which is
 * what makes generating a week idempotent across the two processes every deploy
 * overlaps: the second insert hits the primary key and re-reads the first's row.
 * The (week, user_id) unique index is the one-submission-per-account rule.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS quiz_rounds (
  week text PRIMARY KEY,
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS quiz_submissions (
  id text PRIMARY KEY,
  week text NOT NULL,
  user_id text NOT NULL,
  data jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS quiz_submissions_week_user_idx ON quiz_submissions (week, user_id);
CREATE INDEX IF NOT EXISTS quiz_submissions_user_idx ON quiz_submissions (user_id);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS quiz_submissions');
  await knex.raw('DROP TABLE IF EXISTS quiz_rounds');
};
