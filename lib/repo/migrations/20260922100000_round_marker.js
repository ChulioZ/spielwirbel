'use strict';

/*
 * A round's colour marker (issue #1187): a `marker smallint` column on rounds
 * holding an index 0-7 into whichever design the VIEWER wears. Rounds stopped
 * owning a design when designs became per-account (#1184); the marker is the
 * one thing about a round's appearance that is still the round's, and it is
 * deliberately design-neutral so two people in one round on two designs see
 * the same round as "the green one" in their own colours.
 *
 * Stays NULL for every round that predates markers, and that is the whole
 * design: there is no data-rewriting step here, so nothing has to be run under
 * FORCE RLS (.claude/rules/rls-blocks-data-migrations.md — a data migration
 * matches zero rows and reports success). A NULL marker is resolved on the
 * client from the round's retired `background`, render-time, which is the same
 * approach the #145 accent correction took and the reason this repo carries no
 * one-time migration code (CLAUDE.md).
 *
 * `smallint` rather than jsonb or text because the value is an integer 0-7 and
 * the route validates it as one; no non-null default, so assemble() can tell
 * "never set" from "set to 0" — index 0 is a real marker (Standard, Tannenfilz)
 * and a DEFAULT 0 would make every legacy round claim to have chosen it.
 */

exports.up = (knex) => knex.schema.alterTable('rounds', (t) => t.smallint('marker'));

exports.down = (knex) => knex.schema.alterTable('rounds', (t) => t.dropColumn('marker'));
