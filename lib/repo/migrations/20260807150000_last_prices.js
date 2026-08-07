'use strict';

/*
 * The last known price per price-source lookup (issue #688).
 *
 * A fallback layer UNDER the process's in-memory cache, read only when a live
 * lookup is unavailable, so a wish still shows a price — clearly labelled with
 * its age — while the upstream is out. Measured 2026-08-07: the aggregator 504'd
 * for hours and every board-game wish showed nothing, because an expired cache
 * entry is never reused and the cache dies with the process anyway.
 *
 * GLOBAL and un-scoped, with no RLS and no tenant_id — the sharpest case in the
 * schema for it. A price is a public fact about a game, keyed by the provider's
 * own id: two tenants wishing for the same game are asking one question with one
 * answer, and scoping it would store the same row per tenant and ask the
 * upstream once per tenant. It holds no personal data at all (`vvt.md` row 21),
 * so there is nothing here for RLS to protect.
 *
 * `key` is the PRICE SOURCE'S OWN CACHE KEY verbatim (`source.cacheKey(...)`),
 * not a tuple assembled here. That is deliberate: the key already encodes
 * destination, currency, the EDITION LANGUAGE and the external id, and reusing
 * it makes it impossible for the fallback to answer a question the live lookup
 * would have answered differently. A key built from (source, externalId,
 * destination, currency) alone would drop the edition — and a French and a
 * German reader share a destination and a currency while being shown different
 * boxes at different prices.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS last_prices (
  key text PRIMARY KEY,
  data jsonb NOT NULL
);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS last_prices');
};
