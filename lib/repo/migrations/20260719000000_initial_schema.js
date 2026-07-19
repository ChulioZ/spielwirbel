'use strict';

/*
 * Baseline schema + Row-Level Security (issue #211).
 *
 * This is the ONE-TIME transition migration: it mirrors the pre-Knex inline
 * `SCHEMA`/`RLS` DDL exactly, as idempotent `CREATE ... IF NOT EXISTS` /
 * `ALTER ... ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS` + `CREATE
 * POLICY`. So applying it to the ALREADY-LIVE production database — which has
 * every object but no `knex_migrations` row yet — is a safe no-op that just
 * records this baseline; applying it to an empty database (CI, a fresh
 * self-host, local dev) creates the schema from scratch. Both paths converge.
 *
 * From here on, schema evolution is NEW migration files (add-column, index,
 * etc.), NOT edits to this one — that's the whole point of the move to Knex
 * migrations (ordered, tracked in `knex_migrations`, rollback-able).
 *
 * Knex wraps each migration in a transaction (like the old advisory-locked
 * init did), so the multi-statement DDL below is atomic. Kept as `knex.raw`
 * on purpose: idempotent `IF NOT EXISTS` DDL is what makes this a provable
 * no-op against the live schema — the .raw() escape hatch the "no ORM" note
 * calls out (RLS session var, `FORCE`, policies) has no fluent-builder
 * equivalent anyway.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rounds (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'default',
  name text NOT NULL,
  background jsonb,
  recommendation_runs jsonb,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  tenant_id text NOT NULL DEFAULT 'default',
  data jsonb NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS games (
  id text PRIMARY KEY,
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  tenant_id text NOT NULL DEFAULT 'default',
  data jsonb NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  tenant_id text NOT NULL DEFAULT 'default',
  data jsonb NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS activities (
  id text PRIMARY KEY,
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  tenant_id text NOT NULL DEFAULT 'default',
  data jsonb NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  seq bigserial
);
-- Schema evolution for databases created before tenancy (#136): the child
-- tables gain tenant_id, backfilled to the pre-tenancy single group. Idempotent,
-- like everything in this block. (rounds got the column at creation, #127.)
ALTER TABLE members    ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'default';
ALTER TABLE games      ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'default';
ALTER TABLE sessions   ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'default';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'default';
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users((data->>'email'));
CREATE INDEX IF NOT EXISTS rounds_tenant_idx ON rounds(tenant_id, seq);
CREATE INDEX IF NOT EXISTS members_round_idx ON members(round_id, seq);
CREATE INDEX IF NOT EXISTS games_round_idx ON games(round_id, seq);
CREATE INDEX IF NOT EXISTS sessions_round_idx ON sessions(round_id, seq);
CREATE INDEX IF NOT EXISTS activities_round_idx ON activities(round_id, seq);
CREATE INDEX IF NOT EXISTS games_image_idx ON games((data->>'image'));
`;

// Row-Level Security (#136, defense-in-depth): FORCE makes the policies bind the
// table owner too — Railway/CI connect as exactly that role, so without FORCE the
// whole layer would silently not apply. CREATE POLICY has no IF NOT EXISTS, hence
// DROP+CREATE (idempotent).
const RLS_TABLES = ['rounds', 'members', 'games', 'sessions', 'activities'];
const RLS = RLS_TABLES.map((t) => `
ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ${t}_tenant_isolation ON ${t};
CREATE POLICY ${t}_tenant_isolation ON ${t}
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
`).join('\n');

exports.up = async (knex) => {
  await knex.raw(SCHEMA);
  await knex.raw(RLS);
};

// Full teardown — for a local reset only; never run against production data.
// Ordered so FK dependencies drop cleanly (CASCADE covers the rest).
exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS activities, sessions, games, members, rounds, users CASCADE');
};
