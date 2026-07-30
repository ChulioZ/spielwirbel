# The column's width may key off the VIEWPORT, never off what a screen renders

`.app` is capped at `--w-content` (1000px) below 1280px and at `--w-shell`
(1800px) above it, where the rail takes over. `test/content-width.test.js` fails
if any rule picks that width from **content** — `:has()`, a state class, an
attribute selector — rather than from a media query.

That distinction is the whole lesson. #332 shipped a content-selected width and
it had to be reverted within hours; the mechanism looked (and was) correct, and
the defect it caused is invisible from any single screenshot.

## What went wrong

The rule was `.app:has(.cards, .pokale-cards, .lobby-list) { max-width: 1440px }`
— content-conditioned, so no view could forget it, failing to the narrow width.
All true, and all irrelevant, because of one thing it didn't account for:

**`.app` is centred (`margin: 0 auto`), so changing its width moves BOTH edges
— and the hub tab strip lives inside `.app`.** Measured at 1920:

| Tab | `.app` | strip left edge |
|---|---|---|
| Start | 1000 | 480 |
| Regal | 1440 | **260** |
| Chronik | 1000 | 480 |
| Pokale | 1440 | **260** |

The widths alternate along the tab row, so the navigation control slid 220px
back and forth as the user moved across it — it shifted out from under the
cursor that was clicking it. And it was not confined to tabs: 8 of the 12 SPA
screens changed width relative to their neighbours.

## The constraint (this is the part to remember)

Two requirements, each individually obvious:

1. **Within** a screen, the tab strip and the content need a shared edge — a
   strip floating 220px away from the heading it labels reads as unattached.
2. **Across** screens, the strip must not move.

Together they force **every screen that shares the strip to share one column
width**. So "wider grids" and "stable navigation" are mutually exclusive for as
long as navigation sits inside the content column. No `:has()` list reconciles
them, and neither does any of the alternatives that look promising:

- **A per-view width flag** — worse, not better. There is no "begin view" hook
  in this frontend (every `show*` clears `#app` itself), so a flag has to be set
  in ~20 places and cleared in the rest, and the first view that forgets it
  renders at the *previous* screen's width.
- **Stable container, content capped and left-aligned inside it** — removes the
  jump (measured 0px), but text screens then hug the left of a centred column
  with ~660px dead to the right, and the footer, which centres itself, no longer
  lines up with the content it follows.
- **Stable container, content capped and centred inside it** — text screens keep
  today's look, but on grid screens the strip floats mid-page while the heading
  and grid start at the left. Prototyped both; neither is shippable as-is.

## How the rail resolved it

Navigation moved **out** of the content column: from 1280px up, `.rail`
(`public/js/round-rail.js`) carries the round's identity, its four sections,
both archives and the settings screens, and the dock is `display: none`. With
nothing persistent left inside the column, its width is free to depend on the
viewport — and because it depends on *only* the viewport, every screen at a
given size gets the same pane and nothing moves as you navigate.

Measured across all 12 round screens at 1920: rail jump 0px, pane jump 0px,
width jump 0px.

A rail is not free horizontally: 260px + a 32px gap costs 292px, so **below
1280px a rail yields fewer Regal columns than the plain 1000px column** — which
is where that breakpoint comes from, rather than from taste. Below it the strip
and dock (#331) are untouched.

Text still needs a measure inside a 1450px pane, so `.app > *` caps at
`--w-read` and grid-bearing blocks opt out. Deciding *that* by content is safe
precisely because it changes no width the navigation depends on — which is the
distinction the test encodes.

### A block that INTRODUCES a grid is not caught by either exemption (#543)

The two exemption selectors match a child that **is** a grid or **contains** one.
A block that merely *labels* the grid next to it is neither — it is a **sibling**
— so it stays capped and centred while the grid beside it spans the pane. That is
how the lobby greeting came to sit at x=270 over cards starting at x=20: a 250px
gap between a heading and the thing it heads, on the first screen every
registered user sees. The tell is a heading that looks *indented* rather than
misaligned, which reads as deliberate until you measure it.

**Exempt such a block on the condition that the grid is actually there**
(`.app:has(.lobby-list) > …`), never unconditionally. The empty state renders
`.lobby-cta` instead of `.lobby-list` (#358) and is still capped and centred, so
a blanket exemption doesn't fix the misalignment — it **moves** it, opening the
identical 250px gap on the first-run view where the head would span 1400px above
a 900px centred CTA. Measured both ways before shipping; the numbers are
symmetric, which is what makes the unconditional version look correct in the one
state anyone tests.

**This has since happened a second time, so treat it as the norm rather than as
one screen's quirk.** #577 gave the two setup forms a two-column layout and
exempted `.setup-grid` alone; the `.page-head` above it — again a *sibling*, not
a wrapper — stayed capped and centred, indenting each screen's own `<h1>` ~170px
from the form it heads. Same fix, same condition (`:has(.setup-grid)`), and the
two now share one custom property so their edges cannot drift. See
`.claude/rules/setup-screens-two-column-layout.md`, which also records the one
argument that lets those two screens select a width by content at all: they
render **no navigation**, so there is nothing inside the column for a width
change to move.

Note this is a *fourth* specificity trap on top of the three below: the cap is
(0,3,0), so a natural-looking `.app:has(.lobby-list) > .lobby-head` is (0,3,0)
too and wins or loses on source order alone. Repeat the cap's `:not()`s the way
the existing exemption does.

**A tint added to such a block has an AA ceiling set by its *quietest* line.**
The lobby band's wash is `--page-glow` — deliberately the exact tint `body`
already lays over the top of every page, so the band introduces no darker surface
than ships everywhere. It cannot simply be deepened to taste: the sub-line is
`.muted` (`--ink-soft`), which clears AA by 0.14 at 7% brand (4.64:1 on Schiefer)
and **fails at 13%** (4.28:1). Nothing renders wrong when it does — the text just
drops below the bar — so `test/a11y-contrast.test.js` composites the wash over
every theme page and pins both lines, keyed to the token rather than to a
percentage a future edit could raise past what was measured.

## Hiding something the rail replaced: your rule will lose

The rail hides five things the column used to carry — the dock, the Start tab's
hero, its CTA, its Tags/Provider/Design links and the Regal's archive footer.
Each hide is a `display: none` competing with a component rule declared **~400
lines further down** `styles.css`, and **three of the five lost on the first
try.** Every failure was silent: no error, no failing test, just the rail entry
*and* the thing it replaced both rendering.

| Hide | Lost to | Why |
|---|---|---|
| `.dock` | `.dock { display: flex }` | ties on specificity → **source order** decides, and the base rule is later |
| `.rail-owned` | `a.btn` (0,1,1) | a bare class is (0,1,0); three of the hidden elements are `a.btn` |
| grid exemption `:has()` (0,2,0) | the cap `:not(.rail):not(.dock)` (0,3,0) | Regal quietly rendered 3 columns instead of 6 |

**Rule:** when hiding or overriding an existing component from the rail's
media block, win on **specificity**, not position — `.app .rail-owned` (0,2,0)
rather than `.rail-owned`. Specificity survives someone moving the block;
source order does not. The one exception is `.dock`, where the competing rule
is the same specificity by nature, so its hide is declared next to the dock's
own rules with a comment saying why it lives there.

`test/content-width.test.js` pins all three, and each assertion was verified by
reintroducing the exact bug and watching it go red.

## What survived from #332, and why

- **The phone Regal is two columns.** A 220px floor needs 456px for two, so
  every phone got one, and a 22-game shelf measured ~6300px of scroll. The floor
  drops to 150px below 520px; at 390px that is two 175px columns and the scroll
  roughly halves (6235 → 3463 measured on one dataset). Unrelated to the width
  question and uncontroversial.
- **The home lobby is a grid** from 860px up. Still tiles 2-up inside a 1000px
  column, so it kept its value after the revert.

Both are pinned as **arithmetic over the declared numbers** — how many columns
the grid actually gets at a given viewport — not as "a rule mentioning grid
exists". A floor nudged 150px → 180px passes every naive assertion while
silently restoring one column; only the column count notices.

## Verifying layout work here

- **An empty screen tells you nothing.** The Pokale tab measured 1000px and
  looked like the rule was broken; the round simply had no finished sessions, so
  it rendered its empty state and contained no grid at all. Seed content for
  every screen you intend to measure.
- **Measure the transition, not the screen.** Every individual screen in #332
  measured correctly. The defect only exists *between* screens — so walk the
  whole set at a fixed viewport and diff the position of anything persistent:
  ```js
  Math.max(...lefts) - Math.min(...lefts)   // must be 0 across all 12 screens
  ```
  That one probe would have caught this before it shipped, and it is the
  standing check for any future shell change.
- Probe with `getComputedStyle(el).gridTemplateColumns`, element rects and
  `document.scrollHeight` rather than pixels
  (`.claude/rules/preview-pane-paint-artifacts.md`); screenshot only right after
  a fresh `navigate`; clear the service worker before believing any
  `styles.css` edit (`.claude/rules/pwa-service-worker.md`); and drive it
  against a generated dataset in a temp `DATA_DIR` — use the committed
  `dev-temp-data` launch config, never `production-data`
  (`.claude/rules/no-reading-production-data.md`).

## The cover budget, for when width does change

More columns mean more covers decoded at once, so `COVER_CARD` (330px) looks due
for a re-check (`.claude/rules/provider-cover-sizing.md`). It holds: `.cards`
uses **`auto-fill` with a `1fr` max**, so extra room becomes extra *columns*,
not wider cards — measured 220px per card at 1920 and 235px at 1280, i.e. still
at the floor. On a phone the card is 175px while we still request 330px, which
is 1.9×, inside the DPR headroom the constant is built from.

That reasoning depends on `auto-fill`; switching to `auto-fit` would collapse
empty tracks and let cards balloon on a sparse shelf, which *would* put the
budget back in play.

**Related:** `.claude/rules/responsive-hub-tabs.md` (the strip/dock breakpoints
this sits on top of), `.claude/rules/css-text-assertions-strip-comments.md`
(how `test/support/css.js` parses the sheet).
