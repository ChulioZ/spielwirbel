'use strict';

/*
 * Round invite links (issue #1515) — the capability behind /join/<token>.
 *
 * The random token is the PRIMARY KEY, exactly like `session_vote_links`, and for
 * the same reasons the table is global, NOT under RLS, and keeps the owner's
 * tenant in the jsonb: the token is what produces the tenant, so there is
 * nothing to scope the lookup by.
 *
 * `slot` is the seat the link hands out — a member id, or '' for "a fresh seat".
 * It is a column (not the jsonb's nullable memberId) because the unique index
 * needs a value that compares equal: two NULLs are distinct in a unique index,
 * so a nullable column would let two fresh-seat links coexist. The index is what
 * makes "a new link REPLACES the old one" a single atomic upsert.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS round_invite_links (
  id text PRIMARY KEY,
  round_id text NOT NULL,
  slot text NOT NULL,
  data jsonb NOT NULL,
  seq bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS round_invite_links_slot_idx
  ON round_invite_links(round_id, slot);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS round_invite_links');
};
