---
paths:
  - "public/styles.css"
---

# Capping the HEIGHT of an `aspect-ratio` box shrinks its WIDTH instead (#666)

Making the vote card fit a phone means letting the cover give way vertically.
`.vote__img` is `aspect-ratio: 4 / 3` and full-bleed inside the card, so the
obvious move is to leave the ratio alone and add a cap:

```css
.vote .vote__img { max-height: 110px; }   /* WRONG */
```

The height is then correct and the box is **147px wide in a 320px slot** — a
thumbnail adrift in the middle of the card, with a huge empty gap either side.

## Why

With `aspect-ratio` in force, the two axes are one constraint. The used height
comes from the width, gets clamped by `max-height`, and the clamped value is then
**transferred back** through the ratio to produce the width. `width: auto` on a
block normally means "fill the container" and would win — but a definite
transferred size outranks the stretch, so the ratio is preserved and the fill is
what gives way. Exactly the opposite of the intent, and the direction nobody
predicts, because the declaration you wrote names *height*.

## The fix

Release the ratio in the same rule that caps the height, and give an explicit
height instead of a max:

```css
.vote .vote__img {
  aspect-ratio: auto;
  height: max(110px, min(240px, calc(100svh - 480px)));
}
```

`aspect-ratio: auto` is the load-bearing line — without it the `height` transfers
back exactly like the `max-height` did. The `min()` then has to do the job the
ratio used to: it caps the box at roughly the height the ratio gave it, so a tall
phone does not stretch the cover past its old proportions.

**A free height distorts nothing here**, which is what makes this safe: the cover
is painted by the `::before`/`::after` layers (blurred `cover` under sharp
`contain`, `.claude/rules/deterministic-cover-placeholders.md`), so any box
letterboxes the artwork rather than squashing it. A rule that cropped or stretched
an `<img>` would need a different answer.

Two floors that are not style:

- **`max(<floor>, …)` around anything with a viewport unit.** `min(240px,
  calc(100svh - 480px))` computes negative — so, clamped, zero — in a degenerate
  viewport, and the box vanishes with nothing to explain it. Same trap as
  `.cover-picker__grid` (`.claude/rules/anchored-popover-is-placed-once.md`).
- **The floor must clear whatever the box centres.** `.vote__img` sizes its
  placeholder glyph with its own `font-size: 64px`, i.e. a 96px line box, so a
  floor under that clips the empty state — the one state the floor exists for.
  `test/vote-card-viewport-fit.test.js` derives it rather than pinning 110.

## The symptom to recognise

The height is exactly what you asked for and the element is *narrow*. Because the
height is right, the natural reading is "the width rule is missing" and the
natural fix is to add `width: 100%` — which works, and leaves a box whose two
axes are now fighting through a ratio nobody needs. Check for a live
`aspect-ratio` before adding a width.

**Related:** `.claude/rules/flex-none-cancels-flex-wrap.md` (the sibling
`styles.css` trap — a phone override losing on source order, which the same PR
found a third instance of), `.claude/rules/deterministic-cover-placeholders.md`
(the cover layers that make a free height safe).
