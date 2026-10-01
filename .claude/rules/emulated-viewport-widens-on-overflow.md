# Under `resize_window`'s phone emulation, ONE overflow widens the viewport for every later reading

<!-- scope: global — the trap surfaces through the Browser pane's resize_window tool, not through any one file -->

Found verifying #1460 (the top bar's „…" fold). At a 390px emulated width a
probe measured five designs in one call and came back with **`innerWidth` 512**
and a bar 394–512px wide, i.e. "the fix overflows in every design". It did not.

## The two mechanisms

- **The mobile layout viewport widens to fit overflow.** Any width below 768
  emulates a phone, and a phone's layout viewport grows to contain content wider
  than the device. So one overflowing element — here the probe's own CONTROL,
  which put `main`'s 438px bar back on purpose — makes `innerWidth`, the bar's
  `clientWidth` and every rect afterwards report the widened width. A layout
  fitted to that width (this one measures `clientWidth`) then fits the wrong
  number, keeps the overflow, and the error sustains itself.
- **`resize_window` delivers no `resize` event.** A popover the app closes on
  `resize` stays open at its old position across the change, and at the new,
  narrower width it reads as overflow (`docSW=432` at 320px, from a menu placed
  at 390px). The app's own resize-driven code does not run either, so call it by
  hand after each resize.

## The rule

- **Read `innerWidth` back in every measurement** and treat any value other than
  the emulated width as a contaminated run. Re-`navigate` to get a clean document.
- **Run a control that reintroduces the bug LAST**, after the readings that
  matter, or in its own document. The control is still required: it is what
  proved the probe could see the bug at all, matching the issue's table to the
  pixel in WebKit.
- **Close overlays explicitly** (`closePopover()`) before a resize, and list what
  is wider than the viewport (`getBoundingClientRect().right > innerWidth`)
  before blaming the change.

**Related:** `.claude/rules/preview-pane-paint-artifacts.md` (the `resize_window`
section and the pane's other falsehoods),
`.claude/rules/browser-pane-is-chromium-only.md` (the WebKit probe, which has a
real viewport and was the cleaner instrument here).
