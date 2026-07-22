# Two content widths (#332): `:has()` decides, and it must fail NARROW

`.app` has two max-widths — `--w-content` (1000px, the reading measure) and
`--w-wide` (1440px) — and which one a screen gets is decided in CSS by **what
the screen renders**:

```css
.app:has(.cards, .pokale-cards, .lobby-list) { max-width: var(--w-wide); }
.app:has(.cards, .pokale-cards, .lobby-list) + .site-footer { max-width: var(--w-wide); }
```

Before #332 it was a flat 1000px at every viewport: a 1920 screen spent **48% of
itself on empty gutter** while the Regal stayed at four columns, and the same
220px grid floor gave **every phone a single column** (a 22-game shelf measured
6332px of scroll as filed — 6235px reproduced here — about eight screenfuls).

## 1. Why it is CSS and not a per-view flag

The obvious implementation is a width mode each view sets (`app.dataset.width =
'wide'`). Don't. **There is no "begin view" hook in this frontend** — every
`show*` function clears `#app` itself, there is no shared entry point — so the
flag would have to be set in ~20 places and *cleared* in the rest. The first
view that forgets it renders at the **previous screen's** width, which is a bug
that only appears depending on where you navigated from. `:has()` reads the
rendered content, so it cannot be forgotten.

This is the same technique — and the same reasoning — as the dock clearance in
`.claude/rules/responsive-hub-tabs.md` §3.

## 2. The direction of the failure is the whole point

The rule adds the WIDE width to recognised screens; it never subtracts. So a
screen nobody thought about keeps `--w-content`, i.e. exactly its pre-#332
behaviour. The inverse shape — widen `.app` globally and cap the text views
back down — reads as the same change and fails in the opposite, much worse
direction: a text view someone forgets stretches prose to 1440px, and a Chronik
row already carries only ~350px of content in a 1000px row.

`test/wide-layout.test.js` pins this as *"nothing widens the page
unconditionally"*, because "just bump `.app`" is a genuinely tempting
simplification that no other test would notice.

## 3. `.theme-cards` is absent on purpose

The design studio renders a grid, so it looks like it belongs in the list. It
is deliberately excluded: nine theme swatches read better as 6 columns × 2 rows
than as one 9-wide strip, and it keeps the settings sub-screens (tags,
providers, design) consistent at the reading measure. Adding a class to the
`:has()` list is a product decision, not a tidy-up.

**Whatever you add, add it to BOTH rules.** The footer's condition and the
page's must stay identical or the footer keeps the narrow measure under a wide
column and visibly stops lining up — on exactly the screens someone just
extended. The test asserts the two `:has()` payloads are character-identical.

## 4. Verifying it — an empty screen tells you nothing

The trap that cost a probe cycle: the Pokale tab measured **1000px** and looked
like the rule was broken. It wasn't — the round had no finished sessions, so
Pokale rendered its empty state, which contains no `.pokale-cards` grid, so
`:has()` correctly declined to widen. **Seed content for every screen you
intend to measure**, or you are measuring the empty state.

Everything else follows the pane rules that already exist: probe with
`getComputedStyle(el).gridTemplateColumns`, element rects and
`document.scrollHeight` rather than pixels
(`.claude/rules/preview-pane-paint-artifacts.md`), take screenshots only right
after a fresh `navigate`, and clear the service worker before believing any
`styles.css` edit (`.claude/rules/pwa-service-worker.md`). Drive it against a
generated dataset in a temp `DATA_DIR` — the committed `.claude/launch.json`
points at the production folder, so add a throwaway config and revert it
(`.claude/rules/no-reading-production-data.md`).

To compare before/after honestly on one dataset, re-apply the old floor from
the console rather than trusting a number measured on different data:

```js
const g = document.querySelector('.cards');
const after = document.documentElement.scrollHeight;
g.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
g.style.gap = '16px';
const before = document.documentElement.scrollHeight;   // 6235 vs 3463 at 390px
```

## 5. The cover budget did not need re-tuning — and here is why

More columns mean more covers decoded at once, so `COVER_CARD` (330px) looked
due for a re-check (`.claude/rules/provider-cover-sizing.md`). It holds:
`.cards` uses **`auto-fill` with a `1fr` max**, so extra room becomes extra
*columns*, not wider cards — measured 220px per card at 1920 and 235px at 1280,
i.e. still at the floor. On a phone the card is 175px while we still request
330px, which is 1.9× — inside the DPR headroom that constant is built from.
`content-visibility: auto` still skips the off-screen ones.

Note this reasoning depends on `auto-fill`; a switch to `auto-fit` would
collapse empty tracks and let cards balloon on a sparse shelf, which *would*
put the decoded-pixel budget back in play.

**Related:** `.claude/rules/responsive-hub-tabs.md` (the breakpoints and the
`:has()` precedent this builds on), `.claude/rules/css-text-assertions-strip-comments.md`
(how `test/support/css.js` parses the sheet for both tests).
