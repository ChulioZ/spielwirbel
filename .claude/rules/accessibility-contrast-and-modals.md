---
paths:
  - "public/styles.css"
  - "public/js/**"
  - "test/a11y-contrast.test.js"
  - "test/focus-trap.test.js"
---
# A11y (#145): measure contrast against the PAGE, and every sheet needs a focus trap

The #145 audit's findings cluster into traps that produce no error, no failing
test, and no visibly broken screen — easy to reintroduce.

## 1. A colour is not "accessible on white" — check it on EACH design, both ways

Cards are `--surface`, but bare `.link-btn`s (breadcrumbs, "Session löschen")
paint straight onto `--page-bg`, a **round-chosen design**. Measuring against
`#fff` alone passed three colours (`--good`, `--warn`, `--danger`) that were
below AA on the darkest page (#145).

**Rule:** any colour used as text gets measured against **both** `--surface`
and `--page-bg` — **resolved for the design under test**.
`test/a11y-contrast.test.js` does exactly this and requires the registry
(`public/js/round-designs.js` — palettes AND worlds), so a newly added design is
checked automatically.

**"The darkest theme page" stopped being one hex in #904.** A design may declare
`scheme: 'dark'`, which replaces `--surface`, `--ink`, `--ink-soft` and all three
semantics, and inverts the ink on every saturated fill (`--on-accent`). So the
harness resolves tokens **per design** through `test/support/theme.js` instead
of lifting them out of `:root`, and it asserts the registry ships designs in
both directions — otherwise every "for each design" loop in it is vacuous. The
whole dark half is `.claude/rules/dark-designs-and-the-on-accent-flip.md`.

- **The accent is text, not just a fill.** Every design's `accent` becomes
  `--brand`, which paints every `.link-btn` — so an accent must clear 4.5:1
  **on its own page** (Sand and Pfirsich sat at 3.8:1 and put every link in
  the app below AA; both were darkened).
- **Correcting a theme needs no migration — resolve at RENDER time.** A round
  stores a palette *snapshot*, so `resolveAccent(bg)` in `core.js` looks the
  accent up by `page` on every render; existing rounds self-correct on next
  draw. Both `applyBackground` and `themeAccent` go through it. (Same
  render-time reasoning as `provider-cover-sizing.md`; keeps the repo free of
  migration code.)
- **`avgColor()` is used in BOTH directions** — fill under `--on-accent` text
  (`.score-pill`) *and* text/stroke on the page (`.gd-ring__num`). Its
  lightness is **30%** for every value at or above 1: the lightest value
  clearing 4.5:1 under white across the whole hue range while the ring still
  clears 3:1 (large text) on every light design. Don't lighten it without
  re-checking both uses. **On a dark design it is 66%** (#904) — the mirror of
  the same two constraints, since both uses invert together: the ring is 2.6:1
  at 30% on a dark page, and the pill's ink is near-black there. Hue and
  saturation are identical in both directions, so a 2 is the same orange-red
  whichever design the round picked. **Below 1 it steps AWAY from the ink**, to
  20% on a light design and 76% on a dark one (#890) — the hue formula is clamped
  there, so the retirement end of the scale would otherwise be the same red as a
  1, which the results distribution paints side by side. That direction can only
  add contrast for both uses, and the ramp is a provable no-op at and above 1,
  which is what bounds it. `test/a11y-contrast.test.js` now
  evaluates the real `avgColor` under jsdom and sweeps from 0 — it used to lift
  one fixed lightness out of the source with a regex, which cannot read an
  expression and left the whole 0–1 range unmeasured.
  Since #893 most callers arrive through **`scoreColor()`**, which clamps the
  Spielwirbel-Score into 0–5 and then calls this — so the hue range, and every
  contrast figure above, is unchanged by construction. That clamp is load-bearing
  for contrast and not merely for looks: the score can go negative, and an
  unclamped value would drive the hue formula below its floor. Keep `avgColor`
  for anything on the tile scale (the vote card's selected tile) and
  `scoreColor` for anything on the score scale.
- **Hex rounding eats the last hundredth.** Scaling RGB toward black and
  rounding to 8-bit hex landed colours at 4.48–4.49:1 — just under. Aim at
  ~4.52 and assert on the rounded hex (the test does; it caught this).

## 2. `aria-modal` constrains screen readers, NOT the keyboard

All five sheets were `role="dialog" aria-modal="true"` and still let Tab walk
out into the page behind the backdrop, and closing one dropped focus to
`<body>`. `public/js/focus-trap.js` fixes both, and **every sheet must go
through `openSheet(backdrop, onKey)`** (`views-round-detail.js`) rather than
assigning `activeSheet` directly — that makes it impossible to add a sheet
that silently misses the trap. Two orderings are load-bearing:

- **Install the trap before moving focus into the sheet** — `trapFocus`
  captures `document.activeElement` as the restore target, so focusing first
  would "restore" focus to the sheet's own input.
- **Release AFTER removing the sheet** — restoring focus to the opener while
  the dialog is still attached gets undone a moment later.

`openSheet` is now the choke point for a **second** thing a hand-rolled dialog
has to do and a native `<dialog>` gets free: freezing the page behind it, so a
drag on the backdrop doesn't scroll the screen away underneath the sheet (#622,
`.claude/rules/overlay-page-lock.md`). Same reasoning as the trap — routing every
sheet through one function is what makes it impossible to add one that misses.

## 3. State conveyed by colour alone

The seat picker, rating buttons and hub tabs signalled state with a class +
colour only (`paintTagChip` had already solved this — the pattern just wasn't
applied to newer controls). Toggles get `aria-pressed`, the current tab
`aria-current="page"`.

## 4. A live region must already be in the tree

`toast()` is the main channel for confirmations *and* errors. `role="status"`
alone is not enough: a live region inserted — or un-`hidden` — **with its text
already in place is never announced**. The toast element stays permanently in
the tree; visibility is a **class** (`.toast.is-on`), never the `hidden`
attribute, and `toast()` clears the text on hide so re-showing the same
message is still a reported mutation.

**There is a second live region since #584** — the add-game duplicate-title hint
`#dupHint` (`showAddGame`, `views-round-lookup.js`). It shipped in #524 toggled
with `hidden` *and* assigned its text in the same statement, i.e. the exact shape
above, so it was silent for a year's worth of releases while looking finished.
Adding `aria-live` to it as it stood would have changed nothing audible.

Two things to carry to a third one:

- **`display: none` also removes the element from the tree**, so "visibility is a
  class" is not on its own the fix — `.toast`'s own class *is* a display toggle,
  which is in tension with the "stays permanently in the tree" reason given
  above. `#dupHint` is therefore rendered at all times and its **empty state is
  the hidden state**; `.is-on` carries only spacing. Prefer that shape.
- **An always-rendered empty hint must cost no layout space**, or the sheet gains
  a permanent gap. `#dupHint` gets that free today from margin collapsing (zero
  height, last child of `.field`), which is an accident worth knowing rather than
  relying on — see the comment on `.field__hint--dup` in `styles.css`.

## Things that are fine — don't "fix" them

- **Focus rings.** Nothing removes them globally; the two `outline: none`
  rules (`.search-pill input`, `.paste-zone`) both provide a replacement.
  Note `el.focus()` from a script does **not** set `:focus-visible` in Chrome
  — probe with a real Tab keypress or you'll "find" a bug that isn't there.
- **The remaining small targets** (`.round-footer .link-btn`, `.tl-act__del`)
  pass WCAG 2.2 SC 2.5.8 via the spacing exception (33.5px between centres >
  the required 24px). Left alone deliberately.
- **`<html lang>`** is set dynamically by `i18n.js`; the static `lang="en"` is
  only the pre-boot value.

## Auditing this app again

Drive it against a generated dataset in a temp `DATA_DIR`, never the real
`data/` (`no-reading-production-data.md`) — use the committed `dev-temp-data`
launch config (`preview_start {name: "dev-temp-data"}`), not `production-data`. The
Browser pane can report `innerWidth === 0`/`innerHeight === 0` after
navigations, making every element measure `width: 0` — that's the pane
artifact family in `preview-pane-paint-artifacts.md`; `resize_window` to a
real size and re-probe before believing a regression. And clear the service
worker after every CSS edit (snippet in `pwa-service-worker.md`, "Verifying a
shell-asset change") or the cache-first shell serves the old `styles.css` and
your fix looks inert.
