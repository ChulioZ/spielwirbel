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
.podium__entry { width: 100%; min-width: 0; }                 /* definite via the column */
.spotlight__winner { width: 168px; max-width: 100%; }         /* definite by literal */
.spotlight__img { width: 112px; max-width: 100%; }            /* absolute, not % */
```

A **definite** width on the entry is what makes `%` and `text-overflow` start
working at all; `min-width: 0` is the usual flex companion, without which the
item still refuses to go below its content. Then prefer an **absolute** size with
`max-width: 100%` as the squeeze: it says what it means, and a long title cannot
re-break it later.

**Either form is fine; what matters is that the width is DEFINITE.** The podium
entry was `100%` before #891, a `112px` literal while the stage was a stack of
tiers (a tier has no width of its own to inherit), and is `100%` again since #897
now that the column is back and carries a `max-width` of its own. The one thing
that must never come back is a `%` under a parent that is itself shrink-to-fit —
the two literals in the block above exist precisely because their parents are.

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

The instance is `.podium--single .podium__col { width: fit-content }`, so a tie
stands on a pedestal as wide as the tied entries need rather than on a full-width
1108px band. It was retired with the column stage in #891 and **came back with it
in #897**, unchanged and for the same reason — which is the tell that it is
structural rather than incidental: `fit-content` is only ever safe above an
absolute child, and `.podium--single .podium__col--multi .podium__entry`'s `96px`
is that child.

So the load-bearing pairing survives two rewrites. Relax an entry back to a
relative width and the *parent's* width becomes a measurement of the longest
name.

**The translated-word case is the sharper half, and #897 moved where it lives.**
A box sized to a *localised* string must never take a literal: `.podium__marker`
(#891, now gone) was a bet on the longest locale and lost it at the value that
looked generous — 46px, against a German „geteilt" measuring 51px and a Spanish
„compartido" 85px. The same word is now the pedestal's `.podium__shared`, which
is sized in the *other* axis, so the bet moved from width to **height**: at 56px
the rank-3 step held every locale on one line at 375px and let the Spanish and
Italian labels overhang its bottom edge at 320px, where the step is 89px wide and
they wrap. It is 60px for that reason.

The check to re-run if any of this is retuned: uniform avatars across a tie, one
over-long name ellipsised (**not** wrapped — a wrapped chip is a taller chip, and
height is the rank), and zero overhang on the tie marker in **all five locales at
320px as well as 375px**. That is one probe per width (swap the label text,
compare the two rects), not five browser sessions.

**Related:** `.claude/rules/popover-width-is-shrink-to-fit.md` (the same
shrink-to-fit sizing one container over, where a `max-width` clamps nothing),
`.claude/rules/flex-none-cancels-flex-wrap.md` (the other `min-width: 0` trap),
`.claude/rules/preview-pane-paint-artifacts.md` (`resize_window` first — a `%`
resolves against a 0×0 viewport otherwise).
