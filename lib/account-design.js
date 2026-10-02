'use strict';

/*
 * Which design an ACCOUNT wears (#1186) — in one place, because two readers
 * must agree:
 *
 *  - lib/me-projection.js, which tells the client what to wear;
 *  - both repo backends' instanceMetrics, which count accounts per design for
 *    the operator's „Funktionsnutzung" card.
 *
 * If the card resolved a stored id differently from /me, it would report an
 * account as wearing a design its owner never sees.
 *
 * The switch-back stamp `designSwitchedBack` (#1201) that used to be written
 * from here is gone (#1480, operator decision): its only reader, the operator's
 * switch-back share, was removed, and an unread personal-data field is a
 * data-minimisation problem. Stored values are deleted by
 * lib/repo/migrations/20261002120000_drop_design_switched_back.js (Postgres) and
 * scripts/migrate-drop-design-switched-back.js (JSON).
 *
 * Dependency-free apart from the registry, so both repo backends can require it
 * without a cycle.
 */

const {
  FACE_DESIGN, isSelectableDesign, selectableDesignIds,
} = require('../public/js/designs');

// Read per call, never hoisted: the tests run one process under both settings,
// and lib/app.js decides the same question the same way.
const production = () => process.env.NODE_ENV === 'production';

/* Whether this account has ever ANSWERED the design chooser — any run of it,
   by picking or by „Später entscheiden". Before that, its stored `design` was
   never a choice: registration wrote the face of the day into it, which was
   Klassisch until the flip (#1202). */
const answeredChooser = (user) => Boolean(user && user.designChooserSeen);

/* The design this account wears, RESOLVED rather than echoed. Three cases fold
   into the face here, and all must:

    - THE FLIP (#1202). An account that has never answered the chooser wears the
      face, whatever it stores. Every account registered before the flip stores
      `design: 'klassisch'` because that WAS the face at registration, not
      because anyone picked it — and the flip moves everyone to Der Tisch with
      the chooser offering Klassisch back. Resolved here, lazily, on read,
      rather than by rewriting accounts: no migration (CLAUDE.md), nothing to
      run under FORCE RLS (.claude/rules/rls-blocks-data-migrations.md), and it
      holds identically on both backends. Answering the chooser — or picking a
      design on Konto — stamps `designChooserSeen` and writes the design, so from
      then on the stored value is a real choice and is honoured (the two write
      sites are lib/routes/account.js's PATCH /me and POST /design-chooser-seen).
    - an account predating the field carries no key at all;
    - an account holding a design this instance does not offer. `enabled` is
      resolved against NODE_ENV, so a design picked on a dev instance is a real
      stored value production must not honour — and applyDesign() on the client
      is deliberately POLICY-FREE (public/js/design.js says why), so an unoffered
      id handed out would be faithfully worn. */
function accountDesign(user) {
  if (!answeredChooser(user)) return FACE_DESIGN;
  const id = user.design;
  return isSelectableDesign(id, { production: production() }) ? id : FACE_DESIGN;
}

// Every design this instance offers, in registry order — the rows of the
// operator's design tile. Registry-owned, so the card's KEYS come from code and
// never from a stored value (the key sweep in test/status.test.js).
function offeredDesignIds() {
  return selectableDesignIds({ production: production() });
}

/* The operator's design card (#1201), from `{ design, answered, n }`
   groups — one per account on the JSON backend, one per stored (design,
   answered) pair on Postgres, so both backends share this fold instead
   of restating it. `answered` is whether the account has ever answered the
   chooser; without it the fold could not resolve the flip's lazy default and
   would count every untouched pre-flip account as Klassisch.

   `byDesign` is keyed by every design this instance OFFERS, zero included, in
   registry order: the keys come from code, never from a stored value, and an
   offered design nobody wears still gets its row.

   It counts ONLY accounts that have answered the chooser (#1362) — every
   answer in the chooser and every design pick on Konto stamp
   `designChooserSeen`. An account that never answered wears the face without
   having seen the alternatives, so it says nothing about which design people
   pick and drops out of every row; the rows sum to the ANSWERED accounts, not
   to all accounts measured. Skippers are in: „Später entscheiden", Escape and
   Back stamp the field and store the face, byte-identical to a confirmed Der
   Tisch, so the tile must never call these rows a choice.

   An answered group counts under the design it RESOLVES to — the answer /me
   gives that account — so an absent key (null from SQL) or a design production
   does not offer lands on the face.

   The switch-back share that used to ride beside `byDesign` was dropped in
   #1480 (operator decision) — from the card AND the payload. */
function tallyDesignAdoption(groups) {
  const byDesign = Object.fromEntries(offeredDesignIds().map((id) => [id, 0]));
  for (const g of groups) {
    if (!g.answered) continue;
    byDesign[accountDesign({ design: g.design, designChooserSeen: 'answered' })] += g.n;
  }
  return { byDesign };
}

module.exports = {
  accountDesign, answeredChooser, offeredDesignIds, tallyDesignAdoption,
};
