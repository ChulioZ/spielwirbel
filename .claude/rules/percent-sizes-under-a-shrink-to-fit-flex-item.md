---
paths:
  - "public/styles.css"
  - "public/js/**"
---
# A `%` size inside a shrink-to-fit flex item measures the TEXT next to it

A flex item in a column-direction container with `align-items: center` is
**shrink-to-fit**: its used width is its own max-content size. Anything sized in
`%` inside it therefore resolves against *that*, i.e. against whichever child
happens to be widest — in practice the title.

Measured on the #836 podium at 375px, three tied games in one 169px column:

| Entry | Its width | Cover at `width: min(52px, 70%)` |
|---|---|---|
| „Azul" | 51px | **36px** |
| „Carcassonne" | 81px | **52px** |
| „Codenames" | 73px | **51px** |

Three covers, three sizes, in one row — sized by the length of the word under
them. The intent (`min(52px, 70%)`) reads as "52, squeezed if the column is
narrow"; what it means is "70% of this title".

## The second half: `text-overflow` is dead there too

The same entries carried `white-space: nowrap; overflow: hidden; text-overflow:
ellipsis; max-width: 100%` — and **nothing ever truncated**, because `100%` of a
box that sizes itself from its content is exactly its content. Instead of
clipping, the title widened the entry, which is what made the covers ragged in
the first place. The two symptoms have one cause.

## The fix, and why both halves are needed

```css
.podium__entry { width: 100%; min-width: 0; }   /* a definite box to measure against */
.result-podium__img { width: 74px; max-width: 100%; }  /* absolute, not % */
```

`width: 100%` gives the entry the column's definite width, so `%` and
`text-overflow` both start working. `min-width: 0` is the usual flex companion —
without it the item still refuses to go below its content. And once the box is
definite, prefer an **absolute** size with `max-width: 100%` as the squeeze:
that says what it means, and it cannot be re-broken by a long title later.

## The tell, and why nothing catches it

**Some instances look right and others look wrong, in the same row.** That reads
as a data problem (a bad cover, a missing image) rather than a layout one, and
every uniform-content test case — one entry, or entries with same-length titles —
is green. jsdom applies no external stylesheet, so no view spec can see it
either; it took a real browser and a rendering with titles of different lengths.
Pin the fix with a CSS-text assertion (`test/podium-ranks.test.js`), since that
is the only layer that can hold it.

## The definite width also LICENSES a shrink-to-fit parent (#879)

Once the entries have absolute widths, the rule runs in the other direction too:
the column above them can safely size itself to its content, because there is no
longer a `%` to resolve circularly. `.podium--single .podium__col` does exactly
that — `width: fit-content`, so a tie stands on a pedestal as wide as the tied
entries need rather than on a full-width 1108px band.

That makes `.podium--single .podium__entry { width: 96px }` load-bearing **one
level up from where it is written**, and the failure it now guards is bigger than
the ragged covers above: relax it back to a relative width and the *step's own
width* becomes a measurement of the longest name. Measured after the change, the
symptom this file opens with stays absent — three tied covers at 52/52/52px, and
the one over-long title ellipsised — which is the check to re-run if either width
is ever retuned.

**Related:** `.claude/rules/popover-width-is-shrink-to-fit.md` (the same
shrink-to-fit sizing one container over, where a `max-width` clamps nothing),
`.claude/rules/flex-none-cancels-flex-wrap.md` (the other `min-width: 0` trap),
`.claude/rules/preview-pane-paint-artifacts.md` (`resize_window` first — a `%`
resolves against a 0×0 viewport otherwise).
