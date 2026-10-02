---
paths:
  - "public/css/designs/**"
  - "test/design-tokens-*.test.js"
---

# A design package's token NAMES are not the app's — map each one by its ROLE

Every design package (`docs/design/<id>/…-1-Komponenten.dc.html`) ships its own
token table, and several of its names coincide with app tokens that mean
something else. Copying a package row into the stylesheet by name type-checks,
renders, and is wrong — and the contrast suite reports it far from the line
that caused it.

Met on Forest (#1465), where three collided at once:

| Package name | What the package means | The app token with that role | What the app's same-named token is |
|---|---|---|---|
| `gold-ink` `#85570f` | gold-coloured TEXT („hat gewonnen") | `--gold-deep` | `--gold-ink` is the glyph printed ON a gold fill — the seal's padlock (`theme-derived-colors.md`) |
| `accent-deep` `#284d1d` | the accent's hover/pressed tone | `--brand-strong` | — (no app token by that name; `:root` mixes `--brand-strong` itself, so a design that leaves it out gets a mix, not its colour) |
| `gold-tint` / `edge` | the winner row / the control border | `--gold-soft` / `--control-edge` | — |

Written by name, `--gold-ink: #85570f` put the padlock at **1.44:1** on the
gold, and the failure surfaced as „the seal's padlock clears the 3:1 non-text
bar" — a test about a screen the slice never touched.

## `--on-accent` on a LIGHT design should stay white

Forest's F1 gives „on-accent" a faint green tint (`#f4f8ec`). The app paints
`--on-accent` on fills the design does not own: the eight member tones (an
avatar's initials) and the continuous `avgColor` ramp of an unrunged score pill,
both tuned to **4.5:1 against pure white**. The tint drops six member tones and
the mid ramp to 4.2:1. So Forest states `--on-accent: #ffffff` and keeps F1's
tint as `--on-dusk`, the ramp's low inks and `markerInk` — fills it does own.

## The rule

**Read the package's ROLE column, not its name column**, and write each value
into the app token with that role. Then pin the mapping in the design's own
`test/design-tokens-<id>.test.js` beside the package values, and pin every value
that deviates from the package as a deviation with its reason — so "restore the
package value" later reads as a decision someone has to make, not a cleanup.

**Related:** `.claude/rules/theme-derived-colors.md` (`--gold-ink`'s contract,
and `--on-accent` on a saturated fill), `.claude/rules/dark-designs-and-the-on-accent-flip.md`
(why `--on-accent` is a property of the FILL), `.claude/rules/design-stylesheets-are-shell-assets.md`.
