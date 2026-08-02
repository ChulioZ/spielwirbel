---
paths:
  - "public/styles.css"
  - "public/js/views-round-detail.js"
  - "public/js/core.js"
  - "public/index.html"
---
# Derive UI colors from the theme variables, don't hardcode them

Each round picks a design (page background + accent). The whole UI must follow
it, so `styles.css` derives every tone from two custom properties that
`applyBackground()` sets: `--page-bg` and `--brand`.

**Rule:** when styling something new, never hardcode a hex that is really "a
lighter/darker shade of the page or accent" — use `color-mix()` on the existing
variables, or one of the prepared families:

- Neutrals from the page: `--sunken`, `--sunken-soft`, `--line`, `--placeholder`.
- Accent surfaces: `--brand-dark`, `--brand-tint`, `--brand-tint-soft`,
  `--brand-edge`, `--page-glow`.
- The dark finale stage: `--stage-bg/raised/line/ink/muted/faint` (all derived
  from `--brand`, so the "curtain" matches every theme).
- Semantics (theme-independent by design): `--good`, `--warn`, `--danger`, and
  the trophy/winner family `--gold`, `--gold-deep`, `--gold-soft`, `--gold-edge`.
  Tints of these still go through `color-mix(... var(--warn/--danger) N%,
  var(--surface))`, not fixed pastels.

**Why:** the original redesign hardcoded warm tones (a brown stage, beige
placeholder icons, amber pastels). On cool themes (Blaugrau, Schiefer, Lavendel)
they clashed badly — three color worlds on one screen. The fix was exactly this
derivation; don't regress it. Category tags (`.tag--digital` etc.) and medal
silver/bronze are intentionally fixed — they encode meaning, not theme.

Also note: the page backdrop (soft accent glow + paper grain) lives entirely in
the `body` rule in `styles.css`. There is no JS texture generation anymore —
`applyBackground()` sets/removes the two variables plus the browser chrome
(below), and stored round designs are just `{ type: 'theme', page, accent }` (a
legacy `pattern` field in old data is ignored).

## The one themed colour that is NOT a CSS variable: the browser chrome (#523)

`<meta name="theme-color">` tints the mobile browser toolbar and the installed
PWA's chrome. It is an **HTML attribute**, so no amount of `color-mix()` reaches
it — `applyBackground()` writes it directly (`setThemeColor`), which is why that
function is the only place a theme colour is applied imperatively. Adding a
themed surface? Check whether it lives outside the stylesheet before reaching
for a variable.

It follows the **accent**, not `--page-bg`, and the reason is continuity: the
static default in `index.html` is `#c2410c`, which *is* `THEMES[0].accent`, so
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
  editing one alone goes red.

Verification is a DOM probe (`document.querySelector('meta[name=theme-color]')
.content`), never a screenshot: the Browser pane renders no browser chrome, so a
capture is the same picture whether the change works or not.
