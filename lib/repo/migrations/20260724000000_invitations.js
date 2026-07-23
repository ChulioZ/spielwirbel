'use strict';

/*
 * Round-sharing invitations (issue #207).
 *
 * An invitation records the inviter's decision to share a round with a specific
 * account, including whether the invitee takes over a specific user-less member
 * seat (memberId in the jsonb) or gets a fresh one on accept.
 *
 * Deliberately NOT tenant-scoped and NOT under RLS, exactly like `round_grants`
 * and `users`: an invitation crosses tenants (the inviter owns the round, the
 * invitee is a stranger to that tenant). Row shape mirrors the other global
 * stores — id + data jsonb + seq — with round_id and invitee_user_id promoted to
 * columns for the two reads (a round's invitations, an invitee's pending ones).
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS invitations (
  id text PRIMARY KEY,
  round_id text NOT NULL,
  invitee_user_id text NOT NULL,
  data jsonb NOT NULL,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS invitations_round_idx ON invitations(round_id, seq);
CREATE INDEX IF NOT EXISTS invitations_invitee_idx ON invitations(invitee_user_id, seq);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS invitations');
};
