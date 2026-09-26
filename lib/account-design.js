'use strict';

/*
 * Which design an ACCOUNT wears (#1186), and when it counts as having gone back
 * to Klassisch (#1201) — in one place, because three readers must agree:
 *
 *  - lib/me-projection.js, which tells the client what to wear;
 *  - lib/routes/account.js, which writes `designSwitchedBack` on a change;
 *  - both repo backends' instanceMetrics, which count accounts per design for
 *    the operator's „Funktionsnutzung" card.
 *
 * If the card resolved a stored id differently from /me, it would report an
 * account as wearing a design its owner never sees — and the switch-back write
 * would compare against a design the account was not actually wearing.
 *
 * Dependency-free apart from the registry, so both repo backends can require it
 * without a cycle.
 */

const {
  FACE_DESIGN, CLASSIC_DESIGN, isSelectableDesign, selectableDesignIds,
} = require('../public/js/designs');

/* The design a „switch back" returns TO. Klassisch is the original look and
   stays selectable forever („Wie bisher", operator decision 2026-09-19), so this
   is a fixed id rather than FACE_DESIGN — FACE_DESIGN moved from Klassisch to
   Der Tisch at the flip (#1202), and a switch-back defined against it would
   have flipped meaning with it. test/account-design.test.js pins that this id
   is registered and enabled. */
const SWITCH_BACK_DESIGN = CLASSIC_DESIGN;

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

/* The extra field a design change writes, if any (#1201).

   `designSwitchedBack: true` is set when an account that was WEARING something
   other than Klassisch moves to Klassisch — measured against the RESOLVED
   design before the change, i.e. what the account actually saw, never against
   the stored string or FACE_DESIGN. That one choice is what makes the write
   correct across the flip:

    - Before #1202, production offered Klassisch alone, so every account
      resolved to it and no change could set the flag.
    - Since #1202 an account that has not answered the chooser resolves to Der
      Tisch, so picking Klassisch — „Wie bisher" in the chooser, or on Konto —
      sets it. An account that already chose Klassisch does not, because it
      never left.

   Sticky: nothing ever clears it, so „went back at some point" survives a later
   return to Tisch. The tile reads it together with the CURRENT design, which is
   what separates „went back and stayed" from „went back and tried again". */
function switchBackPatch(before, nextDesign) {
  if (nextDesign !== SWITCH_BACK_DESIGN) return {};
  if (!before || before.designSwitchedBack === true) return {};
  return accountDesign(before) === SWITCH_BACK_DESIGN ? {} : { designSwitchedBack: true };
}

/* The operator's design tile (#1201), from `{ design, answered, switched, n }`
   groups — one per account on the JSON backend, one per stored (design,
   answered, flag) triple on Postgres, so both backends share this fold instead
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

   `switchedBack` needs the flag AND a current Klassisch: the question is „went
   back and stayed", and the flag alone is sticky. It is not narrowed by the
   answered filter — an unanswered account resolves to the face, so it could
   never count there anyway. */
function tallyDesignAdoption(groups) {
  const byDesign = Object.fromEntries(offeredDesignIds().map((id) => [id, 0]));
  let switchedBack = 0;
  for (const g of groups) {
    const design = accountDesign({ design: g.design, designChooserSeen: g.answered ? 'answered' : null });
    if (g.answered) byDesign[design] += g.n;
    if (g.switched === true && design === SWITCH_BACK_DESIGN) switchedBack += g.n;
  }
  return { byDesign, switchedBack };
}

module.exports = {
  SWITCH_BACK_DESIGN, accountDesign, answeredChooser, offeredDesignIds, switchBackPatch, tallyDesignAdoption,
};
