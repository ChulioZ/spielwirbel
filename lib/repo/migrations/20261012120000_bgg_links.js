'use strict';

/*
 * The BGG link table (#1638): BoardGameGeek's numeric ids for the categories,
 * mechanics and designers games name, which is what a link to their BGG page
 * needs (`/boardgamecategory/<id>` — there is no URL that looks a name up).
 *
 * GLOBAL and un-scoped, with no RLS and no tenant_id, like `bgg_corpus`: public
 * BGG metadata, identical for every tenant, with no user, account, round or
 * tenant id in it — so nothing for RLS to protect and no processing for
 * docs/legal/vvt.md to record.
 *
 * Keyed `(type, bgg_id)`; the name is unique per type too, because the surfaces
 * resolve a link by `(type, name)` — BGG names are unique within a type (it tells
 * same-named people apart with "(I)"/"(II)"). Games keep their name lists as
 * they are; nothing here references a game row.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS bgg_links (
  type text NOT NULL,
  bgg_id integer NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (type, bgg_id)
);
`);
  // The lookup's own key, and the uniqueness the upsert maintains.
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS bgg_links_name_idx ON bgg_links (type, name)');
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS bgg_links');
};
