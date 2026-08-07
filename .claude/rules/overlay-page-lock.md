---
paths:
  - "public/js/page-lock.js"
  - "public/js/views-round-detail.js"
  - "public/js/core.js"
  - "public/styles.css"
---

# An open overlay must freeze the page — in TWO independent places (#622)

Nothing locked the page while a sheet was up, so the screen behind it moved and
dismissing the sheet dropped the user somewhere else. There are **two separate
paths** to that, and closing either one alone leaves the bug fully reproducible:

- **The exposed backdrop.** `.sheet-backdrop` is `position: fixed; inset: 0` but
  is *not* a scroll container, and `.sheet` can never fill it — so there is
  always bare backdrop. A drag there goes straight to the document. Closed in
  JS: `lockPage()` in `openSheet`.

  **The premise held by a much bigger margin when this was written**, and the
  conclusion survives the change that shrank it. `.sheet` was capped at
  `min(85vh, 660px)`; #678 replaced that with `max(280px, min(85dvh, 100%))`
  (and `max(280px, 100%)` from 640px up) because the absolute term stopped the
  sheet growing on any normal desktop window. The gutter is now the backdrop's
  own `padding: 24px` rather than several hundred px of dead space — still bare
  backdrop on all four sides, so the lock is still required, and the drag guard
  in §4 is what keeps that thinner margin from becoming a dismissal hazard.
- **Scroll chaining.** Every bounded scroll box hands the gesture on once it hits
  its own edge. Closed in CSS: `overscroll-behavior: contain`.

The admin panel never had this bug — `public/js/pages/admin.js` uses a native
`<dialog>` + `showModal()`, which the browser scroll-locks for free. The SPA's
sheets are hand-rolled (own focus trap #145, own history marker #333), so they
get none of it.

## 1. `overflow: hidden` is not the lock — and the lock has to carry the offset

`body { overflow: hidden }` does not stop iOS Safari scrolling the document
behind it. `page-lock.js` uses `position: fixed` + `top: -scrollY`, which works
everywhere but has a consequence: taking the body out of flow **destroys the
scroll offset**, so `unlockPage()` must `window.scrollTo(0, y)` it back. Miss
that and every sheet dismissal returns the user to the top of the page.

Order matters — restore the styles *first*, then scroll. The document is not
scrollable until the body is back in flow, so a `scrollTo` before that silently
does nothing.

## 2. The lock must SURVIVE the openSheet replace

`openSheet` tears down an already-open sheet by calling `teardownSheet()`
(`.claude/rules/sheet-history-back-dismissal.md` §2). The naive lock/unlock pair
therefore unlocks, restores the scroll, and re-locks on every sheet-over-sheet
open — a visible jump. Hence `teardownSheet({ keepLock: true })` at that one call
site, and nowhere else. Every *other* exit from the sheet layer — ×, Escape,
backdrop tap, a successful submit, and Back via `handleSheetPop()` — funnels
through `teardownSheet` too, which is why the unlock lives there rather than in
`closeSheet`.

`lockPage()` is idempotent for the same reason. Both halves are needed: without
`keepLock` the offset is restored mid-replace, without idempotence the second
`lockPage()` would freeze at the wrong `y`.

## 3. Do NOT lock the page under a popover

`openPopover` (`core.js`) deliberately tears itself down on a window `scroll`,
and that teardown is what keeps an anchored popover from drifting off its anchor
(`.claude/rules/anchored-popover-is-placed-once.md`,
`.claude/rules/popover-vs-sheet-editors.md` §1). It gets containment on its inner
scroll box only, never a page lock, and its `scroll`/`resize` listeners stay
exactly as they are.

Note the containment *helps* it: scrolling `.cover-picker__grid` to its last row
used to chain to the page, and a page scroll closes a popover — so reaching the
end of the edition list dismissed the picker outright.

## 4. Locking the page turns a swipe into a tap

Every sheet dismisses on a `mousedown` whose target is the backdrop. That was
safe only because the gesture *scrolled*: a browser resolving a drag as a scroll
synthesises no mouse events at all. Remove the scroll and the same swipe can come
back as a tap and dismiss a sheet holding unsaved input.

`guardDragDismiss(el)` measures `pointerdown` → `pointerup` and swallows the
following `mousedown` past a 10px slop. Two properties are load-bearing:

- **Capture phase, on the backdrop itself.** A capture listener on the *target
  element* runs before that element's bubble listeners regardless of registration
  order, and `stopPropagation()` from it suppresses them — verified in jsdom and
  in Chrome. That is what lets one guard cover all ten sheets without touching a
  single call site.
- **Pointer events, not touch events.** `pointerdown` precedes `mousedown` for a
  mouse, while for touch the compatibility `mousedown` arrives only after
  `pointerup` — so one lifecycle covers both input kinds and the flag is set at
  most one `mousedown` ahead.

## 5. Which scroll boxes get containment is a decision, not a sweep

`.sheet`, `.lookup__menu` and `.cover-picker__grid` are contained.
`.setup-panel__body` is **not**: it sits inline on the page, and containing it
traps the user in a 420px box on a normal screen. `test/overlay-page-lock.test.js`
asserts the *complete* classification — a new `overflow-y: auto` rule fails it
until someone puts it in one list or the other, which is exactly the question
nobody asked for the three overlay boxes.

Note the issue that filed this named two of them wrongly (`.cover-grid`,
`.cover-pick`); the real classes are `.cover-picker__grid` and
`.setup-panel__body`. Grep `overflow-y` rather than trusting a name.

## Verifying a change here

The Browser pane is the wrong instrument for the *gesture*, and partly wrong for
the geometry: it reports `innerWidth === 0` (`resize_window` does not clear it,
confirmed again on #622), so the scrollbar-gutter compensation and every rect are
unmeasurable there. What it answers honestly:

- `getComputedStyle(document.body).position` / `.top` while a sheet is open, and
  `window.scrollY` before / during / after — a `scrollBy` while locked must leave
  it unchanged.
- `getComputedStyle(el).overscrollBehavior` on a probe element per class, which
  proves the rule **wins the cascade** — the CSS-text test only proves the
  declaration is in the file.
- The drag guard, by dispatching `pointerdown`/`pointerup`/`mousedown` and
  counting dismissals.

Drive a real sheet through `openSheet` directly rather than hunting for a
reachable one: `showSupport()` returns immediately unless `DONATE_URL` is set, so
the obvious logged-out sheet builds nothing. And clear the service worker first
(`.claude/rules/pwa-service-worker.md`) or `.sheet` reports `auto` from the
cached stylesheet.

**Related:** `.claude/rules/sheet-history-back-dismissal.md` (the replace path in
§2 and the Back dismissal both go through `teardownSheet`),
`.claude/rules/accessibility-contrast-and-modals.md` §2 (the focus trap — the
other thing `openSheet` exists to make impossible to forget),
`.claude/rules/popover-vs-sheet-editors.md` (the presentation split, and why the
popover is exempt), `.claude/rules/preview-pane-paint-artifacts.md` (the
`innerWidth === 0` family),
`.claude/rules/token-friendly-source-files.md` ("Moving or renaming code…" — the
pre-#678 `.sheet` cap was cited as a premise both here and in
`public/js/page-lock.js`'s header comment, and the second was nearly missed; that
grep now covers source, not just the rules).
