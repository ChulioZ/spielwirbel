---
paths:
  - "public/styles.css"
---
# An ornament must name EVERY presentation of its host — and a scroll container is not a host

Learned on the round worlds' slot 10 (#1086), which painted a vessel behind the
session pot. The worlds were retired at the flip (#1202); both traps bind any
decoration a user design paints on a host. The issue specified one selector,
and it was the natural one:

```css
[data-world] .pool-shelf::before { position: absolute; inset: auto 0 0; … }
```

Measured on the demo, it is wrong twice over, and neither failure is visible
from the stylesheet.

## 1. The host is rendered twice, and only one of them exists at a time

The pool has **two presentations** and CSS picks one by width
(`.claude/rules/setup-screens-two-column-layout.md` §3): the `.setup-panel` tile
grid from 860px up, the `.pool-hint` strip below it. Each is `display: none` at
the other's widths. `.pool-shelf` lives in the strip — so at 1470×870, the width
a group actually gathers around a laptop at, the rule matched an element that is
not rendered and **painted nothing at all**.

Nothing catches that. The selector is valid, the token resolves, every existing
test stayed green, and a browser check confirms the art on a phone. Only
opening the same screen at a desktop width shows the hole.

**So before writing a slot, grep the host for a second rendering.** In this app
the tell is a `display: none` default switched on inside a media query — the
rail, the dock and the pool all use it. An ornament on such a host needs **one
rule per presentation**, and its spec one assertion per rule, or deleting either
leaves a whole class of viewport bare with the existence test still green.

## 2. An absolutely-positioned layer inside a scroller SCROLLS, and is clipped

`.pool-shelf` is the horizontally snapping cover row, i.e. `overflow-x: auto`.
An abspos child of a scroll container is positioned against its **padding box**
and travels with the content. Measured at 390px with a probe pinned to
`inset: auto 0 0`:

```js
shelf.scrollLeft = 200;
// probe x: 46 → -164, box width 222 of a 558px scrollWidth
```

So the vessel would slide off with the covers and only ever cover the visible
third of the pot. `overflow-y` also computes to `auto` when `overflow-x` is set,
so anything taller than the padding box is clipped as well.

The fix is to host the ornament on the scroller's **parent** — the row, the
panel, the card — never on the box that scrolls. Keep that in mind for any
`.pool-shelf`-shaped host: the thing that looks like the art's natural container
is exactly the thing that moves.

What shipped for the vessel was one host per presentation — the panel reserving
a band out of the pool's own `max-height`, the strip text-free by geometry — with
the band's size measured against the „Loswirbeln" button's fold, not chosen.

**Related:** `.claude/rules/setup-screens-two-column-layout.md` §3 (the two
presentations, and why they are CSS-picked),
`.claude/rules/transformed-grid-items-escape-their-scroll-box.md` (the other way
this same scroll box surprises you),
`.claude/rules/theme-derived-colors.md` (the constraints that outlived the worlds),
`.claude/rules/preview-pane-paint-artifacts.md` (why the probe above is a DOM
measurement rather than a screenshot).
