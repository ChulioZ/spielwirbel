---
paths:
  - "public/styles.css"
---
# A card container that PACKS is a column flow — and multicol fails in five silent ways

`.hub-cards` and `.home-dash` are `columns: <n>px`, not grids (#942). Grid places
in **rows**, so the tallest card in a row holds every short neighbour's successor
down with it — the Start tab's „Rundenpuls" is a chart plus three lines beside a
two-row suggestion card, and the next row could not begin until the taller ended.

`align-self: start` does not reach it, which is the part worth knowing: it stops
the short card *stretching*, so the space is saved inside the card and reappears
between the rows. Both variants waste the same band; only packing does not.

**Convert a container iff its items' heights are content-driven and genuinely
different** — an optional chart, a list of one to three rows, an async tile.
A container of **uniform tiles** stays a grid: packing there trades a flush row
for a ragged one and saves nothing. The tell is already in the sheet — a
container that opts out of stretching (`align-self: start` / `align-items:
start`) is one whose author had already decided its items differ.

Measured for #942 (natural, unstretched heights at 760–1500px): `.pokale-cards`
168/137/137 in a single row, `.ds-list--tiles` 98/98/98/98 — no gain, so both
stayed grids. `.home-resume__list` is structurally fixed (image, round name,
title, time, stub — no optional part), and `.tables-grid` re-balances the
two-step „Hierher verschieben" target out from under the cursor between the pick
and the click, so both stayed too.

## The five that fail quietly

1. **`row-gap` does nothing.** In a multi-column container `gap` sets the
   *column* gap only; vertical spacing is a `margin-bottom` **on the item**.
   Write `column-gap` explicitly, so the shorthand cannot read as though it set
   both.
2. **`break-inside: avoid` is mandatory, not defensive.** Without it a card
   fragments across the column boundary and its border and background fragment
   with it — which reads as broken rather than as unpacked.
3. **`column-width` reproduces `auto-fill`, never `auto-fit`.** `columns: 280px`
   fits `floor((W + gap) / (280 + gap))` columns — literally `columnsIn` in
   `test/support/css.js` — so a lone card stays about one column wide. That is
   free where the grid *wanted* `auto-fill`, and a **regression** where it wanted
   `auto-fit`: a lone tile is then stranded ~320px wide against the left edge of
   an 1800px shell, the #358 defect
   (`.claude/rules/auto-fit-collapses-only-empty-tracks.md`). Restore it rather
   than dropping the conversion:
   ```css
   .home-dash:has(> :only-child) { columns: 1; }
   ```
   Live selector, not a class the renderer sets: two of that zone's three tiles
   decide asynchronously, so "only child" is a state entered after first paint.
4. **Keep `column-fill` at its default (`balance`)** — that IS the packing.
   `column-fill: auto` needs a definite container height and is unusable here.
5. **The trailing margin is trimmed — do NOT compensate for it.** The last card
   in a column carries a `margin-bottom` that looks like it should push the
   container's bottom edge down, so the reflex is a cancelling negative margin on
   the container. Measured in Chrome at two and three columns, the browser
   truncates it at the column end, so the container already ends flush at the
   last card — and the "fix" cut `.hub-cards`'s 26px gap to `.hub-actions` down
   to 14px. Measure before compensating; if a browser is ever found that keeps
   it, 12px of slack below a container is the cheaper error.

`:empty { display: none }` still works — `display` beats `columns` — so a
container appended before its content can arrive keeps costing nothing.

## The trade-off that is accepted, not overlooked

Reading and tab order become **column-major** above one column: cards flow down
column 1, then column 2, so left-to-right no longer matches DOM order. Confirmed
with the operator (#942) for these two containers only, on the grounds that they
hold independent modules with no narrative sequence between them — WCAG 1.3.2 is
about a *meaningful* sequence. DOM order is untouched, so the phone (one column)
still reads action-first. **Never convert a container whose items carry an
order** — that is `.claude/rules/tiles-vs-lists.md`'s ordering half, and multicol
breaks it harder than a grid does, since a grid at least reads left-to-right.

## Verifying it

jsdom computes no layout and applies no external stylesheet, so no spec here can
see a column form. The CSS assertions
(`test/hub-start-cards.test.js`, `test/home-dashboard.test.js`) pin the
mechanism; the packing itself is a `getBoundingClientRect()` sweep in a resized
Browser pane — every card's top must be the container's top or the previous
card-in-that-column's bottom plus the gap. `resize_window` first, and cache-bust
the `<link>` after editing (`.claude/rules/pwa-service-worker.md`), or you are
measuring a 0×0 viewport against the previous stylesheet.

**Related:** `.claude/rules/auto-fit-collapses-only-empty-tracks.md` (the
guarantee point 3 costs you), `.claude/rules/tiles-vs-lists.md` (which
containers may be tiled at all), `.claude/rules/responsive-content-width.md`,
`.claude/rules/css-text-assertions-strip-comments.md`.
