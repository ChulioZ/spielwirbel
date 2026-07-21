'use strict';

/*
 * Stored contact-form submissions / abuse notices (issue #272).
 *
 * Until now POST /api/contact only mailed the operator — if that mail was lost
 * or filtered, no record existed that a DSA Art. 16 notice ever arrived. Every
 * submission is now also persisted here, and the operator panel (#268) reads
 * this table as its Meldungen inbox.
 *
 * Deliberately NOT tenant-scoped and NOT under RLS, exactly like `users`,
 * `moderation_log` and `feedback`: a notice is addressed TO the operator and
 * usually arrives from someone who is not a user at all. Same row shape as
 * feedback — id + data jsonb + a `seq bigserial` backing the newest-first read.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS contact_notices (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS contact_notices_seq_idx ON contact_notices(seq DESC);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS contact_notices');
};
