'use strict';

/*
 * Data-access layer — PostgreSQL backend (issue #127; Knex since #211).
 *
 * Selected by ./index.js when DATABASE_URL is set. Implements the exact same
 * async contract as ./json.js (the documented shape lives there), so routes are
 * unchanged whichever backend runs. This is the stateless-app-tier persistence
 * the production roadmap needs (docs/production-readiness.md §3).
 *
 * Query building + schema migrations go through **Knex** (issue #211): the
 * fluent builder replaces the hand-written parameterized SQL (and its JSONB
 * footguns), and versioned migration files under ./migrations replace the old
 * inline `CREATE TABLE IF NOT EXISTS` template re-run on every boot. The knex
 * instance is built from the shared ../../knexfile.js (same config the CLI uses).
 *
 * Storage shape — a table per top-level entity, one row each, with the "messy"
 * nested bits kept as JSONB (votes maps, gameIds/winnerIds arrays, activity
 * payloads, the design) exactly as the roadmap sanctions ("JSONB where that's
 * genuinely simpler, need not fully normalize on day one"):
 *   rounds(id, tenant_id, name, background jsonb, tags jsonb)
 *   members / games / sessions / activities (id, round_id -> rounds ON DELETE
 *   CASCADE, tenant_id, data jsonb)  — `data` holds every field except
 *   id/round_id.
 * `seq bigserial` preserves insertion order (arrays in the JSON model are
 * ordered).
 *
 * Tenancy (issue #136) — two independent layers, so a slip in one can't leak:
 *  1. App layer: every round-scoped method takes the tenant first and every
 *     statement filters/writes `tenant_id` explicitly (children carry it
 *     denormalized so a guessed round_id+child_id can't cross tenants).
 *  2. Row-Level Security: the round tables ENABLE + FORCE row level security
 *     with policies comparing tenant_id to the per-transaction setting
 *     `app.tenant_id`. Every tenant-scoped statement runs inside a transaction
 *     that sets it (tx/qt below). FORCE means even the table owner (the role
 *     Railway/CI connect as) is subject; `current_setting(..., true)` yields
 *     NULL when unset, so a query outside tx/qt sees NO rows — fail-closed,
 *     never fail-open.
 * The users table is NOT tenant-scoped: users are the identity layer (looked up
 * by email at login, before any tenant is known) and carry their tenantId in
 * `data` instead.
 *
 * Conventions:
 *  - Reads assemble plain objects fresh from the rows (like a DB snapshot), so a
 *    caller mutating a returned object never touches the store — same contract as
 *    the JSON backend.
 *  - Every value written to a JSONB column is passed through `J` (JSON.stringify),
 *    NOT as a raw JS value. Knex/pg serialize a plain object to JSON fine but turn
 *    a JS ARRAY into a Postgres array literal — corrupting `tags` (an array) and
 *    any array payload. Stringifying uniformly sidesteps the footgun; pg casts
 *    the text to jsonb on assignment.
 *  - JSONB reads come back already parsed (pg's jsonb parser -> JS objects).
 *  - Not-found -> `null`; never throws for it. SQL/connection errors do reject
 *    and reach the central error handler (Express 5 forwards them).
 */

const crypto = require('crypto');
const knex = require('knex')(require('../../knexfile'));
// The demo classifier lives in its own dependency-free leaf module: lib/demo.js
// requires the repo, so requiring it back from here would be a cycle.
const { DEMO_TENANT_PREFIX } = require('../demo-tenant');

const newId = () => crypto.randomBytes(8).toString('hex');
const J = (v) => JSON.stringify(v);

// Run fn inside a transaction (Knex BEGIN/COMMIT, ROLLBACK on throw). When
// `tenant` is non-null, the transaction sets the RLS scope `app.tenant_id` with
// set_config(..., true): it dies with the transaction, so no tenant ever leaks
// to the next pooled checkout. `fn` receives the Knex transaction object (used
// as a query builder). An early `return` with no writes commits an empty tx.
function tx(tenant, fn) {
  return knex.transaction(async (trx) => {
    if (tenant != null) {
      await trx.raw("SELECT set_config('app.tenant_id', ?, true)", [String(tenant)]);
    }
    return fn(trx);
  });
}

// One tenant-scoped statement in its own little transaction (the RLS setting
// only exists inside one — see tx). `fn(trx)` returns the builder to await.
// Each call costs BEGIN/SET/<stmt>/COMMIT = 4 round trips on its own pooled
// connection — acceptable on the write paths that use it, but exactly the
// amplification that made the hot reads slow against a hosted Postgres (#203);
// reads go through the single-round-trip READ_SQL statements below instead.
const qt = (tenant, fn) => tx(tenant, fn);

// A jsonb `data || <patch>` merge fragment — replaces whole top-level keys, the
// same semantics as the JSON backend's Object.assign. `knex.raw` keeps `?::jsonb`
// as a literal cast around the positional binding.
const mergeData = (patch) => knex.raw('data || ?::jsonb', [J(patch)]);

// Serialize concurrent boots (rolling deploys, parallel test processes) with a
// transaction-scoped advisory lock, then run pending migrations. Knex's own
// migration lock guards RUNNING migrations but NOT the first CREATE of its
// bookkeeping tables (knex_migrations / _lock) on an empty catalog — the same
// pg_class race the raw backend hit with CREATE TABLE IF NOT EXISTS (a known
// Postgres gap). Proven: without this lock, two simultaneous first-boots crash
// with a duplicate knex_migrations table; with it, they serialize cleanly. The
// lock-holding transaction stays open while migrate.latest() runs on OTHER
// pooled connections, so a second booter blocks on the advisory lock until the
// first has finished migrating. The xact variant self-releases at COMMIT.
const INIT_LOCK_KEY = 727135;

async function init() {
  await knex.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(?)', [INIT_LOCK_KEY]);
    await knex.migrate.latest();
  });
}

async function end() {
  await knex.destroy();
}

// Readiness probe for /readyz (#462): resolves when the database answers, and
// REJECTS when it does not — the rejection is the signal, so never catch in
// here. A GLOBAL method (no tenant argument), so it must stay out of
// TENANT_METHODS; `select 1` touches no round table, so it needs no tx()/RLS
// tenant setting and is unaffected by the policies.
//
// Deliberately the cheapest statement that still proves a live connection: it
// makes the pool hand out a checkout and round-trips to the server, which is
// exactly the failure this endpoint exists to surface. The caching that keeps a
// 1/min monitor from driving load lives in the handler, not here.
async function ping() {
  await knex.raw('select 1');
  return true;
}

// Re-attach the id column and merge the JSONB `data` back into one flat object,
// reproducing the JSON model's entity shape ({ id, ...fields }).
const withId = (row) => ({ id: row.id, ...row.data });

// Row count of an un-scoped global table (moderation_log, feedback — #288).
// Postgres count() is a bigint, which pg hands back as a STRING to avoid losing
// precision past 2^53 — returning it raw would make the JSON backend (a real
// number) and this one disagree, which the contract suite compares strictly.
const count = async (table) => Number((await knex(table).count('* as n').first()).n);

// Assemble the nested round object from its row + child rows, in the same key
// order the JSON backend builds. The activity feed is NOT part of it (issue
// #197 — it is unbounded and only Chronik reads it, via listActivities()).
// background is always present (may be null); tags and lastSessionFilters only
// when they have ever been written (matches the JSON model, where those keys are
// absent until addTag / the first draw-flow session runs). tenant_id is scoping
// metadata, never payload.
function assemble(round, children) {
  const out = {
    id: round.id,
    name: round.name,
    members: children.members.map(withId),
    games: children.games.map(withId),
    sessions: children.sessions.map(withId),
    background: round.background ?? null,
  };
  if (round.tags != null) out.tags = round.tags;
  if (round.providers != null) out.providers = round.providers;
  if (round.lastSessionFilters != null) out.lastSessionFilters = round.lastSessionFilters;
  return out;
}

/*
 * Single-round-trip read statements (issue #203). The hot reads (home screen,
 * round navigation, Chronik) used to issue one qt() PER TABLE — each a full
 * transaction: BEGIN + set_config + SELECT + COMMIT = 4 round trips on its own
 * pooled connection. Measured against a latency-injected Postgres, that put
 * ~9 round trips of wall time under GET /api/rounds and ~4.4 under
 * GET /api/rounds/:rid — the ~1s hosted round loads #203 was filed for.
 *
 * These statements collapse each read to ONE round trip on ONE connection:
 *
 *  - The materialized CTE `_t` calls set_config('app.tenant_id', ?, true),
 *    establishing the RLS tenant scope *inside the statement's own implicit
 *    transaction*; being transaction-local it dies at statement end, so nothing
 *    ever leaks to the next pooled checkout (same guarantee tx() gives).
 *  - Every subquery correlates on `_t.v` — set_config's RETURN VALUE (the
 *    tenant id). That is a real dataflow dependency, not an ordering hope: the
 *    executor must produce the `_t` row (running set_config) before it can
 *    evaluate any target-list subquery, so the RLS policies' current_setting()
 *    always sees the tenant during the scans. MATERIALIZED (plus set_config
 *    being volatile) keeps the CTE a separate, evaluate-first node.
 *  - The explicit `tenant_id = _t.v` predicates stay the app-layer half of the
 *    double enforcement (.claude/rules/tenancy-rls.md); RLS remains the
 *    backstop. If the evaluation-order guarantee ever broke, RLS would return
 *    ZERO rows (fail-closed, loud) — never cross-tenant data. The plain-role
 *    probe in test/repo.postgres.test.js runs these texts under FORCE RLS as a
 *    non-superuser to prove the ordering holds for real.
 *
 * Exported for exactly that test; don't rewrite these reads back onto qt() —
 * that reintroduces the round-trip amplification this fixed.
 */
// jsonb_agg of {id[, round_id], data} entity rows, insertion-ordered, [] when none.
const AGG = "coalesce(jsonb_agg(jsonb_build_object('id', id, 'data', data) ORDER BY seq), '[]'::jsonb)";
const AGG_RID = "coalesce(jsonb_agg(jsonb_build_object('id', id, 'round_id', round_id, 'data', data) ORDER BY seq), '[]'::jsonb)";
const ROUND_OBJ = "jsonb_build_object('id', id, 'name', name, 'background', background, 'tags', tags, 'providers', providers, 'lastSessionFilters', last_session_filters)";
// The per-round home summary object (counts + the "last played" highlight),
// shared by the whole-tenant `summaries` read and the single-round `summary`
// read (#207 home-merge, so a granted round can appear on the grantee's home).
// References the round alias `r` and the tenant CTE `_t`; both readers provide them.
const SUMMARY_OBJ = `jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'members', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object('id', m.id, 'name', m.data->'name')
          || (CASE WHEN jsonb_exists(m.data, 'color')
                THEN jsonb_build_object('color', m.data->'color') ELSE '{}'::jsonb END)
        ORDER BY m.seq), '[]'::jsonb)
      FROM members m WHERE m.round_id = r.id AND m.tenant_id = _t.v),
    'memberCount', (SELECT count(*) FROM members m WHERE m.round_id = r.id AND m.tenant_id = _t.v),
    'gameCount', (SELECT count(*) FROM games g WHERE g.round_id = r.id AND g.tenant_id = _t.v
      AND (g.data->>'retired')::boolean IS NOT TRUE
      AND (g.data->>'completed')::boolean IS NOT TRUE),
    'sessionCount', (SELECT count(*) FROM sessions s WHERE s.round_id = r.id AND s.tenant_id = _t.v),
    'playedCount', (SELECT count(*) FROM sessions s WHERE s.round_id = r.id AND s.tenant_id = _t.v
      AND (s.data->>'finished')::boolean IS TRUE),
    'background', r.background,
    'lastPlayed', (
      SELECT jsonb_build_object(
        'gameTitle', g.data->'title',
        'winnerNames', (
          SELECT coalesce(jsonb_agg(mw.data->>'name' ORDER BY w.ord), '[]'::jsonb)
          FROM jsonb_array_elements_text(coalesce(s.data->'winnerIds', '[]'::jsonb))
            WITH ORDINALITY AS w(wid, ord)
          JOIN members mw ON mw.id = w.wid AND mw.round_id = r.id AND mw.tenant_id = _t.v),
        'at', s.data->'createdAt')
      FROM sessions s
      JOIN games g ON g.id = s.data->>'chosenGameId' AND g.round_id = r.id AND g.tenant_id = _t.v
      WHERE s.round_id = r.id AND s.tenant_id = _t.v
        AND (s.data->>'finished')::boolean IS TRUE
      ORDER BY s.data->>'createdAt' DESC, s.seq ASC
      LIMIT 1)
  )`;
const READ_SQL = {
  // bindings: [tenant]
  list: `
WITH _t AS MATERIALIZED (SELECT set_config('app.tenant_id', ?, true) AS v)
SELECT
  (SELECT coalesce(jsonb_agg(${ROUND_OBJ} ORDER BY seq), '[]'::jsonb)
     FROM rounds WHERE tenant_id = _t.v) AS rounds,
  (SELECT ${AGG_RID} FROM members  WHERE tenant_id = _t.v) AS members,
  (SELECT ${AGG_RID} FROM games    WHERE tenant_id = _t.v) AS games,
  (SELECT ${AGG_RID} FROM sessions WHERE tenant_id = _t.v) AS sessions
FROM _t`,
  // bindings: [tenant]. The home-screen summary, computed entirely in the
  // database: counts + the "last played" highlight per round, WITHOUT shipping
  // every game/session row to the app. listRounds moves the tenant's whole
  // dataset (~80 KB for one real group today, megabytes at quota scale) to
  // answer with under a kilobyte — over a non-local DB link the transfer alone
  // dominated the request (the #294-era ~600 ms home loads). This statement
  // keeps the one-round-trip property AND makes the bytes proportional to the
  // response. lastPlayed mirrors lib/routes/rounds.js's old JS exactly: newest
  // finished session (by createdAt, seq as the stable tiebreak) whose chosen
  // game still exists; winnerNames keep winnerIds order and drop unknown ids.
  // jsonb_exists(), never the jsonb `?` operator: `?` is the positional
  // binding character for knex (and pg's $-rewriting test probe), so the
  // operator form cannot appear in any SQL text the repo executes.
  summaries: `
WITH _t AS MATERIALIZED (SELECT set_config('app.tenant_id', ?, true) AS v)
SELECT coalesce(jsonb_agg(x.s ORDER BY x.seq), '[]'::jsonb) AS summaries
FROM _t, LATERAL (
  SELECT r.seq, ${SUMMARY_OBJ} AS s
  FROM rounds r WHERE r.tenant_id = _t.v
) x`,
  // bindings: [tenant, rid]. One round's home summary (#207 home-merge): same
  // shape and same set_config-before-scan ordering as `summaries`, filtered to a
  // single round so a grantee's home load fetches ONLY the granted round, never
  // the owner's other rounds. Zero rows (wrong id/tenant) → the method returns null.
  summary: `
WITH _t AS MATERIALIZED (SELECT set_config('app.tenant_id', ?, true) AS v)
SELECT ${SUMMARY_OBJ} AS s
FROM _t, rounds r WHERE r.tenant_id = _t.v AND r.id = ?`,
  // bindings: [tenant, rid, rid, rid, rid]
  round: `
WITH _t AS MATERIALIZED (SELECT set_config('app.tenant_id', ?, true) AS v)
SELECT
  (SELECT ${ROUND_OBJ} FROM rounds WHERE id = ? AND tenant_id = _t.v) AS round,
  (SELECT ${AGG} FROM members  WHERE round_id = ? AND tenant_id = _t.v) AS members,
  (SELECT ${AGG} FROM games    WHERE round_id = ? AND tenant_id = _t.v) AS games,
  (SELECT ${AGG} FROM sessions WHERE round_id = ? AND tenant_id = _t.v) AS sessions
FROM _t`,
  // bindings: [tenant, rid, rid]
  activities: `
WITH _t AS MATERIALIZED (SELECT set_config('app.tenant_id', ?, true) AS v)
SELECT
  (SELECT jsonb_build_object('id', id) FROM rounds WHERE id = ? AND tenant_id = _t.v) AS round,
  (SELECT ${AGG} FROM activities WHERE round_id = ? AND tenant_id = _t.v) AS acts
FROM _t`,
  // bindings: [tenant, rid, rid]. The light validation read: the round row +
  // its members (a handful of tiny rows), WITHOUT the games/sessions payload.
  // Mutation routes fetch the round only to 404 and to validate against
  // tags/providers/members — pulling every game and vote map out of the
  // database for that made each WRITE as expensive as the biggest read.
  meta: `
WITH _t AS MATERIALIZED (SELECT set_config('app.tenant_id', ?, true) AS v)
SELECT
  (SELECT ${ROUND_OBJ} FROM rounds WHERE id = ? AND tenant_id = _t.v) AS round,
  (SELECT ${AGG} FROM members WHERE round_id = ? AND tenant_id = _t.v) AS members
FROM _t`,
  // bindings: [tenant, sid, rid] / [tenant, gid, rid] — one child entity row.
  session: `
WITH _t AS MATERIALIZED (SELECT set_config('app.tenant_id', ?, true) AS v)
SELECT (SELECT jsonb_build_object('id', id, 'data', data) FROM sessions
  WHERE id = ? AND round_id = ? AND tenant_id = _t.v) AS entity
FROM _t`,
  game: `
WITH _t AS MATERIALIZED (SELECT set_config('app.tenant_id', ?, true) AS v)
SELECT (SELECT jsonb_build_object('id', id, 'data', data) FROM games
  WHERE id = ? AND round_id = ? AND tenant_id = _t.v) AS entity
FROM _t`,
};

// Fetch a round's assembled child collections (ordered) on the given tx client.
// Awaited one at a time on purpose: a single transaction runs on ONE connection,
// which cannot run concurrent queries. The transaction already carries the RLS
// tenant; the explicit tenant_id predicate is the app-layer half of the double
// enforcement. (Write flows only — the hot reads use READ_SQL above.)
async function childrenOf(trx, tenant, rid) {
  const members = await trx('members').where({ round_id: rid, tenant_id: tenant }).orderBy('seq').select('id', 'data');
  const games = await trx('games').where({ round_id: rid, tenant_id: tenant }).orderBy('seq').select('id', 'data');
  const sessions = await trx('sessions').where({ round_id: rid, tenant_id: tenant }).orderBy('seq').select('id', 'data');
  return { members, games, sessions };
}

// Append an activity row (feed) on a tx client. Same {type, at, ...payload}
// shape as the JSON backend, minus the id (that's the row's own column).
async function addActivity(trx, tenant, rid, type, payload, actorMemberId) {
  const data = { type, at: new Date().toISOString(), ...payload };
  // Who did it (#207) — the acting account's member seat, when known. Absent
  // otherwise, matching the JSON backend (absent-key parity).
  if (actorMemberId) data.actorMemberId = actorMemberId;
  await trx('activities').insert({ id: newId(), round_id: rid, tenant_id: tenant, data: J(data) });
}

/* ---------------------------------- Rounds --------------------------------- */

async function listRounds(tenant) {
  // One round trip for the whole tenant (READ_SQL rationale above): rounds plus
  // ALL child rows, grouped per round in JS. The global ORDER BY seq preserves
  // each round's insertion order through the stable grouping.
  const { rows } = await knex.raw(READ_SQL.list, [tenant]);
  const { rounds, members, games, sessions } = rows[0];
  const group = (entityRows) => {
    const m = new Map();
    for (const row of entityRows) {
      if (!m.has(row.round_id)) m.set(row.round_id, []);
      m.get(row.round_id).push(row);
    }
    return m;
  };
  const mm = group(members), mg = group(games), ms = group(sessions);
  return rounds.map((r) =>
    assemble(r, {
      members: mm.get(r.id) || [],
      games: mg.get(r.id) || [],
      sessions: ms.get(r.id) || [],
    })
  );
}

// The home-screen summary rows (see READ_SQL.summaries for why this exists and
// what it computes). One round trip, bytes proportional to the response.
async function listRoundSummaries(tenant) {
  const { rows } = await knex.raw(READ_SQL.summaries, [tenant]);
  return rows[0].summaries;
}

// One round's home summary (#207 home-merge) — the same shape as an entry of
// listRoundSummaries. Fetches only this round (never the tenant's others), so it
// is what the home read uses per granted round. Null when the round is missing or
// another tenant's.
async function getRoundSummary(tenant, rid) {
  const { rows } = await knex.raw(READ_SQL.summary, [tenant, rid]);
  return rows[0] ? rows[0].s : null;
}

async function getRound(tenant, rid) {
  // One round trip for the round + its three child collections (READ_SQL above).
  const { rows } = await knex.raw(READ_SQL.round, [tenant, rid, rid, rid, rid]);
  const { round, members, games, sessions } = rows[0];
  if (!round) return null;
  return assemble(round, { members, games, sessions });
}

// The light validation read (READ_SQL.meta): everything getRound carries except
// the games/sessions collections. Same key semantics as assemble — background
// always present, tags/providers/lastSessionFilters only when ever written.
async function getRoundMeta(tenant, rid) {
  const { rows } = await knex.raw(READ_SQL.meta, [tenant, rid, rid]);
  const { round, members } = rows[0];
  if (!round) return null;
  const out = {
    id: round.id,
    name: round.name,
    members: members.map(withId),
    background: round.background ?? null,
  };
  if (round.tags != null) out.tags = round.tags;
  if (round.providers != null) out.providers = round.providers;
  if (round.lastSessionFilters != null) out.lastSessionFilters = round.lastSessionFilters;
  return out;
}

// One session / one game by id, without assembling the whole round (the write
// routes validate against a single entity). Wrong round or tenant reads as
// not-found, like everywhere else.
async function getSession(tenant, rid, sid) {
  const { rows } = await knex.raw(READ_SQL.session, [tenant, sid, rid]);
  return rows[0].entity ? withId(rows[0].entity) : null;
}

async function getGame(tenant, rid, gid) {
  const { rows } = await knex.raw(READ_SQL.game, [tenant, gid, rid]);
  return rows[0].entity ? withId(rows[0].entity) : null;
}

// See the JSON backend for the contract. The owner seat is inserted FIRST so it
// takes the lowest `seq` and reads back at index 0, matching the JSON backend's
// prepend; the typed members carry no `userId` key at all (absent-key parity).
async function createRound(tenant, { name, members, owner, importFromRoundId }) {
  return tx(tenant, async (trx) => {
    const rid = newId();
    await trx('rounds').insert({ id: rid, tenant_id: tenant, name, background: null });
    if (owner) {
      await trx('members').insert({
        id: newId(), round_id: rid, tenant_id: tenant, data: J({ name: owner.name, userId: owner.userId }),
      });
    }
    for (const nm of members) {
      await trx('members').insert({ id: newId(), round_id: rid, tenant_id: tenant, data: J({ name: nm }) });
    }
    if (importFromRoundId) {
      // Active games only, copying just title/image — and only from a round of
      // the same tenant.
      const src = await trx('games')
        .where({ round_id: importFromRoundId, tenant_id: tenant })
        .whereRaw("(data->>'retired')::boolean IS NOT TRUE")
        .whereRaw("(data->>'completed')::boolean IS NOT TRUE")
        .orderBy('seq')
        .select('data');
      for (const row of src) {
        const gid = newId();
        const data = {
          title: row.data.title,
          image: row.data.image,
          retired: false,
          retiredAt: null,
          completed: false,
          completedAt: null,
        };
        await trx('games').insert({ id: gid, round_id: rid, tenant_id: tenant, data: J(data) });
        await addActivity(trx, tenant, rid, 'game_added', { gameId: gid, title: data.title });
      }
    }
    // Aliased so assemble() sees the same camelCase key ROUND_OBJ builds.
    const round = await trx('rounds')
      .where({ id: rid })
      .select('id', 'name', 'background', 'tags', 'providers', 'last_session_filters as lastSessionFilters');
    return assemble(round[0], await childrenOf(trx, tenant, rid));
  });
}

// See the JSON backend for the contract (#562) — including why an unchanged name
// writes no activity and why the entry carries only the new name. The whole
// round is assembled on the way out so the response matches getRound exactly;
// a rename is rare, and createRound already pays the same cost.
//
// Inside tx(), never a bare knex update: rounds are RLS-scoped, so an unscoped
// write matches zero rows under a non-superuser role and reports success
// (.claude/rules/tenancy-rls.md).
async function renameRound(tenant, rid, name, actorMemberId) {
  return tx(tenant, async (trx) => {
    const current = await trx('rounds').where({ id: rid, tenant_id: tenant }).first('id', 'name');
    if (!current) return null;
    if (current.name !== name) {
      await trx('rounds').where({ id: rid, tenant_id: tenant }).update({ name });
      await addActivity(trx, tenant, rid, 'round_renamed', { name }, actorMemberId);
    }
    // Aliased so assemble() sees the same camelCase key ROUND_OBJ builds.
    const round = await trx('rounds')
      .where({ id: rid })
      .select('id', 'name', 'background', 'tags', 'providers', 'last_session_filters as lastSessionFilters');
    return assemble(round[0], await childrenOf(trx, tenant, rid));
  });
}

// See the JSON backend for the contract and why the images must be collected
// before the delete (#280). Children go with the round via ON DELETE CASCADE,
// which is exactly why their cover paths are unrecoverable afterwards.
// Sequential awaits: one transaction runs on one connection (see
// .claude/rules/postgres-backend.md).
async function deleteRound(tenant, rid) {
  return tx(tenant, async (trx) => {
    const round = await trx('rounds')
      .where({ id: rid, tenant_id: tenant })
      .first('id', 'background');
    if (!round) return null;

    const games = await trx('games')
      .where({ round_id: rid, tenant_id: tenant })
      .whereRaw("data->>'image' IS NOT NULL")
      .select('data');

    const images = new Set();
    for (const g of games) images.add(g.data.image);
    if (round.background && round.background.type === 'collage' && round.background.image) {
      images.add(round.background.image);
    }

    await trx('rounds').where({ id: rid, tenant_id: tenant }).del();
    return { images: [...images] };
  });
}

/* ---------------------------------- Users ----------------------------------- */
/*
 * Accounts (issue #135): users(id, data jsonb) with a unique index on the email
 * inside `data`. Deliberately global — no tenant scoping, no RLS (see the header)
 * — each user's `tenantId` lives in `data` (#136). Every key in the user object
 * is always present (null when unset), so jsonb round-trips match the JSON
 * backend exactly (absent-key parity, .claude/rules/postgres-backend.md). These
 * methods use the base knex instance (no tenant transaction) since users aren't
 * RLS-scoped.
 */

async function createUser(fields) {
  // The username (#320) is checked BEFORE the insert rather than left to the
  // unique index alone: which of two violated indexes Postgres reports first is
  // not a contract, and a row colliding on both must answer 'username_taken'
  // deterministically — otherwise the OPEN username error becomes a probe for
  // the deliberately HIDDEN e-mail one (see lib/routes/account.js and the JSON
  // backend, which orders its checks the same way). The index below stays the
  // race backstop for two simultaneous registrations.
  if (fields.username && (await getUserByUsername(fields.username))) return 'username_taken';
  const uid = newId();
  try {
    await knex('users').insert({ id: uid, data: J(fields) });
  } catch (e) {
    if (e.code !== '23505') throw e; // not a unique_violation
    // The constraint name says which handle was taken — but ONLY ever one name,
    // even when both indexes are violated, and it is not the one we check first.
    // Measured against Postgres 16: an insert colliding on the username alone
    // reports `users_username_idx`, but one colliding on BOTH reports
    // `users_email_idx`. Trusting the name there would answer email_taken for a
    // taken username — reintroducing, in the race window this branch exists for,
    // exactly the leak the pre-check above closes. So re-read the username
    // instead of guessing; this runs only on the error path.
    if (e.constraint === 'users_username_idx') return 'username_taken';
    return fields.username && (await getUserByUsername(fields.username)) ? 'username_taken' : 'email_taken';
  }
  return { id: uid, ...fields };
}

async function getUserById(uid) {
  const rows = await knex('users').where({ id: uid }).select('id', 'data');
  return rows[0] ? withId(rows[0]) : null;
}

async function getUserByEmail(email) {
  const rows = await knex('users').whereRaw("data->>'email' = ?", [email]).select('id', 'data');
  return rows[0] ? withId(rows[0]) : null;
}

// Resolve the public handle (#320), case-insensitively — the expression matches
// the users_username_idx index, so this is an index scan, not a table scan.
async function getUserByUsername(username) {
  const name = String(username || '').trim();
  if (!name) return null;
  const rows = await knex('users')
    .whereRaw("lower(data->>'username') = lower(?)", [name])
    .select('id', 'data');
  return rows[0] ? withId(rows[0]) : null;
}

// jsonb || replaces whole top-level keys — same semantics as the JSON backend's
// Object.assign, so token lists/identities are always passed complete.
async function updateUser(uid, patch) {
  const rows = await knex('users').where({ id: uid }).update({ data: mergeData(patch) }).returning(['id', 'data']);
  return rows[0] ? withId(rows[0]) : null;
}

async function deleteUser(uid) {
  const n = await knex('users').where({ id: uid }).del();
  return n > 0;
}

// Every user, for the operator's account list (#268). The ROUTE strips secrets
// before responding — the repo returns the stored shape, as it does everywhere.
async function listUsers() {
  const rows = await knex('users').orderBy('seq', 'asc').select('id', 'data');
  return rows.map(withId);
}

/*
 * Demo accounts (#427) — global, mirroring the JSON backend exactly; see the
 * comment there for why `demoExpiresAt` is compared as text and why a missing
 * expiry reads as expired.
 *
 * `data->>'demo' = 'true'` deliberately avoids `::boolean`: the cast throws on
 * any value that isn't boolean-shaped, which would turn one malformed row into a
 * failure of the whole purge sweep. A plain text compare just doesn't match it.
 *
 * The count goes through Number() for the reason every count here does — pg
 * hands back a bigint as a STRING, so returning it raw would have this backend
 * answer '3' where the JSON one answers 3 (.claude/rules/postgres-backend.md).
 */
async function countLiveDemoUsers(now) {
  const row = await knex('users')
    .whereRaw("data->>'demo' = 'true'")
    .whereRaw("data->>'demoExpiresAt' > ?", [now])
    .count('* as n')
    .first();
  return Number(row.n);
}

/*
 * The per-IP live-demo cap (#502) — same contract as the JSON backend.
 *
 * The empty-hash guard is deliberately kept here even though SQL would answer 0
 * anyway: `data->>'demoIpHash' = NULL` is NULL, never true, so a null binding
 * matches nothing. The JSON backend's `===` does the OPPOSITE — it matches every
 * row that stored null — so the two backends disagree by default on exactly the
 * input that decides whether unattributable mints share one bucket. Stating the
 * guard in both is what makes the contract hold by construction rather than by
 * each backend's accidental semantics.
 *
 * Note the consequence for the contract suite: its empty-hash assertion goes red
 * against the JSON backend when the guard is removed and stays green here, so a
 * green Postgres run is not evidence this line is doing anything. Don't delete it
 * on that basis.
 */
async function countLiveDemoUsersByIp(now, ipHash) {
  if (!ipHash) return 0;
  const row = await knex('users')
    .whereRaw("data->>'demo' = 'true'")
    .whereRaw("data->>'demoExpiresAt' > ?", [now])
    .whereRaw("data->>'demoIpHash' = ?", [ipHash])
    .count('* as n')
    .first();
  return Number(row.n);
}

async function listExpiredDemoUsers(now) {
  const rows = await knex('users')
    .whereRaw("data->>'demo' = 'true'")
    .whereRaw("coalesce(data->>'demoExpiresAt', '') <= ?", [now])
    .orderBy('seq', 'asc')
    .select('id');
  return rows.map((r) => r.id);
}

/* -------------------------------- Moderation -------------------------------- */
/*
 * Operator tooling (#268) — the only GLOBAL (cross-tenant) round-data access in
 * this backend, because an abuse notice names an image, not a tenant. Not in
 * TENANT_METHODS; routes reach these on the module-level repo, never req.repo.
 *
 * `atx` is the read-only admin escape: a transaction that sets `app.admin='on'`,
 * which a separate FOR SELECT RLS policy admits (migration
 * 20260720140000_moderation.js). So a lookup can see across tenants while a
 * WRITE still cannot — the tenant policy is untouched and is the only one
 * consulted for INSERT/UPDATE/DELETE. That split is deliberate and structural:
 * `OR`-ing the flag into the existing FOR ALL policy's USING clause would have
 * opened cross-tenant DELETE, which has no WITH CHECK to hold it back. The
 * setting is transaction-local (set_config(..., true)), so it dies at COMMIT and
 * never reaches the next pooled checkout, exactly like app.tenant_id.
 *
 * Consequently takedownImage does NOT write under the escape: it resolves the
 * owning tenant with a read, then performs the update through the ordinary
 * tenant-scoped tx(tenant, ...) path.
 */
function atx(fn) {
  return knex.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.admin', 'on', true)", []);
    return fn(trx);
  });
}

async function findImageOwner(image) {
  const rows = await atx((trx) =>
    trx('games')
      .join('rounds', 'rounds.id', 'games.round_id')
      .whereRaw("games.data->>'image' = ?", [image])
      .select(
        'games.id as gameId',
        'games.tenant_id as tenantId',
        'games.data as gameData',
        'rounds.id as roundId',
        'rounds.name as roundName',
      )
      .first());
  if (!rows) return null;
  return {
    image,
    tenantId: rows.tenantId,
    roundId: rows.roundId,
    roundName: rows.roundName,
    gameId: rows.gameId,
    gameTitle: rows.gameData.title,
  };
}

// Clear the cover from every game referencing this path, across all tenants.
// Returns the count of games changed. The per-tenant loop is what keeps the
// write inside normal tenant isolation (see the atx note above): the escape
// finds the rows, the tenant-scoped transaction changes them.
async function takedownImage(image) {
  const targets = await atx((trx) =>
    trx('games').whereRaw("data->>'image' = ?", [image]).select('id', 'tenant_id'));
  let cleared = 0;
  for (const t of targets) {
    const rows = await qt(t.tenant_id, (trx) =>
      trx('games')
        .where({ id: t.id, tenant_id: t.tenant_id })
        .update({ data: mergeData({ image: null }) })
        .returning('id'));
    if (rows[0]) cleared += 1;
  }
  return cleared;
}

/* --------------------- Broader lookup & redaction (#275) -------------------- */
/*
 * Resolve a round link to its tenant, summarise what a tenant holds, list a
 * round's user-authored text, and redact one field of it. See the JSON backend
 * for the contract; the split below is what this backend adds:
 *
 *   READS  run under atx()   — cross-tenant by nature (a notice names a round or
 *                              an e-mail, not a tenant), and the admin policy is
 *                              FOR SELECT, so this is exactly what it admits.
 *   WRITES run under tx(tenant, …) — NEVER atx(). The admin policy contributes
 *                              nothing to UPDATE, so a redaction attempted under
 *                              the escape would match zero rows and report a
 *                              success that changed nothing. Same shape as
 *                              takedownImage: the escape finds the row, the
 *                              tenant-scoped transaction changes it.
 */

async function findRoundOwner(roundId) {
  const row = await atx((trx) => trx('rounds').where({ id: roundId }).first('id', 'name', 'tenant_id'));
  if (!row) return null;
  return { roundId: row.id, roundName: row.name, tenantId: row.tenant_id };
}

async function tenantSummary(tenantId) {
  if (!tenantId) return null;
  return atx(async (trx) => {
    // Awaited one at a time: a single transaction runs on ONE connection and
    // cannot serve concurrent queries (see the tx note above).
    const rounds = await trx('rounds')
      .where({ tenant_id: tenantId }).orderBy('seq').select('id', 'name', 'tags');
    if (!rounds.length) {
      return {
        tenantId,
        rounds: [],
        totals: {
          rounds: 0, members: 0, games: 0, activeGames: 0, sessions: 0, tags: 0,
        },
        images: [],
      };
    }

    // ::int on every count: Postgres count() is a bigint, which pg hands back as
    // a STRING — returned raw it would make this backend disagree with the JSON
    // one's real numbers, and the totals below would concatenate instead of add.
    const byRound = async (table, extra) => {
      const rows = await trx(table)
        .where({ tenant_id: tenantId })
        .groupBy('round_id')
        .select('round_id')
        .select(trx.raw('count(*)::int as n'))
        .modify((qb) => { if (extra) qb.select(trx.raw(extra)); });
      return new Map(rows.map((r) => [r.round_id, r]));
    };

    const members = await byRound('members');
    const games = await byRound(
      'games',
      "count(*) FILTER (WHERE (data->>'retired')::boolean IS NOT TRUE"
      + " AND (data->>'completed')::boolean IS NOT TRUE)::int as active",
    );
    const sessions = await byRound('sessions');

    const imageRows = await trx('games')
      .where({ tenant_id: tenantId })
      .whereRaw("data->>'image' IS NOT NULL")
      .select(trx.raw("data->>'image' as image"));

    const list = rounds.map((r) => ({
      id: r.id,
      name: r.name,
      members: (members.get(r.id) || {}).n || 0,
      games: (games.get(r.id) || {}).n || 0,
      activeGames: (games.get(r.id) || {}).active || 0,
      sessions: (sessions.get(r.id) || {}).n || 0,
      tags: (r.tags || []).length,
    }));
    const sum = (key) => list.reduce((n, r) => n + r[key], 0);

    return {
      tenantId,
      rounds: list,
      totals: {
        rounds: list.length,
        members: sum('members'),
        games: sum('games'),
        activeGames: sum('activeGames'),
        sessions: sum('sessions'),
        tags: sum('tags'),
      },
      images: [...new Set(imageRows.map((g) => g.image))],
    };
  });
}

async function roundContent(roundId) {
  return atx(async (trx) => {
    const round = await trx('rounds').where({ id: roundId }).first('id', 'name', 'tenant_id', 'tags');
    if (!round) return null;
    const members = await trx('members').where({ round_id: roundId }).orderBy('seq').select('id', 'data');
    const games = await trx('games').where({ round_id: roundId }).orderBy('seq').select('id', 'data');
    return {
      roundId: round.id,
      roundName: round.name,
      tenantId: round.tenant_id,
      members: members.map((m) => ({ id: m.id, name: m.data.name })),
      games: games.map((g) => ({ id: g.id, title: g.data.title })),
      tags: (round.tags || []).map((tg) => ({ id: tg.id, name: tg.name })),
    };
  });
}

async function redactText({ kind, roundId, id: targetId }, replacement) {
  // Feedback is a global, un-scoped table with no RLS (like moderation_log), so
  // it needs neither escape nor tenant transaction.
  if (kind === 'feedback') {
    const row = await knex('feedback').where({ id: targetId }).first('id', 'data');
    if (!row) return null;
    await knex('feedback').where({ id: targetId }).update({ data: mergeData({ message: replacement }) });
    return {
      kind,
      tenantId: (row.data.context || {}).tenantId || null,
      roundId: null,
      id: targetId,
      previous: row.data.message,
    };
  }

  // Only the tenant RESOLUTION is cross-tenant; everything below runs scoped.
  const owner = await atx((trx) => trx('rounds').where({ id: roundId }).first('id', 'tenant_id'));
  if (!owner) return null;
  const tenant = owner.tenant_id;
  const done = (id_, previous) => ({
    kind, tenantId: tenant, roundId, id: id_, previous,
  });

  return tx(tenant, async (trx) => {
    if (kind === 'round') {
      const row = await trx('rounds').where({ id: roundId, tenant_id: tenant }).first('name');
      if (!row) return null;
      await trx('rounds').where({ id: roundId, tenant_id: tenant }).update({ name: replacement });
      return done(roundId, row.name);
    }

    if (kind === 'tag') {
      // Read-modify-write the whole array: `tags` is one jsonb value, not rows.
      // J() is not optional here — a raw JS array binding into jsonb is turned
      // into a Postgres array literal and throws 22P02.
      const row = await trx('rounds').where({ id: roundId, tenant_id: tenant }).first('tags');
      const tags = (row && row.tags) || [];
      const tag = tags.find((tg) => tg.id === targetId);
      if (!tag) return null;
      const previous = tag.name;
      await trx('rounds').where({ id: roundId, tenant_id: tenant })
        .update({ tags: J(tags.map((tg) => (tg.id === targetId ? { ...tg, name: replacement } : tg))) });
      return done(targetId, previous);
    }

    // Explicit rather than `kind === 'game' ? 'games' : 'members'`: that shape
    // makes MEMBERS the fallback for anything unrecognised, so an unknown kind
    // would go looking in — and possibly redact — a member row, while the JSON
    // backend returns null for it. Unreachable through the route (z.enum), but
    // the two backends owe the contract identical behaviour.
    const target = { game: ['games', 'title'], member: ['members', 'name'] }[kind];
    if (!target) return null;
    const [table, field] = target;

    // The same where-clause on the read and the write. They must not drift: a
    // write scoped more loosely than the read it was authorised by is how a
    // later copy-paste of this line escapes its round.
    const where = { id: targetId, round_id: roundId, tenant_id: tenant };
    const row = await trx(table).where(where).first('data');
    if (!row) return null;
    await trx(table).where(where).update({ data: mergeData({ [field]: replacement }) });
    return done(targetId, row.data[field]);
  });
}

/* ---------------------------- Instance metrics ------------------------------ */
/*
 * Aggregate usage numbers for the operator's Kennzahlen card (#404). See the
 * JSON backend for the contract (counts + quota peaks, demo tenants excluded
 * from everything, `now` passed in so the date windows are deterministic).
 * What this backend adds:
 *
 *  - THE ROUND TABLES MUST BE READ UNDER atx(). rounds/games/sessions are
 *    RLS-scoped, and a plain query outside a transaction that sets a scope sees
 *    ZERO rows under a non-superuser role — no error, just a healthy-looking
 *    zero on the card while production is full of data. Reads are exactly what
 *    the additive FOR SELECT admin escape exists for. test/repo.postgres.test.js
 *    pins it through a plain role, because this file's own connection in CI is a
 *    superuser and bypasses RLS entirely.
 *  - `::int` ON EVERY count(). pg hands a bigint back as a STRING, so a raw
 *    count would make this backend answer '3' where the JSON one answers 3, and
 *    any sum of them would concatenate.
 *  - users / round_grants / invitations / friendships are un-scoped, no-RLS
 *    tables (like moderation_log), so they take plain knex with no transaction.
 *
 * The demo exclusion is a LIKE prefix match built from DEMO_TENANT_PREFIX. That
 * is safe only because the prefix contains no LIKE metacharacter — a prefix
 * gaining a `%` or `_` would need an ESCAPE clause here.
 */
async function instanceMetrics(now = new Date().toISOString()) {
  const parsed = Date.parse(now);
  const at = Number.isFinite(parsed) ? parsed : Date.now();
  const since = (days) => new Date(at - days * 86400000).toISOString();
  const since7 = since(7);
  const since30 = since(30);
  const demoLike = `${DEMO_TENANT_PREFIX}%`;

  // A legacy row could carry no tenantId at all; coalesce keeps it counted as a
  // real account, matching the JSON backend, where `undefined` is not demo.
  const accounts = await knex('users')
    .whereRaw("coalesce(data->>'tenantId', '') not like ?", [demoLike])
    .select(
      knex.raw('count(*)::int as total'),
      knex.raw("count(*) FILTER (WHERE data->>'emailVerified' = 'true')::int as verified"),
      knex.raw("count(*) FILTER (WHERE data->>'disabled' = 'true')::int as disabled"),
      knex.raw("count(*) FILTER (WHERE data->>'createdAt' >= ?)::int as new7d", [since7]),
      knex.raw("count(*) FILTER (WHERE data->>'createdAt' >= ?)::int as new30d", [since30]),
    )
    .first();

  const shared = await knex('round_grants')
    .whereRaw("coalesce(data->>'ownerTenantId', '') not like ?", [demoLike])
    .countDistinct('round_id as n')
    .first();

  const invitations = await knex('invitations')
    .whereRaw("data->>'status' = 'pending'")
    .whereRaw("coalesce(data->>'ownerTenantId', '') not like ?", [demoLike])
    .count('* as n')
    .first();

  // A friendship row carries two ACCOUNT ids and no tenant, so the demo filter
  // has to go through users — the JSON backend does the same with a Set of demo
  // account ids.
  const friendships = await knex('friendships')
    .whereRaw("data->>'status' = 'accepted'")
    .whereNotExists((qb) => qb
      .select(knex.raw('1'))
      .from('users')
      .whereRaw('users.id in (friendships.user_lo, friendships.user_hi)')
      .whereRaw("users.data->>'tenantId' like ?", [demoLike]))
    .count('* as n')
    .first();

  const rounds = await atx(async (trx) => {
    // Awaited one at a time: a single transaction runs on ONE connection and
    // cannot serve concurrent queries.
    const perTenant = await trx('rounds')
      .whereRaw('tenant_id not like ?', [demoLike])
      .groupBy('tenant_id')
      .select(trx.raw('count(*)::int as n'));

    const games = await trx('games')
      .whereRaw('tenant_id not like ?', [demoLike])
      .select(trx.raw('count(*)::int as n'))
      .first();

    // The fullest shelf, as a top-1 grouped read rather than a max-over-subquery:
    // same answer, and it reuses the games_round_idx scan.
    const fullestRound = await trx('games')
      .whereRaw('tenant_id not like ?', [demoLike])
      .groupBy('round_id')
      .select(trx.raw('count(*)::int as n'))
      .orderBy('n', 'desc')
      .limit(1)
      .first();

    // `tags` stays NULL until a round defines its first tag (absent-key parity),
    // so it needs the coalesce before jsonb_array_length; the outer one covers
    // "no rounds at all", where max() is NULL.
    const tags = await trx('rounds')
      .whereRaw('tenant_id not like ?', [demoLike])
      .select(trx.raw("coalesce(max(jsonb_array_length(coalesce(tags, '[]'::jsonb))), 0)::int as n"))
      .first();

    const sessions = await trx('sessions')
      .whereRaw('tenant_id not like ?', [demoLike])
      .select(
        trx.raw('count(*)::int as total'),
        trx.raw("count(*) FILTER (WHERE data->>'finished' = 'true')::int as finished"),
        trx.raw("count(*) FILTER (WHERE data->>'createdAt' >= ?)::int as recent", [since30]),
      )
      .first();

    return {
      // Reduced here, never Math.max(...arr): a spread is capped by the engine's
      // argument limit, and tenant count is the one number here that grows with
      // no quota bounding it.
      roundCounts: perTenant.reduce(
        (acc, r) => ({ total: acc.total + r.n, tenants: acc.tenants + 1, max: Math.max(acc.max, r.n) }),
        { total: 0, tenants: 0, max: 0 },
      ),
      games: games.n,
      maxGamesPerRound: fullestRound ? fullestRound.n : 0,
      maxTagsPerRound: tags.n,
      sessions,
    };
  });

  return {
    accounts: {
      total: accounts.total,
      verified: accounts.verified,
      disabled: accounts.disabled,
      new7d: accounts.new7d,
      new30d: accounts.new30d,
    },
    rounds: {
      total: rounds.roundCounts.total,
      tenants: rounds.roundCounts.tenants,
    },
    content: {
      games: rounds.games,
      sessions: rounds.sessions.total,
      sessionsFinished: rounds.sessions.finished,
      sessions30d: rounds.sessions.recent,
    },
    social: {
      sharedRounds: Number(shared.n),
      invitationsOpen: Number(invitations.n),
      friendships: Number(friendships.n),
    },
    peaks: {
      roundsPerTenant: rounds.roundCounts.max,
      gamesPerRound: rounds.maxGamesPerRound,
      tagsPerRound: rounds.maxTagsPerRound,
    },
  };
}

/* --------------------------- Erasure & export (#273) ------------------------ */
/*
 * Art. 17 (erasure) and Art. 15/20 (access/portability), operator-side. Global
 * like the rest of this section — the operator names an ACCOUNT, and the account
 * carries the tenant id.
 *
 * Note both run through the ORDINARY tenant-scoped tx(tenant, ...) path, NOT the
 * atx admin escape: resolving the account already yields its tenant, so the work
 * is single-tenant and needs no cross-tenant widening at all. For the erasure
 * that is not merely tidier but required — the admin policy is FOR SELECT only,
 * so a DELETE under it matches zero rows by design (see the atx note above).
 */

// Everything held for one tenant, for an access request. Unlike getRound this
// DOES include the activity feed: "everything you hold about me" has to mean
// everything, and the feed is held data (assemble() omits it only because it is
// unbounded and no view needs it — #197).
async function exportTenant(tenant) {
  if (!tenant) return { tenantId: null, rounds: [] };
  return tx(tenant, async (trx) => {
    const rows = await trx('rounds')
      .where({ tenant_id: tenant })
      .orderBy('seq')
      .select('id', 'name', 'background', 'tags', 'providers', 'last_session_filters as lastSessionFilters');
    const rounds = [];
    // Awaited one at a time: a single transaction runs on ONE connection and
    // cannot serve concurrent queries (see the tx note above).
    for (const row of rows) {
      const children = await childrenOf(trx, tenant, row.id);
      const acts = await trx('activities')
        .where({ round_id: row.id, tenant_id: tenant })
        .orderBy('seq')
        .select('id', 'data');
      rounds.push({ ...assemble(row, children), activities: acts.map(withId) });
    }
    return { tenantId: tenant, rounds };
  });
}

// The account's rows in the five GLOBAL stores, for the same Art. 15/20 export.
// The READ mirror of eraseAccount's global-store cleanup below (grants,
// invitations, inbox, friendships, feed events are all un-scoped, no RLS — plain
// knex reads). Keep the WHERE clauses identical to the deletes there: what erasure
// removes as the account's personal data, export must return, and the contract
// suite pins the symmetry. `tenant` scopes only the owner-side rows (grants/
// invitations on the account's own rounds), exactly as erasure uses it.
async function exportAccountData(uid, tenant = null) {
  const t = tenant || null;

  const grantQ = knex('round_grants').where({ user_id: uid });
  if (t) grantQ.orWhereRaw("data->>'ownerTenantId' = ?", [t]);
  const grantRows = await grantQ.orderBy('seq').select('id', 'round_id', 'user_id', 'data');

  const invQ = knex('invitations')
    .where({ invitee_user_id: uid })
    .orWhereRaw("data->>'inviterUserId' = ?", [uid]);
  if (t) invQ.orWhereRaw("data->>'ownerTenantId' = ?", [t]);
  const invRows = await invQ.orderBy('seq').select('id', 'round_id', 'invitee_user_id', 'data');

  const inboxRows = await knex('inbox').where({ user_id: uid })
    .orderBy('seq').select('id', 'user_id', 'data');

  const friendRows = await knex('friendships')
    .where({ user_lo: uid }).orWhere({ user_hi: uid })
    .orderBy('seq').select('id', 'data');

  const feedRows = await knex('feed_events').where({ uid })
    .orderBy('seq').select('id', 'uid', 'data');

  return {
    grants: grantRows.map(grantRow),
    invitations: invRows.map(invitationRow),
    inbox: inboxRows.map(inboxRow),
    friendships: friendRows.map(friendshipRow),
    feedEvents: feedRows.map(feedRow),
  };
}

// Erase an account AND its tenant's round data, returning the freed
// '/uploads/<key>' paths so the ROUTE can delete the stored objects — the same
// clear-the-reference-then-delete-the-bytes ordering takedownImage uses.
// Children (members/games/sessions/activities) go with the round via the
// schema's ON DELETE CASCADE.
//
// Returns null for an unknown account, 'tenant_shared' when another account
// still lives on the tenant, else { tenantId, rounds, images }.
async function eraseAccount(uid) {
  const user = await getUserById(uid);
  if (!user) return null;
  const tenant = user.tenantId || null;

  // See the JSON backend for why a shared tenant must refuse rather than cascade.
  if (tenant) {
    const other = await knex('users')
      .whereRaw("data->>'tenantId' = ?", [tenant])
      .andWhereNot({ id: uid })
      .first('id');
    if (other) return 'tenant_shared';
  }

  let rounds = 0;
  const images = new Set();
  if (tenant) {
    await tx(tenant, async (trx) => {
      // Collected BEFORE the delete — the rows are gone afterwards. Deduped: an
      // imported round shares the cover path rather than the file.
      const games = await trx('games')
        .where({ tenant_id: tenant })
        .whereRaw("data->>'image' IS NOT NULL")
        .select('data');
      for (const g of games) images.add(g.data.image);
      rounds = await trx('rounds').where({ tenant_id: tenant }).del();
    });
  }

  // #207: erase the account's sharing rows too — global tables (no RLS), so plain
  // deletes outside the tenant tx: grants it held or that sat on its now-deleted
  // rounds, invitations it sent/received, and its inbox items. See the JSON backend.
  const grantCleanup = knex('round_grants').where({ user_id: uid });
  if (tenant) grantCleanup.orWhereRaw("data->>'ownerTenantId' = ?", [tenant]);
  await grantCleanup.del();
  const invCleanup = knex('invitations')
    .where({ invitee_user_id: uid })
    .orWhereRaw("data->>'inviterUserId' = ?", [uid]);
  if (tenant) invCleanup.orWhereRaw("data->>'ownerTenantId' = ?", [tenant]);
  await invCleanup.del();
  await knex('inbox').where({ user_id: uid }).del();
  // #325: the account's friendships (either side of the pair) and its feed events.
  await knex('friendships').where({ user_lo: uid }).orWhere({ user_hi: uid }).del();
  await knex('feed_events').where({ uid }).del();

  await knex('users').where({ id: uid }).del();
  return { tenantId: tenant, rounds, images: [...images] };
}

// Global, un-scoped, no RLS — operator data ABOUT tenants (like `users`).
async function logModeration(entry) {
  const eid = newId();
  await knex('moderation_log').insert({ id: eid, data: J(entry) });
  return { id: eid, ...entry };
}

// The #275 filters, applied identically to the list, the count and the CSV.
// `at` is compared as TEXT rather than cast to timestamptz: it is always written
// as an ISO-8601 UTC string, which sorts lexicographically in that format, and a
// cast would turn one malformed historical value into an error for the whole
// query instead of one row that simply doesn't match.
const logFilter = (qb, filters) => {
  const f = filters || {};
  if (f.tenantId) qb.whereRaw("data->>'tenantId' = ?", [f.tenantId]);
  if (f.action) qb.whereRaw("data->>'action' = ?", [f.action]);
  if (f.from) qb.whereRaw("data->>'at' >= ?", [f.from]);
  if (f.to) qb.whereRaw("data->>'at' <= ?", [f.to]);
};

// `offset` skips that many of the newest entries, so (limit, offset) walks
// backwards through history a page at a time (#288).
async function listModeration(limit = 100, offset = 0, filters) {
  const rows = await knex('moderation_log')
    .modify((qb) => logFilter(qb, filters))
    .orderBy('seq', 'desc').offset(offset).limit(limit)
    .select('id', 'data');
  return rows.map(withId);
}

// Counts the same filtered set the list returns. Number() for the bigint-as-
// string reason the `count` helper exists for — this one can't use it, since
// that helper takes a bare table name.
async function countModeration(filters) {
  const row = await knex('moderation_log')
    .modify((qb) => logFilter(qb, filters))
    .count('* as n').first();
  return Number(row.n);
}

// The distinct action names actually present, so the panel's filter offers only
// values that can match.
async function moderationActions() {
  const rows = await knex('moderation_log')
    .distinct(knex.raw("data->>'action' as action"))
    .orderBy('action');
  return rows.map((r) => r.action).filter(Boolean);
}

// One log entry by id (#272) — the Art. 17 statement of reasons is generated
// from the entry, so the route needs to load exactly one.
async function getModeration(eid) {
  const row = await knex('moderation_log').where({ id: eid }).first('id', 'data');
  return row ? withId(row) : null;
}

// Record on the entry that its Art. 17 statement of reasons was delivered
// (#272). Only the timestamp — the log must stay purgeable (#311).
async function markModerationStatement(eid, at) {
  const rows = await knex('moderation_log').where({ id: eid })
    .update({ data: mergeData({ statementSentAt: at }) })
    .returning(['id', 'data']);
  return rows[0] ? withId(rows[0]) : null;
}

/* --------------------------------- Feedback --------------------------------- */
/*
 * In-app user feedback (issue #260). Global and un-scoped, no RLS — the same
 * treatment as `users` and `moderation_log`, and for the same reason: it is data
 * addressed TO the operator, who must read it across every tenant. Absent from
 * TENANT_METHODS, so only the admin-gated routes can reach the read side.
 */

async function createFeedback(entry) {
  const fid = newId();
  await knex('feedback').insert({ id: fid, data: J(entry) });
  return { id: fid, ...entry };
}

async function listFeedback(limit = 100, offset = 0) {
  const rows = await knex('feedback')
    .orderBy('seq', 'desc').offset(offset).limit(limit)
    .select('id', 'data');
  return rows.map(withId);
}

async function countFeedback() {
  return count('feedback');
}

// Delete one submission by id (issue #389). Un-scoped, no RLS — a plain
// `del()`. Returns the deleted row (so the route can confirm) or null when the
// id is unknown; the retention decision lives in the route, not here.
async function deleteFeedback(fid) {
  const rows = await knex('feedback').where({ id: fid }).del().returning(['id', 'data']);
  return rows[0] ? withId(rows[0]) : null;
}

/* ------------------------------ Contact notices ----------------------------- */
/*
 * Stored contact-form submissions / DSA abuse notices (issue #272). Global and
 * un-scoped, no RLS — the same treatment as `users`, `moderation_log` and
 * `feedback`: a notice is addressed TO the operator and usually comes from
 * someone who is not a user at all. Absent from TENANT_METHODS; the write comes
 * from lib/routes/contact.js, the read/decide side only from lib/routes/admin.js.
 */

async function createContactNotice(entry) {
  const nid = newId();
  await knex('contact_notices').insert({ id: nid, data: J(entry) });
  return { id: nid, ...entry };
}

async function listContactNotices(limit = 100, offset = 0) {
  const rows = await knex('contact_notices')
    .orderBy('seq', 'desc').offset(offset).limit(limit)
    .select('id', 'data');
  return rows.map(withId);
}

async function countContactNotices() {
  return count('contact_notices');
}

// Apply the route-built decision fields (status/decidedAt/decisionNote/
// decisionSentAt) to one notice. Returns the notice, or null when it is gone.
async function setContactNoticeStatus(nid, fields) {
  const rows = await knex('contact_notices').where({ id: nid })
    .update({ data: mergeData(fields) })
    .returning(['id', 'data']);
  return rows[0] ? withId(rows[0]) : null;
}

async function getContactNotice(nid) {
  const row = await knex('contact_notices').where({ id: nid }).first('id', 'data');
  return row ? withId(row) : null;
}

// Delete one notice by id (issue #389). Un-scoped, no RLS. The route reads the
// notice first and blocks deleting a DECIDED one (Art. 17 retention) unless the
// operator overrides — this just removes the row and reports found vs. not-found.
async function deleteContactNotice(nid) {
  const rows = await knex('contact_notices').where({ id: nid }).del().returning(['id', 'data']);
  return rows[0] ? withId(rows[0]) : null;
}

/* ---------------------------------- Inbox ---------------------------------- */
/*
 * Per-user in-app inbox (issue #207). Global and un-scoped, no RLS — like `users`.
 * Keyed by the recipient's account id (`user_id` column); every method scopes to
 * the caller's own id, since these are reached from user-facing lib/routes/account.js.
 * See lib/repo/json.js for the documented contract; the store ships with no
 * producer yet (invitations #207 / friend requests #325 are later slices).
 */

// Keep at most this many items per user (see json.js). Read per call from env.
const inboxCap = () => Number(process.env.MAX_INBOX_ITEMS) || 100;
// user_id lives in its own column; the rest of the item is the data jsonb.
const inboxRow = (row) => ({ id: row.id, userId: row.user_id, ...row.data });

async function addInboxItem(userId, item) {
  const iid = newId();
  const data = {
    type: item.type,
    payload: item.payload || {},
    read: false,
    createdAt: new Date().toISOString(),
  };
  await knex('inbox').insert({ id: iid, user_id: userId, data: J(data) });
  // Prune this user's oldest items beyond the cap (seq order == age).
  await knex('inbox').where({ user_id: userId }).whereNotIn('id',
    knex('inbox').where({ user_id: userId }).orderBy('seq', 'desc').limit(inboxCap()).select('id')).del();
  return { id: iid, userId, ...data };
}

async function listInbox(userId) {
  const rows = await knex('inbox').where({ user_id: userId })
    .orderBy('seq', 'desc').select('id', 'user_id', 'data');
  return rows.map(inboxRow);
}

async function markInboxRead(userId, itemId) {
  const rows = await knex('inbox').where({ id: itemId, user_id: userId })
    .update({ data: mergeData({ read: true }) })
    .returning(['id', 'user_id', 'data']);
  return rows[0] ? inboxRow(rows[0]) : null;
}

async function dismissInboxItem(userId, itemId) {
  const rows = await knex('inbox').where({ id: itemId, user_id: userId })
    .del().returning(['id', 'user_id', 'data']);
  return rows[0] ? inboxRow(rows[0]) : null;
}

/* ------------------------------- Round grants ------------------------------ */
/*
 * Per-round access grants (issue #207). Global and un-scoped, no RLS — like
 * `users`; a grant is inherently cross-tenant. See lib/repo/json.js for the
 * documented contract. The store ships with no producer yet (invitation accept
 * is a later slice of #207).
 */

// round_id and user_id are columns (the unique pair + hot reads); the rest of the
// grant lives in the data jsonb.
const grantRow = (row) => ({ id: row.id, roundId: row.round_id, userId: row.user_id, ...row.data });

async function createGrant({ roundId, ownerTenantId, userId, memberId = null, role = 'member' }) {
  const gid = newId();
  const data = { ownerTenantId, memberId, role, createdAt: new Date().toISOString() };
  try {
    await knex('round_grants').insert({ id: gid, round_id: roundId, user_id: userId, data: J(data) });
  } catch (e) {
    // The one unique index on this table is (round_id, user_id), so a 23505 is
    // unambiguously a duplicate grant (unlike the two-index users case, #320).
    if (e.code === '23505') return 'grant_exists';
    throw e;
  }
  return { id: gid, roundId, userId, ...data };
}

async function listGrantsForUser(userId) {
  const rows = await knex('round_grants').where({ user_id: userId })
    .orderBy('seq').select('id', 'round_id', 'user_id', 'data');
  return rows.map(grantRow);
}

async function listGrantsForRound(roundId) {
  const rows = await knex('round_grants').where({ round_id: roundId })
    .orderBy('seq').select('id', 'round_id', 'user_id', 'data');
  return rows.map(grantRow);
}

async function deleteGrant(roundId, userId) {
  const rows = await knex('round_grants').where({ round_id: roundId, user_id: userId })
    .del().returning(['id', 'round_id', 'user_id', 'data']);
  return rows[0] ? grantRow(rows[0]) : null;
}

/* ------------------------------- Invitations ------------------------------- */
/*
 * Round-sharing invitations (issue #207). Global and un-scoped like round_grants
 * (an invitation crosses tenants). See lib/repo/json.js for the documented
 * contract. round_id and invitee_user_id are columns; the rest is the data jsonb.
 */

const invitationRow = (row) => ({ id: row.id, roundId: row.round_id, inviteeUserId: row.invitee_user_id, ...row.data });

async function createInvitation({ roundId, ownerTenantId, inviterUserId, inviteeUserId, memberId = null }) {
  const iid = newId();
  const data = { ownerTenantId, inviterUserId, memberId, status: 'pending', createdAt: new Date().toISOString(), resolvedAt: null };
  await knex('invitations').insert({ id: iid, round_id: roundId, invitee_user_id: inviteeUserId, data: J(data) });
  return { id: iid, roundId, inviteeUserId, ...data };
}

async function getInvitation(invId) {
  const row = await knex('invitations').where({ id: invId }).first('id', 'round_id', 'invitee_user_id', 'data');
  return row ? invitationRow(row) : null;
}

async function listInvitationsForRound(roundId) {
  const rows = await knex('invitations').where({ round_id: roundId })
    .orderBy('seq').select('id', 'round_id', 'invitee_user_id', 'data');
  return rows.map(invitationRow);
}

async function resolveInvitation(invId, status) {
  // Only a PENDING invitation resolves — the status guard is in the UPDATE itself,
  // so two concurrent accept/decline calls can't both win (the loser matches zero
  // rows → null), and no read-modify-write race exists.
  const rows = await knex('invitations')
    .where({ id: invId })
    .whereRaw("data->>'status' = 'pending'")
    .update({ data: mergeData({ status, resolvedAt: new Date().toISOString() }) })
    .returning(['id', 'round_id', 'invitee_user_id', 'data']);
  return rows[0] ? invitationRow(rows[0]) : null;
}

/* ------------------------------ Friendships -------------------------------- */
/*
 * Friendships (issue #325). Global and un-scoped, no RLS — like `users`; keyed by
 * two ACCOUNT ids. See lib/repo/json.js for the documented contract. The pair is
 * stored canonically ((user_lo, user_hi), lexicographic) so the unique index
 * enforces one row per unordered pair; the direction + status live in data jsonb.
 */

// Canonical (lo, hi) order for a pair, so the pair index is order-independent.
const pairKey = (a, b) => (a <= b ? [a, b] : [b, a]);
const friendshipRow = (row) => ({ id: row.id, ...row.data });

async function createFriendRequest({ requesterUserId, addresseeUserId }) {
  // Pre-check like createUser: report the specific marker BEFORE relying on the
  // unique index (which is only the race backstop for two simultaneous sends).
  const [lo, hi] = pairKey(requesterUserId, addresseeUserId);
  const existing = await knex('friendships').where({ user_lo: lo, user_hi: hi }).first('data');
  if (existing) return existing.data.status === 'accepted' ? 'already_friends' : 'request_pending';
  const fid = newId();
  const data = { requesterUserId, addresseeUserId, status: 'pending', createdAt: new Date().toISOString(), acceptedAt: null };
  try {
    await knex('friendships').insert({ id: fid, user_lo: lo, user_hi: hi, data: J(data) });
  } catch (e) {
    // The one unique index is (user_lo, user_hi), so a 23505 is unambiguously a
    // duplicate pair — re-read to answer already_friends vs request_pending.
    if (e.code !== '23505') throw e;
    const now = await knex('friendships').where({ user_lo: lo, user_hi: hi }).first('data');
    return now && now.data.status === 'accepted' ? 'already_friends' : 'request_pending';
  }
  return { id: fid, ...data };
}

async function listFriendships(userId) {
  const rows = await knex('friendships')
    .where({ user_lo: userId }).orWhere({ user_hi: userId })
    .orderBy('seq', 'desc').select('id', 'data');
  return rows.map(friendshipRow);
}

async function acceptFriendRequest(fid, addresseeUserId) {
  // The status + addressee guards live in the UPDATE, so a second accept, or the
  // requester accepting their own request, matches zero rows → null (no race).
  const rows = await knex('friendships')
    .where({ id: fid })
    .whereRaw("data->>'status' = 'pending'")
    .whereRaw("data->>'addresseeUserId' = ?", [addresseeUserId])
    .update({ data: mergeData({ status: 'accepted', acceptedAt: new Date().toISOString() }) })
    .returning(['id', 'data']);
  return rows[0] ? friendshipRow(rows[0]) : null;
}

async function deleteFriendshipById(fid, userId) {
  // Party guard in the DELETE: the caller must be requester or addressee, so a
  // stranger's id deletes nothing. Covers decline / cancel / unfriend alike.
  const rows = await knex('friendships')
    .where({ id: fid })
    .whereRaw("(data->>'requesterUserId' = ? OR data->>'addresseeUserId' = ?)", [userId, userId])
    .del().returning(['id', 'data']);
  return rows[0] ? friendshipRow(rows[0]) : null;
}

/* --------------------------- Freundeskreis feed ---------------------------- */
/*
 * User-attributed feed events (issue #325). Global and un-scoped, no RLS. See
 * lib/repo/json.js for the allowlist contract — the row is built from a fixed
 * field set here too, so a call site can't leak an extra field into a friend's feed.
 */

const FEED_EVENT_TYPES = new Set(['session_played', 'game_added']);
const feedCap = () => Number(process.env.MAX_FEED_EVENTS) || 50;
const feedRow = (row) => ({ id: row.id, uid: row.uid, ...row.data });

async function addFeedEvent(uid, event) {
  if (!uid || !event || !FEED_EVENT_TYPES.has(event.type)) return null;
  const eid = newId();
  const data = {
    type: event.type,
    title: String(event.title || ''),
    coverUrl: event.coverUrl || null,
    at: new Date().toISOString(),
  };
  await knex('feed_events').insert({ id: eid, uid, data: J(data) });
  // Prune this user's oldest events beyond the cap (seq order == age).
  await knex('feed_events').where({ uid }).whereNotIn('id',
    knex('feed_events').where({ uid }).orderBy('seq', 'desc').limit(feedCap()).select('id')).del();
  return { id: eid, uid, ...data };
}

async function listFeedEvents(uids, limit = 100) {
  if (!uids || !uids.length) return [];
  const rows = await knex('feed_events').whereIn('uid', uids)
    .orderBy('seq', 'desc').limit(limit).select('id', 'uid', 'data');
  return rows.map(feedRow);
}

/* --------------------------------- Members --------------------------------- */

// Add a member to an existing round (issue #207; also the add-member route since
// #563). See lib/repo/json.js for why this primitive exists, its contract, why it
// appends, and why the `member_added` activity is written here rather than in the
// route. `fields` is { name, color?, userId? } with absent optional keys staying
// absent (jsonb parity). Returns the created member, or null if the round is
// missing / another tenant's.
async function createMember(tenant, rid, fields, actorMemberId) {
  return tx(tenant, async (trx) => {
    const round = await trx('rounds').where({ id: rid, tenant_id: tenant }).first('id');
    if (!round) return null;
    const mid = newId();
    const data = { name: fields.name };
    if (fields.color !== undefined) data.color = fields.color;
    if (fields.userId !== undefined) data.userId = fields.userId;
    await trx('members').insert({ id: mid, round_id: rid, tenant_id: tenant, data: J(data) });
    await addActivity(trx, tenant, rid, 'member_added', { name: data.name }, actorMemberId);
    return { id: mid, ...data };
  });
}

async function updateMember(tenant, rid, mid, patch) {
  const rows = await qt(tenant, (trx) =>
    trx('members').where({ id: mid, round_id: rid, tenant_id: tenant }).update({ data: mergeData(patch) }).returning(['id', 'data']));
  return rows[0] ? withId(rows[0]) : null;
}

/* ---------------------------------- Games ---------------------------------- */

async function createGame(tenant, rid, fields, actorMemberId) {
  return tx(tenant, async (trx) => {
    const round = await trx('rounds').where({ id: rid, tenant_id: tenant }).first('id');
    if (!round) return null;
    const gid = newId();
    const data = {
      title: fields.title,
      minPlayers: fields.minPlayers,
      maxPlayers: fields.maxPlayers,
      image: fields.image,
      retired: false,
      retiredAt: null,
      completed: false,
      completedAt: null,
    };
    if (fields.source) data.source = fields.source;
    if (Array.isArray(fields.tagIds) && fields.tagIds.length) data.tagIds = fields.tagIds;
    await trx('games').insert({ id: gid, round_id: rid, tenant_id: tenant, data: J(data) });
    await addActivity(trx, tenant, rid, 'game_added', { gameId: gid, title: data.title }, actorMemberId);
    return { id: gid, ...data };
  });
}

// Whether the round already holds a game linked to this provider record. Mirrors
// the JSON backend's helper of the same name — see it for why the import needs it.
function sameSource(game, source) {
  const s = game.source;
  return !!s && !!source && s.provider === source.provider && s.externalId === source.externalId;
}

// Create MANY games in one statement's worth of work (#481). See the JSON
// backend for the contract and the reasoning; the Postgres specifics:
//
//   - the whole thing runs in ONE tx, so the "already present" read and the
//     insert are atomic — the point of doing the dedupe here and not in the
//     route. The round row is locked FOR UPDATE so two concurrent imports of the
//     same collection serialize instead of both finding a game missing.
//   - the shelf is read ordered by `seq` and the inserts go in one batch, so the
//     imported games land at the end in candidate order, matching the JSON
//     backend's array push (the same ordering constraint moveGames documents).
async function createGames(tenant, rid, games, actorMemberId, limits) {
  return tx(tenant, async (trx) => {
    const round = await trx('rounds').where({ id: rid, tenant_id: tenant }).forUpdate().first('id');
    if (!round) return null;
    const existing = await trx('games')
      .where({ round_id: rid, tenant_id: tenant })
      .orderBy('seq', 'asc')
      .select('id', 'data');
    const shelf = existing.map(withId);

    const fresh = [];
    let skipped = 0;
    for (const fields of games) {
      if (shelf.some((g) => sameSource(g, fields.source))
          || fresh.some((g) => sameSource(g, fields.source))) {
        skipped += 1;
        continue;
      }
      fresh.push({
        id: newId(),
        title: fields.title,
        minPlayers: fields.minPlayers,
        maxPlayers: fields.maxPlayers,
        image: fields.image,
        retired: false,
        retiredAt: null,
        completed: false,
        completedAt: null,
        ...(fields.source ? { source: fields.source } : {}),
      });
    }

    if (limits && shelf.length + fresh.length > limits.maxGames) return 'quota_games';

    if (fresh.length) {
      // J() every jsonb value — a raw object would happen to work here, but the
      // uniform stringify is what keeps a value that turns out to be an array
      // from throwing 22P02 (see .claude/rules/postgres-backend.md).
      await trx('games').insert(fresh.map(({ id: gid, ...data }) => ({
        id: gid,
        round_id: rid,
        tenant_id: tenant,
        data: J(data),
      })));
      await addActivity(trx, tenant, rid, 'games_imported', { count: fresh.length }, actorMemberId);
    }
    return { created: fresh, skipped };
  });
}

async function updateGame(tenant, rid, gid, patch) {
  const rows = await qt(tenant, (trx) =>
    trx('games').where({ id: gid, round_id: rid, tenant_id: tenant }).update({ data: mergeData(patch) }).returning(['id', 'data']));
  return rows[0] ? withId(rows[0]) : null;
}

// A game is Active, Retired or Completed — never two at once (#250), so setting
// one archived state clears the other. See the JSON backend for the contract.
async function retireGame(tenant, rid, gid, retired, actorMemberId) {
  return tx(tenant, async (trx) => {
    const patch = { retired, retiredAt: retired ? new Date().toISOString() : null };
    if (retired) Object.assign(patch, { completed: false, completedAt: null });
    const rows = await trx('games').where({ id: gid, round_id: rid, tenant_id: tenant }).update({ data: mergeData(patch) }).returning(['id', 'data']);
    if (!rows[0]) return null;
    await addActivity(trx, tenant, rid, retired ? 'game_retired' : 'game_restored', {
      gameId: gid,
      title: rows[0].data.title,
    }, actorMemberId);
    return withId(rows[0]);
  });
}

async function completeGame(tenant, rid, gid, completed, actorMemberId) {
  return tx(tenant, async (trx) => {
    const patch = { completed, completedAt: completed ? new Date().toISOString() : null };
    if (completed) Object.assign(patch, { retired: false, retiredAt: null });
    const rows = await trx('games').where({ id: gid, round_id: rid, tenant_id: tenant }).update({ data: mergeData(patch) }).returning(['id', 'data']);
    if (!rows[0]) return null;
    await addActivity(trx, tenant, rid, completed ? 'game_completed' : 'game_uncompleted', {
      gameId: gid,
      title: rows[0].data.title,
    }, actorMemberId);
    return withId(rows[0]);
  });
}

async function deleteGame(tenant, rid, gid, actorMemberId) {
  return tx(tenant, async (trx) => {
    const g = await trx('games').where({ id: gid, round_id: rid, tenant_id: tenant }).first('data');
    if (!g) return null;
    const game = g.data;
    if (!game.retired && !game.completed) return 'not_archived';

    await trx('games').where({ id: gid, tenant_id: tenant }).del();

    // Scrub the game from every session of this round (same rules as the JSON
    // backend): drop it from gameIds + all votes, reset the choice if it was the
    // chosen game, and delete sessions that end up empty.
    const sessions = await trx('sessions').where({ round_id: rid, tenant_id: tenant }).select('id', 'data');
    for (const row of sessions) {
      const s = row.data;
      s.gameIds = (s.gameIds || []).filter((x) => x !== gid);
      if (s.gameIds.length === 0) {
        await trx('sessions').where({ id: row.id, tenant_id: tenant }).del();
        continue;
      }
      for (const mid in s.votes || {}) delete s.votes[mid][gid];
      if (s.chosenGameId === gid) {
        s.chosenGameId = null;
        s.chosenAt = null;
        s.finished = false;
        s.finishedAt = null;
        s.winnerIds = [];
      }
      await trx('sessions').where({ id: row.id, tenant_id: tenant }).update({ data: J(s) });
    }

    // Drop feed entries that reference the game, then log the deletion itself.
    await trx('activities').where({ round_id: rid, tenant_id: tenant }).whereRaw("data->>'gameId' = ?", [gid]).del();
    await addActivity(trx, tenant, rid, 'game_deleted', { title: game.title }, actorMemberId);

    return { image: game.image };
  });
}

// Move games of one round into another round of the same tenant — the whole
// shelf, or just the `gameIds` subset (#402) — merging tags by name (#253).
// See the JSON backend for the contract and the rationale for the quota check
// living here.
//
// Both round rows are locked in ONE statement ordered by id, so two concurrent
// moves between the same pair of rounds in opposite directions serialize
// instead of deadlocking (each would otherwise hold the row the other wants).
// Sequential awaits throughout: one transaction runs on one connection.
async function moveGames(tenant, rid, targetRid, limits, gameIds) {
  return tx(tenant, async (trx) => {
    if (rid === targetRid) return 'same_round';
    const rows = await trx('rounds')
      .whereIn('id', [rid, targetRid])
      .andWhere({ tenant_id: tenant })
      .orderBy('id')
      .forUpdate()
      .select('id', 'name', 'tags');
    const src = rows.find((r) => r.id === rid);
    const target = rows.find((r) => r.id === targetRid);
    if (!src || !target) return null;

    // Filtered in JS rather than with a `whereIn` so the subset (#402) is
    // decided exactly as the JSON backend decides it — including the
    // 'unknown_game' refusal, which is a COUNT comparison and would need a
    // second query otherwise. The full shelf was already being read, and it is
    // capped by the games quota, so this costs nothing extra.
    let moving = await trx('games')
      .where({ round_id: rid, tenant_id: tenant })
      .orderBy('seq')
      .select('id', 'data');
    if (gameIds) {
      const want = new Set(gameIds);
      moving = moving.filter((g) => want.has(g.id));
      if (moving.length !== want.size) return 'unknown_game';
    }
    const targetTags = target.tags || [];

    const used = new Set();
    for (const g of moving) for (const x of g.data.tagIds || []) used.add(x);

    const remap = new Map();
    const created = [];
    let mergedTags = 0;
    const norm = (s) => s.trim().toLowerCase();
    for (const tag of src.tags || []) {
      if (!used.has(tag.id)) continue;
      const match = targetTags.find((tg) => norm(tg.name) === norm(tag.name));
      if (match) {
        remap.set(tag.id, match.id);
        mergedTags += 1;
        continue;
      }
      const fresh = { id: newId(), name: tag.name };
      if (tag.icon) fresh.icon = tag.icon;
      created.push(fresh);
      remap.set(tag.id, fresh.id);
    }

    if (limits) {
      const [{ count }] = await trx('games').where({ round_id: targetRid, tenant_id: tenant }).count();
      if (Number(count) + moving.length > limits.maxGames) return 'quota_games';
      if (targetTags.length + created.length > limits.maxTags) return 'quota_tags';
    }

    const movedGames = moving.length;
    if (created.length) {
      // `tags` is an ARRAY — J() it (see the header note on the JSONB footgun).
      await trx('rounds')
        .where({ id: targetRid, tenant_id: tenant })
        .update({ tags: J([...targetTags, ...created]) });
    }

    // Reparent one game at a time, in the source's shelf order, taking a FRESH
    // `seq` for each. Reads order by seq, so keeping the old values would
    // interleave the moved games among the target's existing ones by original
    // insertion time — the JSON backend appends them, and the contract suite
    // compares the assembled rounds, so the two must agree.
    const movedIds = new Set();
    for (const g of moving) {
      movedIds.add(g.id);
      const patch = {
        round_id: targetRid,
        seq: knex.raw("nextval(pg_get_serial_sequence('games', 'seq'))"),
      };
      if (Array.isArray(g.data.tagIds)) {
        patch.data = mergeData({ tagIds: g.data.tagIds.map((x) => remap.get(x)).filter(Boolean) });
      }
      await trx('games').where({ id: g.id, tenant_id: tenant }).update(patch);
    }

    // Scrub the moved games out of the SOURCE round's sessions, same rules as
    // deleteGame; the target's sessions are untouched.
    const sessions = await trx('sessions').where({ round_id: rid, tenant_id: tenant }).select('id', 'data');
    for (const row of sessions) {
      const s = row.data;
      s.gameIds = (s.gameIds || []).filter((x) => !movedIds.has(x));
      if (s.gameIds.length === 0) {
        await trx('sessions').where({ id: row.id, tenant_id: tenant }).del();
        continue;
      }
      for (const mid in s.votes || {}) {
        for (const gid of movedIds) delete s.votes[mid][gid];
      }
      if (movedIds.has(s.chosenGameId)) {
        s.chosenGameId = null;
        s.chosenAt = null;
        s.finished = false;
        s.finishedAt = null;
        s.winnerIds = [];
      }
      await trx('sessions').where({ id: row.id, tenant_id: tenant }).update({ data: J(s) });
    }

    if (movedGames) {
      await addActivity(trx, tenant, rid, 'games_moved_out', {
        count: movedGames, roundId: targetRid, roundName: target.name,
      });
      await addActivity(trx, tenant, targetRid, 'games_moved_in', {
        count: movedGames, roundId: rid, roundName: src.name,
      });
    }

    return { movedGames, mergedTags, createdTags: created.length };
  });
}

async function isImageReferenced(tenant, image) {
  const row = await qt(tenant, (trx) =>
    trx('games').whereRaw("data->>'image' = ?", [image]).andWhere({ tenant_id: tenant }).first(knex.raw('1')));
  return !!row;
}

/* --------------------------------- Sessions -------------------------------- */

// `filters` ({ tagIds, excludeTagIds, count }) is the draw-flow's remembered
// session-start preset (#252), written onto the round in the SAME transaction
// as the session insert. Direct-pick sessions pass nothing, so they never read
// or overwrite the preset.
async function createSession(tenant, rid, session, filters) {
  return tx(tenant, async (trx) => {
    const round = await trx('rounds').where({ id: rid, tenant_id: tenant }).first('id');
    if (!round) return null;
    const sid = newId();
    await trx('sessions').insert({ id: sid, round_id: rid, tenant_id: tenant, data: J(session) });
    if (filters) {
      await trx('rounds')
        .where({ id: rid, tenant_id: tenant })
        .update({ last_session_filters: J(filters) });
    }
    return { id: sid, ...session };
  });
}

// Load a session row FOR UPDATE, apply `mutate` (the same closures the JSON
// backend uses) and write it back — one atomic read-modify-write per row.
async function withSession(tenant, rid, sid, mutate) {
  return tx(tenant, async (trx) => {
    const row = await trx('sessions').where({ id: sid, round_id: rid, tenant_id: tenant }).forUpdate().first('data');
    if (!row) return null;
    const data = row.data;
    mutate(data);
    await trx('sessions').where({ id: sid, tenant_id: tenant }).update({ data: J(data) });
    return { id: sid, ...data };
  });
}

async function saveSessionResults(tenant, rid, sid, votes) {
  return withSession(tenant, rid, sid, (s) => {
    s.votes = votes;
    s.done = true;
  });
}

// Write ONE person's column of a per-device session (#209). See the JSON twin
// for the reasoning; the atomicity it relies on is this backend's `FOR UPDATE`
// in withSession, which serializes two simultaneous submissions instead of
// letting the later one clobber the earlier one's column.
async function saveSessionPersonVotes(tenant, rid, sid, personId, byGame) {
  return withSession(tenant, rid, sid, (s) => {
    if (!s.votes || typeof s.votes !== 'object') s.votes = {};
    s.votes[personId] = byGame;
  });
}

// Close a per-device session's voting (#209), keeping the collected votes.
async function closeSessionVoting(tenant, rid, sid) {
  return withSession(tenant, rid, sid, (s) => {
    s.done = true;
  });
}

async function setSessionChoice(tenant, rid, sid, gameId) {
  return withSession(tenant, rid, sid, (s) => {
    s.chosenGameId = gameId;
    s.chosenAt = gameId ? new Date().toISOString() : null;
  });
}

async function finishSession(tenant, rid, sid, { finished, winnerIds }) {
  return withSession(tenant, rid, sid, (s) => {
    if (!finished) {
      s.finished = false;
      s.finishedAt = null;
      s.winnerIds = [];
    } else {
      s.winnerIds = winnerIds;
      s.finished = true;
      s.finishedAt = new Date().toISOString();
    }
  });
}

async function cancelSession(tenant, rid, sid, cancelled) {
  return withSession(tenant, rid, sid, (s) => {
    if (cancelled) {
      s.cancelled = true;
      s.cancelledAt = new Date().toISOString();
    } else {
      s.cancelled = false;
      s.cancelledAt = null;
    }
  });
}

async function removeSessionGame(tenant, rid, sid, gid) {
  return withSession(tenant, rid, sid, (s) => {
    s.gameIds = s.gameIds.filter((x) => x !== gid);
    Object.keys(s.votes || {}).forEach((mid) => {
      if (s.votes[mid]) delete s.votes[mid][gid];
    });
    if (s.chosenGameId === gid) {
      s.chosenGameId = null;
      s.chosenAt = null;
      s.finished = false;
      s.finishedAt = null;
      s.winnerIds = [];
    }
  });
}

async function deleteSession(tenant, rid, sid) {
  const n = await qt(tenant, (trx) => trx('sessions').where({ id: sid, round_id: rid, tenant_id: tenant }).del());
  return n > 0;
}

/* -------------------------------- Activities ------------------------------- */

// The round's activity feed (insertion order, like the JSON model's array).
// Returns null when the round is missing — the feed is not part of getRound.
async function listActivities(tenant, rid) {
  // One round trip: round-existence probe + the feed (READ_SQL rationale above).
  const { rows } = await knex.raw(READ_SQL.activities, [tenant, rid, rid]);
  if (!rows[0].round) return null;
  return rows[0].acts.map(withId);
}

async function deleteActivity(tenant, rid, aid) {
  const n = await qt(tenant, (trx) => trx('activities').where({ id: aid, round_id: rid, tenant_id: tenant }).del());
  return n > 0;
}

/* -------------------------------- Background -------------------------------- */

async function setBackground(tenant, rid, bg) {
  return tx(tenant, async (trx) => {
    const row = await trx('rounds').where({ id: rid, tenant_id: tenant }).first('background');
    if (!row) return null;
    const previous = row.background ?? null;
    await trx('rounds').where({ id: rid, tenant_id: tenant }).update({ background: J(bg) });
    return { previous };
  });
}

/* ----------------------------------- Tags ----------------------------------- */

// Create a round-level tag (#238), reusing an existing one whose name matches
// (the route trims; compared case-insensitively). Returns the tag, or null if
// the round is gone. FOR UPDATE serializes concurrent creates so two same-name
// tags can't race past the dedupe. `tags` is an ARRAY — J() it (see header).
async function addTag(tenant, rid, name, icon) {
  return tx(tenant, async (trx) => {
    const row = await trx('rounds').where({ id: rid, tenant_id: tenant }).forUpdate().first('tags');
    if (!row) return null;
    const tags = row.tags || [];
    const existing = tags.find((tg) => tg.name.toLowerCase() === name.toLowerCase());
    // A duplicate name reuses the existing tag and deliberately does NOT adopt
    // the passed icon: creating a tag must never silently restyle one the round
    // already has (#255).
    if (existing) return existing;
    const tag = { id: newId(), name };
    // `icon` stays absent when unset — absent-key parity with the JSON backend.
    if (icon) tag.icon = icon;
    tags.push(tag);
    await trx('rounds').where({ id: rid, tenant_id: tenant }).update({ tags: J(tags) });
    return tag;
  });
}

// Set (or clear, with a null icon) a tag's icon (#255). Returns the updated
// tag, or null when the round or the tag is gone. Name is not patchable —
// renaming a tag is deliberately still unsupported. FOR UPDATE serializes
// concurrent writes to the tags array, like addTag/deleteTag.
async function setTagIcon(tenant, rid, tagId, icon) {
  return tx(tenant, async (trx) => {
    const row = await trx('rounds').where({ id: rid, tenant_id: tenant }).forUpdate().first('tags');
    if (!row) return null;
    const tags = row.tags || [];
    const tag = tags.find((tg) => tg.id === tagId);
    if (!tag) return null;
    if (icon) tag.icon = icon;
    else delete tag.icon;
    await trx('rounds').where({ id: rid, tenant_id: tenant }).update({ tags: J(tags) });
    return tag;
  });
}

// Delete a round tag and silently unassign it from every game that had it.
// Returns true/false (found) — a missing round reads like a missing tag.
async function deleteTag(tenant, rid, tagId) {
  return tx(tenant, async (trx) => {
    const row = await trx('rounds').where({ id: rid, tenant_id: tenant }).forUpdate().first('tags');
    if (!row) return false;
    const tags = row.tags || [];
    const idx = tags.findIndex((tg) => tg.id === tagId);
    if (idx === -1) return false;
    tags.splice(idx, 1);
    await trx('rounds').where({ id: rid, tenant_id: tenant }).update({ tags: J(tags) });
    const games = await trx('games').where({ round_id: rid, tenant_id: tenant }).select('id', 'data');
    for (const g of games) {
      if (Array.isArray(g.data.tagIds) && g.data.tagIds.includes(tagId)) {
        const tagIds = g.data.tagIds.filter((x) => x !== tagId);
        await trx('games').where({ id: g.id, tenant_id: tenant }).update({ data: mergeData({ tagIds }) });
      }
    }
    return true;
  });
}

/* --------------------------- Lookup providers (#294) -------------------------- */

// Set which lookup providers this round queries. `ids` is already validated
// against the registry by the route. Returns the stored list, or null if the
// round is gone. The column stays NULL until first configured — NULL means "all
// providers", the pre-#294 behaviour — while an empty array is a distinct,
// legitimate "query nothing". `providers` is an ARRAY, so J() it: a raw array
// binding into jsonb throws 22P02 (see the header note).
async function setProviders(tenant, rid, ids) {
  return tx(tenant, async (trx) => {
    const n = await trx('rounds').where({ id: rid, tenant_id: tenant }).update({ providers: J(ids) });
    return n ? [...ids] : null;
  });
}

module.exports = {
  READ_SQL, // for the plain-role RLS ordering probe in test/repo.postgres.test.js
  init,
  end,
  instanceMetrics,
  ping,
  listRounds,
  listRoundSummaries,
  getRoundSummary,
  getRound,
  getRoundMeta,
  getSession,
  getGame,
  createRound,
  renameRound,
  deleteRound,
  createUser,
  getUserById,
  getUserByEmail,
  getUserByUsername,
  updateUser,
  deleteUser,
  listUsers,
  countLiveDemoUsers,
  countLiveDemoUsersByIp,
  listExpiredDemoUsers,
  findImageOwner,
  findRoundOwner,
  tenantSummary,
  roundContent,
  redactText,
  takedownImage,
  exportTenant,
  exportAccountData,
  eraseAccount,
  logModeration,
  listModeration,
  countModeration,
  moderationActions,
  getModeration,
  markModerationStatement,
  createFeedback,
  listFeedback,
  countFeedback,
  deleteFeedback,
  createContactNotice,
  listContactNotices,
  countContactNotices,
  setContactNoticeStatus,
  getContactNotice,
  deleteContactNotice,
  addInboxItem,
  listInbox,
  markInboxRead,
  dismissInboxItem,
  createGrant,
  listGrantsForUser,
  listGrantsForRound,
  deleteGrant,
  createInvitation,
  getInvitation,
  listInvitationsForRound,
  resolveInvitation,
  createFriendRequest,
  listFriendships,
  acceptFriendRequest,
  deleteFriendshipById,
  addFeedEvent,
  listFeedEvents,
  createMember,
  updateMember,
  createGame,
  createGames,
  updateGame,
  retireGame,
  completeGame,
  deleteGame,
  moveGames,
  isImageReferenced,
  createSession,
  saveSessionResults,
  saveSessionPersonVotes,
  closeSessionVoting,
  setSessionChoice,
  finishSession,
  cancelSession,
  removeSessionGame,
  deleteSession,
  listActivities,
  deleteActivity,
  setBackground,
  addTag,
  setTagIcon,
  deleteTag,
  setProviders,
};
