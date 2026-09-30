---
paths:
  - "public/js/views-regal.js"
  - "public/styles.css"
  - "public/css/designs/*.css"
---
# A control added to the Regal's header row wraps onto its own line — and a sticky offset is one dock's number

#1427 gave every design a second „Spiel hinzufügen" (the dashed tile closing the
grid is the end of a long scroll). Two things about doing that were not visible
from the diff, and both shipped wrong on the first try.

## 1. The Ocean toolbar had NO spare room at desktop

`.section-tools` is a wrapping row. Adding the pill to Ocean's (it was already
rendered, only hidden ≥1280) did not widen anything — it **wrapped onto a line of
its own, left-aligned**, at 1440 and at 1366. Nothing errors; the control is
present, correctly styled, and reads as a stray button.

What measured it, and what did not:

- **Head height is the honest signal.** `.section-head`'s `getBoundingClientRect()
  .height`, with the control shown and with it `display: none`, at 1280 / 1366 /
  1440 / 1920. A count of distinct `top` values is fooled by vertical centring
  (items of different heights centre to different tops) and reported three rows
  for a two-row head.
- **The baseline is not one row.** Ocean's German head was 85px at 1440 (title
  row + one tools row), 133px at 1280. The goal is "never taller than today", not
  "one line": the pill joined the existing tools row at 1440 (85 → 85) and
  wrapped at 1366 (85 → **133**) — the most common laptop.
- **The levers, cheapest first, both already in the codebase:** the short import
  label (`tools-label--short`, 18 chars against 28 — 99px; O3.3 draws it), then
  the `aria-hidden` „Sortiert:" prefix (~80px), which phones already drop. Applied
  at ≥1280 and 1280–1439 respectively; from 1440 the sheet's own wording fits.
- **German is not the worst locale by a margin that matters.** Spanish has ~7
  more characters in the variable strings; checked at 1366 it measured 85px
  against a 133px baseline. Compare the lengths across `lang/*.js` before
  assuming one locale stands for nine.

## 2. `bottom: calc(var(--dock-clearance) - N)` — N belongs to ONE dock

Der Tisch's sticky plate uses `- 8px`, Ocean's bubble `- 30px`. Both are right
**for their dock**, and copying either to Klassisch is wrong: Klassisch's dock is
a floating pill, 70px tall at `bottom: 18px`, so its top edge is at 88px and
`- 30px` (→ 90px) left the bar **2px above it** — touching in the screenshot,
"correct" in the CSS. `- 20px` leaves 12px. Ocean's dock is flush and 77px, so its
own `- 30px` measures a 13px gap; Das Programmheft's is flush and 67px (64px cells
+ the 3px rule), so its offset is a literal plus `env(safe-area-inset-bottom)`.

So **measure `dock.top - bar.bottom` at scroll 0** in the design you are writing
for, and check the end of the scroll too: the bar, being in flow after the grid,
settles below the last row and cannot cover it. That is the reason it is a second
DOM copy at all — a sticky box only sticks inside its parent — see
`.claude/rules/sticky-bottom-bar-needs-slack-below-it.md`.

## 3. Klassisch's pair has its own class, and hides while selecting

`regal-add` is styled by Der Tisch, Ocean and Das Programmheft (Ocean hides it
globally), so Klassisch's buttons are `shelf-add` and `styles.css` carries no bare
`.regal-add` rule — `test/regal-second-add.test.js` asserts both. Its pair is the
only one hidden while selecting (`.is-selecting .shelf-add`), as its tile is
dropped. The other designs' buttons stay, because hiding only the new copy would
make each design differ between widths.

**Related:** `.claude/rules/flex-none-cancels-flex-wrap.md` (the wrapping row
itself and the ≤520px block's source-order trap),
`.claude/rules/responsive-hub-tabs.md` (the dock presentations),
`.claude/rules/break-the-code-on-purpose.md` (every assertion in the spec was seen
red against a deliberate break).
