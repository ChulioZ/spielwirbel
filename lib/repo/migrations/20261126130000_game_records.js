'use strict';

/*
 * Spielwirbel-Rekorde (#1788): the instance-wide record score per BGG game, and
 * the operator's review of outlier scores.
 *
 * BOTH GLOBAL and un-scoped, with no RLS and no tenant_id, like
 * `game_scoring_settings`. Neither stores a tenant or an account id:
 *
 *  - `game_records` holds one row per BGG id — the record value, its direction,
 *    the distribution figures the admin screen shows, and the ROUND-LOCAL score
 *    keys (`<roundId>/<sessionId>/<seatId>`) that hold or set it. Those keys let
 *    a round read find its own record-setting scores and let the profile find
 *    the account's own seats without the table ever naming a person.
 *  - `score_reviews` holds one row per flagged or decided score, keyed by that
 *    same score key, with the snapshot the admin list renders (value, game,
 *    distribution, player count, date, the session's other scores) and an
 *    opaque `ref` the admin acts by — the key itself never leaves the server.
 *
 * Both are REWRITTEN by the scheduler's recompute (lib/game-records.js), which
 * reads every round under the read-only admin escape; nothing in a request path
 * writes them except the operator's review decision. A score whose session is
 * deleted drops out of both on the next recompute, which is also what removes it
 * after an account erasure.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS game_records (
  bgg_id text PRIMARY KEY,
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS score_reviews (
  score_key text PRIMARY KEY,
  data jsonb NOT NULL
);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS score_reviews; DROP TABLE IF EXISTS game_records');
};
