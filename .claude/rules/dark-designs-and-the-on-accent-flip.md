---
paths:
  - "public/styles.css"
  - "public/js/designs.js"
  - "public/js/design.js"
  - "public/js/core.js"
  - "public/js/round-theme.js"
  - "public/js/design-picker.js"
  - "public/js/recap-card.js"
  - "test/a11y-contrast.test.js"
  - "test/support/theme.js"
---
# A dark design flips the INK on every fill — and two of those inks are resolved in JS

A design may be dark since #904 — first a ROUND's, and since the flip (#1202),
which retired round designs, an ACCOUNT's: `scheme: 'dark'` in `designs.js`,
`<html data-scheme="dark">` from `paintDesign()` (called by `applyDesign()`), and
one token block in `styles.css` plus the design's own scheme-gated block
(`.claude/rules/design-colour-blocks-are-scheme-gated.md`). Der Tisch — the face,
and what every account wears until it chooses — is dark. The colour work is mechanical. The four things that are not
obvious cost real effort, and each is silent.

## 1. The accent must be LIGHT, so white-on-accent stops working

A design's accent is `--brand`, and `--brand` is **text**: every `.link-btn`
paints with it straight on the page. On a dark page that forces the accent
light — and white ink on a light accent is unreadable. The two are the same
fact, so they have to move together, which is what `--on-accent` is for.

That constraint is not negotiable by picking a darker accent. An accent that
clears 4.5:1 under white needs luminance ≤ 0.183; clearing 4.5:1 *on* a page of
luminance `Lp` needs ≥ `4.5(Lp + 0.05) − 0.05`. Both hold only for `Lp ≤
0.0019`, i.e. a page within a hair of `#000000`. So on any usable dark page the
ink on a saturated fill **must** flip.

`--on-accent` therefore replaced 20 literal `#fff`s — every accent button, chip,
avatar, rating pill and semantic fill. `test/a11y-contrast.test.js` measures it
on each of those fills for every design; the whites that legitimately stayed are
an exhaustive, self-checking `WHITE_EXEMPT` list there.

## 2. Two tones are resolved in JS, so a design change must REDRAW

`memberTone()` (the palette lift) and `avgColor()` (the rating ramp) read the
scheme off the document **at render time** and emit an inline colour. Everything
else follows the tokens, so before #904 changing a design was pure CSS and
nothing needed re-rendering.

It does now, and the failure lands on the screen where a design changes: when
rounds picked designs, choosing a dark one left the design screen's own rail
avatars painted with light-scheme discs while `--on-accent` had already gone
near-black — dark initials on a dark disc, unreadable, with no error anywhere.
Measured in a browser; no test saw it, because every test rendered *after* the
scheme was set.

So a design change re-renders the screen: `applyDesign()` calls `currentView()`
on a committed change (#1266), and the Konto picker re-renders its own screen
(`public/js/design-picker.js`). The marker picker has the sibling trap one
layer over: `fetchRound()` serves the cached round, which still holds the OLD
marker, so it seeds the SWR cache before re-rendering
(`public/js/views-round-settings.js` `showMarker`).

The general rule: **anything that resolves a theme value in JS turns a design
change into a re-render.** Prefer a token; when a token cannot do it (an HSL ramp
cannot be computed in CSS), make the redraw part of the change that flips the
scheme.

## 3. `getComputedStyle().getPropertyValue('--x')` is unresolved — and `--surface` is now a mix

Custom properties are substitution-only, so reading one back gives you its
**text**. That was harmless while every token this app reads from JS was a plain
hex; a dark design makes `--surface` a `color-mix()`, and `recap-card.js` reads
it to paint the shared card on a canvas. Canvas treats an unparseable
`fillStyle` as "keep the previous colour", so the card would have painted a white
panel on a night-blue background with nothing to say so.

Two moves, both worth reusing:

- **Resolve through an element.** Paint `color: var(--surface)` on a throwaway
  span, read `getComputedStyle(probe).color`.
- **Ask the canvas whether it parsed, with two sentinels.** Assign `#000000`,
  then the value; assign `#ffffff`, then the value. If it parsed, both land on
  it and agree; if not, each sentinel survives and they differ. Exact where a
  `/^#|^rgb/` regex is a guess, and it hands back a normalized `#rrggbb`.

## 4. The dark page EXPOSES latent light-page bugs — sweep the rendered app

Three defects turned up that a static read of the sheet cannot see, and two of
them were failing on light designs the whole time:

- **A `<button>` does not inherit `color`.** The UA gives it `buttontext`, which
  is ~black — indistinguishable from `--ink` on a light page. Four rules had
  `font: inherit` with no `color`, and the account menu rendered black on a dark
  surface at 1.40:1. `font: inherit` is the tell, and `test/a11y-contrast.test.js`
  now pins it.
- **`--placeholder` was painting real text.** It is a fallback GLYPH tone — then
  18.5% off the page, 45% since #938 (53% on dark since #1140); `.result-people__label` measured **1.07:1
  on a light design** and 1.58 on dark, i.e. the dark scheme made it *better*.
- **A minted mix instead of a prepared one.** `.score-pill--none` spelled its own
  8% tone and put `--ink-soft` at 4.15:1 on the default design; `--sunken` (4%)
  is the pair the harness already measures.

The instrument for all three is a **contrast sweep over the rendered page** in a
dark round: walk every element with text or an icon, resolve its computed colour
and its effective background **through a canvas** (a computed `color-mix` comes
back as `oklab(…)`, and a regex over that string silently reads the L/a/b numbers
as RGB — it reported a passing avatar at 1.18:1), and compare against 4.5 / 3.
Nothing in jsdom can run it, so it stays a browser step rather than a spec.

Two hits were decorative and deliberately left: the gold seal's white lock glyph
(2.45:1, still open as #937) and the empty-cover placeholder glyph. Both are
`aria-hidden`, so neither was this change's to make.

**The placeholder figures recorded here were wrong, and #938 inherited them.**
This paragraph read "1.48 dark / 1.05 light" and concluded the dark scheme fared
better. The real pair, resolved through `test/support/theme.js` below rather than
sampled off the page, is **1.58:1 light / 1.44–1.47:1 dark** — the light case is
the better one — and the 1.05 does not correspond to any token pair on Standard.
The cause is that a rendered-page sweep reads *whatever is painted*, and on a
coverless game box that is `.cover-ph`'s gradient, not `--placeholder` at all:
`.claude/rules/cover-ph-owns-the-coverless-game-glyph.md`. Prefer the resolver
for any claim about a token; keep the page sweep for finding *which* elements to
look at. (#938 took the token to 45% and pinned it with a spec — a
token-PAIR check is perfectly expressible without jsdom; only the page walk is
not.)

## What the harness had to become

`test/support/theme.js` resolves a token **for a design**: it reads the real
declarations out of `styles.css`, takes the dark block's value when the design is
dark, substitutes `var()` recursively and evaluates `color-mix(in oklab, …)`.
Nothing restates a percentage. That matters because the old shape — one regex
over `:root` — would have kept measuring the light `--ink` over a dark page and
kept passing, which is this repo's worst failure mode
(`.claude/rules/break-the-code-on-purpose.md`).

`scheme` is **declared**, not measured off the page, so the registry stays the
single statement of what a design is — and the spec pins the two to each other,
because a dark page that forgot the flag renders dark ink on a dark background
everywhere at once.

**The NEUTRAL ramp had the same split and it was missed here** — this file
covers the ink on a saturated fill, while `--line`/`--sunken`/`--sunken-soft`
collapsed into `--surface` on every dark design until #1140:
`.claude/rules/dark-scheme-neutral-ramp-runs-upward.md`.

**Related:** `.claude/rules/theme-derived-colors.md` (what derives from what),
`.claude/rules/color-mix-interpolation-space.md` (`--shade`, and why the
percentages transfer between directions),
`.claude/rules/accessibility-contrast-and-modals.md` §1 (the bar, which is now
per design rather than one darkest page),
`.claude/rules/shared-constants-across-the-stack.md` (why the member palette is
lifted at render time instead of being forked).
