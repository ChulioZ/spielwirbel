---
paths:
  - "public/js/sheet.js"
  - "public/js/keyboard-viewport.js"
  - "public/js/page-lock.js"
  - "public/styles.css"
---

# The iOS keyboard does not shrink a `position: fixed` sheet — it PANS it away (#1752)

On WebKit (Safari and the installed PWA) the on-screen keyboard leaves the
**layout** viewport full height; `dvh` does not track it, and `interactive-widget`
in the viewport meta is not honoured. WebKit pans the **visual** viewport up
instead, to reveal the focused input. `.sheet-backdrop` is `fixed; inset: 0` and
docks the sheet to its bottom edge, so that pan moved the sheet's head — and the
autofocused field in it — off the top of the screen. The page is locked behind it
(`overlay-page-lock.md`) and `.sheet` sits at `scrollTop: 0`, so no drag could
bring it back; only closing the keyboard did, and then the field needed a second
tap.

## The rule

**Every sheet is pinned to `window.visualViewport` while it is open** —
`followVisualViewport` (`public/js/keyboard-viewport.js`), attached in
`openSheet` and released in `teardownSheet`, so the `keepLock` replace path hands
it from sheet to sheet with nothing leaking (`test/keyboard-viewport.test.js`
counts the listeners). Don't solve it per sheet with a `scrollIntoView` or by
dropping autofocus (operator decision: keep it).

Three properties are load-bearing:

- **Inline `top`/`bottom: auto`/`height`, cleared when there is nothing to do.**
  Where the keyboard resizes the layout viewport, or there is none, the visual
  viewport equals the layout one and the CSS geometry stands untouched.
- **A pinch zoom is ignored** (`scale ≠ 1`) — chasing it drags the sheet around
  under the user's fingers.
- **`.sheet` keeps `max-height: …100%` of the backdrop**, which is what makes it
  give way in the band that is left while staying the scroll container
  (`lookup-menu-fixed-position.md`).

**The Browser pane cannot verify this** — Chromium with no on-screen keyboard
(`.claude/skills/browser-verification/browser-pane-is-chromium-only.md`). It can
only show the no-op half; the fix itself needs a real iPhone or the iOS
Simulator with the software keyboard shown.

**Related:** `.claude/rules/overlay-page-lock.md` (the lock that removed the
document scroll this used to fall back on), `.claude/rules/sheet-history-back-dismissal.md`
(the replace path).
