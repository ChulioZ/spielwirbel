'use strict';

/*
 * The round's group challenge (issue #1779): two nullable jsonb columns on
 * rounds — `challenge` (the current goal) and `challenge_history` (finished
 * ones, newest first). Only the goal is stored; progress is derived from the
 * sessions (public/js/challenges.js). NULL for every existing round, which reads
 * as "no challenge", so there is no data-rewriting step to run under FORCE RLS
 * (.claude/rules/rls-blocks-data-migrations.md).
 */

exports.up = (knex) => knex.schema.alterTable('rounds', (t) => {
  t.jsonb('challenge');
  t.jsonb('challenge_history');
});

exports.down = (knex) => knex.schema.alterTable('rounds', (t) => {
  t.dropColumn('challenge');
  t.dropColumn('challenge_history');
});
