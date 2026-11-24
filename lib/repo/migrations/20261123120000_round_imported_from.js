'use strict';

/*
 * Where a round came from (issue #1756): a nullable `imported_from text` on
 * rounds, written only by importRound ('export' — a round read back in from its
 * own data export). NULL for every existing round and every round created by
 * hand, so there is no data-rewriting step to run under FORCE RLS
 * (.claude/rules/rls-blocks-data-migrations.md). No read names it: the only
 * reader is the operator's „aus Export importiert" adoption figure, so a round
 * payload stays byte-identical to the JSON backend's, which strips the key.
 */

exports.up = (knex) => knex.schema.alterTable('rounds', (t) => t.text('imported_from'));

exports.down = (knex) => knex.schema.alterTable('rounds', (t) => t.dropColumn('imported_from'));
