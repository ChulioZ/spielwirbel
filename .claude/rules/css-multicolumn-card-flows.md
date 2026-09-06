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
5. **The vertical spacing goes INSIDE the break-avoid box — never on the card
   as a margin.** This point said the opposite until #946, on a measurement that
   was correct and taken in one engine.

   A margin adjoining a column break is *truncated* by Chromium, exactly as
   measured. **WebKit carries it into the next column instead**, so with the
   spacing on the card the first card of every column after the tallest one
   starts one gap low — 18px on `.home-dash`, 12px on `.hub-cards`, 1.25rem on
   the admin dashboard, on every Safari and every iPhone, on the public home
   screen. CSS Fragmentation says the margin is truncated; Chromium follows it
   and WebKit does not.

   The shape that measures flush in **both** engines is a slot element per card
   carrying `break-inside: avoid` and `padding-bottom: <gap>`, with the card
   itself holding no vertical margin at all:

   ```css
   .card-slot { break-inside: avoid; }
   .home-dash > .card-slot { padding-bottom: 18px; }
   .home-dash > :last-child { padding-bottom: 0; }
   ```

   Padding inside the unavoidable box has nowhere to spill. The cost is the
   slack this point used to warn about — the container ends one gap below the
   tallest column — which is now the *same* in both engines rather than in
   neither, and is still the cheaper error. **Do not compensate for it with a
   negative margin on the container**, which remains the wrong instrument: that
   was the original finding and it stands (it cut `.hub-cards`'s 26px gap to
   `.hub-actions` down to 14px).

   Two consequences that are easy to miss. A renderer that removes a card must
   remove its **slot** (`slotOf` in `core.js`), or an orphaned slot keeps paying
   its padding and still counts as a child — so `:empty` cannot collapse the
   container and the point-3 `:only-child` rule stops firing. And a slot around
   a card that starts `hidden` must collapse with it
   (`.card-slot:has(> [hidden]) { display: none }` — admin.html has two).

`:empty { display: none }` still works — `display` beats `columns` — so a
container appended before its content can arrive keeps costing nothing. With
point 5's slot it is the *slot* that must not be appended for an absent card,
not merely the card left out of it.

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

**That sweep is Chromium-only, and point 5 is what it cost.** The Browser pane
cannot see a fragmentation difference between engines, so a claim about column
breaks needs the headless WebKit probe in
`.claude/rules/browser-pane-is-chromium-only.md` as well — and the sweep must
run with the **tallest column not last**, at two *and* three columns, because
the offset only appears when the column setting the container's height has a
successor.

The DOM half needs its own assertion. A card appended **without** its slot
breaks nothing else — the container still packs, `:empty` and `:only-child` still
behave, the card simply has no spacing — so each append site is guarded by a
`parentElement.classList.contains('card-slot')` loop over the rendered cards,
with an exact tile/card count so a fixture that renders two of three cannot
leave the third's append unguarded.

**Related:** `.claude/rules/auto-fit-collapses-only-empty-tracks.md` (the
guarantee point 3 costs you), `.claude/rules/tiles-vs-lists.md` (which
containers may be tiled at all), `.claude/rules/responsive-content-width.md`,
`.claude/rules/css-text-assertions-strip-comments.md`.
