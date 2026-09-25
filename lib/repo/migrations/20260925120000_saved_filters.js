'use strict';

/*
 * A round's saved session filters (issue #1328): a `saved_filters jsonb`
 * column on rounds holding the [{ id, name, tagIds, excludeTagIds, count,
 * memberIds, tagMode?, metadata?, multiTable? }] list the hub renders as its
 * quick-start chips.
 *
 * A COLUMN ON THE ROUND, beside `last_session_filters` — the filters are round
 * data shared by everyone at the round, and the list is bounded by
 * MAX_SAVED_FILTERS_PER_ROUND, so it rides the round row exactly like `tags`.
 *
 * Stays NULL until the round saves its first filter, so assemble() emits the key
 * only when it has ever been written — absent-key parity with the JSON backend
 * (.claude/rules/postgres-backend.md).
 *
 * Pure DDL: it rewrites no rows, so the FORCE-RLS trap for data migrations
 * (.claude/rules/rls-blocks-data-migrations.md) cannot bite, and the existing
 * tenant policy on `rounds` covers the new column with nothing added.
 */

exports.up = (knex) => knex.schema.alterTable('rounds', (t) => t.jsonb('saved_filters'));

exports.down = (knex) => knex.schema.alterTable('rounds', (t) => t.dropColumn('saved_filters'));
