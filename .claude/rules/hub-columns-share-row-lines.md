---
paths:
  - "public/css/designs/**"
  - "public/js/*-hub.js"
  - "public/js/hub-reflow.js"
  - "public/js/views-round-start.js"
---
# Grid AREAS share row lines: tiles from different columns in one grid leave holes

Die Brücke's desktop hub (#1238) placed every slot into a `grid-template-areas`
cell. That looks like three columns and is not. A row only starts below the
tallest item in the row above it, so a short column waits for its neighbour.
„Zuletzt gespielt" sat ~630px under the Missionskontrolle at every width ≥1280
(#1496). Ocean had the same coupling one row lower: its `.hub-actions` lived in a
grid row under the centre column, sized by the taller aside (65–86px).
`align-self: start` does not help. It shrinks the item, and the row stays put.

## The fix: column wrappers, MOVED at the breakpoint

A design's phone order usually cuts across its desktop columns, so the wrappers
can't be static markup. `reflowAt(query, root, apply)` (`public/js/hub-reflow.js`)
moves the cells between the two arrangements on `matchMedia` `change`. DOM order
is then the visual order and the tab order at both widths. Without matchMedia
(jsdom), the phone order stands, so a spec stubs it to see the desktop shape.

**When one item has to sit outside the wrappers, give it the row ABOVE a `1fr`
row.** The Brücke members live in the hero, whose name spans the title row. So
they keep their own area, and the middle and right wrappers span both rows. A
track crossed by a spanning item is sized only by the flexible pass, so the
members' row stays their height. Measured in WebKit: rows `120px 878px`, gap 18.
With that row as `auto` instead of `1fr`, a 333px hole opens under the members.
`test/bruecke-hub-lobby.test.js` pins the `1fr`.

## A row-major card grid is not a hole, if the card fills its cell

Der Tisch's `.hub-cards` is row-major on purpose (T3.2). The slot stretches to
its row, so a short card left a hole only because the CARD didn't fill the slot.
`flex: 1` on the slot's child turns that into equal-height rows. The empty
trailing cells of an incomplete last row are end-of-flow whitespace, not a hole.

## Measuring: iframes at fixed widths, hit by BOXES

To sweep five designs × five widths in one page, use same-origin iframes at each
width. The per-account design applies to all of them. Collect painted boxes plus
headings/paragraphs, keep the outermost, and measure the gap to the next box below
that overlaps the column by more than half. Report "a box above a much wider band"
separately: that is end-of-column whitespace, which #1496 accepts. Pixel
hit-testing reads column gutters and short text lines as holes. In a hidden pane,
wait with `MessageChannel` (`.claude/rules/hidden-pane-throttles-timers.md`).
Visibility-hidden or opacity-0 iframes do not hit-test or never finish rendering,
so keep them on top.

**Related:** `.claude/rules/css-multicolumn-card-flows.md` (the other way to pack
uneven cards), `.claude/rules/tiles-vs-lists.md`,
`.claude/rules/browser-pane-is-chromium-only.md` (the WebKit probe used here).
