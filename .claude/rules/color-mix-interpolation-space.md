---
paths:
  - "public/styles.css"
  - "public/kontakt.html"
  - "public/login.html"
  - "lib/faq.js"
  - "test/a11y-contrast.test.js"
  - "test/design-tokens.test.js"
---
# Every `color-mix()` is `in oklab` — and a mix toward black darkens ~1.3× HARDER there (#544)

The whole palette is derived by mixing (`--sunken*`, `--line`, `--brand-tint*`,
`--brand-edge`, `--placeholder`, the `--stage-*` family), so the interpolation
space is a design decision. All 49 mixes — 39 in `public/styles.css` plus the
token copies in `kontakt.html`, `login.html` and `lib/faq.js` — interpolate
`in oklab`, enforced by `test/design-tokens.test.js`.

## The direction is the opposite of the intuitive one

The issue that filed this predicted "mixes toward `#000`/`#fff` land **lighter**
in oklab". That is right for `#fff` and **backwards for `#000`**, which is the
half that matters, because that is where the app's neutrals come from.

Scaling a *gamma-encoded* channel by 0.95 is a smaller perceptual step than
scaling *perceptual lightness* by 0.95 — so at the same percentage, an oklab mix
toward black lands visibly darker:

| token | sRGB @ old % | oklab @ same % | ΔRGB |
|---|---|---|---|
| `--line` 9% | `#dedbd5` | `#d7d5ce` | 12 |
| `--placeholder` 24% | `#b9b7b2` | `#a9a7a2` | **28** |

Left alone, every border and sunken surface in the app would have quietly
deepened — a palette change wearing a derivation change's clothes.

**The conversion factor is ~0.77 and it is remarkably stable** (3%→2.3,
5%→3.8, 9%→6.8, 24%→18.5, and 18%→13.3 for `--brand-dark`). Residual after
re-tuning: 1–3/255. So for a mix toward pure black the two spaces produce *the
same colour family at a different rate* — re-tune the percentage and the palette
is preserved exactly.

Shipped: `--sunken` 5→4, `--sunken-soft` 3→2.5, `--line` 9→7, `--placeholder`
24→18.5, `--brand-dark` 18→13, `.score-pill--none` 10→8, `.chip.is-excluded`
70→78% danger.

## Mixes toward `#fff`/`--surface` keep their percentages — there the shift IS the fix

This is the half that justifies the migration at all. sRGB drags the **hue** with
a mix toward white; oklab does not (lerping toward `a=0, b=0` is hue-preserving
by construction). Measured drift from the base accent at `--brand-tint`'s 13%:

| theme | sRGB | oklab |
|---|---|---|
| Rose | **9.63°** | 0.10° |
| Lavendel | 6.39° | 0.61° |
| Salbei | 6.33° | 1.42° |
| Standard | 5.45° | 0.07° |

A token whose job is "this surface is tinted with the round's own accent" was
landing up to ~10° off that accent. Those mixes move only 1–4/255 in RGB, so the
correction is free.

## oklab, never oklch — and the reason is a property of THIS sheet

**Every mix here has at least one achromatic or near-achromatic endpoint**
(`#000`, `#fff`, `--surface`, `--page-bg`, `--ink`, `transparent`, the stage's
`#201a15` / `#f7f2e9`). None travels between two distinct hues, which is the only
case oklch is for. A neutral endpoint has no meaningful hue to interpolate
toward, so oklch would hold chroma up through a mix whose entire purpose is to
drop it — a "tinted grey" that is actually saturated. Revisit only if a genuinely
bi-chromatic mix is ever added.

## Two traps in the surrounding code

**1. The a11y test's arithmetic has to move with the sheet.**
`test/a11y-contrast.test.js` simulates the mixes in JS. A channel lerp left
behind would measure a colour the browser no longer paints — measured gap: **up
to 0.56 contrast points**, pessimistic here, but wrong, and nothing would say so.
The regexes there now require the literal `in oklab`, so reverting the space in
CSS reddens the test rather than silently desyncing the model.

**2. `composite()` in that same file is NOT a color-mix and must stay sRGB.**
It models *alpha compositing* — a translucent layer over an opaque one, which the
compositor does in the device space. The confusion is live because the token
feeding it (`--page-glow`) is itself written as a `color-mix`; that mix is with
`transparent`, which under premultiplied alpha resolves to "`--brand` at 7%
alpha" in **every** space, so the space switch leaves both its input and its
arithmetic alone.

## What this cost the finale stage, and what nothing was watching

The three tokens that dilute a light tone into the dark `--stage-bg` take the
same darker-per-percent hit, and there it costs **contrast**: unretuned,
`--stage-muted` fell 5.48→5.12 and `--stage-faint` 3.59→3.30. Both stayed on the
same side of their bar, so every existing check passed while the darkest text on
the darkest screen lost a fifth of its headroom. Percentages nudged (62→65,
45→48) and a stage test added.

**Pre-existing and NOT fixed here:** `.stage__note` is 12px/700 in
`--stage-faint` at ~3.58:1 — **below the 4.5 AA bar for normal text**, and it was
(3.59:1) before this change too. The test pins a 3.5 floor as a *non-regression
guard, not a pass*; fixing it means choosing a lighter tone, i.e. a design
decision about the finale.

## Verifying a change here

Model it in JS, then check the model against the engine — custom properties are
substitution-only, so `getPropertyValue('--line')` returns the unresolved
`color-mix()` text. Paint the token onto a probe element, read the computed
`oklab(...)`, and rasterize through a 1×1 canvas to get device sRGB. Measured
that way across 4 themes × 14 tokens, the JS model matched Chrome to **1/255**.

Clear the service worker first (`.claude/rules/pwa-service-worker.md`) or the
cache-first shell serves the old stylesheet and the change looks inert.

**Related:** `.claude/rules/theme-derived-colors.md` (what derives from what, and
the `--brand`-on-a-tint AA finding whose numbers this re-measured),
`.claude/rules/accessibility-contrast-and-modals.md` (the AA bars),
`.claude/rules/css-text-assertions-strip-comments.md` (why the guard test strips
comments — this file's own `:root` comment discusses the sRGB it replaced).
