'use strict';

/*
 * The round's opt-in draw boost (issue #1777, „Wer zu kurz kommt, ist dran"): a
 * nullable `draw_boost boolean` on rounds. NULL for every existing round, which
 * reads as OFF — the feature is off by default — so there is no data-rewriting
 * step to run under FORCE RLS (.claude/rules/rls-blocks-data-migrations.md).
 * assemble() emits `drawBoost: true` only for a TRUE column, matching the JSON
 * backend, which deletes the key when it is switched off.
 */

exports.up = (knex) => knex.schema.alterTable('rounds', (t) => t.boolean('draw_boost'));

exports.down = (knex) => knex.schema.alterTable('rounds', (t) => t.dropColumn('draw_boost'));
