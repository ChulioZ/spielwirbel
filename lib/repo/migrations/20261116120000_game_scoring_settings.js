'use strict';

/*
 * The operator's confirmed scoring direction per BoardGameGeek game (#1786).
 *
 * GLOBAL and un-scoped, with no RLS and no tenant_id, like `bgg_corpus`. A row
 * says "this BGG game is won by the lowest (or highest) score" for EVERY round;
 * it belongs to no tenant and carries no round, account or person id. Rounds see
 * it through an overlay on read (lib/game-scoring.js), so confirming writes only
 * this table and never into a tenant's rows — no RLS widening, nothing for the
 * write path of .claude/rules/admin-cross-tenant-escape.md to get wrong.
 *
 * `bgg_id` is text because it is compared against a game's stored
 * `source.externalId`, which is a string, exactly as `bgg_corpus.external_id`.
 * Everything else (state, the confirmed value, the dates, the round count at
 * dismissal, the title shown at confirmation) lives in `data`: nothing sorts or
 * joins on it, and the list is a few hundred rows read whole.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS game_scoring_settings (
  bgg_id text PRIMARY KEY,
  data jsonb NOT NULL
);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS game_scoring_settings');
};
