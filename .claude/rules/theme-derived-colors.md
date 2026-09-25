---
paths:
  - "public/styles.css"
  - "public/js/views-round-settings.js"
  - "public/js/core.js"
  - "public/js/round-theme.js"
  - "public/js/designs.js"
  - "public/index.html"
---
# Derive UI colors from the theme variables, don't hardcode them

Each account wears a design (page background + accent, `public/js/designs.js`);
until the flip (#1202) each ROUND picked one. The whole UI must follow it, so
`styles.css` derives every tone from two custom properties that `paintDesign()`
(`public/js/round-theme.js`) sets: `--page-bg` and `--brand`.

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
placeholder icons, amber pastels). On the cool round palettes of the time
(Blaugrau, Schiefer, Lavendel) they clashed badly — three colour worlds on one
screen. The fix was exactly this
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
`paintDesign()` sets/removes the two variables plus the browser chrome (below);
a legacy `pattern` field in old data is ignored.

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

## The round worlds are retired (#1202) — two of their constraints outlive them

Rounds could wear seven worlds (#903–#905, #1084): a display face and SVG
ornaments on ten pseudo-element slots, keyed off `<html data-world>`. The flip
removed them with the palettes; a round that wore one now shows the colour
marker its world maps to (`public/js/round-marker.js`). What still binds every
user design that paints something of its own:

- **The face changes through `--font-display` only** — `--font` (body text)
  stays Nunito, so reading is never harmed; and **`--surface` is declared by the
  two token blocks and a design's own resolved root block, nowhere else**
  (`test/game-detail-hero.test.js` pins *where*, not *what*).
- **Artwork paints in a theme TOKEN, never a shade of its own, and a motif under
  text costs contrast the plain-background harness cannot see** — so bold art
  lives in text-free bands, and an alpha tuned on a light design is not portable
  to a dark one (`.claude/rules/alpha-washes-are-not-comparable-across-schemes.md`).
  Authoring traps (a mask reads alpha; a single-weight face needs a weight range):
  `.claude/rules/single-weight-display-faces.md`. A slot rendered in two
  presentations needs a rule for each:
  `.claude/rules/ornament-slots-need-every-presentation.md`.

## The browser chrome is themed too, and it is NOT a CSS variable

`<meta name="theme-color">` is an HTML attribute, so no amount of `color-mix()`
reaches it — `paintDesign()` writes it directly. Adding a themed surface?
Check whether it lives outside the stylesheet before reaching for a variable.
The reasoning (why it follows the ACCENT rather than the page, and the two
constraints on changing it) is `.claude/rules/theme-color-meta-tag.md`.
