'use strict';

/*
 * Delete the `designSwitchedBack` key from every stored account (issue #1480).
 *
 * #1201 stamped `designSwitchedBack: true` on an account that moved from another
 * design back to Klassisch, for one reader: the switch-back share on the
 * operator's „Funktionsnutzung" card. #1480 removed that share, and with it the
 * only reason to hold the field — keeping a personal-data field nothing reads
 * fails data minimisation (Art. 5 Abs. 1 lit. c DSGVO). The code stopped writing
 * it in the same change; this deletes the values already stored, so the field
 * is gone rather than merely unread.
 *
 * NO FORCE-RLS LIFT, AND THAT IS CORRECT — do not "fix" it by adding one.
 * .claude/rules/rls-blocks-data-migrations.md is about the ROUND tables, which
 * carry FORCE row-level security and so match zero rows in a migration. `users`
 * is not one of them: it is global, not tenant-scoped, and is absent from
 * RLS_TABLES in 20260719000000_initial_schema.js (no later migration enables RLS
 * on it). A plain UPDATE therefore sees every row. The verification below stays
 * anyway, because "a data migration that can silently do nothing" is the shape
 * that must not ship, whatever the reason it would do nothing.
 *
 * `jsonb_exists(data, 'designSwitchedBack')` is the `?` operator spelled as a
 * function: knex.raw would read a bare `?` as a binding placeholder.
 *
 * Idempotent, and re-runnable on purpose: Railway's zero-downtime deploy
 * overlaps the outgoing and incoming containers, so the previous build can still
 * write the key for a few seconds after this has run
 * (.claude/rules/deploy-invariants-are-pinned-in-code.md). Such a leftover is
 * harmless — nothing reads it, and it goes with the account — and running up()
 * again cleans it up; against clean data this writes nothing (the WHERE only
 * matches rows that carry the key).
 *
 * The table is locked against writes (EXCLUSIVE: reads such as /me carry on)
 * for the migration's own transaction — Knex runs each migration in one, and
 * LOCK TABLE refuses to run outside a transaction block, so a caller that
 * forgot one fails loudly instead of racing. Without the lock, an account write
 * committed by the still-serving previous container between the UPDATE and the
 * count would fail this migration, and therefore the deploy, over a key the code
 * no longer reads. `users` is small and the rewrite is one statement, so the
 * window is milliseconds.
 */

const STILL_STORED = `jsonb_typeof(data) = 'object' AND jsonb_exists(data, 'designSwitchedBack')`;

exports.up = async (knex) => {
  await knex.raw('LOCK TABLE users IN EXCLUSIVE MODE');
  await knex.raw(`UPDATE users SET data = data - 'designSwitchedBack' WHERE ${STILL_STORED}`);
  const left = await knex.raw(`SELECT count(*)::int AS n FROM users WHERE ${STILL_STORED}`);
  if (left.rows[0].n > 0) {
    throw new Error(`drop_design_switched_back: ${left.rows[0].n} account(s) still carry designSwitchedBack`);
  }
};

/*
 * Irreversible on purpose, and a no-op rather than a throw: the deleted values
 * are not recoverable, and the schema is unchanged either way, which is what a
 * rollback is for. Throwing would only make an unrelated `migrate:rollback` fail
 * on a step it cannot fix.
 */
exports.down = async () => {};
