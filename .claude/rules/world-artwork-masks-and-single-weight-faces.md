---
paths:
  - "public/styles.css"
  - "public/fonts/**"
  - "public/js/round-designs.js"
---
# World artwork: a mask reads ALPHA, and a one-weight face needs a weight RANGE

Two traps from shipping the four #905 worlds on the #903 slot contract. Neither
errors, neither fails a test, and both look like a drawing that is merely a bit
off.

## 1. White in a mask SVG is opaque — there is no "draw the hole in white"

Every ornament is `mask-image: url("data:image/svg+xml,…")` painted in a theme
token. For an image mask the default `mask-mode` is `alpha`, so the mask is the
SVG's **coverage**, and a shape's colour is irrelevant: a `stroke='#fff'` slit
across a bishop, ridges on a shell, serrations on a tooth are all *more* mask,
not less. The natural instinct (black silhouette, white detail) produces a
silhouette with the detail silently welded shut.

A cutout is geometry: an `evenodd` path with the hole as a sub-path (the ghost's
eyes in `[data-world="horror"]`), or simply no detail. `test/round-worlds.test.js`
requires every mask to be drawn in black, but it cannot tell decoration from a
hole that failed — only the rendered glyph can.

## 2. A single-weight display face gets faux-bolded — declare `font-weight: 400 800`

Headings ask for 700 (`h1`–`h3` and every `--font-display` rule). Creepster and
Alfa Slab One ship **one** weight; declared as `font-weight: 400`, that face is
matched for the request and then **synthesised bold** — a smear over an already
heavy face, visibly worse than the real glyphs, on every heading in the world.

The fix is in the `@font-face`: a range (`400 800`) tells the browser this face
*is* the bold, so nothing is synthesised. A multi-weight face ships its 700 file
instead (Comfortaa, Playfair Display, and the #903 pair). Either way, 700 must be
covered by a declared face — `test/round-worlds-content.test.js` asserts it,
because the alternative (`font-synthesis: none` on the world block) would also
switch synthesis off for Nunito body text, which does not need protecting.

Note the fetched files are checked for the `wOF2` tag there too: a CDN 404 saved
under a `.woff2` name passes "the file exists" and ships a world that falls back
to Baloo 2 with no error anywhere.

## 3. An arc's radius is SCALED UP to reach its endpoint — silently

Three crescent moons in the Horror world painted **zero pixels** in production
(#1081): the reveal's `--world-victory-2-r`, the stage's, and the backdrop's.
Each was two arcs on one chord:

```
M70 22a36 36 0 1 0 0 72a29 29 0 1 1 0-72z      <- 0 px of ink
```

Per SVG F.6.6.2, an elliptical arc whose radii are too small to reach its own
endpoint is **not an error**: both radii are multiplied by √Λ until it just
fits, where Λ = (x₁′/rx)² + (y₁′/ry)². So `r 29` on a 72px chord becomes `r 36`,
the inner arc becomes the same half-circle as the outer one, and they cancel
exactly. The SVG parses, the mask applies, the token is present, and the ornament
simply is not there.

**Draw a crescent as a disc minus an OFFSET disc, in one `fill-rule='evenodd'`
path** — the technique the ghost's eye already used:

```
%3Cpath fill-rule='evenodd' d='M50 60a36 36 0 1 0 72 0a36 36 0 1 0-72 0z
                               M64 60a29 29 0 1 0 58 0a29 29 0 1 0-58 0z'/%3E
```

Both subpaths are full circles, so no radius is ever short, and the offset is
what makes the bite. **A cutout drawn as its OWN `<path>` does not work under a
mask** — alpha is what a mask reads, and a second black path adds alpha rather
than removing it. It has to be a subpath of the shape it cuts.

`test/round-worlds.test.js` now applies Λ to every relative arc in every world
mask. Two things about that guard are worth keeping:

- **It implements the spec's formula, not the obvious paraphrase.** “2·rx and
  2·ry must both reach the chord” flags `a 10 8 0 0 1 20 0` — a flat-ended
  ellipse whose short radius is *perpendicular* to the chord and which is not
  scaled at all. Three of Forest's mushroom caps are that shape, and a guard that
  reddens on correct artwork gets weakened until it stops catching the real thing.
- **In path data a minus sign IS a separator.** The shipped crescents spell their
  endpoint `0-72`, with no space. The first draft of the guard demanded
  whitespace, swept all six worlds, reported clean, and missed every moon it was
  written for — `.claude/rules/source-scanning-guards-enumerate-shapes.md`
  exactly: what varies is the syntax around the token, not the token. The guard
  carries a self-test with that spelling in it.

It found a third moon nobody knew about, which is the argument for writing it at
all: node has no canvas, so ink cannot be measured in CI, and this is the one
failure mode that is invisible from every other direction.

## The animation timeline in the pane advances only on a PAINT

Sampling `getComputedStyle(el, '::before').transform` at 0.3/1.0/1.5/2.2/3.6 s
after adding `.is-reveal` read the **start value five times**, which looks like
a keyframe that does not apply. It applies: with a 0.1-scale `screenshot`
between samples the same probe read 140 → 2 → 0 → 0. The pane paints no frames
on its own, and an animation's clock waits for the first frame — so interleave
a paint with every sample, and treat `document.getAnimations()` listing the
world's names as the proof that the keyframes parsed (an unparseable
`@keyframes` produces no animation at all).

**Related:** `.claude/rules/theme-derived-colors.md` § Worlds (the slot
contract), `.claude/rules/preview-pane-paint-artifacts.md` (the compositor and
capture half of the pane's lies — this timeline note is the third),
`.claude/rules/tabler-icon-codepoints.md` (the emblem glyphs, cmap-verified).
