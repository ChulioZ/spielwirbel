---
paths:
  - "public/styles.css"
  - "test/a11y-contrast.test.js"
  - "test/round-worlds.test.js"
  - "test/support/theme.js"
---

# One alpha over a light page and a dark page are not the same wash — and oklab will tell you they are

Slot 1, the world page backdrop, painted `--brand` at a flat `opacity: .09` for
all seven worlds. The number was picked on a light page and reused on the dark
ones, where it bought roughly **a third** of the step — Burg's motif was
effectively invisible while its own contrast ceiling was `.335`, i.e. it was
being held to a number nearly four times stricter than its budget for no reason
anybody had chosen (#1138).

Nothing could see it. The alpha satisfied every contrast bar — it is far too
*faint* to endanger text, and a contrast test only ever asks the other question.

## Why the dark end swallows it

Alpha compositing is linear in the device space, so the same `.09` moves the
pixel by the same fraction of the distance to the accent on either page. What
differs is how much of that the eye gets: a display in a lit room adds veiling
glare, so differences near black are washed out. APCA models this with a soft
clamp on the darker term; WCAG's ratio has the `+0.05` flare constant doing a
crude version of the same job.

**Measure a decorative wash's step in APCA, not in oklab.** This is the part
that costs an afternoon, because the two instruments disagree in opposite
directions and oklab is the one this repo otherwise derives in
(`.claude/rules/color-mix-interpolation-space.md`):

| instrument | what it said about `.09` on the three dark worlds |
|---|---|
| oklab ΔL | dark worlds step **further** than the light ones (.054–.072 vs ~.043) — nothing to fix |
| APCA Lc | dark worlds at **2.4** against the light worlds' **8.4** — under a third |

Oklab's cube root is a colour-appearance model calibrated on reflective samples
under controlled viewing; it has no flare term at all, so it cannot answer "can
you see this on a phone in a lit room". Trust it for *deriving* a colour and
APCA for *whether a wash reads*. Believing oklab here would have closed the
issue as unreproducible, with a screenshot from the operator saying otherwise.

Watch APCA's own floor while you are at it: the published formula clamps a
result under `Lc 10` to **0**, so three of the four light worlds also read
"0.00" and look identical to the broken ones. Compare the **unclamped**
magnitude when you are ranking steps this small, or the instrument hides the
control you are measuring against.

## The fix shape: a per-world token, and no shared ceiling left behind

Give the wash a token each host declares (`--world-backdrop-alpha`) and let the
guard measure the **real** bar per world — `--ink` AAA, `--ink-soft` AA over the
densest pixel — instead of pinning one number. The flat `.1` ceiling the test
used to assert was standing in for that measurement and stood in badly: it sat
near the ceiling on a light page (dinos' is `.090`) and at a third of it on a
dark one, so it over-constrained exactly the worlds it was hiding a bug in, and
said nothing while doing it.

## A `var(--x, <literal>)` fallback belongs to whoever does NOT override it

The same change nearly shipped a second bug, and it is worth its own paragraph
because the misreading is so natural.

`:is(.theme-card, .round-card)[data-world]::before` declares
`opacity: var(--motif-a, .16)`, and `.theme-card--world` overrides `--motif-a`.
Reading that, the literal looks like "the theme card's value, which the poster
tunes". It is the opposite: **every** world card in the picker is a poster
(`posters: true` is set for the WELTEN group, which *is* the world registry), so
the override is total and the literal is reached by exactly one host — the
`.round-card` tile on **home**.

That matters because the two hosts have unrelated grounds. The poster carries
its world's own page inline and its bar is the accent *name* painted on the
accent *wash*. The home tile sits on the lobby, which carries no ROUND design — home calls
`applyBackground(null)`, and #904's dark block is scoped to `:root` and
`.theme-card` precisely so a dark round's tile does not turn dark — so its
ground is the standard `--surface` and its bar is `--ink-soft` body text.

**Since #1184 that last step holds only while no dark USER design is enabled.**
`applyBackground(null)` now means "fall back to the user's design" rather than
"clear to the `:root` defaults", so a dark one puts `data-scheme="dark"` on
`<html>` and the lobby's `--surface` goes dark with it — a different ground for
the same literal. Nothing ships yet (`enabled: false`), and
`test/a11y-contrast.test.js` carries a named tripwire that fails the moment one
is enabled. Re-derive the `.150` before citing it under a dark design.
Deriving the fallback from the backdrop alpha, which is what the issue asked
for, would have put a `.42` wash under that body text.

**So before changing a `var()` fallback, find out which hosts actually reach
it** — grep for every rule that sets the property, and check whether the
override is conditional or total. The measured bar for the home tile is `.150`
(Chess, light lobby); it had shipped at `.16` since #1082, i.e. at 4.44:1 against
a 4.5 bar, on a *light* world rather than one of the dark ones the issue was
about. It is `.14` now, the same landing value and the same reasoning as the
dock's motif in `.claude/rules/accessibility-contrast-and-modals.md`'s
neighbourhood.

## A mask fade on a `position: fixed` layer never scrolls

Third trap, same slot, and the one no alpha retune would have fixed. Slot 1 is
`position: fixed; inset: 0`, and its fade is a **mask**, so the mask's own alpha
multiplies the layer's:

```css
--world-backdrop-fade: linear-gradient(transparent 0%, #000 100vh);   /* before */
--world-backdrop-fade: linear-gradient(rgb(0 0 0 / .55) 0%, #000 100vh);
```

Because the layer does not scroll, **stop 0% is the top of the viewport on every
screen, forever** — not the top of the document. A `transparent` stop there means
the motif is absent precisely where the eye lands first, at every scroll
position, whatever the alpha says; zero times anything is zero. Five of the
seven worlds had it, including three whose alpha was never in question, so the
symptom ("faint near the floor, nothing at the top") reads as an alpha problem
and is not one.

A floor on a *rising* fade is contrast-free by construction: it only raises the
mask toward the full alpha, which is already the measured-safe value. So the
guard is mechanism-based — detect a gradient that rises, require a non-zero
first stop — rather than naming the worlds, which is what makes a future world
covered for free (`.claude/rules/ci-aggregate-gate.md` on allowlists over
denylists).

**Related:** `.claude/rules/dark-scheme-neutral-ramp-runs-upward.md` (the
sibling: a *derived* neutral mixed at the light percentage lands somewhere else
on dark — that one moves, this one arrives where you asked and still cannot be
seen), `.claude/rules/theme-derived-colors.md` § Worlds (the slot contract),
`.claude/rules/color-mix-interpolation-space.md` (where oklab *is* the right
space), `.claude/rules/browser-pane-is-chromium-only.md` (this was verified in
the pane only — nothing here is engine-dependent).
