'use strict';

/*
 * The BGG link table's input cleaning (#1638), shared by both repo backends so
 * they store exactly the same rows for the same input and answer the same
 * question for the same lookup. Pure and dependency-free apart from the two
 * shared constants it validates against.
 */

const { BGG_LINK_TYPES, BGG_LINK_NAME_MAX, isBggLinkType } = require('../../public/js/bgg-links');
const { BGG_UNCREDITED } = require('../../public/js/provider-info-fields');

// The rows to store, or [] for anything malformed.
//
// DEDUPED TWICE, last one wins each time, because both keys are unique in the
// store: two rows for one `(type, bggId)` would make a Postgres upsert touch one
// row twice (an error), and two rows for one `(type, name)` would violate the
// name index. The name is stored VERBATIM — never trimmed or re-cased — because
// BGG's licence forbids modifying retrieved data and because the game rows hold
// the same untouched string the lookup has to match.
//
// `(Uncredited)` is refused here as well as in the parser: every reader drops it
// via creditedDesigners, so a row for it could never be asked about.
function normalizeLinkRows(rows) {
  const byId = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !isBggLinkType(r.type)) continue;
    if (!Number.isSafeInteger(r.bggId) || r.bggId <= 0) continue;
    if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > BGG_LINK_NAME_MAX) continue;
    if (r.type === 'designer' && r.name === BGG_UNCREDITED) continue;
    const key = `${r.type}:${r.bggId}`;
    byId.delete(key);
    byId.set(key, { type: r.type, bggId: r.bggId, name: r.name });
  }
  const byName = new Map();
  for (const r of byId.values()) {
    const key = `${r.type}\u0000${r.name}`;
    byName.delete(key);
    byName.set(key, r);
  }
  return [...byName.values()];
}

// The cleaned lookup question: `{ category: [names], … }` with every known type
// present (possibly empty), duplicates and non-strings dropped.
function normalizeLinkQuery(query) {
  const out = {};
  for (const type of Object.keys(BGG_LINK_TYPES)) {
    const list = query && Array.isArray(query[type]) ? query[type] : [];
    out[type] = [...new Set(list.filter((n) => typeof n === 'string' && n && n.length <= BGG_LINK_NAME_MAX))];
  }
  return out;
}

// The empty answer: every type present, no names resolved.
function emptyLinkAnswer() {
  const out = {};
  for (const type of Object.keys(BGG_LINK_TYPES)) out[type] = {};
  return out;
}

module.exports = { normalizeLinkRows, normalizeLinkQuery, emptyLinkAnswer };
