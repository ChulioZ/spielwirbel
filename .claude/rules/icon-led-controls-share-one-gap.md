---
paths:
  - "public/styles.css"
  - "public/css/designs/**"
---

# An icon-led button gets its gap from ONE zero-weight rule — don't space the glyph by hand

`public/styles.css` makes every `.btn` / `.link-btn` whose first element child is
a `.ti` glyph an `inline-flex` row with `gap: var(--icon-gap)` (#1640). Before
that the gap was whatever the template said: many write `</i>${label}` with no
space, and a flex box drops the space even where one exists. About twenty
controls per design rendered the glyph flush against its label, and nothing
reported it: the label still reads, and a control that is merely cramped looks
deliberate.

## Three things about the rule that fail silently if undone

- **It carries no weight.** Every member is wrapped in `:where()`; the `a.btn`
  member weighs exactly what `a.btn` does and follows it. So any component that
  sets its own `display` (a `.rail-owned` hide, a flex CTA, `display: none` at
  some width) or its own `gap` still wins. Written as a plain
  `.btn:has(> .ti:first-child)` it would be (0,3,0) and would put the phone CTA
  back on desktop beside the rail's
  (`.claude/rules/state-rules-clobber-component-values.md`).
- **`:not([hidden])`** — the `hidden` attribute hides through the UA sheet only,
  and any author `display` beats it
  (`.claude/rules/hidden-attribute-vs-display-rule.md`).
- **`:not([aria-label])`** — CSS cannot see a text node, so an icon-ONLY control
  (the „…" menus) matches `:has(> .ti:first-child)` too, and as a flex box it
  loses the line box its height came from: measured 8px shorter. The exclusion
  rests on a convention, and `test/icon-gap.test.js` holds it: every icon-only
  control names itself with `aria-label`, and a labelled one has none.

## What to do instead of spacing by hand

- **A new icon-led button needs nothing.** Don't add `margin` to the `.ti` or a
  space in the template to fix a glued glyph.
- **A design that makes a control flex** (Der Tisch's `.link-btn`, its phone
  `.round-card--new`) states `gap: var(--icon-gap)`, not a px value of its own.
- **A drawn gap from a design package** (game-detail actions, hub CTAs) stays as
  a literal on that component. It wins over the shared rule by weight, and that
  is the point of the zero weight.

The inline meta lines (`.trow__owners`, `.archive-row__meta`, a game card's
player count) are text runs, not controls, and keep their space: a flex box
there would split multi-part text into items and drop the whitespace between
them.

## Measuring it

jsdom applies no stylesheet, so the gap is a browser number: for each visible
`i.ti`, take the first text ink after it with a `Range` and subtract the icon's
right edge. Run it with the old and new sheet swapped in one page, and compare
every button's box, not only the gap. That comparison is what found the menu
height loss above. An icon box carries side bearings, so the em-based gap reads
4–10px across sizes, and that spread is expected.

**Related:** `.claude/rules/measure-text-ink-not-its-box.md` (the Range probe),
`.claude/rules/styles-css-guards-are-blind-to-design-sheets.md` (why the spec
also reads `tisch.css`).
