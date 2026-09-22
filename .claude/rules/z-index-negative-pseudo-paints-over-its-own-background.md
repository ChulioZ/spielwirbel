---
paths:
  - "public/css/designs/**"
  - "public/styles.css"
---

# A `z-index: -1` pseudo-element paints OVER its own element's background

`.stamp` paints its fill on a pseudo-element rather than on itself, because the
fill is masked and the shadow must not be:

```css
.stamp { isolation: isolate; }
.stamp::before { position: absolute; inset: 0; z-index: -1;
                 background: color-mix(…); mask-image: radial-gradient(…); }
```

So the natural way for a design to restyle that stamp is to state a background
on the element:

```css
:root[data-design="tisch"] .tisch__box .stamp--table { background: var(--played-tag); }
```

**It is invisible.** `z-index: -1` reads as "behind the element", and it is —
behind its *content*. The CSS painting order puts an element's own background in
step 2 and its negative-z-index descendants in step 3, so inside the stacking
context `isolation: isolate` creates, the pseudo paints **on top of** the
background you just set. The element's background is there, computed exactly as
written, and covered.

That produced a stamp with the right ink and the wrong ground on #1191: green
text on the cream paper slip #1190 gives every `.stamp::before`, i.e. a label
nobody could read, on a card that otherwise looked finished.

## The rule

**If an element's fill lives on a pseudo-element, restyle the pseudo-element.**
Ink stays on the element (the text is the element's own); ground goes where the
ground already is:

```css
… .tisch__box .stamp--table::before { background: var(--played-tag); }
… .tisch__box .stamp--table         { color: var(--played-tag-ink); }
```

**The tell, and it is cheap:** `getComputedStyle(el).backgroundColor` reports
your new colour and the pixels disagree. Read `getComputedStyle(el, '::before')`
in the same probe whenever a background "applies" and does not show — that one
extra field is the whole diagnosis, and without it the next move is to raise
specificity on a rule that already won.

**Before restyling any component, grep the stylesheet for `::before`/`::after`
on it.** Whether a fill sits on the element or on a pseudo is invisible from the
markup and from the class name, and this codebase uses the pseudo whenever a
mask, a gradient border or a clipped fill is involved (`.stamp`, `.trow`'s score
fill, `.vote__img`'s blur layer).

**Related:** `.claude/rules/inline-custom-properties-cannot-be-overridden.md`
(the other override that looked right and did nothing, same slice),
`.claude/rules/preview-pane-paint-artifacts.md` (when the computed value and the
pixels disagree for the pane's own reasons instead).
