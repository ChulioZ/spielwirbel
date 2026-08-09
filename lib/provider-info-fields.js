'use strict';

/*
 * WHICH provider-sourced fields a game carries, and what counts as a value worth
 * storing (#717, widened by #724). Dependency-free on purpose: the two repo
 * backends, the games route and the lazy backfill all need this shape, and the
 * backends must not gain a path to the provider registry (lib/provider-info.js
 * requires ./providers, which is why the field shape does not live there).
 *
 * It exists as ONE module because the alternative is the drift this repo has
 * already paid for once: a field written but not counted leaves every game
 * permanently incomplete, one counted but not written can never complete, and a
 * third hand-written copy at a route would decide, on its own, whether an empty
 * list erases a stored one. See .claude/rules/provider-info-is-a-field-set.md
 * and .claude/rules/shared-constants-across-the-stack.md.
 */

// The guard per field. An absent/null/empty value is NOT a value: BGG answering
// with nothing must never erase what an earlier fetch stored (values only
// accrete — the licence-granted copy stays until a real one replaces it), and a
// free-text game's row must keep every one of these keys ABSENT rather than
// gaining a wall of nulls (absent-key parity, .claude/rules/postgres-backend.md).
//
// An empty categories/mechanics array is "the provider named none", which is why
// it is skipped exactly like a null rather than stored as [].
const isNum = (v) => Number.isFinite(v);
const isText = (v) => typeof v === 'string' && !!v;
const isList = (v) => Array.isArray(v) && v.length > 0;

const PROVIDER_INFO_GUARDS = {
  weight: isNum,
  description: isText,
  minPlaytime: isNum,
  maxPlaytime: isNum,
  minAge: isNum,
  categories: isList,
  mechanics: isList,
  rating: isNum,
};

const PROVIDER_INFO_FIELDS = Object.keys(PROVIDER_INFO_GUARDS);

// The fields the link-provider sheet offers a CHIP for — the two the sheet
// previews and the user opts into (#717). Everything else is provider metadata
// nobody chooses, so the route writes it whenever the hop has already run.
const CHIPPED_PROVIDER_INFO_FIELDS = ['weight', 'description'];

const UNCHIPPED_PROVIDER_INFO_FIELDS =
  PROVIDER_INFO_FIELDS.filter((k) => !CHIPPED_PROVIDER_INFO_FIELDS.includes(k));

// Whether a game already carries a value for one field.
function hasProviderField(game, key) {
  return PROVIDER_INFO_GUARDS[key]((game || {})[key]);
}

// Copy the fields that carry a real value from `src` onto `dst`, and return
// `dst`. Pass `fields` to restrict it to a subset (the route writes only the
// unchipped ones without a user's opt-in).
function assignProviderInfo(dst, src, fields = PROVIDER_INFO_FIELDS) {
  for (const key of fields) {
    if (PROVIDER_INFO_GUARDS[key]((src || {})[key])) dst[key] = src[key];
  }
  return dst;
}

module.exports = {
  PROVIDER_INFO_FIELDS,
  CHIPPED_PROVIDER_INFO_FIELDS,
  UNCHIPPED_PROVIDER_INFO_FIELDS,
  hasProviderField,
  assignProviderInfo,
};
