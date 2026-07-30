# A screen that opts out of `--w-read` must take its PAGE HEAD with it (#577)

The session-setup and new-round screens are the app's two setup forms, and both
were a single ~900px column however wide the screen got. Measured at 1600×1000
before #577: content 900px wide at **x=350** — ~350px of dead gutter on each
side — while the page still scrolled to **1346px**, so "Wirbeln", the one thing
the screen exists to press, sat below the fold. The column was doing neither job
well: too narrow to use the pane, too tall to fit in it.

Both are now `.setup-grid`: two columns from 860px, the breakpoint the dock, the
lobby grid and `.vote--split` already use. Session setup splits along the two
questions it asks — who is at the table (left) / what gets drawn, and the button
that draws it (right). After: **1009px** of scroll at the same viewport, with the
CTA at y=752.

## 1. The page head is a SIBLING of the grid, so no existing exemption reaches it

This is `.claude/rules/responsive-content-width.md` §"A block that INTRODUCES a
grid", one screen over, and it is worth restating because the first
implementation walked into it: the two exemption selectors in the ≥1280 block
match a child that **is** a grid or **contains** one. A screen's `<h1>` wrapper
is neither — it sits *next to* the grid.

Exempt only the grid and the heading stays capped at `--w-read` and centred while
the form beside it spans `--w-setup`, leaving the screen's own title indented
from the content it heads. So both take the **same custom property**:

```css
.app:has(.setup-grid) > *:not(.rail):not(.dock):is(.page-head, .setup-grid) {
  max-width: var(--w-setup);
}
```

Three parts are load-bearing and each fails silently:

- **`.page-head` in the `:is()`.** Without it: measured 170px of indent.
- **`:has(.setup-grid)`.** Unconditionally, *every* screen's page head loses its
  reading measure — the same "it doesn't fix the misalignment, it moves it"
  trap the lobby band records.
- **(0,5,0) against the cap's (0,3,0).** Specificity, never source order.

`--w-setup` (1240px) must also be **wider than `--w-read`**, or the exemption is
a no-op that reads as working: `test/content-width.test.js` pins that as
arithmetic, because every selector assertion stays green at `--w-setup: 880px`.

## 2. The width may be chosen by content HERE — and only because there is no rail

`.claude/rules/responsive-content-width.md` forbids picking a width from what a
screen renders, because `.app` is centred and the hub tab strip lives inside it,
so a second width slides the navigation sideways. `:has(.setup-grid)` is exactly
the shape that got #332 reverted.

It is safe here for one reason, and the reason is the whole licence: **neither
setup screen renders any navigation.** Both are rail-less and both clear `.app`
outright, so there is no persistent element inside the column for a width change
to move. `test/content-width.test.js`'s own guard is unaffected — it constrains
rules whose final compound is `.app`/`.site-footer`, and this one caps *children*.

Do not extend the exemption to a screen that renders a rail or a tab strip
without re-deriving that argument.

## 3. Two presentations of the pool, picked by CSS — never a JS width branch

The eligible-game preview is rendered **twice**: the tile panel (`.setup-panel`,
860px up) and the compact overlapping strip (`.pool-hint`, below it). Same shape
as the rail/dock (`round-rail.js`), and for the same reason — a resize needs no
re-render, and only one is ever in the accessibility tree.

- The panel **defaults to `display: none`** and is switched on inside the query,
  never the reverse. A panel defaulting to visible renders on every phone
  *beside the strip it replaces* the moment someone adds a narrower breakpoint
  above it (the `.rail` lesson).
- The strip's hide is `.setup-grid .pool-hint` — **(0,2,0)**, because
  `.pool-hint { display: flex }` is (0,1,0) and is declared ~100 lines further
  down. A one-class hide would win on position only.
- The wide panel lists **every** matching game inside a bounded scroll box, so it
  needs no "+n" chip and the two representations share no counting logic beyond
  one headline string. The bound is not cosmetic: unbounded, a 60-game shelf
  pushes the CTA straight back below the fold, i.e. re-creates the defect.
- **The empty-state line needs `grid-column: 1 / -1`.** The panel body is a tile
  grid, so without it the message becomes one 110px grid item and wraps after
  two words — measured, and it looks like a broken panel rather than a missing
  declaration.

## 4. Column membership is DOM, not CSS `order` — which constrains the phone order

The columns are real DOM groups (`.setup-grid__main` / `__aside`), so below
860px the grid is a plain block and **DOM order is the phone order**; visual
order and tab order can never disagree. Verified: tab sequence is
`LLLLLLLLLLRRRRRRRRR`, all of the left column then all of the right.

The consequence to plan for: **whatever is in the second column comes last on a
phone.** Session setup gets this for free — its split reproduces the existing
order byte for byte. New round does not: grouping name + import on the left
moved the optional import card *above* the seat table on phones. Accepted
deliberately (the CTA, which is what matters, stays last). Don't "fix" a phone
order with CSS `order` — it desyncs tab order from what is on screen.

`aria-labelledby` is unaffected by the split (it is id-based), but check it: the
seats group and the tag-filter group now label across a column boundary.

## Verifying a change here

Drive `dev-temp-data` with the service worker cleared
(`.claude/rules/pwa-service-worker.md`) and measure rather than eyeball:
`scrollHeight` vs `innerHeight`, the `.page-head` and `.setup-grid` rects (their
`x` and `width` must be **identical**), and the 1279→1280 step, which must grow
(960 → 1240) and never shrink. Walk 390 / 860 / 1279 / 1280 / 1600, and probe for
any element whose rect escapes its own column — a grid track can clip its
contents with every test green (`.claude/rules/tiles-vs-lists.md`).

Every assertion in `test/content-width.test.js` was verified by breaking the
production CSS on purpose (dropping `.page-head` from the `:is()`, dropping the
`:has()`, `--w-setup: 880px`, a visible-by-default panel, deleting the strip
hide, bare `1fr` tracks) — each reddens exactly one test. **Confirm the edit
actually landed** (`grep -c` for what you removed) before reading a green suite
as evidence, and back the files up to the scratchpad first: `git checkout`
restores from the index and discards the whole uncommitted change
(`.claude/rules/css-text-assertions-strip-comments.md`).

## Screens deliberately NOT changed

Chronik, session results and game detail are also ~900px and also scroll. All
three are settled decisions in `.claude/rules/tiles-vs-lists.md` — the first two
because **order carries meaning** (a ranking read in columns puts rank 3 beside
rank 2), the third because its defect was a sizing one, already fixed. "It is a
tall single column on a wide screen" is not on its own a reason to split a
screen; the two forms qualified because neither reads as a sequence.

**Related:** `.claude/rules/responsive-content-width.md` (the cap this escapes
and the #332 revert it must not repeat), `.claude/rules/tiles-vs-lists.md`
(which screens may be re-shaped at all),
`.claude/rules/responsive-hub-tabs.md` (where 860 comes from),
`.claude/rules/label-rows-lose-to-field-label.md` (the `.field` specificity trap
both forms sit inside).
