---
paths:
  - "public/css/designs/**"
  - "public/js/designs.js"
  - "test/support/theme.js"
  - "test/a11y-contrast.test.js"
  - "public/js/views-session*.js"
---

# A LIGHT design gates its colours on `:not([data-scheme="dark"])` — and its blocks are looked up by stylesheet

Ocean (#1210) is the first light design with tokens of its own. The things
below were not obvious from Der Tisch's seam, and each fails silently.

## 1. The gate runs the other way, and the resolver must read it

Der Tisch gates its colour block on `[data-scheme="dark"]`
(`.claude/rules/design-colour-blocks-are-scheme-gated.md`). The mirror for a light
design cannot be `[data-scheme="light"]`: the light scheme is the ABSENCE of the
attribute (`setScheme` deletes it). So the block is

```css
:root[data-design="ocean"]:not([data-scheme="dark"]) { --surface: #f7fbfc; … }
```

and until #1202 it was what kept Ocean's `#10283a` ink off a dark WORLD round's
page. Since the flip the scheme follows the design (`setScheme(designScheme())`
in `round-theme.js`), but the gate is still the shape the tooling reads:
`test/support/theme.js` reads this block as `light`, only for a light design,
and `test/design-layer.test.js`'s `splitRoot` accepts the suffix — without both,
every Ocean colour resolves to Klassisch and the whole contrast suite measures
the wrong design while staying green. Measured: dropping `b.light` from
`designBlocks` reddens seven Ocean checks by name.

## 2. Look a design's blocks up by STYLESHEET — a guard from when ids were shared

Until #1202, `round-designs.js` had a world `ocean` beside the user design `ocean`
in `designs.js` (and a world `forest` beside the user design to come). Every
contrast sweep looped BOTH registries, so a lookup keyed on `design.id` alone
handed the world the user design's stylesheet — which the browser never did. It
crashed the Tisch toast test outright (`t.design.stylesheet` undefined on the
world row). The flip deleted `round-designs.js` (a45af150), and the collision
with it.

`blocksOf(design)` in `test/support/theme.js` still answers only for a design
that carries the same `stylesheet` as the one that registered the blocks, so a
spread copy (`{ ...design, scheme }`) resolves and Klassisch, which has no sheet,
gets nothing. Its comment keeps the check as the cheaper guarantee; use it rather
than an id lookup. It never got to be discriminating: while both registries
existed, the world and the design shared page and accent.

## 3. A small title inherits the display face without asking for it

`h1, h2, h3 { font-family: var(--font-display) }` is global, so a rule like
`.hub-card__title { font-size: 16px }` on an `<h3>` puts the display face at
16px while naming no face at all. For Ocean that breaks O1's „Comfortaa nie
unter 17 px". A scan of rules that name `--font-display` cannot see it; the
browser walk found it on the hub and the Regal. `test/design-tokens.test.js`
therefore also derives every heading/`title`/`name` rule under 17px, and
`ocean.css` moves each one to `--font`.

## 4. A view cannot spell `designIs('ocean')` where a retired-world guard scans it

`test/result-tafel.test.js` asserts `views-session.js` names no retired round
world — every key of `LEGACY_MARKER_INDEX`, quoted. `ocean` (and `forest`) are
keys there, so the obvious `designIs('ocean')` in that file reddens a test about
the #1202 flip, not about your change. Don't weaken the scan: #1213 asks through
`oceanWorn()` in `views-session-ocean.js`, the one place the session screens
spell the id, and #1468 did the same with `forestWorn()` in
`views-session-forest.js` — every Forest session file (the shared vote and the
blind, #1469, included) asks through it rather than spelling `'forest'`.

**Related:** `.claude/rules/design-colour-blocks-are-scheme-gated.md` (the dark
half of the gate), `.claude/rules/design-stylesheets-are-shell-assets.md`,
`.claude/rules/overlay-surface-flip-strands-the-status-tokens.md` (the other
"two registries, one sweep" hole).
