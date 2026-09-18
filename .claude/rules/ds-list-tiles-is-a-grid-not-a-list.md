---
paths:
  - "public/styles.css"
  - "public/js/views-round-settings.js"
  - "public/js/views-round-detail.js"
---
# `.ds-list--tiles` is a wrapping GRID — every "up / down / the row above" claim on it is wrong at desktop width

The rows in it are `.ds-row` elements, the container is called a `ds-list`, and
on a phone it renders exactly one item per line. Everything about the naming and
about the width you happen to be testing at says *vertical list*. It is not:

```css
.ds-list--tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
```

Measured in the pane at a 1200px viewport, the Tags screen reported
`grid-template-columns: "312px 312px 312px"` — **three columns**, because the
content column is `--w-read: 900px`. So for the majority of a desktop session
the previous item is to the **left**, not above, and only below ~600px does the
grid collapse to the single column the name suggests.

## What it cost

#1159 specified up/down arrows for reordering a round's tags, in good faith and
naming `.ds-row` as the element to hang them on. Shipped as written, the arrow
on a laptop would have pointed at a neighbour the tag never moves to — the one
defect no test in this repo can see, since jsdom applies no external stylesheet
and every assertion is about array order, which is correct either way.

The fix was to stop making a geometric claim at all: the controls are
`ti-arrow-left` / `ti-arrow-right` labelled „nach vorne" / „nach hinten"
(move earlier / later). A sequence has an earlier and a later at **every**
width, and for an icon-only button the `aria-label` is what a screen reader
reads anyway — so the label carries the meaning and the glyph only has to not
contradict it.

## The rule

**Before adding any positional affordance to a list, read its container's
`display`.** If it is `grid` with `auto-fill`/`auto-fit`, the item order is a
*sequence*, not a column — so describe it as one. Up/down, "move to the top",
"the row below" and a drag axis are all claims the layout will break at some
width nobody tested at.

Reach for the measurement rather than the CSS when it matters, because the
tokens are indirect (`--w-read` → column count):

```js
getComputedStyle(document.querySelector('.ds-list--tiles')).gridTemplateColumns
```

## Why the naming misleads, and where else it bites

`.ds-list--tiles` is a **modifier** on the shared `.ds-list` component, and the
unmodified component genuinely is a one-per-line list (the game detail's
related-sessions list, which must stay chronological). So the same class prefix,
the same `.ds-row` children and the same helpers describe two different
geometries, and which one you get depends on a modifier three words into a class
attribute. Anything reading `.ds-row` alone and concluding "row" is guessing.

The screens on the grid side today are the Tags manager and the provider tiles.
`.tag-row { flex-direction: column }` compounds it: each tile is itself a
column, so "row" in the markup, "column" in the layout and "grid" in the
container are three different words for one thing.

**Related:** `.claude/rules/browser-pane-is-chromium-only.md` (the other class of
layout claim that is true only where you measured it),
`.claude/rules/testing-views-under-jsdom.md` (why no view spec can catch this —
jsdom has no stylesheet, so a grid and a list are indistinguishable there).
