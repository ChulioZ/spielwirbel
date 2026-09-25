---
paths:
  - "public/css/designs/**"
  - "public/js/designs.js"
  - "test/support/theme.js"
  - "test/a11y-contrast.test.js"
---

# A LIGHT design gates its colours on `:not([data-scheme="dark"])` — and its id may be a world's too

Ocean (#1210) is the first light design with tokens of its own. Three things
about that were not obvious from Der Tisch's seam, and each fails silently.

## 1. The gate runs the other way, and the resolver must read it

Der Tisch gates its colour block on `[data-scheme="dark"]`
(`.claude/rules/design-colour-blocks-are-scheme-gated.md`). The mirror for a light
design cannot be `[data-scheme="light"]`: the light scheme is the ABSENCE of the
attribute (`setScheme` deletes it). So the block is

```css
:root[data-design="ocean"]:not([data-scheme="dark"]) { --surface: #f7fbfc; … }
```

and until #1202 it is what keeps Ocean's `#10283a` ink off a dark WORLD round's
page. `test/support/theme.js` reads this block as `light`, only for a light
design, and `test/design-layer.test.js`'s `splitRoot` accepts the suffix — without
both, every Ocean colour resolves to Klassisch and the whole contrast suite
measures the wrong design while staying green. Measured: dropping `b.light` from
`designBlocks` reddens seven Ocean checks by name.

## 2. The two registries share ids — look a design's blocks up by STYLESHEET

`round-designs.js` has a world `ocean`; `designs.js` has a user design `ocean`
(and a user design `forest` is coming, beside the world `forest`). Every contrast
sweep loops BOTH registries, so a lookup keyed on `design.id` alone hands the
world the user design's stylesheet — which the browser never does. It crashed the
Tisch toast test outright (`t.design.stylesheet` undefined on the world row).

Use `blocksOf(design)` from `test/support/theme.js`: it answers only for a design
that carries the same `stylesheet` as the one that registered the blocks, so a
world gets nothing and a spread copy (`{ ...design, scheme }`) still resolves.
Today the world and the design happen to share page and accent, so an id-only
lookup would ALSO pass the sweeps — this guard is not discriminating until a
world and a design with one id differ in colour, which Forest will.

## 3. A small title inherits the display face without asking for it

`h1, h2, h3 { font-family: var(--font-display) }` is global, so a rule like
`.hub-card__title { font-size: 16px }` on an `<h3>` puts the display face at
16px while naming no face at all. For Ocean that breaks O1's „Comfortaa nie
unter 17 px". A scan of rules that name `--font-display` cannot see it; the
browser walk found it on the hub and the Regal. `test/design-tokens.test.js`
therefore also derives every heading/`title`/`name` rule under 17px, and
`ocean.css` moves each one to `--font`.

**Related:** `.claude/rules/design-colour-blocks-are-scheme-gated.md` (the dark
half of the gate), `.claude/rules/design-stylesheets-are-shell-assets.md`,
`.claude/rules/overlay-surface-flip-strands-the-status-tokens.md` (the other
"two registries, one sweep" hole).
