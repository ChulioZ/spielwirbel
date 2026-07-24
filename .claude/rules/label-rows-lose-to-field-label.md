# A `<label>` row inside a `.field` is `display: block` — `.field label` outruns `.ds-row`

`.ds-row` is the app's row component (`display: flex`, main left, meta right).
The checkbox-row idiom builds each row as a **`<label class="ds-row …">`** so the
whole row toggles its checkbox — that is what `.provider-row` does and it works.

Put that same row inside a **`.field`** wrapper and it silently stops being a row:

```css
.field label, .field .field__label { display: block; font-weight: 600; margin-bottom: 6px; }
.ds-row { display: flex; align-items: center; justify-content: space-between; }
```

`.field label` is **(0,1,1)** — a class plus a *type* selector — and `.ds-row` is
**(0,1,0)**. Specificity, not source order, decides, so every row computes
`display: block`: the `__main` and `__meta` stack, each row grows ~50%, the
checkbox lands under the title instead of at the right edge, and the rows
inherit `font-weight: 600` and a stray `margin-bottom` as a bonus.

Found on #402 (the move-games selection list). The `.field` wrapper was there
purely for its `margin-bottom: 18px`, and it cost the whole row layout.

## The rule

A `.ds-row` built as a `<label>` must **not** live inside a `.field`. Give the
group its own wrapper carrying the same spacing (`.move-picker { margin-bottom:
18px; }`) rather than escalating specificity — `.field` exists to style *a form
control's own label*, and a row of content is not that. Escalating (`.field
.move-row { display: flex; font-weight: 400; margin-bottom: 0 }`) works but
leaves three overrides that have to be kept in sync with `.field label` forever.

## The verification trap: every DOM probe reported this as fine

The bug is invisible to the obvious checks, and two separate probes said so:

- **`getComputedStyle` on the *children* looks perfect.** `.ds-row__main` and
  `.ds-row__meta` both report `display: flex`, `flexWrap: nowrap`,
  `flexDirection: row` — because they *are* flex; it is their **parent** that
  stopped being one. Read `display` on the **row itself**, which is the element
  the competing rule targets.
- **The rects were all `width: 0`.** The Browser pane was in its
  `innerWidth === 0` state (`.claude/rules/preview-pane-paint-artifacts.md`), so
  `getBoundingClientRect()` returned zero widths for everything and the
  "is the checkbox to the right of the title?" probe answered a meaningless
  `false`. `resize_window` did **not** clear it.

**Only the screenshot showed it** — the pane renders the capture at real size
even while it reports a 0-width layout. So for a *layout* claim, trust the
screenshot over the rects; use the rects only once `innerWidth` is non-zero.
Same family as `.claude/rules/hidden-attribute-vs-display-rule.md`, where
`el.hidden` reported `true` on a fully visible element: in both cases the IDL/DOM
answer is right about the DOM and wrong about the pixels.

**Related:** `.claude/rules/responsive-content-width.md` ("your rule will lose" —
the same win-on-specificity-not-source-order lesson for the rail's hides),
`.claude/rules/tiles-vs-lists.md` (the `.ds-row` wrap trap in a narrow tile).
