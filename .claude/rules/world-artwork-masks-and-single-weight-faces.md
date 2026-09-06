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
