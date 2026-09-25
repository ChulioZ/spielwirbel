---
paths:
  - "public/css/designs/*.css"
---
# Paper IN THE PAGE needs the overlay's whole token answer, not just its grounds

`.claude/rules/overlay-surface-flip-strands-the-status-tokens.md` is about Der
Tisch's overlays: a subtree that flips from walnut to paper must re-point every
token `:root` mixed from the walnut, or it inherits a finished walnut colour. The
overlay rule was fixed and guarded — and the same trap sat, unguarded, on the
paper **in the page**: the result Tafel, the vote card, the split-table Tafel,
the live-vote panel and the Chronik's session cards.

Each of those blocks named its grounds and inks (`--surface`, `--ink`, later
`--control-fill` after the „Spielen" button came out at 1.57:1) and stopped. The
brand tints, `--brand-ink`/`--brand-ring` and the status inks were still walnut.
It surfaced in production as the Tafel's „auf dem Tisch" chip: `.trow__chip`
grounds itself in `--brand-tint-soft`, so it stayed a dark walnut pill under the
gold row's `--gold-ink` — **1.12:1**.

## The rule

**One scheme-gated `:where(...)` rule gives every page-paper surface the
overlay's answer** (`tisch.css`, directly after the overlay block). `:where()`
keeps it at the gate's specificity, below each surface's own block, so a value a
surface chose for itself still wins and the shared rule only fills what was left
out. A new paper surface is added to that list, not given its own copy.

`test/tisch-overlays.test.js` derives the requirement — every `:root` token mixed
from `--page-bg`/`--surface`, plus the walnut-tuned inks — and checks each block
that sets `--ink: var(--paper-ink)` against its own body plus the `:where()`
rule. Deleting the shared rule reddens it naming all six surfaces.

**Why the earlier fix did not generalise:** the „Spielen" regression was fixed by
adding the two tokens its symptom named (`--control-fill`/`--control-edge`) and a
test for exactly those two. A guard written from one symptom covers that symptom;
derive the list instead.

## Two traps met on the way

- **`:is()` carries its heaviest argument's specificity.** Grouping
  `.btn--danger` with `.archive-row__actions .btn[data-act="delete"]` in one
  `:is()` made the felt rule out-rank `.sheet .btn--danger` and would have
  un-filled every red button in a sheet. Keep them as separate selectors; the
  test asserts the sheet rule still `outranks` the felt one.
- **`.btn` transitions its background, so a control reads the OLD colour.** A
  "put the old fill back" probe that injects the value and sweeps in the same
  tick measures the start of the transition — the fixed colour — and reports the
  control as clean, which reads exactly like a sweep that cannot see the bug. Read
  `getComputedStyle(el).backgroundColor` back and confirm it moved before trusting
  the control (or set `transition: none` on the element for the probe).

**Related:** `.claude/rules/overlay-surface-flip-strands-the-status-tokens.md`
(the overlay half), `.claude/rules/break-the-code-on-purpose.md`.
