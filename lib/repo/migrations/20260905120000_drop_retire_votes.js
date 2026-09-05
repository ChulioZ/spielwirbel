'use strict';

/*
 * Drop the retirement-proposal flag out of every stored vote (issue #909).
 *
 * #797 made "aussortieren" the ZERO of a 0–5 scale rather than a separate
 * control, but deliberately did not migrate storage — `effectiveRating()`
 * resolved both legacy shapes on read. #909 removes the option entirely, so the
 * read-side rule goes with it and the data has to be brought to the one shape
 * the surviving code understands:
 *
 *   { rating: null, retire: true }  ->  { rating: 1 }
 *   { rating: N,    retire: true }  ->  { rating: N }      (the flag just goes)
 *   { rating: N,    retire: false } ->  { rating: N }
 *
 * The first row is the only semantically NECESSARY write: the flag WAS the
 * vote there, so simply ignoring it would delete the opinion rather than
 * reinterpret it. The second deliberately REVERSES #797's precedence — with the
 * shelf signal gone, the stored rating is the only real opinion left in the row
 * — and needs no rewrite to behave correctly, since the new code reads
 * `v.rating` directly. The flag is dropped there anyway so no `retire` key
 * survives anywhere in the data.
 *
 * `retire` as the STRING "true" is NOT a retirement (`effectiveRating` required
 * `=== true`, and the corpus aggregate compared as jsonb for exactly that
 * reason), so such a row keeps its rating and only loses the key. Comparing
 * `->'retire' = 'true'::jsonb` here, not `->>'retire' = 'true'`, is what keeps
 * that true: the text form also matches the string.
 *
 * FORCE ROW LEVEL SECURITY IS THE TRAP THIS MIGRATION EXISTS TO SURVIVE. Every
 * round table has RLS with FORCE (20260719000000_initial_schema.js), and FORCE
 * binds the table OWNER — which is the role the app and the Knex CLI connect
 * as. `app.tenant_id` is unset during a migration, so `tenant_id =
 * current_setting('app.tenant_id', true)` is NULL, and a plain cross-tenant
 * UPDATE here would match ZERO rows and report success. Nothing would be red;
 * the votes would simply be gone from every average.
 *
 * So the rewrite lifts FORCE on `sessions` for its own duration and puts it
 * back, both inside the migration's transaction (DDL is transactional in
 * Postgres, so a failure rolls the lift back with it). Then it VERIFIES: if any
 * `retire` key is still reachable afterwards, it throws. A data migration that
 * can silently do nothing is the one shape that must not ship — see
 * .claude/rules/rls-blocks-data-migrations.md.
 *
 * Idempotent, and re-runnable on purpose: Railway's zero-downtime deploy
 * overlaps the outgoing and incoming containers, so the previous build can
 * still write a `retire` flag for a few seconds after this has run
 * (.claude/rules/deploy-invariants-are-pinned-in-code.md). Running it again
 * cleans that up; running it against already-clean data writes nothing at all
 * (the WHERE only matches rows that still carry the key).
 */

// Rows still carrying the key, anywhere two levels down in the votes blob.
// `-> 'retire' IS NOT NULL` is "the key exists" — a jsonb `null` value is not
// SQL NULL — and avoids the `?` operator, which knex.raw would read as a
// binding placeholder. The jsonb_typeof guards are load-bearing: jsonb_each
// ERRORS on a non-object, so one malformed blob would take the whole deploy
// down rather than being stepped over.
const STILL_FLAGGED = `
  jsonb_typeof(s.data->'votes') = 'object'
  AND EXISTS (
    SELECT 1
      FROM jsonb_each(s.data->'votes') AS person(pid, pvotes)
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(person.pvotes) = 'object' THEN person.pvotes ELSE '{}'::jsonb END
      ) AS vote(gid, val)
     WHERE jsonb_typeof(vote.val) = 'object' AND vote.val->'retire' IS NOT NULL
  )`;

// Rebuild votes[personId][gameId] with the flag resolved away. A non-object at
// either level is passed through untouched rather than normalised: this
// migration's job is the flag, and quietly "repairing" a shape nobody wrote
// would make it impossible to tell afterwards what the data had held.
const REWRITE = `
UPDATE sessions s SET data = jsonb_set(s.data, '{votes}', (
  SELECT coalesce(jsonb_object_agg(person.pid,
    CASE WHEN jsonb_typeof(person.pvotes) <> 'object' THEN person.pvotes ELSE (
      SELECT coalesce(jsonb_object_agg(vote.gid,
        CASE
          WHEN jsonb_typeof(vote.val) <> 'object' THEN vote.val
          WHEN vote.val->'retire' = 'true'::jsonb
               AND jsonb_typeof(vote.val->'rating') <> 'number'
            THEN (vote.val - 'retire') || '{"rating": 1}'::jsonb
          ELSE vote.val - 'retire'
        END), '{}'::jsonb)
        FROM jsonb_each(person.pvotes) AS vote(gid, val)
    ) END), '{}'::jsonb)
    FROM jsonb_each(s.data->'votes') AS person(pid, pvotes)
))
WHERE ${STILL_FLAGGED}`;

exports.up = async (knex) => {
  // See the header: without this the UPDATE below matches nothing at all.
  await knex.raw('ALTER TABLE sessions NO FORCE ROW LEVEL SECURITY');
  try {
    await knex.raw(REWRITE);
  } finally {
    await knex.raw('ALTER TABLE sessions FORCE ROW LEVEL SECURITY');
  }
  const left = await knex.raw(`SELECT count(*)::int AS n FROM sessions s WHERE ${STILL_FLAGGED}`);
  if (left.rows[0].n > 0) {
    throw new Error(`drop_retire_votes: ${left.rows[0].n} session(s) still carry a retire flag`);
  }
};

/*
 * Irreversible on purpose, and a no-op rather than a throw.
 *
 * The flags are not recoverable from the new shape — a migrated retire-only
 * vote is now indistinguishable from a genuine 1 — so there is nothing honest
 * for a down() to restore. Throwing would only make an unrelated
 * `migrate:rollback` fail on a step it cannot fix; the schema itself is
 * unchanged either way, which is what a rollback is actually for.
 */
exports.down = async () => {};
