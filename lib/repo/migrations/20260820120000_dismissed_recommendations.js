'use strict';

/*
 * Recommendations a round has marked "Nicht interessiert" (issue #782): a
 * `dismissed_recommendations jsonb` column on rounds holding the
 * [{ externalId, title, at }] list.
 *
 * A COLUMN ON THE ROUND, deliberately not a `games` row — a dismissal is a
 * title the round has never owned, and giving it a shelf row would make it count
 * in gameCount, the Regal's archive views, the Chronik, the public stats and the
 * per-round game quota. See lib/repo/json.js's dismissRecommendation for the
 * full argument.
 *
 * Stays NULL until the round dismisses its first title, so assemble() emits the
 * key only when it has ever been written — absent-key parity with the JSON
 * backend (.claude/rules/postgres-backend.md).
 */

exports.up = (knex) => knex.schema.alterTable('rounds', (t) => t.jsonb('dismissed_recommendations'));

exports.down = (knex) => knex.schema.alterTable('rounds', (t) => t.dropColumn('dismissed_recommendations'));
