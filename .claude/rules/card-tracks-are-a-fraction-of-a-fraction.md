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

## The same mistake as a BREAKPOINT — a viewport media query inside a sheet

Everything above is about a fixed *track*. #1186 hit the identical error one
construct over, with a *breakpoint*, and it is worth naming separately because
the code looks textbook:

```css
.design-picker { grid-template-columns: 1fr; }
@media (min-width: 640px) { .design-picker { grid-template-columns: 1fr 1fr; } }
```

That list renders in two places — full width on the Konto screen, and inside a
`.sheet--dialog`, whose `max-width` is **460px**. At a 1200px viewport the query
fires in both, so the sheet got two columns in 414px of usable width: cards
202px wide, the description wrapping to five lines, a 230px-tall card. Measured,
not eyeballed; at a glance it reads as merely "a bit cramped".

**A media query asks about the viewport. A list that renders in more than one
container must ask about its CONTAINER** — `repeat(auto-fit, minmax(210px, 1fr))`
needs no breakpoint at all and was the whole fix. Reach for a viewport query only
when the box really is the page.

The general test: before writing `@media (min-width: N)`, ask whether the rule's
subject is ever rendered inside something narrower than the viewport — a sheet, a
popover, a column, a card. If yes, the query is measuring the wrong box, exactly
as the px track above measures the wrong box.

## And the neighbour it arrived with: at EQUAL specificity, source order decides

The same sheet produced a second one-line defect. `.sheet__head--stacked
{ display: block; }` did nothing, because `.sheet__head { display: flex }` is
**also** (0,1,0) and is declared ~3700 lines later in `styles.css`.

`.claude/rules/label-rows-lose-to-field-label.md` covers the case where
specificity decides and a modifier loses to a *higher* one. This is the other
half: a modifier at **equal** specificity loses to wherever the block happens to
sit in the file — so a variant written near its feature, rather than beside the
block it modifies, silently does nothing. The repo already has the fix as a
convention: `.sheet--dialog.sheet--list` widens the dialog with a two-class
selector, and `.sheet--dialog.design-chooser` / `.sheet__head.sheet__head--stacked`
now follow it. **Write a block's modifier as `.block.block--mod`** unless you are
putting it immediately after the block.

Neither defect failed a test, and both were found the same way — by reading
`getComputedStyle(...).display` and `getBoundingClientRect()` in the pane, not by
looking at the screenshot. The screenshot showed both; it just did not say which
of five plausible causes was the real one.

**Related:** `.claude/rules/responsive-content-width.md` (why the pane's width
keys off the viewport and nothing else, and the `--w-detail` opt-out this screen
takes), `.claude/rules/setup-screens-two-column-layout.md` §5 ("widening a column
cannot remove content" — the same lesson from the other side),
`.claude/rules/sticky-bottom-bar-needs-slack-below-it.md` (the other #1039
measurement that contradicted a written claim),
`.claude/rules/flex-none-item-makes-the-row-data-dependent.md` (what this card's
row used to do, and why the grid retires it),
`.claude/rules/label-rows-lose-to-field-label.md` (the specificity half of the
source-order section above — there a modifier loses to a HIGHER specificity,
here to an equal one declared later),
`.claude/rules/popover-vs-sheet-editors.md` (the sheet whose 460px cap is the
container the breakpoint section is about).
