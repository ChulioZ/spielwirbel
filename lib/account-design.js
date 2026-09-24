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

const { FACE_DESIGN, isSelectableDesign, selectableDesignIds } = require('../public/js/designs');

/* The design a „switch back" returns TO. Klassisch is today's look and stays
   selectable forever („Wie bisher", operator decision 2026-09-19), so this is a
   fixed id rather than FACE_DESIGN — FACE_DESIGN is Klassisch today and becomes
   Tisch at the flip (#1202), and a switch-back defined against it would flip
   meaning with it: before the flip every move to Tisch would read as „went
   back". test/account-design.test.js pins that this id is registered and
   enabled. */
const SWITCH_BACK_DESIGN = 'klassisch';

// Read per call, never hoisted: the tests run one process under both settings,
// and lib/app.js decides the same question the same way.
const production = () => process.env.NODE_ENV === 'production';

/* The design this account wears, RESOLVED rather than echoed. Two failures fold
   into the face here, and both must:

    - an account predating the field carries no key at all;
    - an account holding a design this instance does not offer. `enabled` is
      resolved against NODE_ENV, so a design picked on a dev instance is a real
      stored value production must not honour — and applyDesign() on the client
      is deliberately POLICY-FREE (public/js/design.js says why), so an unoffered
      id handed out would be faithfully worn. */
function accountDesign(user) {
  const id = user && user.design;
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
   correct on both sides of the flip:

    - Before #1202, production offers Klassisch alone, so every account resolves
      to it and no change can set the flag — correct, nobody has been on Tisch.
      On a dev instance, trying Tisch and returning DOES set it, which is the
      same fact the tile reports after the flip.
    - After #1202 an account moved to Tisch (stored or resolved) that picks
      Klassisch — in the chooser or on Konto — sets it. An account whose stored
      `klassisch` still resolves to Klassisch does not, because it never left.

   Sticky: nothing ever clears it, so „went back at some point" survives a later
   return to Tisch. The tile reads it together with the CURRENT design, which is
   what separates „went back and stayed" from „went back and tried again". */
function switchBackPatch(before, nextDesign) {
  if (nextDesign !== SWITCH_BACK_DESIGN) return {};
  if (!before || before.designSwitchedBack === true) return {};
  return accountDesign(before) === SWITCH_BACK_DESIGN ? {} : { designSwitchedBack: true };
}

/* The operator's design tile (#1201), from `{ design, switched, n }` groups —
   one per account on the JSON backend, one per stored (design, flag) pair on
   Postgres, so both backends share this fold instead of restating it.

   `byDesign` is keyed by every design this instance OFFERS, zero included, in
   registry order: the keys come from code, never from a stored value, and an
   offered design nobody wears still gets its row. Each group counts under the
   design it RESOLVES to — the answer /me gives that account — so an absent key
   (null from SQL) or a design production does not offer lands on the face, and
   the rows always sum to the accounts measured.

   `switchedBack` needs the flag AND a current Klassisch: the question is „went
   back and stayed", and the flag alone is sticky. */
function tallyDesignAdoption(groups) {
  const byDesign = Object.fromEntries(offeredDesignIds().map((id) => [id, 0]));
  let switchedBack = 0;
  for (const g of groups) {
    const design = accountDesign({ design: g.design });
    byDesign[design] += g.n;
    if (g.switched === true && design === SWITCH_BACK_DESIGN) switchedBack += g.n;
  }
  return { byDesign, switchedBack };
}

module.exports = {
  SWITCH_BACK_DESIGN, accountDesign, offeredDesignIds, switchBackPatch, tallyDesignAdoption,
};
