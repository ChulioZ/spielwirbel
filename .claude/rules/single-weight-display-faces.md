---
paths:
  - "public/styles.css"
  - "public/css/designs/**"
  - "public/fonts/**"
---
# A one-weight display face gets faux-bolded — and SVG mask art reads alpha

Two traps from drawing a design's display face and artwork, first hit shipping
the round worlds (#903/#905, retired at the flip, #1202). Neither errors,
neither fails a test, and both look like a drawing that is merely a bit off.
They bind every user design that brings its own face or its own masks.

## 1. A single-weight face is synthesised bold — declare `font-weight: 400 800`

Headings ask for 700 (`h1`–`h3` and every `--font-display` rule). A face that
ships **one** weight, declared as `font-weight: 400`, is matched for the request
and then **synthesised bold** — a smear over an already heavy face, visibly worse
than the real glyphs, on every heading.

The fix is in the `@font-face`: a range (`400 800`) tells the browser this face
*is* the bold, so nothing is synthesised. A multi-weight face ships its 700 file
instead (Bricolage Grotesque, Manrope, Comfortaa). Either way 700 must be covered
by a declared face. Do not reach for `font-synthesis: none` on the design block:
it would also switch synthesis off for body text that does not need protecting.

Check a fetched file for the `wOF2` magic bytes: a CDN 404 saved under a `.woff2`
name passes "the file exists" and ships a design that falls back to Baloo 2 with
no error anywhere.

## 2. A mask is COVERAGE — white is not a hole, and a short arc is scaled up

For `mask-image: url("data:image/svg+xml,…")` the default `mask-mode` is
`alpha`, so a shape's colour is irrelevant: a `stroke='#fff'` detail is *more*
mask, not less. A cutout is geometry — an `evenodd` path with the hole as a
sub-path of the shape it cuts; a second black `<path>` adds alpha rather than
removing it.

And per SVG F.6.6.2 an elliptical arc whose radii are too small to reach its own
endpoint is **not an error**: both radii are multiplied by √Λ until it fits
(Λ = (x₁′/rx)² + (y₁′/ry)²). Two arcs on one chord meant as a crescent become the
same half-circle and cancel — three Horror-world moons painted **zero pixels** in
production (#1081). Draw a crescent as a disc minus an OFFSET disc, both full
circles, in one `fill-rule='evenodd'` path. In path data a minus sign IS a
separator (`0-72`), so a guard that parses arcs must not demand whitespace.

## 3. In the Browser pane an animation's clock advances only on a PAINT

Sampling `getComputedStyle(el, '::before').transform` at intervals after adding a
reveal class read the **start value** every time, which looks like a keyframe
that does not apply. It applies: with a 0.1-scale `screenshot` between samples
the same probe read 140 → 2 → 0 → 0. The pane paints no frames on its own and an
animation's clock waits for the first frame — so interleave a paint with every
sample, and treat `document.getAnimations()` listing the keyframes' names as the
proof they parsed (an unparseable `@keyframes` produces no animation at all).

**Related:** `.claude/rules/preview-pane-paint-artifacts.md` (the compositor and
capture half of the pane's lies — this timeline note is the third),
`.claude/rules/theme-derived-colors.md` (colours a design's artwork must take
from tokens), `.claude/rules/tabler-icon-codepoints.md`.
