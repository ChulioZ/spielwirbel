'use strict';

/*
 * Recording what a BGG parse learned into the instance-wide link table (#1638).
 *
 * Every `/thing` parse already sees each category's, mechanic's and designer's
 * numeric id; the parser hands them over as `links` beside the name arrays
 * (lib/providers/bgg.js `linkPairs`), and the three fill paths — the
 * provider-info backfill (which the BGG collection import triggers), and the
 * corpus enrichment pass — hand their parse results here. Games keep their name
 * lists untouched: a surface resolves a link by `(type, name)`, which works
 * because BGG names are unique within a type.
 */

const repo = require('./repo');
const { logger } = require('./observability');
const { emptyLinkAnswer } = require('./repo/bgg-links-rows');

// BEST-EFFORT by contract: none of the three callers may fail because the link
// table could not be written, so every error is logged and swallowed here — at
// the one place all of them go through — rather than at each call site.
async function recordBggLinks(items) {
  const rows = (items || []).flatMap((it) => (it && Array.isArray(it.links) ? it.links : []));
  if (!rows.length) return { upserted: 0 };
  try {
    return await repo.upsertBggLinks(rows);
  } catch (err) {
    logger.warn({ event: 'bgg_links_upsert_failed', rows: rows.length, message: err.message });
    return { upserted: 0 };
  }
}

// Resolve names to ids for a SERVER-built payload (the Entdecken favourites).
// Best-effort the same way: a failed lookup answers "no ids known", so the
// names render as plain text rather than the payload failing.
async function lookupBggLinks(query) {
  try {
    return await repo.getBggLinks(query);
  } catch (err) {
    logger.warn({ event: 'bgg_links_lookup_failed', message: err.message });
    return emptyLinkAnswer();
  }
}

module.exports = { recordBggLinks, lookupBggLinks };
