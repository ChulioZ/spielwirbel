---
paths:
  - "public/js/core.js"
  - "public/index.html"
  - "public/manifest.webmanifest"
  - "test/theme-color.test.js"
---
# The one themed colour that is NOT a CSS variable: the browser chrome (#523)

`<meta name="theme-color">` tints the mobile browser toolbar and the installed
PWA's chrome. It is an **HTML attribute**, so no amount of `color-mix()` reaches
it — `applyBackground()` writes it directly (`setThemeColor`), which is why that
function is the only place a theme colour is applied imperatively. Adding a
themed surface? Check whether it lives outside the stylesheet before reaching
for a variable.

It follows the **accent**, not `--page-bg`, and the reason is continuity: the
static default in `index.html` is `#c2410c`, which *is* `PALETTES[0].accent`, so
home, the landing and unthemed rounds keep exactly that value and the chrome
never flips between a saturated tone and a pale one mid-navigation. Tracking the
page colour instead would have flipped it (and the toolbar's icon colours with
it) on every round entry and exit. That choice also settles the sibling question
in #597: `theme-color` is brand chrome here, so a standalone page's value aligns
on the manifest's `theme_color`, not on its own background.

Two constraints on any change here:

- **The meta and `--brand` are set from the same local**, never re-derived
  independently. `themeAccent(bg)` looks like it would do — it normalizes more
  loosely (no `bg.page` requirement), so on malformed data it can disagree with
  what `applyBackground` actually painted. The tag must state the applied accent
  or it is worse than a stale one.
- **The static default and `STANDARD_ACCENT` must stay equal.**
  `test/theme-color.test.js` parses both out rather than restating a hex, so
  editing one alone goes red. That discipline now covers the whole file (#637):
  the stale-accent spec reads Sand's current `page`/`accent` off `PALETTES` too,
  so a legitimate contrast retune needs no hand-edit there. Only the **pre-#145**
  hex it feeds in stays a literal — that one is history and lives nowhere in the
  code, and the spec asserts it still differs from Sand's current accent, or it
  would be resolving nothing.

Verification is a DOM probe (`document.querySelector('meta[name=theme-color]')
.content`), never a screenshot: the Browser pane renders no browser chrome, so a
capture is the same picture whether the change works or not.

Split out of `.claude/rules/theme-derived-colors.md` in #904, when that file
crossed the 150-line budget: it is the one concern there that is not about CSS
tokens at all — an HTML attribute, its own test file, and a question ("does this
themed thing live outside the stylesheet?") a session asks without needing the
derivation rules beside it.

**Related:** `.claude/rules/theme-derived-colors.md` (everything that IS a token),
`.claude/rules/dark-designs-and-the-on-accent-flip.md` (a dark design changes the
page, and deliberately not this).
