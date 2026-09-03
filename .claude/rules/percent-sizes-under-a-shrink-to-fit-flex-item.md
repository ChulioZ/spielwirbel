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
.podium__entry { width: 112px; max-width: 100%; min-width: 0; }  /* a definite box */
.result-podium__img { width: 74px; max-width: 100%; }            /* absolute, not % */
```

A **definite** width on the entry is what makes `%` and `text-overflow` start
working at all; `min-width: 0` is the usual flex companion, without which the
item still refuses to go below its content. Then prefer an **absolute** size with
`max-width: 100%` as the squeeze: it says what it means, and a long title cannot
re-break it later.

The entry's own width was `100%` until #891, when the stage became a stack of
tiers whose entries flow in a **row** — where `100%` would put one entry per line
and defeat the whole arrangement. Note the fix did not change in kind: `100%` was
only ever standing in for "definite", inherited from the column above it, and a
literal states the same thing without depending on a parent that no longer
exists.

## The tell, and why nothing catches it

**Some instances look right and others look wrong, in the same row.** That reads
as a data problem (a bad cover, a missing image) rather than a layout one, and
every uniform-content test case — one entry, or entries with same-length titles —
is green. jsdom applies no external stylesheet, so no view spec can see it
either; it took a real browser and a rendering with titles of different lengths.
Pin the fix with a CSS-text assertion (`test/podium-ranks.test.js`), since that
is the only layer that can hold it.

## The definite width also LICENSES a shrink-to-fit parent (#879, #891)

Once the entries have absolute widths, the rule runs in the other direction too:
the box above them can safely size itself to its content, because there is no
longer a `%` to resolve circularly.

The original instance was `.podium--single .podium__col { width: fit-content }`,
so a tie stood on a pedestal as wide as the tied entries needed rather than on a
full-width 1108px band. **That selector is gone with the column stage (#891)**,
but the shape is not: `.podium__marker` now sizes to its own content between a
`min-width` and a `max-width`, which is the same licence for the same reason —
and it is a *stronger* case, because the content it sizes to is a **translated**
word. A literal there is a bet on the longest locale, and the bet was already
lost at the value that looked generous: 46px, against a German „geteilt" that
measured 51px and a Spanish „compartido" at 85px.

So the load-bearing pairing survives the rewrite. Relax an entry back to a
relative width and the *parent's* width becomes a measurement of the longest
title. The check to re-run if either is retuned: uniform covers across a tie, the
one over-long title ellipsised, and — since #891 — zero overhang on the marker in
**all five locales**, which is one probe (swap the label text, compare the two
rects) and not five browser sessions.

**Related:** `.claude/rules/popover-width-is-shrink-to-fit.md` (the same
shrink-to-fit sizing one container over, where a `max-width` clamps nothing),
`.claude/rules/flex-none-cancels-flex-wrap.md` (the other `min-width: 0` trap),
`.claude/rules/preview-pane-paint-artifacts.md` (`resize_window` first — a `%`
resolves against a 0×0 viewport otherwise).
