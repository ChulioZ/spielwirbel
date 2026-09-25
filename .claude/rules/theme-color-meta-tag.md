---
paths:
  - "public/js/round-theme.js"
  - "public/index.html"
  - "public/manifest.webmanifest"
  - "test/theme-color.test.js"
---
# The one themed colour that is NOT a CSS variable: the browser chrome (#523)

`<meta name="theme-color">` tints the mobile browser toolbar and the installed
PWA's chrome. It is an **HTML attribute**, so no amount of `color-mix()` reaches
it — `paintDesign()` writes it directly (`setThemeColor`), which is why that
function is the only place a theme colour is applied imperatively. Adding a
themed surface? Check whether it lives outside the stylesheet before reaching
for a variable.

It follows the **accent**, not `--page-bg`, and the reason is continuity: the
chrome is a saturated brand tone at every moment and never flips between that
and a pale one mid-navigation. Tracking the page colour instead would have
flipped it (and the toolbar's icon colours with it) on every round entry and
exit, while rounds still owned designs. Since the flip (#1202) only the worn
design moves it — a round never does — and the static default in `index.html`
is the FACE's accent (Der Tisch's brass `#d9a951`). That choice also settles the sibling question
in #597: `theme-color` is brand chrome here, so a standalone page's value aligns
on the manifest's `theme_color`, not on its own background.

Two constraints on any change here:

- **The meta and `--brand` are set from the same local**, never re-derived
  independently. The tag must state the applied accent or it is worse than a
  stale one.
- **The static default must equal the face's accent** (`STANDARD_ACCENT` for a
  colourless face like Klassisch), and every install surface's tag must equal
  the `theme_color` its manifest URL answers with. `test/theme-color.test.js`
  parses the markup and resolves the manifest through `lib/web-manifest.js`
  rather than restating a hex, so editing one side alone goes red.

Verification is a DOM probe (`document.querySelector('meta[name=theme-color]')
.content`), never a screenshot: the Browser pane renders no browser chrome, so a
capture is the same picture whether the change works or not.

Split out of `.claude/rules/theme-derived-colors.md` in #904, when that file
crossed the 150-line budget: it is the one concern there that is not about CSS
tokens at all — an HTML attribute, its own test file, and a question ("does this
themed thing live outside the stylesheet?") a session asks without needing the
derivation rules beside it.

**The manifest follows the same rule per design (#1199).** A non-face design's
manifest comes from `lib/web-manifest.js`, and its `theme_color` is that design's
**accent** — the value `paintDesign` writes into the meta when the design is
worn — with `background_color` its page. Klassisch's is the static file, served
for `?design=klassisch`; the bare URL answers with the face's derived manifest.

**Related:** `.claude/rules/theme-derived-colors.md` (everything that IS a token),
`.claude/rules/dark-designs-and-the-on-accent-flip.md` (a dark design changes the
page, and deliberately not this).
