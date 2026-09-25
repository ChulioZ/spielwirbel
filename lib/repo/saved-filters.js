'use strict';

/*
 * A round's saved session filters (#1328) — the list operations both backends
 * run INSIDE their own critical section (the JSON backend's synchronous
 * read-modify-write, Postgres's FOR UPDATE on the round row).
 *
 * Shared rather than written twice because every rule here is a precondition
 * over the list the mutator holds: name uniqueness, the cap, and the exact
 * permutation a reorder must be. Each has to live beside the lock, not in the
 * route (.claude/rules/data-access-layer.md, the `updateTag` paragraph) — and
 * two copies of "beside the lock" is how the backends would come to disagree.
 *
 * Every function takes the CURRENT list and returns either a new list (plus the
 * touched entry) or a string sentinel; none of them mutates its input, so a
 * refusal writes nothing by construction.
 */

// Names compare trimmed and case-insensitively, the rule tags use (#238).
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Append a filter. `filter` arrives resolved and WITHOUT an id; `newId` mints
// one. 'name_taken' is checked before 'quota' because it is the more specific
// answer — a user at the cap typing an existing name should be told about the
// name, which is the one they can fix in the same sheet.
function insertSavedFilter(list, filter, limit, newId) {
  const current = Array.isArray(list) ? list : [];
  if (current.some((f) => sameName(f.name, filter.name))) return 'name_taken';
  if (current.length >= limit) return 'quota';
  const entry = { id: newId(), ...filter };
  return { list: [...current, entry], entry };
}

// Rename one filter. Its OWN entry is excluded from the clash check, which is
// what makes a pure case fix („kinderabend" -> „Kinderabend") reachable.
// Returns null when the id is unknown.
function renameSavedFilter(list, fid, name) {
  const current = Array.isArray(list) ? list : [];
  const idx = current.findIndex((f) => f.id === fid);
  if (idx === -1) return null;
  if (current.some((f) => f.id !== fid && sameName(f.name, name))) return 'name_taken';
  const entry = { ...current[idx], name };
  const next = current.slice();
  next[idx] = entry;
  return { list: next, entry };
}

// Remove one filter; null when the id is unknown.
function removeSavedFilter(list, fid) {
  const current = Array.isArray(list) ? list : [];
  if (!current.some((f) => f.id === fid)) return null;
  return { list: current.filter((f) => f.id !== fid) };
}

// Put the filters in a hand-chosen order. The ids must be an EXACT permutation
// of the stored list, the same strictness `reorderTags` applies (#1159) and for
// the same reason: the list is written whole, so a stale client would otherwise
// resurrect a filter another device deleted or drop one it just saved.
function permuteSavedFilters(list, ids) {
  const current = Array.isArray(list) ? list : [];
  const want = Array.isArray(ids) ? ids.map(String) : [];
  if (want.length !== current.length) return 'filters_changed';
  const byId = new Map(current.map((f) => [f.id, f]));
  const next = [];
  for (const fid of want) {
    const f = byId.get(fid);
    // A repeated id reads as unknown — the first occurrence consumed it.
    if (!f) return 'filters_changed';
    byId.delete(fid);
    next.push(f);
  }
  return { list: next };
}

module.exports = { insertSavedFilter, renameSavedFilter, removeSavedFilter, permuteSavedFilters };
