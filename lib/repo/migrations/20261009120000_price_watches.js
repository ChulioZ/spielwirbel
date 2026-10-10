'use strict';

/*
 * Price watches (issue #680) — an account's "tell me when this BGG game costs at
 * most X". Global and keyed by ACCOUNT, like `inbox`: a watch belongs to the
 * person and to a BGG id, never to a tenant, round or wish, so there is no
 * tenant to scope by and no RLS (the same reasoning as `round_grants`).
 *
 * `user_id` and `external_id` are columns because the unique index needs them
 * (one watch per account and game) and the erasure deletes by `user_id`;
 * everything else, including the job's state, lives in the jsonb.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS price_watches (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  external_id text NOT NULL,
  data jsonb NOT NULL,
  seq bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS price_watches_user_game_idx
  ON price_watches(user_id, external_id);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS price_watches');
};
