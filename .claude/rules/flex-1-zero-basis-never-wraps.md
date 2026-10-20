---
paths:
  - "public/styles.css"
  - "public/css/designs/*.css"
  - "public/js/vote-card-composed.js"
  - "test/vote-felt-marks.test.js"
---
# `flex: 1` in a wrapping row means the row NEVER wraps — the flexible item is squeezed instead

```css
.vote-felt { display: flex; flex-wrap: wrap; }
.vote-felt__who { flex: 1; min-width: 0; }      /* WRONG for a wrapping row */
```

That reads as "the name takes the space that is left, and the marks wrap when
there is not enough". It is not: `flex: 1` is `1 1 0%`, so the name's
**hypothetical size is 0**. Line breaking adds up the hypothetical sizes, and a 0
always fits, so the row never wraps. The marks keep their full width and the
name is shrunk to whatever is left — at 320px with ten dots, a word per line.

Measured on #1637 in Der Tisch, Ocean and Die Brücke (all three had this rule),
and Forest had the grid version of the same thing: `auto minmax(0, 1fr) auto`,
where the `auto` marks track grows with the game count and the `1fr` name
column goes to ~0 (`.claude/rules/percent-sizes-under-a-shrink-to-fit-flex-item.md`
§grid). The screen still looks deliberate at three games, and nothing warns.

## The fix

Give the flexible item a **real basis**: `flex: 1 1 11rem` (13rem in Ocean,
whose count is wider). Now the line wraps once the name's basis and its siblings
don't fit, and a `margin-left: auto` (or `margin-inline: auto` in a centred
header) puts the wrapped marks where they belong. Auto margins are resolved
*after* flex-grow, so on a single line they take nothing from the name.

The basis is chosen so the counter („Spiel 2 von 10 · Person 1 von 4") fits on
one line. If you retune the header's type or the count string, re-measure.

## Measure the INK, at every width, with the longest strings

A box measurement reports the name's box as the column, so it can't see the
squeeze. Read the text's lines with a `Range`
(`.claude/rules/measure-text-ink-not-its-box.md`) at 320 / 375 / 390 / 430,
with a long name and with 3 / 10 / 15 / 20 games, in de and the longest locales
(it „Indietro"/„Vota", pt „está avaliando", fr „Personne 1 sur 4"). Run the
unchanged stylesheet first as the control: it must show the one-word-per-line
result, or the probe is measuring something else.

## The mark count is coupled to this

`VOTE_MARKS_MAX` (`public/js/vote-card-composed.js`) is the most marks every
composed design fits beside its back key at 320px; past it the header draws one
band. A design that makes its marks or its back key wider must re-measure ten
marks at 320px. Forest (18px leaves) and Das Programmheft (14px squares) only fit
by dropping the back key's word below 360px.

**Related:** `.claude/rules/flex-none-cancels-flex-wrap.md` (the other way a
flex declaration silently cancels `flex-wrap`),
`.claude/rules/percent-sizes-under-a-shrink-to-fit-flex-item.md` (the grid half),
`.claude/skills/browser-verification/browser-pane-is-chromium-only.md` (measured in Chromium only).
