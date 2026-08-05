'use strict';

/*
 * Vote links (issue #652) — the capability behind the public /vote/:token screen.
 *
 * One row per shared per-device session. The random token is the PRIMARY KEY:
 * it is the only thing its holder has, and resolving it is what produces the
 * tenant, round and session to act on. `tenant_id` therefore lives in the jsonb
 * rather than as a column — nothing ever queries this table BY tenant except the
 * erasure cleanup, and promoting it would suggest the lookup is tenant-scoped
 * when the whole point is that it cannot be.
 *
 * Deliberately NOT tenant-scoped and NOT under RLS, exactly like `users` and
 * `round_grants`, and for a sharper version of the same reason: the caller is not
 * authenticated at all, so there is no `app.tenant_id` to set — an RLS-scoped
 * lookup here would match zero rows on every request.
 *
 * The unique index on (round_id, session_id) is what makes minting idempotent:
 * at most one live link per session, so a second tap on „Link teilen" hands out
 * the URL already sitting in the group chat instead of invalidating it.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS session_vote_links (
  id text PRIMARY KEY,
  round_id text NOT NULL,
  session_id text NOT NULL,
  data jsonb NOT NULL,
  seq bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS session_vote_links_session_idx
  ON session_vote_links(round_id, session_id);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS session_vote_links');
};
