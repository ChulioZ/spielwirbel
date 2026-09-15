---
paths:
  - "public/styles.css"
---
# A world slot must name EVERY presentation of its host — and a scroll container is not a host

Slot 10 (#1086) paints the world's vessel behind the session pot. The issue
specified one selector, and it was the natural one:

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
world test stayed green, and a browser check confirms the art on a phone. Only
opening the same screen at a desktop width shows the hole.

**So before writing a slot, grep the host for a second rendering.** In this app
the tell is a `display: none` default switched on inside a media query — the
rail, the dock and the pool all use it. A slot on such a host needs **one rule
per presentation**, and the spec's `SLOTS` list needs one entry per rule, or
deleting either leaves a whole class of viewport bare with the existence test
still green.

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

## 3. What replaced it, and the constraint that decided the shape

Two hosts, and they are not symmetrical, because one of them has room and the
other does not:

- **The panel reserves a band** (slot 9's discipline) and pays for it out of the
  pool's own `max-height`, so a long pool gives the band back. An unreserved
  layer was measured and rejected: composited on `--surface`, `--ink-soft` (the
  tile titles) holds AA only to alpha **.12** — .16 gives Chess 4.44:1 — and a
  .12 vessel is not worth painting. Reserved, it takes slot 7's bold .55.
- **The strip reserves nothing**, because it cannot: the setup screen fills a
  390×844 phone to the pixel. It is text-free by **geometry** instead — the count
  group is the row's only text and is a left-aligned flex item, the art is
  right-anchored and only as wide as its own ratio at the row's height.

**And the band's cap is a measurement, not taste.** Below the `max(300px, …)`
floor — any viewport under ~800px tall — the subtraction cannot bite, so the band
is simply added height. What that costs is not the document height (this page
already scrolls past its footer at 1280×800) but the „Loswirbeln" button: its
bottom sits at 686 with no band, 770 at 84px and **802 against an 800px fold at
116px**. Re-measure before raising it.

**Related:** `.claude/rules/setup-screens-two-column-layout.md` §3 (the two
presentations, and why they are CSS-picked),
`.claude/rules/transformed-grid-items-escape-their-scroll-box.md` (the other way
this same scroll box surprises you),
`.claude/rules/theme-derived-colors.md` § Worlds (the slot contract),
`.claude/rules/preview-pane-paint-artifacts.md` (why the probe above is a DOM
measurement rather than a screenshot).
