'use strict';

/*
 * The operator's confirmed scoring categories per BoardGameGeek game (#1787).
 *
 * A SIBLING of `game_scoring_settings` (#1786) rather than more fields in its
 * `data`: the two confirmations have independent lifecycles — revoking a
 * direction deletes its row, and must not take a confirmed category set with it
 * — and the overlay loaders read each table whole. Global and un-scoped, no RLS
 * and no tenant_id, carrying no round, account or person id: a row is the base
 * set (`categories: [{ id, name, match }]`), its state and dates. Rounds see it
 * through the overlay on read (lib/game-categories.js), so confirming writes
 * only this table.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS game_category_settings (
  bgg_id text PRIMARY KEY,
  data jsonb NOT NULL
);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS game_category_settings');
};
