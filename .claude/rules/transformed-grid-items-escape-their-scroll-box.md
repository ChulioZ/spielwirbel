---
paths:
  - "public/styles.css"
---
# A transformed item escapes its box — and `overflow-y: auto` turns that into a horizontal scrollbar

The session-setup pot (#1017) lifts a cover under the pointer with
`transform: scale(1.08)`. The covers live in `.setup-panel__body`, which is a grid
with

```css
max-height: max(300px, calc(100dvh - 500px));
overflow-y: auto;
```

and nothing else about overflow. Measured at 1280×860 with the side padding
removed: a 157px tile grows **6.3px per side**, the rightmost one escapes the body
by **5.1px**, and `scrollWidth − clientWidth` becomes **5**.

## Why one declaration produced an axis nobody wrote

**A transform grows the border box's bounding rect but not the layout box.** The
grid still allocates the item's untransformed width, so the grown edges stick out
by `(w · k − w) / 2` — a few px at 1.08, which is exactly small enough to look
like nothing and exactly large enough to overflow.

**And `overflow-x` was never `visible` to begin with.** Per CSS Overflow, if one
of `overflow-x`/`overflow-y` is not `visible` and the other is, the `visible` one
**computes to `auto`**. So `overflow-y: auto` silently made `overflow-x: auto`
too, and those few px became a real horizontal scrollbar in a panel with no
horizontal content at all.

The symptom is a scrollbar under a tidy-looking grid, with no rule anywhere
mentioning the x axis — so the natural search (`grep overflow-x`) finds nothing
and the cause reads as a layout bug in the grid.

## The rule

**When you transform a grid/flex item inside a scroll box, pay for the growth in
the container's PADDING, not in the item's margins.** Padding is inside the
scrollable area, so it absorbs the overhang; a negative margin on the item pushes
it further out and makes this worse. Here `padding: 4px 10px` leaves the hovered
tile's right edge 4px inside the body, and `scrollWidth === clientWidth`.

`overflow-x: clip` is the other fix and is usually the wrong one for decoration:
it removes the scrollbar by **cutting the grown edges off**, which is the thing
you transformed the item to show.

**Measure it, don't look at it.** The overhang is small enough to miss by eye at
any zoom, and the scrollbar is an overlay scrollbar on macOS — invisible until
something scrolls. Two numbers and a filter:

```js
const b = document.querySelector('.setup-panel__body');
const br = b.getBoundingClientRect();
b.scrollWidth - b.clientWidth;                       // 5  ← the whole tell
[...b.children].filter((el) => {
  const r = el.getBoundingClientRect();
  return r.left < br.left - 0.5 || r.right > br.right + 0.5;
}).length;
```

**Kill the transition before you read the rect.** `.pool-tile` carries
`transition: transform var(--dur-slow)`, so setting `style.transform` and reading
`getBoundingClientRect()` in the same turn measures the **start** of the
transition — an unchanged rect and `growthPerSide: 0`, which reads as "the
transform does nothing" and sent one probe down the wrong path. Set
`style.transition = 'none'` first.

## History: it was worse under a rotation

#1017 first tilted every cover by up to ±8° (`rotate(var(--r))` from an inline
per-index table). That is the same trap with a bigger number — two of eight tiles
escaped, `scrollWidth − clientWidth` was 3 at `padding: …2px` — and it is what led
here. The tilt was dropped on review for design reasons; the hover scale that
remains is enough to reproduce everything above, so the padding stayed.

**Related:** `.claude/rules/preview-pane-paint-artifacts.md` (why this had to be a
rect probe rather than a screenshot),
`.claude/rules/setup-screens-two-column-layout.md` §3 (the panel this was found
in, and the bounded scroll box it must keep).
