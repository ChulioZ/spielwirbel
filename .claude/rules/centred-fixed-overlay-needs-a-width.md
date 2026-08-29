---
paths:
  - "public/styles.css"
---

# A `max-width` on a `position: fixed; left: 50%` box is INERT without a `width`

The toast is centred the usual way — `position: fixed; left: 50%;
transform: translateX(-50%)`. Adding `max-width: min(420px, 100vw - 32px)` to
stop a long message wrapping edge-to-edge changed **nothing**, and the reason is
not visible in the rule:

- A fixed box's containing block is the viewport, but `left: 50%` moves its
  **start edge** to the middle. The available space is what remains to the
  *right* of that offset — half the viewport.
- `transform` is a paint-time operation. `translateX(-50%)` visually recentres
  the box and has **no effect on layout**, so it never gives the width back.
- A shrink-to-fit box is `min(max-content, available)`. At 375px that is
  `min(…, 187.5px)`, which is already narrower than any sane `max-width` — so
  the cap is dead code.

Measured on #858 at a 375px viewport, one string (`wish.deleted` with a real
game title): **187.5px wide, six lines tall** with the cap declared, versus
**343px wide, three lines** once `width: max-content` was added beside it.

## The rule

Give a centred fixed overlay an explicit `width` — `max-content` is the right
one for a shrink-to-fit box — so the cap has something to cap:

```css
width: max-content;
max-width: min(420px, 100vw - 32px);
```

`width` and `max-width` here read as redundant and the `width` is the one that
looks droppable. It is the load-bearing half: delete it and the box silently
returns to half the viewport. `test/toast-shape.test.js` asserts it for that
reason, with the explanation on the assertion rather than only in the sheet.

The alternative shape, if you would rather not declare a width:
`left: 16px; right: 16px; margin-inline: auto; width: max-content` — insetting
both edges makes the containing block the full viewport again. Don't mix the two.

## The trap that rides along: a pill radius is only a pill on ONE line

The same `.toast` carried `border-radius: var(--radius-pill)` (999px). That is a
pill *only while the box is one line tall* — on a taller box the four corner arcs
meet and it paints as a **full ellipse**, which is how a wrapped toast rendered
as a black circle over the content. CSS cannot see line boxes, so there is no
conditional to write: pick a fixed radius just over half a single-line box
(`padding*2 + font-size*line-height`), which leaves one line clamped to the same
pill it always was and degrades a wrapped one to a rounded rectangle.

Note this is invisible until something makes the box wrap, and on a phone an
interpolated game title does that routinely — so "it looks fine" on a desktop
viewport is not evidence. Any `--radius-pill` on a box holding **interpolated
text** is this bug waiting; the token is safe only on fixed-height chips.

**Why the diagnosis is the expensive part:** #858's issue body attributed the
wrapping to the box being "shrink-to-fit against the viewport … edge-to-edge with
no gutter" and prescribed the `max-width` alone. That reads correctly, the fix
looks complete, and the CSS-text test asserting the cap exists passes — while the
rendered toast is unchanged. Only a real browser measurement separated them.
Measure the box, don't reason about it (`resize_window` first, or `vw` resolves
to 0 — `.claude/rules/preview-pane-paint-artifacts.md`).

**Related:** `.claude/rules/css-text-assertions-strip-comments.md` (a CSS-text
assertion can only see the declaration, never its effect — which is exactly how
the inert cap passed), `.claude/rules/break-the-code-on-purpose.md`,
`.claude/rules/pwa-service-worker.md` (the SW cache served the pre-edit sheet
mid-verification here and made a correct fix look like it had no effect).
