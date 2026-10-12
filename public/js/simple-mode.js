/* Spielwirbel – the „Einfacher Modus" feature list and its predicate (#1646).

   A per-ACCOUNT view preference: each id names one area of the app the account
   may hide from its own UI. Nothing is skipped, deleted or altered — rounds keep
   recording everything, and a co-member with the mode off sees it all. Only the
   rendering asks.

   Shared across the stack (.claude/rules/shared-constants-across-the-stack.md):
   the Konto screen OFFERS these ids, PATCH /api/account/me VALIDATES against
   them, lib/me-projection.js NORMALISES the stored value with the same function,
   and both repo backends count the operator's per-feature figures with
   `simpleModeHides` — so a feature the client offers can never be one the server
   drops, and the admin line for a new id appears without anyone adding it.

   The stored shape is `{ all, except }`, deliberately NOT a list of hidden ids:
   an account that chose "hide everything" must also get an id ADDED LATER
   hidden, because that is what it asked for. `except` therefore means the
   opposite thing under each value of `all` — the items kept when `all` is set,
   the items hidden when it is not — and a sub-option toggle is the same flip of
   membership either way.

   Loaded as a shared-scope script by index.html and required from Node, so it
   is dependency-free. */

'use strict';

// The order is the Konto screen's order, grouped as it renders them.
const SIMPLE_MODE_GROUPS = [
  { id: 'round', features: ['trophies', 'stats', 'suggestions', 'todo', 'recap'] },
  { id: 'pass', features: ['ratingDetails', 'gameExtras'] },
  { id: 'account', features: ['friends', 'discover', 'quiz', 'priceAlerts', 'news', 'profileRecord'] },
];
const SIMPLE_MODE_FEATURES = SIMPLE_MODE_GROUPS.flatMap((g) => g.features);

/* Any stored or submitted value → the canonical shape. An absent key (every
   account predating #1646), a legacy non-object and junk all read as OFF.
   Unknown ids are dropped, duplicates collapse, and the list is kept in feature
   order so two equal preferences are equal values.

   One collapse: an `except` naming EVERY feature is the same view as its
   opposite with an empty list, so it is stored as that. Without it, an account
   that ticked every option one by one would stay `all: false` and see the next
   new feature; one that ticked the parent and then unticked each option would
   stay `all: true` and have the next one hidden — the opposite of what both
   now see on screen. */
function normalizeSimpleMode(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { all: false, except: [] };
  const all = value.all === true;
  const named = new Set(Array.isArray(value.except) ? value.except : []);
  const except = SIMPLE_MODE_FEATURES.filter((f) => named.has(f));
  if (except.length === SIMPLE_MODE_FEATURES.length) return { all: !all, except: [] };
  return { all, except };
}

// Is feature `f` hidden under this preference? An id outside the list is hidden
// exactly when `all` is set — which is what makes a feature added later follow
// an "everything off" account.
function simpleModeHides(pref, f) {
  const p = normalizeSimpleMode(pref);
  return p.all ? !p.except.includes(f) : p.except.includes(f);
}

// The parent checkbox's state over the features ON SCREEN (`shown` — the quiz
// and price alerts are offered only where the instance runs them).
function simpleModeParentState(pref, shown = SIMPLE_MODE_FEATURES) {
  const hidden = shown.filter((f) => simpleModeHides(pref, f)).length;
  if (!hidden) return 'off';
  return hidden === shown.length ? 'on' : 'mixed';
}

/* A click on the parent: uniform, with every exception cleared. From "all
   hidden" it shows everything; from anything else (off or mixed) it hides
   everything — the select-all pattern, where an indeterminate box completes. */
function simpleModeToggleAll(pref, shown = SIMPLE_MODE_FEATURES) {
  return simpleModeParentState(pref, shown) === 'on'
    ? { all: false, except: [] }
    : { all: true, except: [] };
}

// A click on one sub-option flips its membership in `except` under either
// value of `all` (see the header), then normalises.
function simpleModeToggle(pref, f) {
  const p = normalizeSimpleMode(pref);
  const except = p.except.includes(f) ? p.except.filter((x) => x !== f) : [...p.except, f];
  return normalizeSimpleMode({ all: p.all, except });
}

/* The operator's „Funktionsnutzung" figures (#1646), over a list of stored
   preferences: komplett (all, nothing excepted), any feature hidden, and the
   EFFECTIVE hide per feature — an `all` account counts toward every feature it
   did not except. Both repo backends reduce through this one function, so the
   two cannot disagree about what "hidden" means; keys follow the feature list,
   so a new id gets its admin line with no other edit. */
function tallySimpleMode(prefs) {
  const out = { all: 0, any: 0, hidden: Object.fromEntries(SIMPLE_MODE_FEATURES.map((f) => [f, 0])) };
  for (const raw of prefs) {
    const p = normalizeSimpleMode(raw);
    if (p.all && !p.except.length) out.all += 1;
    const hidden = SIMPLE_MODE_FEATURES.filter((f) => simpleModeHides(p, f));
    if (hidden.length) out.any += 1;
    for (const f of hidden) out.hidden[f] += 1;
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SIMPLE_MODE_GROUPS,
    SIMPLE_MODE_FEATURES,
    normalizeSimpleMode,
    simpleModeHides,
    simpleModeParentState,
    simpleModeToggleAll,
    simpleModeToggle,
    tallySimpleMode,
  };
}
