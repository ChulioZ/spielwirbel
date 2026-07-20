'use strict';

/*
 * Remembered session-start filters (issue #252): a `last_session_filters jsonb`
 * column on rounds holding { tagIds, excludeTagIds, count } — the criteria the
 * round's most recent draw-flow session was started with, used to preset the
 * "New session" sheet next time.
 *
 * Stays NULL until the first draw-flow session runs (direct-pick sessions never
 * write it), so assemble() emits the key only once it has ever been written —
 * absent-key parity with the JSON backend (.claude/rules/postgres-backend.md).
 * Hence deliberately no non-null default.
 */

exports.up = (knex) => knex.schema.alterTable('rounds', (t) => t.jsonb('last_session_filters'));

exports.down = (knex) =>
  knex.schema.alterTable('rounds', (t) => t.dropColumn('last_session_filters'));
