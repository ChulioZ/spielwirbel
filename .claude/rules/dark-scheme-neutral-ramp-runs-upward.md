---
paths:
  - "public/styles.css"
  - "test/a11y-contrast.test.js"
  - "test/support/theme.js"
---

# On a dark design every neutral token mixed at the light percentage lands ON `--surface`

> The sibling trap, for a wash rather than a derived token:
> `.claude/rules/alpha-washes-are-not-comparable-across-schemes.md`. This file is
> about a mix that lands somewhere **else** on dark; that one is about an alpha
> that lands exactly where you asked and still cannot be seen.

`:root` derives the whole neutral ramp off the page toward `--shade`, and the
dark block flips `--shade` to `#fff` — so the mixes "just work" in both
directions. They do not. `--surface` is the one token that is **not** a fixed
colour on dark:

```css
:root                     { --surface: #fff; }                              /* the page's whole distance away */
:root[data-scheme="dark"] { --surface: color-mix(in oklab, #fff 9%, var(--page-bg)); }
```

So a 7% `--line` is separated from a white card by the page's distance to white
**plus** its 7%, and from a dark card by `9% − 7%`. Measured across the four dark
designs before #1140:

| | light | dark |
|---|---|---|
| `--line` vs `--surface` | 1.37 – 1.43 | **1.04 – 1.05** |
| `--sunken` vs `--surface` | 1.25 – 1.31 | ~1.05 |
| `--sunken-soft` vs `--surface` | 1.20 – 1.26 | 1.13 – 1.15 |

A chip's border therefore measured **1.05:1 against the chip's own fill** — the
boundary that identifies the control separated it from nothing, on every dark
design, for as long as dark designs had shipped.

## The ramp has to run UPWARD, and the percentages are re-picked per scheme

There is no room below: the dark pages are near-black, so mixing toward `#000`
tops out at **1.10:1 against the page even at 35%**. The only position that
separates from the page *and* from the card is **above `--surface`** — which
inverts the words (a "sunken" well reads as raised) and is still correct, because
what the components rely on is the **ordering**, not the direction. Keep
`soft < sunken < line < control-edge` and say so in a comment.

Pin the **ratios light already ships**, per design, not the percentages —
`test/a11y-contrast.test.js`'s `LIGHT_FLOOR`. Light is the half that was always
right, so a dark design is asked to reach what light reaches rather than to hit a
number somebody typed, and a new design is measured automatically.

## Raising the ramp drags everything measured AGAINST it — in the silent direction

This is the expensive half. `--placeholder` is a non-text graphic sitting on
`--sunken`/`--sunken-soft` and was taken to 45% by #938 precisely to clear 3:1
there. Lifting those two grounds by 15 points walked it back down to **2.43:1** —
i.e. #938's fix was undone *from underneath*, by a change that never mentioned it
and touched no line it owns. Only its own spec caught it.

So after retuning any ground, **re-run every check that measures something on
it** and expect to move the dependants too (`--placeholder` → 53% on dark here).
Grep the token's name before assuming it stands alone.

The same shape hit the **hover** affordance, where nothing was measuring at all:
`--brand-edge` is 1.39 – 1.95:1 against a control's fill, so raising the resting
edge to 3:1 made nine controls get *fainter* under the pointer. A state is only
a state relative to the resting value — when you change a resting value, check
every state that was tuned against the old one.

## Verifying it in the pane

Do **not** toggle `data-scheme` at runtime; the pane updates the custom property
and not the used value (`.claude/rules/preview-pane-paint-artifacts.md`). Build a
subtree under `.theme-card[data-scheme="dark"]` — the app's second scheme carrier
— with `--page-bg`/`--brand` inline, exactly as the design picker does. A plain
`<div data-scheme="dark">` matches neither selector and silently renders light.

And resolve colours **through a canvas**: a computed `color-mix` comes back as
`oklab(0.59 0.002 0.003)`, and the obvious `match(/\d+/g)` reads L/a/b as RGB and
reports every pair as 1.00:1 — a plausible number, and the same one the real bug
produced.

**Related:** `.claude/rules/dark-designs-and-the-on-accent-flip.md` (the same
scheme split, for the ink on a saturated fill),
`.claude/rules/color-mix-interpolation-space.md` (why the percentages are what
they are), `.claude/rules/accessibility-contrast-and-modals.md` (the 3:1 bar),
`.claude/rules/break-the-code-on-purpose.md`.
