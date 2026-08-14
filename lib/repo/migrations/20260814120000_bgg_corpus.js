'use strict';

/*
 * The licensed BoardGameGeek game corpus (issue #681).
 *
 * A few thousand ranked games with their ratings, complexity, player counts,
 * mechanics and categories — the candidate pool a recommender scores against
 * (#682) and a quiz asks about (#743). It exists because BGG's XML API has no
 * browse, filter or attribute-search endpoint at all: "which games would fit
 * this group?" cannot be asked upstream, so the app has to hold its own pool.
 *
 * GLOBAL and un-scoped, with no RLS and no tenant_id, like `last_prices` and
 * `moderation_log`. A game's rank and weight are public facts about a published
 * product, identical for every tenant; scoping them would store 5000 rows per
 * tenant and re-fetch BGG once per tenant. Nothing here is personal data — no
 * user, account, round or tenant id appears in either table — so there is
 * nothing for RLS to protect (docs/legal/vvt.md needs no row for the same
 * reason: this is not processing).
 *
 * Two tables rather than one, because they answer different questions and are
 * written at different times: `bgg_corpus` is the games, replaced wholesale when
 * the operator uploads a new ranks dump, while `bgg_corpus_meta` is one row
 * describing THAT upload, which the admin card reads on its own.
 *
 * `rank` and `enriched_at` are promoted out of the jsonb because the enrichment
 * job's only query orders by one and filters on the other — the same reason
 * every other table here promotes exactly the columns something sorts or joins
 * on and leaves the payload in `data`.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS bgg_corpus (
  external_id text PRIMARY KEY,
  rank integer NOT NULL,
  enriched_at text,
  data jsonb NOT NULL
);
`);
  // The enrichment queue: un-enriched or stale rows, best-ranked first. NULLS
  // FIRST matches the query's own ordering, so a fresh upload's rows are taken
  // before rows that merely aged out.
  await knex.raw(`
CREATE INDEX IF NOT EXISTS bgg_corpus_enrich_idx ON bgg_corpus (enriched_at NULLS FIRST, rank)
`);
  await knex.raw(`
CREATE TABLE IF NOT EXISTS bgg_corpus_meta (
  id integer PRIMARY KEY,
  data jsonb NOT NULL
);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS bgg_corpus');
  await knex.raw('DROP TABLE IF EXISTS bgg_corpus_meta');
};
