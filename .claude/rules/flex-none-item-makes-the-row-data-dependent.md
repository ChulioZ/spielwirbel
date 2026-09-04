---
paths:
  - "public/styles.css"
  - "test/game-detail-hero.test.js"
---

# A `flex: none` ITEM decides where its row wraps — so the layout changes with the data

`flex: none` is `0 0 auto`: the item is sized at **max-content and cannot shrink**.
On a wrapping row that makes the *container's* wrap point a function of that one
item's **content** — its text, its counts, its locale. The row then fits for some
records and not others, and the screen's frame changes shape as you page through
them.

#901, the game detail hero. Three columns in a `flex-wrap: wrap` row, of which
only `.gd-stats` was content-sized:

```
900 (--w-read) - 2x28 padding                      = 844 inner
- 300 cover - 2x24 gaps - .gd-info's 240px floor   = 256 for .gd-stats
```

| `.gd-stats` content | measured width | row wraps? |
|---|---|---|
| „Ø 4,2 aus 7 Bewertungen in 3 Sessions" | 246.9px | no |
| „Ø 4,2 aus **12** Bewertungen in **10** Sessions" | 263.7px | **yes** |
| fr „Ø 4,2 sur 12 évaluations dans 10 sessions" | 264.8px | **yes** |

**Nine pixels of slack**, so a two-digit rating count — or merely switching the UI
to French — dropped the score ring onto a line of its own and took the band from
281px to **450px** tall.

## The fix is a fixed basis, and the token is retuned at the breakpoint

```css
.gd-head  { --gd-stats-w: 200px; }                 /* 56px of headroom, not 5 */
.gd-stats { flex: 0 0 var(--gd-stats-w); text-align: center; }
@media (max-width: 700px) { .gd-head { --gd-stats-w: auto; } }
```

Two things about that are easy to get wrong:

- **`text-align: center` is not decoration — it is what makes the fix legal.** A
  fixed width only works because the labels reflow inside it, and `align-items:
  center` centres the label's *box* while leaving its wrapped lines ragged-left.
  Truncating instead (`nowrap` + ellipsis) would also stop the wrap, while losing
  the text: the same screen broken more quietly.
- **`auto` at the breakpoint, not `100%`.** `flex: 0 0 auto` *is* `flex: none`, so
  the token restores the old behaviour exactly where the band is already a stack.
  Verified byte-identical at 390px — 238.9x145 column, 88x88 ring, both labels —
  against an injected `flex: none; text-align: left` control.

## The hypothesis that eats the day: it is NOT the title

The natural read is "long titles and many chips push the ring off the row". It
cannot. `.gd-info` is `flex: 1 1 240px` with `min-width: 240px`, so its
hypothetical main size is **240px regardless of content** — flex line-breaking
never sees the title at all. Measured: 1 tag, 6 tags and a single 300px chip all
produce the same 245px used width.

What the title *does* change is the band's **height** (281 -> 435px at the same
width, same wrap state), which is why the two feel like one bug. They are not:
height varies with the title, wrapping varies with the stats column.

## Measuring it: inject the old declaration as a control

A single "does it fit now?" reading proves nothing — the row fits for most data,
which is the whole problem. Toggle the old value against the *same* DOM at the
*same* width instead:

```js
const kill = document.createElement('style');
kill.textContent = '.gd-stats{flex:none !important;}';
document.head.appendChild(kill);      // OLD ... measure
kill.remove();                        // NEW ... measure
```

Then force the tipping strings onto the label rather than hunting for a record
that happens to carry them (`label.textContent = 'Ø 4,2 aus 12 …'`).

**`await document.fonts.ready` before every reading, and take more than one.** An
early NEW/BEFORE comparison differed by 5.9px on a column whose computed `flex`
was identical in both — pure font-load noise, and it reads exactly like a real
regression in the change you just made. With fonts settled, five consecutive
renders agreed to the tenth of a pixel.

`resize_window` first, or `--w-read`-relative widths mean nothing
(`.claude/rules/preview-pane-paint-artifacts.md`), and re-bust the stylesheet
`<link>` after **every** resize (`.claude/rules/pwa-service-worker.md`).

## The guard is arithmetic, not a literal

`test/game-detail-hero.test.js` derives the headroom from the sheet — `--w-read`,
the padding, `--gd-cover-w`, the gap and `.gd-info`'s basis — and asserts
`--gd-stats-w` fits inside it. A pinned `256` would go stale the moment any of
those five is retuned, which is precisely the change that would re-break this.

Two things that make such a guard quietly weaker rather than red:

- **`.gd-head` is declared twice** — once at desktop and once inside
  `@media (max-width: 700px)` — and `bodyOf()` returns whichever comes **first**
  in the sheet. Reading the phone rule by accident yields `padding: 20px` and so
  a *larger* headroom, i.e. a guard that still passes while permitting the bug.
  Pin which rule you got (`--gd-cover-w` in px, not `100%`), and assert every
  derived term is finite before doing arithmetic with it.
- **`.score-label`, `.score-why` and `.sort-flag` are shared with the Regal
  rows.** A sweep that matches the bare class also binds `.ds-row__meta
  .sort-flag`, holding an unrelated component to this column's constraint. Match
  the class only as the selector's **last** compound, under no ancestor but
  `.gd-head`/`.gd-stats` — and prove the narrowing by breaking the *excluded*
  component and watching the test stay **green**, which is the only evidence that
  a scope restriction restricts the right thing.

**Related:** `.claude/rules/flex-none-cancels-flex-wrap.md` (the same declaration
on the *container*, where it kills the `flex-wrap` beside it — this file is the
item-side half), `.claude/rules/responsive-content-width.md` (why the column has
one width), `.claude/rules/css-text-assertions-strip-comments.md` (how the guard
parses the sheet), `.claude/rules/break-the-code-on-purpose.md` (each of the three
assertions was seen red against its own break).
