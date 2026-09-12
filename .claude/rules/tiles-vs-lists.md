---
paths:
  - "public/styles.css"
  - "public/js/**"
---
# Tiles vs lists: decide by the CONTENT, not by how much room is left over

Wide screens make every full-width row look wasteful, so the reflex once the
desktop rail landed was "tile everything". Two screens were converted and three
deliberately were not, and the line between them is not about available width:

| Tile it | Keep it a list |
|---|---|
| entries are **unordered** | order carries meaning |
| entries are **short** (a chip, a name, a toggle) | entries are rich (cover, stats, several actions) |
| you scan for one entry | you read the sequence |
| tags, providers, the round lobby, the Regal | session results, the Chronik (related sessions left this column in #1040) |

**The ordering half is the one that actually bites.** A grid is read
left-to-right and then wrapped, so putting a *ranking* in one makes rank 3 sit
to the right of rank 2 and rank 4 below rank 1. The session results screen
exists to communicate an order — the winner, then rows sorted by rating — so tiling
its rows would destroy the one thing it is for, while looking tidier. Same for
the Chronik: a month-grouped timeline read in columns is not a timeline.

**The richness half is about the meta half of a row.** `.ds-row` puts its
`__main` and `__meta` at opposite ends, which is exactly right at 900px for a
*short* entry — and exactly wrong at 900px for a short one on a wide screen,
where it strands a tag's count and buttons ~700px from the tag. Tiling fixes
that by shrinking the line, not by changing the row. A rich row already fills
its width, so it has nothing to gain.

## How to tile, in this codebase

`.ds-list--tiles` (a modifier on `.ds-list`, never a change to it — every other
list in the app shares that component):

```css
.ds-list--tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.ds-list--tiles .ds-row { flex-wrap: wrap; row-gap: 10px; }
.ds-list--tiles .ds-row__main { min-width: 0; }
```

Three things about that are load-bearing:

- **`auto-fill`, so it needs no breakpoint.** 1 column on a phone, 3 at 1279, 5
  in the desktop pane. Don't add a media query; don't switch to `auto-fit`
  (which collapses empty tracks and lets a lone tile balloon).
- **The row must be allowed to WRAP.** `.ds-row` is a nowrap flex line sized for
  a 900px width, so in a 280px tile the tag rows pushed their edit/delete
  buttons out through the right edge, where they were **clipped and
  unclickable** — visible only as a slightly odd screenshot, with every test
  green. Wrapping also lets each list find its own shape without a per-list
  rule: providers keep logo/name/checkbox on one line, a tag drops its count
  and actions to a second.
- **A tiled list must join the width exemption** in the `>= 1280px` block
  (`.app > *:is(…)` / `:has(…)`), or the tiles stay boxed in the `--w-read`
  reading measure and you get three columns where five fit.

## Screens deliberately left alone (2026-07-22)

Re-deciding these costs a browser session each; the reasoning is here so it
doesn't have to be redone.

- **Session results** — a ranking (see above). It opens on a **winner
  spotlight** since #897, not a stage: the stage restated the top three places in
  a second visual language twenty pixels above rows that already state them
  properly, and redundancy reads as clutter however well it is drawn. Moving
  either half beside the other saves ~250px of scroll at the cost of squeezing
  it and breaking the reveal-then-detail flow. **The spotlight is not a
  counter-example to the ordering rule** — it is the one component on the screen
  that may wrap, precisely because everything in it holds the *same* place, so
  reading it left-to-right says nothing false. The moment a component carries
  two different ranks, the rule binds again.
- **Member** — already uses the pane: the five stat cards span it (they are
  `.pokale-cards`, already exempt) while identity and the colour picker keep
  the reading measure. At 900px those cards are ~170px and labels like
  "Ø vergebene Wertung" wrap badly; at ~280px they read cleanly. The resulting
  raggedness (a full-width stats band under narrower sections above) is
  deliberate and reads as a band, not as a mistake.
- **Game detail** — **restructured in #1039, so this entry is history.** For two
  releases the reading here was that the defect was a *sizing* one, not a shape
  one: the score ring sat 453px from the title because `.gd-info` was `flex: 1`,
  fixed by `flex: 0 1 auto` + `width: fit-content` and then by #868's full-width
  framed card. That was all true and all about the hero. What it missed is the
  screen: nothing on it was a grid, so from 1280px up every block sat at
  `--w-read` while the pane ran to ~1450 — 45% gutter at 1920, with „Verwandte
  Sessions" below the fold. The last sentence here even named the obstacle ("a
  full two-column restructure would need the view rebuilt") and read as a reason
  not to.

  It is now a two-page spread (`.pass`): the game left, the group's history
  right, one action in a bar at the right page's foot. It qualifies under the
  same test the setup forms did — **two questions, not one sequence** — and it
  does not contradict the ordering rule above, because neither page is a ranking.
  The rule to carry forward is that "the fix was a sizing one" is an answer about
  a component, and a screen can still be the wrong shape around a correctly
  sized component.
- **The two archives and the Wunschliste** (`.archive-list` / `.archive-row` —
  retired, completed and, since #560, wished-for, all through one renderer) —
  they look like the next tiling candidate after tags and
  providers, and they are not: a row carries a cover thumb, a title, a
  timestamp and two buttons, so it is *rich* by the table above, and the list
  is ordered by when each game was archived (for a wish, by when it was wished
  for). Both halves of the rule point the same way. They keep the reading
  measure.
- **Chronik** — a month-grouped timeline, i.e. the ordering case in its purest
  form. It stays a list at the reading measure, and that is the settled answer
  rather than a deferral (operator decision, 2026-07-23).

The last two were named in **#332**'s scope ("the grid/row density of the
list-type views … the Chronik timeline rows … and the archive rows"), and its
open questions asked what the desktop Chronik should show with the extra width
— "more metadata per row, or a denser two-column timeline". That question is
answered here: neither. Nothing about #332 remains open; don't re-open it on
the strength of that line.

## The one entry that left the right-hand column (#1040)

A game's related sessions are **stamps** now, and neither half of the table was
waived — check that before citing this as precedent. The *ordering* argument
still binds and a row-major strip keeps it (newest first, wrapping like text).
What moved is *richness*, and only because the **container** changed shape:
#1039 made the history a ~150px column instead of a full-width `.ds-row`, and a
date + outcome + winner is a stamp's worth of content at that width. Six
scrolled a 13″ laptop by 88px as rows and fit as stamps. Below 860px it becomes
one snapping row, not a 1-wide stack — a single column of stamps is the tall
thing again. Tilt was proposed and rejected (operator, 2026-09-12): the
character is in the ink, and `test/session-stamps.test.js` keeps rotation out.

## A tiled container may be a column FLOW rather than a grid (#942)

That is a second, independent decision made *after* this one, and it does not
disturb anything above: it asks how the tiles are placed, never whether the
entries should be tiles at all. A container whose items are **uniform** stays a
grid — which is every container in the table above. Only where heights are
content-driven and genuinely different (`.hub-cards`, `.home-dash`) does packing
beat a row grid; `.ds-list--tiles` measured 98px on every row and stayed put.

Note the ordering half of this rule binds **harder** on a column flow: multicol
reads column-major, so an ordered container is worse there than in a grid, which
at least reads left-to-right. See
`.claude/rules/css-multicolumn-card-flows.md`.

**Related:** `.claude/rules/css-multicolumn-card-flows.md` (grid vs column flow,
once a container has been tiled),
`.claude/rules/responsive-content-width.md` (the pane the tiles
live in, and why its width may key off the viewport only),
`.claude/rules/css-text-assertions-strip-comments.md` (how the guarding test
parses the stylesheet).
