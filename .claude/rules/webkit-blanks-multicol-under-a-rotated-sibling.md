---
paths:
  - "public/styles.css"
  - "public/css/designs/**"
---
# WebKit blanks a column flow while a ROTATED sibling above it is hovered — give the flow a stacking context

#1571: hovering the live ticket on the round hub blanked every card in
`.hub-cards` (the recommendations teaser among them) for as long as the hover
lasted, in Safari and every iOS browser. Chromium paints it correctly, so the
Browser pane cannot see it (`.claude/rules/browser-pane-is-chromium-only.md`).

Two things together trigger it, and neither one alone does:

- the hovered sibling's `transform` contains a **`rotate()`** (`.ticket:hover`'s
  `rotate(-0.3deg)`; `translateY` alone is fine, and dropping the shadow does not
  help);
- the cards sit in a **multicol** container (`columns:`). The same cards in a
  grid stay painted, which is why Der Tisch and Ocean, whose sheets turn
  `.hub-cards` into a grid, never showed it.

**The fix goes on the container: `isolation: isolate` on the column flow.**
Measured with the windowed WebKit probe, as the mean pixel diff of the teaser
during hover (Klassisch / Die Brücke / Forest): **24.9 / 14.5 / 21.6** without it,
**0.00** with it, and 0.00 in the three unaffected designs either way.
`contain: paint`, `translateZ(0)` and `will-change: transform` on the container
also work, but they clip shadows or force a GPU layer. Promoting the *ticket*
(`will-change` on it) does **not** help. And a design-scoped rotation-free hover
(the first fix, Forest-only) works only for the one design that has it, while
the bug lives in the shared container.

`test/hub-cards-ticket-hover.test.js` pins the declaration, sweeps every design
sheet for a rule that resets it, and pins that the ticket keeps its tilt.

**When you add another column flow below something that tilts on hover**, give
it the same stacking context and probe it in WebKit. `.home-dash` was checked
(2026-10-08) and does not blank, because the lobby grid sits between it and the
resume ticket. Only Klassisch and Der Tisch render a ticket there.

## Probing it

Point the windowed probe at the dev instance, apply the hover by cloning the
sheet's `.ticket…:hover` rules onto a class, and compare the snapshot of the
card area at rest with the snapshots during the hover. Two things invalidated
the first runs. A fresh demo account gets the **design-chooser sheet** on top of
every screen, so dismiss it („Später entscheiden") before measuring. And routing
re-applies the **account's** design, so apply the design under test *after* the
route. Report the design the page actually wore, and run the
`isolation: auto !important` control beside every fix reading.

**Related:** `.claude/rules/css-multicolumn-card-flows.md` (the flows this
binds), `.claude/rules/browser-pane-is-chromium-only.md` (the probe).
