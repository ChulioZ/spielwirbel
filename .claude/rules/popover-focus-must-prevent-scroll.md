---
paths:
  - "public/js/popover.js"
  - "public/js/sheet.js"
  - "public/js/views-badges.js"
  - "public/js/views-challenges.js"
---
# Focus inside a popover with `{ preventScroll: true }` — a page scroll CLOSES it

`openPopover` closes the card on any scroll whose target is outside it
(`onScroll` in `public/js/popover.js`, there since #247 so a page scroll does
not strand a card at a stale position). A plain `el.focus()` on something
inside a **clamped** popover — one taller than the room on its side, so
`popover-fit.js` capped it and it scrolls itself — can fire a scroll event on
the document even when `scrollY` does not move. The popover then closes in the
same frame it opened.

Measured on #1856 under Der Tisch at 1470×870: a MutationObserver logged
`+popover popover--badges … popover--clamped`, `scroll 414` (unchanged), and
`-popover …`. The holder's collection simply never appeared, and nothing
errored. It reproduced in one design and not in five others, because only that
design's row position made the card clamp.

## The rule

Every `focus()` a popover builder or its `attached()` callback makes goes
`focus({ preventScroll: true })` — the first control, the inline card's
heading, the tile focus returns to. `badgeRevealTarget` already did this for
its own reason (it scrolls first, then focuses).

**jsdom cannot see it**: there is no layout, so nothing clamps and no scroll
fires. The specs pass either way. Only a browser at a real viewport shows it,
which is why this is a rule and not a test.

**Related:** `.claude/rules/anchored-popover-is-placed-once.md` (the placement
this sits on), `.claude/rules/popover-width-is-shrink-to-fit.md` (the other
popover sizing trap #1856 met — the 300px cap on a collection of 20 marks),
`.claude/rules/popover-vs-sheet-editors.md`.
