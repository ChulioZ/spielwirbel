---
paths:
  - "public/styles.css"
  - "public/js/views-round-settings.js"
  - "public/js/core.js"
  - "public/js/round-theme.js"
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

- Neutrals from the page: `--sunken`, `--sunken-soft`, `--line`, `--placeholder`
  — mixes toward **`--shade`** (`#000` light, `#fff` dark, #904); never the literal.
- Accent surfaces: `--brand-strong` (was `--brand-dark` — "stronger" and "darker"
  parted ways once a design could be dark), `--brand-tint`, `--brand-tint-soft`,
  `--brand-edge`, `--page-glow`.
- Ink on a saturated FILL: **`--on-accent`** — white light, near-black dark; a
  bare `#fff` there is a bug on half the designs.
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

## `--brand` ON a brand tint does not clear AA — reach for `--brand-strong` (#633)

The natural way to draw an accent chip is `background: var(--brand-tint); color:
var(--brand)`. Measured across all eight themes, that lands at **4.33–4.92:1** —
so four of the eight (Salbei 4.33, Standard 4.34, Sand 4.36, Pfirsich 4.38) sit
**below the 4.5 text bar**, while the other four pass. `--brand-strong` on the same
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

## A NON-FLIPPING fill needs a non-flipping ink — `--gold-deep` is not it (#937)

Almost every token in `:root` has a dark-scheme twin, so "use the family's dark
member as the ink" is the reflex. For the three gold tokens that **deliberately
stand still** — `--gold`, `--gold-edge`, and now `--gold-ink` — that reflex is
wrong in a way no screen shows you.

`.stage__lock`, the padlock on the finale seal, is the app's **only** place where
`--gold` is a `background` rather than a `color`. It carried `#fff` at
**2.45:1**, under SC 1.4.11's 3:1 non-text bar, identically on light and dark
because the fill does not flip. Three candidate inks, measured:

| ink | on `--gold` | why it fails |
|---|---|---|
| `#fff` | **2.45:1** | what shipped |
| `var(--gold-deep)` | **2.90:1** light, **~1.5:1** dark | the obvious fix, and it is *just* under the bar — then flips to pale `#f0c25c` over a fill that stayed put |
| `var(--gold-edge)` | 1.30:1 | a mid-tone sibling of the fill |
| `--gold-ink` `#6b3405` | **4.05:1**, both schemes | hue 28, between `--gold-deep` (23) and `--gold` (42), at the same saturation |

**The rule:** when a fill is scheme-independent, its ink must be too — a new
non-flipping token, not the family's existing dark member. Then there is one
ratio to hold instead of two, and it cannot be broken from the other side.

**And measure the candidate, don't reason about it.** `--gold-deep` on `--gold`
*looks* like a comfortable dark-on-light pair; it is 2.90:1. Both are saturated
mid-tones, and relative luminance between two saturated colours is not something
the eye estimates well. `test/a11y-contrast.test.js` therefore reads **both
declarations out of the rule** and computes the pair per design, rather than
pinning today's hex — a spec that pinned `#6b3405` would be green against a later
switch to `--gold-deep`, which is precisely the change somebody will make.

Its second assertion is that every design produces the *same* ratio, which is
what makes one number sufficient. Both halves were taken red separately: the
first on `#fff`/`--gold-deep`/`--gold-edge`, the second on a pair that flips
while still clearing the bar (`--gold-deep` on `--gold-soft`, 6.37 vs 7.88).

**The second instance is the round MARKER (#1187), and it generalises the rule
past the gold family.** Every marker in `public/js/designs.js` is a dark,
saturated tone — Klassisch's eight are the palette accents, Der Tisch's are its
felts — and the round's colour is deliberately the same in every design, so the
fill does not flip. `--on-accent` was the reflex there too, and under Der Tisch
(a dark design, so near-black ink) it put the picker's check glyph at **2.81:1**
on Tannenfilz.

So a design declares `markerInk` (default `#ffffff`; Tisch states its package's
paper `#f6ecd8`), and it reaches the page as `--marker-ink` beside `--marker`
and `--marker-deep`. The transferable half: **"does this fill flip?" is the
question, not "is this token in the gold family?"** — any surface a design paints
identically in both schemes needs an ink chosen once, and
`.claude/rules/nan-passes-every-threshold-guard.md` records how nearly that
measurement was missed.

**The decorative exemption was considered and not taken.** The badge is
`aria-hidden` and the stage copy carries the meaning, so SC 1.4.11 arguably
exempts it — but the glyph is the thing that says „sealed", and because `--gold`
is a fill *here and nowhere else*, the fix moves no medal, crown or trophy. An
exemption is the right answer when the fix has blast radius; this one had none.

## Worlds (#903): one hook, ten slots, additive over the tokens

The registry is `public/js/round-designs.js` — `PALETTES`, `WORLDS` and
`resolveDesign(bg)`, which finds a design by its stable `id` first and by the
legacy page hex second (palettes only: a hex-only round predates worlds). The
stored shape is `{ type: 'theme', id, page, accent }`. `lib/routes/marker.js`
NAMES `id` in its zod object because that object strips unknown keys, and stores
it without validating it against the list — an unknown id resolves to the plain
palette client-side, so the list is not a cross-boundary contract.

A world is the same two tokens plus ONE hook: `applyBackground()` sets
`<html data-world="…">` from the entry's `world` and clears it otherwise. Every
ornament rule keys off that attribute, in two halves at the end of `styles.css`:

- **one token block per world** (`[data-world="forest"]`) — its display face
  and its artwork, hand-authored SVG silhouettes as data URIs;
- **nine slot rules keyed off the bare `[data-world]`** — page backdrop,
  primary-button frame, section-heading rule, card corner, empty-state scene,
  finale stage, (#940) the winner reveal's victory scene, (#1082) the
  **crown**: the stage art as a text-free strip above the round's name, on the
  hub hero and the desktop rail, and (#1083) the **floor** under the Pokale
  podium, and (#1086) the **vessel**
  behind the session pot's covers — each a
  pseudo-element with `pointer-events: none`, painting the mask in a THEME
  token (`--brand`, `--brand-strong`, `--stage-ink`), never in a shade of its
  own. Slot 7 is the one with text ON its host, so its bold alpha is bought
  with geometry rather than measured: the hero paints only in two side gutters
  and a bottom band, and the **host** reserves exactly those as padding
  through the **same** custom properties the masks are sized with, so the art
  and the reservation cannot drift apart. Since #1056 there are TWO hosts —
  the split screen's `.spotlight` card and the result screen's gold `.tafel-top`
  group — and the group declares a tighter `--victory-col` because it holds
  full-width rows rather than two small covers. It also re-shapes the confetti
  bits into the world's particles (fireflies, streaking stars) through tokens —
  the one real element a world touches, and the generator in `views-session.js`
  stays world-agnostic (`test/result-tafel.test.js` scans it for a world
  name).

  **Slot 10 (#1086) is the first slot whose host is rendered TWICE**, and it is
  the shape to check for before writing any new one: the session pot is a tile
  panel from 860px up and a scrolling strip below, each `display: none` at the
  other's widths, so the slot is two rules and the spec lists both. The panel
  reserves its band like slots 5/8/9; the strip cannot (the screen fills a
  390x844 phone exactly) and is text-free by geometry instead. The band's 84px
  cap is measured off the CTA, not chosen. Both traps —
  and why the issue's own single `.pool-shelf` selector painted nothing at
  desktop widths — are in
  `.claude/rules/ornament-slots-need-every-presentation.md`.

  **Slot 8 (#1082) takes slot 7's reservation discipline to a second place, and
  needs it for the same reason.** The crown is painted at
  `height: var(--crown-h)` and its host reserves
  `padding-top: calc(var(--crown-h) + N)` — ONE property carrying both. Two
  literals that must agree drift on the first retune and the failure is silent
  in both directions: too little padding clips the art, too much leaves an empty
  band above the round's name, and nothing goes red.

  Its own wrinkle is that the art is a 600x140 SCENE cropped to a <=96px strip,
  so which edge survives is per world: `--world-crown-y` is `top` where the
  motif hangs (canopy, waves, webs) and `bottom` where it stands (skyline, rank,
  horizon). A fixed edge would show half the worlds the empty part of their own
  artwork — and it would look deliberate.

  The rail's copy is gated on `min-height: 860px` as well as the rail's own
  width (operator decision): the rail measures 746px tall under the demo banner
  and its last group sits at y 860–899, so at 1280x800 a 48px crown pushes it
  past the fold. The hero's is unconditional, because the hub scrolls.

  And under `prefers-contrast: more` the RESERVATION goes with the art — a
  hidden crown over an unchanged `padding-top` is the empty band again. Same for
  the coverless tile, which gets its tornado back rather than nothing at all.

  **Slot 9 (#1083) is the third reservation, and it adds two wrinkles.** The
  podium's floor re-uses slot 7's victory band under the pedestals, which is free
  artwork — but a world may carry its ground line on EITHER victory layer
  (Sci-Fi's `--world-victory-band` is `none`; its pad and starfield are on the
  `-2` layer), so the floor lists both masks or one world of six gets a bare
  podium and nothing says so. And its `--podium-band` must be an absolute LENGTH,
  not slot 5's capped percentage: a percentage resolves against the containing
  block's WIDTH in `padding-bottom` and against the element's own HEIGHT in
  `mask-size`, so one property would silently mean two different bands. The same
  band reaches the shareable recap card, where the card GROWS by it rather than
  fitting it in — the canvas's wordmark and frame corner anchor on that foot, so
  the band stays text-free by construction.

Three constraints, each with its reason: the face changes through
`--font-display` only (`--font` stays Nunito, so reading is never harmed);
`--surface` is set by the two token blocks and nowhere else (#904 —
`test/game-detail-hero.test.js` pins *where*, not *what*); and the preview card and the home
tile carry the attribute THEMSELVES, so the slots must read TOKENS — custom
properties inherit from the nearest element that sets them, which is what lets
a Sci-Fi card inside a Forest round preview Sci-Fi. Since #1085 the picker's
world card also RENDERS slot 8's art, as a real `<span>` rather than a
pseudo-element — its own `::before` is already the backdrop — so the card is
judged as the crown the round will wear; the pseudo-element discipline above
binds the SLOTS, not everything a world paints. A motif under text costs
contrast the plain-background harness cannot see (a stage tile at .16 put
`--stage-faint` at 2.27:1), so the bold scenes live in text-free bands.
`test/round-worlds.test.js` pins the hook, the token set, the pseudo-element
discipline, the two bands' geometry and the two media gates. **Sci-Fi is dark
since #904** and a world may declare `scheme: 'dark'` like any palette; the
ornaments need no change, because every slot paints in a theme token. The dark
half is `.claude/rules/dark-designs-and-the-on-accent-flip.md`. Two traps in
authoring a world's artwork — a mask reads alpha, so white is not a cutout, and
a single-weight face needs a `font-weight` range — are
`.claude/rules/world-artwork-masks-and-single-weight-faces.md` (#905).
**A slot's ALPHA is not portable between a light world and a dark one** — one
number over both buys a third of the step on the dark side, and the wash still
passes every contrast bar while being invisible:
`.claude/rules/alpha-washes-are-not-comparable-across-schemes.md` (#1138), which
also has why a `var()` fallback's real consumer may not be the host you expect.

## The browser chrome is themed too, and it is NOT a CSS variable

`<meta name="theme-color">` is an HTML attribute, so no amount of `color-mix()`
reaches it — `applyBackground()` writes it directly. Adding a themed surface?
Check whether it lives outside the stylesheet before reaching for a variable.
The reasoning (why it follows the ACCENT rather than the page, and the two
constraints on changing it) is `.claude/rules/theme-color-meta-tag.md`.
