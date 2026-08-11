---
paths:
  - "public/styles.css"
  - "public/js/core.js"
  - "public/js/cover-picker.js"
---
# A `max-width` on an anchored popover widens NOTHING on its own (#706)

`openPopover` builds an absolutely-positioned card, so the popover is
**shrink-to-fit**: its used width is its content's max-content size, and
`max-width` only ever *clamps* that. Raise the cap on a card whose content is
already narrower and precisely nothing happens — no error, no failing test, and a
diff that reads like a shipped change.

Measured on the edition-cover editor at 1440x900, 40 candidate covers:

| `.popover.has-covers` cap | Card | Columns | Tiles visible |
|---|---|---|---|
| `380px` (as shipped) | **351px** | 3 | 6 |
| `520px` | **351px** | 3 | 6 |

351px both times. The card was sized by its widest child's max-content — the
button label „Titelbild von BoardGameGeek holen" — and **the grid contributed
one track**, because `repeat(auto-fill, …)`'s repeat count is **1** under
intrinsic sizing. So the one child with something to gain from more width was
also the child asking for the least.

## The fix: give the growable child a floor; the cap bounds the result

```css
.popover.has-covers { max-width: 520px; }
.popover.has-covers .cover-picker__grid:has(.cover-pick:nth-child(5)) {
  min-width: calc(92px * 4 + 8px * 3);
}
```

The floor is what makes the card *claim* room; `max-width` is what stops it.
Result: 520px, 5 columns, 10 tiles. Four properties are load-bearing:

- **Gate the floor on there being content to fill it.** `auto-fill` keeps empty
  tracks by design, so an ungated floor pays for the rich case with the common
  one — measured dead space right of the last tile, ungated vs gated:

  | covers | 1 | 2 | 4 | 5+ |
  |---|---|---|---|---|
  | ungated | 416px | 315px | 112px | 11px |
  | gated | 236px | 123px | 11px | 11px |

  Most games are not Catan, and a 520px card holding one 92px tile reads as
  broken. Gate at the **column count the widened card yields**, so the floor
  applies exactly when a full wide row can be filled. `:has()` is live and has to
  be — the grid is filled *asynchronously* after the covers hop, so the rule must
  start matching when the fifth tile lands, not at build time (verified by
  appending tiles one at a time: 0px through four, 392px on the fifth).

- **The floor must clear the cap**, or it overflows the card instead of widening
  it. Express it as columns × gaps so the two are checkable against each other —
  `test/editor-presentation.test.js` parses both and asserts the arithmetic.
- **Scope it to the popover.** `.cover-picker__grid` is shared with the sheet and
  the inline add-game form, both already full width; a bare floor would bound a
  width nothing was constraining there (the same call §4 of
  `.claude/rules/popover-vs-sheet-editors.md` makes for the height caps).
- **A collapsed child must contribute nothing.** `.cover-picker__body` carries no
  author `display` rule, so its `hidden` attribute genuinely hides it and the card
  stays 351px until the user opens the grid — then `setBody`'s
  `repositionPopover()` re-places it. Give that element a `display` rule and the
  card silently goes wide while empty
  (`.claude/rules/hidden-attribute-vs-display-rule.md`).

**Not every card needs the floor.** The expansion and tags editors reach their
caps unaided, because their content really is that wide (a full expansion title, a
row of chips). Check first — `getBoundingClientRect().width` against the computed
`max-width` — rather than adding a floor by symmetry.

## Why width is the axis worth spending, and height usually is not

The reflex for "this editor is cramped" is a taller cap. Width is strictly
better here, and it is the same measurement that shows why: a wider card wraps
its content onto **fewer lines**, so it shows more entries *and gets shorter*.
Measured, the expansion editor at 1440x900:

| Width | Row heights (px) | Rows in the 240px list | Card |
|---|---|---|---|
| 360 | 72,72,45,72,45,72,45,72 | 3 | 550px |
| 540 | 72,45,45,45,45,45,45,45 | **4** | **529px** |

A height cap buys the opposite trade — rows at the cost of a taller card, and
past half the viewport those rows land beyond a fold a page scroll cannot recover,
because a page scroll *closes* a popover
(`.claude/rules/anchored-popover-is-placed-once.md`, "The cap's ceiling is HALF
the viewport"). Width has no such ceiling: `place()` clamps horizontally
(`maxLeft`, 8px margin), so a card wider than the room beside its anchor slides
into view rather than off-screen.

## The verification trap that hid all of this

The first probe forced `width: <n>px` on the element to sweep candidate widths.
That made every width "work" and reported a clean 5-columns-at-520px result for a
cap that in reality changed nothing — an inline `width` replaces the very
shrink-to-fit behaviour under test.

**Set the card's real classes and let it size itself**, then read
`getBoundingClientRect().width` back and compare it to the computed `max-width`.
A card that measures *under* its own cap is the tell that the cap is inert. And
build the probe from the view's **real** markup: a synthetic card holding one
short button measured 193px and would have sent the fix in a third direction
again — the long button label is the whole reason the card is 351px.

**Related:** `.claude/rules/anchored-popover-is-placed-once.md` (the height half,
and the half-viewport ceiling this defers to),
`.claude/rules/popover-vs-sheet-editors.md` §4 (which card rules stay
popover-only, and why they are compounded with `.popover`),
`.claude/rules/preview-pane-paint-artifacts.md` ("`resize_window` DOES clear the
0x0 viewport" — the measurement above is only possible because of it).
