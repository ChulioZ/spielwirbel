---
paths:
  - "public/styles.css"
  - "test/content-width.test.js"
  - "test/game-detail-hero.test.js"
---
# A fixed px track inside a screen that is ITSELF a fraction of the pane starves its sibling

#1039 gave the game detail screen two pages (`.pass`, 3fr/2fr from 860px) and
specified the card inside the left page as `var(--gd-cover-w) minmax(0, 1fr)` —
a 300px cover, 340px from 1280px up. Both numbers are reasonable read against a
*viewport*. Measured against the box the card is actually in, at 1280×800:

```
left page              550px      (pane 948 − 32 gap, × 3/5)
− padding 2×28         494
− gap                  470
− cover 340            130px      ← the title, four chips and three fact pills
```

The card rendered **626px tall** with the action bar pushed out of the fold —
i.e. the flat track re-created the defect the issue existed to fix, at the one
width where the rail has just taken 292px away. Nothing errors, nothing wraps
visibly wrong at a glance, and the assertion that would catch it ("the cover
is at least 300px") **passes**: the cover is fine, it is the sibling that is
gone.

## Why the viewport is the wrong instrument here

The quantity that varies is the **left page's** width, and it is not a monotonic
function of the viewport: the rail appears at 1280 and costs 292px, so the left
page *shrinks* across that breakpoint (581 → 550). A media query on the viewport
therefore cannot express "the page is wide enough for a side-by-side card" — any
threshold is wrong on one side of 1280.

## The fix, and why it needs no new feature

```css
grid-template-columns: minmax(0, min(var(--gd-cover-w), 46%)) minmax(0, 1fr);
```

A percentage in `grid-template-columns` resolves against the **grid's own content
box**, so the cover tracks the card it is in. `--gd-cover-w` stops being a width
and becomes a **ceiling**, which is the only thing it was ever really saying.
Measured (cover / text):

| container | before | after |
|---|---|---|
| 1280 viewport, left page 550 | 340 / **130** | 227 / 243 |
| 1470 viewport, left page 664 | 340 / 244 | 279 / 304 |
| 1920 viewport, left page 821 | 340 / 401 | 340 / 401 (cap binds) |

Three things about it are worth keeping:

- **`minmax(0, …)` on BOTH tracks, and `min-width: 0` on the text item.** They
  are a pair: a grid item's automatic minimum is its min-content size, so either
  one alone still lets a long unbroken title push the card past its column.
- **A container query was NOT needed.** `min(px, %)` answers the same question
  with no new CSS feature and no `container-type`, which would have been the
  first in this stylesheet. Reach for `@container` when the *presentation* must
  change (stack vs. side-by-side), not when a size must scale.
- **The cap still has to respect the cover budget.** `COVER_HERO` is 480
  (`cover-size.js`), so a 340px ceiling still oversamples
  (`.claude/rules/provider-cover-sizing.md`).

## The rule

**When a card sits inside a column that is itself a fraction of the pane, size
its tracks as a fraction of the CARD.** A number picked against the viewport is
two indirections away from the box it lands in, and the error shows up in the
*other* track — which is why "is the cover big enough?" is the wrong assertion
and `test/game-detail-hero.test.js` now pins the track expression and the text
item's `min-width: 0` instead.

And **measure at the width where the shell changes**, not only at the extremes:
every claim in #1039's own issue body held at 1470 and 1920 and was false at
1280, because that is where the rail lands.

**Related:** `.claude/rules/responsive-content-width.md` (why the pane's width
keys off the viewport and nothing else, and the `--w-detail` opt-out this screen
takes), `.claude/rules/setup-screens-two-column-layout.md` §5 ("widening a column
cannot remove content" — the same lesson from the other side),
`.claude/rules/sticky-bottom-bar-needs-slack-below-it.md` (the other #1039
measurement that contradicted a written claim),
`.claude/rules/flex-none-item-makes-the-row-data-dependent.md` (what this card's
row used to do, and why the grid retires it).
