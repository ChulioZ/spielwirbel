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

**Related:** `.claude/rules/design-stylesheets-are-shell-assets.md` (what a
design sheet may declare), `.claude/rules/source-scanning-guards-enumerate-shapes.md`
(a scan's coverage is whatever it reads — here, which FILES).
