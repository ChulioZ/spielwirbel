---
paths:
  - "public/styles.css"
  - "public/js/views-round-detail.js"
  - "public/js/core.js"
  - "public/js/round-designs.js"
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

## `--brand` ON a brand tint does not clear AA — reach for `--brand-dark` (#633)

The natural way to draw an accent chip is `background: var(--brand-tint); color:
var(--brand)`. Measured across all eight themes, that lands at **4.33–4.92:1** —
so four of the eight (Salbei 4.33, Standard 4.34, Sand 4.36, Pfirsich 4.38) sit
**below the 4.5 text bar**, while the other four pass. `--brand-dark` on the same
tint is 5.84–6.51 everywhere, for free.

(Those numbers were re-measured for #544's oklab switch; the ones here before it
read 4.28–4.96 / 5.80–6.57 and named a theme, "Sonnenuntergang", that this app
has never had — the failing accent is **Standard**. The conclusion is unchanged
in both cases, which is exactly why the wrong name survived: nobody re-derives a
number they agree with.)

Two things make this worth writing down rather than leaving to a measurement:

- **The failure is theme-dependent**, so whichever theme you happen to be looking
  at is a coin flip — the Chronik's milestone chip was verified on Standard,
  which is one of the *failing* four only because its accent is the warmest.
- **The bar that binds may not be the bar a reader assumes.** These glyphs are
  `aria-hidden` decoration whose meaning the adjacent label already carries, so
  1.4.11 (non-text, 3.0) is what actually applies and `var(--brand)` passes it.
  Pinning the *strict* bar anyway is the cheaper call: it costs one token swap
  and removes a judgement someone would otherwise have to re-derive.

`test/a11y-contrast.test.js` composites both tints over every theme accent and
pins the row wash (`--ink`/`--ink-soft`) and the chip glyph, keyed to the tokens
rather than to percentages a retune could raise past what was measured.

**Reuse the prepared tints rather than minting a mix.** `--brand-tint-soft` *is*
`color-mix(… var(--brand) 7%, var(--surface))` and `--brand-tint` the 13% one, so
a new tinted surface that spells its own `color-mix` resolves to a colour that
already had a name — and adds one more mix to keep in the right interpolation
space. **Every derivation in this app interpolates `in oklab`** (#544, enforced
by `test/design-tokens.test.js`); the percentage you copy from an sRGB-era
example will not mean what it meant there. See
`.claude/rules/color-mix-interpolation-space.md`.

Also note: the page backdrop (soft accent glow + paper grain) lives entirely in
the `body` rule in `styles.css`. There is no JS texture generation anymore —
`applyBackground()` sets/removes the two variables plus the browser chrome
(below) and the world hook (§ Worlds); a legacy `pattern` field in old data is
ignored.

## Worlds (#903): one hook, six slots, additive over the tokens

The registry is `public/js/round-designs.js` — `PALETTES`, `WORLDS` and
`resolveDesign(bg)`, which finds a design by its stable `id` first and by the
legacy page hex second (palettes only: a hex-only round predates worlds). The
stored shape is `{ type: 'theme', id, page, accent }`. `lib/routes/background.js`
NAMES `id` in its zod object because that object strips unknown keys, and stores
it without validating it against the list — an unknown id resolves to the plain
palette client-side, so the list is not a cross-boundary contract.

A world is the same two tokens plus ONE hook: `applyBackground()` sets
`<html data-world="…">` from the entry's `world` and clears it otherwise. Every
ornament rule keys off that attribute, in two halves at the end of `styles.css`:

- **one token block per world** (`[data-world="forest"]`) — its display face
  and its artwork, hand-authored SVG silhouettes as data URIs;
- **six slot rules keyed off the bare `[data-world]`** — page backdrop,
  primary-button frame, section-heading rule, card corner, empty-state scene,
  finale stage — each a pseudo-element with `pointer-events: none`, painting
  the mask in a THEME token (`--brand`, `--brand-dark`, `--stage-ink`), never
  in a shade of its own.

Three constraints, each with its reason: the face changes through
`--font-display` only (`--font` stays Nunito, so reading is never harmed);
`--surface` stays un-themed (`test/game-detail-hero.test.js` — a dark world is
#904's problem, not a token override here); and the preview card and the home
tile carry the attribute THEMSELVES, so the slots must read TOKENS — custom
properties inherit from the nearest element that sets them, which is what lets
a Sci-Fi card inside a Forest round preview Sci-Fi. A motif under text costs
contrast the plain-background harness cannot see (a stage tile at .16 put
`--stage-faint` at 2.27:1), so the bold scenes live in text-free bands.
`test/round-worlds.test.js` pins the hook, the token set, the pseudo-element
discipline, the two bands' geometry and the two media gates.

## The one themed colour that is NOT a CSS variable: the browser chrome (#523)

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
