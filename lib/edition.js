'use strict';

/*
 * The EDITION a game's cover was picked from (#742) — BGG's own edition name, its
 * year and its language values, as stored on the game row.
 *
 * It exists as its own module because two routes accept it in two shapes and must
 * bound it identically: `lib/routes/games.js` takes it flattened onto a multipart
 * body (`editionName`/`editionYear`/`editionLanguages`, the way `source` is
 * already flattened into three fields), and `lib/routes/lookup.js` takes a map of
 * nested objects keyed by external id, beside `covers`. One normalizer is what
 * keeps the bulk import from accepting what a single add refuses.
 *
 * The caps live here rather than in a shared public/js module because the client
 * never STATES them — it relays what BGG answered, so there is no offered-vs-
 * validated pair that could drift (.claude/rules/shared-constants-across-the-stack.md).
 * They exist so a hand-rolled request cannot store an unbounded blob.
 *
 * `name` and `year` are display-only text, escaped at render like any other user
 * string. `languages` is the only half that DOES anything — it selects which
 * language edition the wish-list price quotes — and it is allowlisted on the way
 * out (`BGG_EDITION_LANGS` in lib/prices/boardgameprices.js), so an unrecognised
 * value reaches no outbound URL.
 */

const EDITION_NAME_MAX = 200;
const EDITION_LANGUAGES_MAX = 12;
const EDITION_LANGUAGE_MAX = 40;

// `{ name, year, languages }`, or **null** when the input says nothing about the
// printing. Null is meaningful rather than merely empty: it is what a pasted
// custom cover URL looks like, and the callers read it as "clear the stored
// edition" — so a cover that is no longer a BGG printing can never keep a label
// describing a box that is not on screen. It is also what keeps the key ABSENT on
// a free-text game instead of storing a row of nulls (absent-key parity,
// .claude/rules/postgres-backend.md).
function normalizeEdition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name == null ? '' : raw.name).trim().slice(0, EDITION_NAME_MAX);
  // A BGG `yearpublished value="0"` is its "unknown", and the picker already
  // turns it into null — re-checked here because this is the trust boundary.
  const y = parseInt(raw.year, 10);
  const year = Number.isInteger(y) && y > 0 ? y : null;
  // Multipart repeats a field, so a single language arrives as a bare string —
  // the same coercion `tagIds` makes.
  const list = Array.isArray(raw.languages) ? raw.languages : raw.languages == null ? [] : [raw.languages];
  const languages = list
    .map((v) => String(v).trim().slice(0, EDITION_LANGUAGE_MAX))
    .filter(Boolean)
    .slice(0, EDITION_LANGUAGES_MAX);
  if (!name && year === null && !languages.length) return null;
  return { name, year, languages };
}

module.exports = {
  normalizeEdition,
  EDITION_NAME_MAX,
  EDITION_LANGUAGES_MAX,
  EDITION_LANGUAGE_MAX,
};
