'use strict';

/*
 * Friendships + Freundeskreis feed (issue #325).
 *
 * Two global stores, deliberately NOT tenant-scoped and NOT under RLS — exactly
 * like `users`, `inbox` and `round_grants`: both are keyed by ACCOUNT ids, the
 * identity layer, not a tenant. They are absent from TENANT_METHODS and reached
 * from the user-facing account routes, which scope every query to the
 * authenticated caller.
 *
 * `friendships` — one row per unordered account pair. The pair is stored in a
 * canonical order (`user_lo` <= `user_hi`, lexicographic) so a single unique
 * index enforces "at most one friendship per pair" regardless of who sent the
 * request; the direction (who asked whom) and the status live in the data jsonb.
 * "My friendships" is `user_lo = me OR user_hi = me`, each an indexed scan.
 *
 * `feed_events` — the Freundeskreis feed: append-only, user-attributed activity
 * a friend may read. Row shape mirrors the other global stores (id + data jsonb +
 * seq); `uid` is a promoted, indexed column so one user's newest events read in a
 * single indexed scan. The payload is a fixed allowlist (type/title/coverUrl/at)
 * enforced by the repo writer, never member names/scores/round names (#325).
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS friendships (
  id text PRIMARY KEY,
  user_lo text NOT NULL,
  user_hi text NOT NULL,
  data jsonb NOT NULL,
  seq bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_idx ON friendships(user_lo, user_hi);
CREATE INDEX IF NOT EXISTS friendships_lo_idx ON friendships(user_lo, seq);
CREATE INDEX IF NOT EXISTS friendships_hi_idx ON friendships(user_hi, seq);

CREATE TABLE IF NOT EXISTS feed_events (
  id text PRIMARY KEY,
  uid text NOT NULL,
  data jsonb NOT NULL,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS feed_events_uid_idx ON feed_events(uid, seq DESC);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS friendships');
  await knex.raw('DROP TABLE IF EXISTS feed_events');
};
