---
paths:
  - "public/css/designs/**"
---
# A guard that reads `styles.css` cannot see a design sheet undoing its fix

Many specs pin a hard-won fix by reading `public/styles.css` as text:
`test/toast-shape.test.js` asserts `.toast` never takes `var(--radius-pill)`
(#858 — a wrapped toast painted as a giant ellipse over the page). Every such
guard is scoped to ONE file, and the per-design override sheets
(`public/css/designs/<id>.css`) load after it and outrank it.

So #1210 wrote, reasonably, from Ocean's drawing:

```css
:root[data-design="ocean"]:not([data-scheme="dark"]) .toast { border-radius: var(--radius-pill); }
```

and reopened #858 on that design alone, with `toast-shape.test.js` green —
it never opened the file. Found by #1217 reading the component layer, not by
any test.

## The rule

**Before restating a component's shape in a design sheet, grep the specs for
that selector** (`grep -rln "'\.toast'" test/`) and read what they pin. If a
guard exists, either honour it or widen it to every design sheet in the same
change — `test/ocean-overlays.test.js` now sweeps all of
`public/css/designs/*.css` for the toast pill, which is the shape to copy.

The drawing is not a licence: a design package draws ONE message at ONE length,
so it can never show you the case the fix was for.

## The same blindness in a contrast sweep — and it cuts both ways (#1371)

`a11y-contrast.test.js`'s „hovering a control never WEAKENS its edge" read
each hover's token out of `styles.css` only. Das Programmheft rests every
control on an ink edge (18:1), so the app's hover-to-`--brand` (6:1) is a real
weakening there — and a design sheet answering it with its own hover rule was
invisible to the test, which kept reporting the app's token. The test now looks
the selector up in the design's sheet first (matching a grouped selector member
by member), and skips a control the design repaints onto another ground, as it
already did for `styles.css`. Widening it immediately found Der Tisch's search
pill, whose paper ground made the old pair meaningless — so a widened sweep can
report a false defect as easily as it hides a real one. Check what ground the
design actually paints before believing either.

**Related:** `.claude/rules/design-stylesheets-are-shell-assets.md` (what a
design sheet may declare), `.claude/rules/source-scanning-guards-enumerate-shapes.md`
(a scan's coverage is whatever it reads — here, which FILES).
