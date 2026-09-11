---
paths:
  - "public/styles.css"
---
# A rotated item escapes its box — and `overflow-y: auto` turns that into a horizontal scrollbar

The session-setup pot (#1017) tilts each cover by a per-index `--r` of up to ±8°.
The tiles live in `.setup-panel__body`, which is a grid with

```css
max-height: max(300px, calc(100dvh - 500px));
overflow-y: auto;
```

and nothing else about overflow. Measured at 1280×860 with `padding: 4px 2px`:
`scrollWidth` 685 against `clientWidth` 682, and two of the eight tiles with a
`getBoundingClientRect()` escaping the body's own rect.

## Why one declaration produced an axis nobody wrote

**A rotation grows the border box's bounding rect but not the layout box.** The
grid still allocates the tile's unrotated width, so the leaning corners stick out
by `(w·|sin θ| + h·|cos θ| − w) / 2` — a few px at 7°, which is exactly small
enough to look like nothing and exactly large enough to overflow.

**And `overflow-x` was never `visible` to begin with.** Per CSS Overflow, if one
of `overflow-x`/`overflow-y` is not `visible` and the other is, the `visible` one
**computes to `auto`**. So `overflow-y: auto` silently made `overflow-x: auto`
too, and the few escaping px became a real horizontal scrollbar inside a panel
that has no horizontal content at all.

The symptom is a scrollbar appearing under a tidy-looking grid, with no rule
anywhere mentioning the x axis — so the natural search (`grep overflow-x`) finds
nothing and the cause reads as a layout bug in the grid.

## The rule

**When you rotate or scale a grid/flex item inside a scroll box, pay for the
growth in the container's PADDING, not in the item's margins.** Padding is inside
the scrollable area, so it absorbs the overhang; a negative margin on the item
(the obvious way to get pile overlap) pushes it further out and makes this worse.
Here `padding: 4px 2px` → `4px 10px` took `scrollWidth` back to `clientWidth` and
the escaping count to zero, at a cost of 16px of tile width.

`overflow-x: clip` is the other fix and is usually the wrong one for decoration:
it removes the scrollbar by **cutting the leaning corners off**, which is the
thing you rotated the tile to show.

**Measure it, don't look at it.** The overhang is small enough to miss by eye at
any zoom, and the scrollbar is an overlay scrollbar on macOS — invisible until
something scrolls. The probe is two numbers and a filter:

```js
const b = document.querySelector('.setup-panel__body');
const br = b.getBoundingClientRect();
b.scrollWidth - b.clientWidth;                       // 3  ← the whole tell
[...b.children].filter((el) => {
  const r = el.getBoundingClientRect();
  return r.left < br.left - 0.5 || r.right > br.right + 0.5;
}).length;                                           // 2
```

**Related:** `.claude/rules/preview-pane-paint-artifacts.md` (why this had to be
a rect probe rather than a screenshot), `.claude/rules/setup-screens-two-column-layout.md`
§3 (the panel this was found in, and the bounded scroll box it must keep).
