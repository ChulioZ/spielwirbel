# The Browser pane never delivers Escape — every sheet looks like Escape-to-close is broken

<!-- scope: global — a Browser-pane artifact; it surfaces while verifying, whatever file is under test -->

Every sheet in this app closes on Escape: `openSheet(backdrop, onKey)` registers
`onKey` on `document` in the capture phase, and it calls `dismiss()`. Verifying
that in the Claude Code Browser pane produces a perfect false negative — the
sheet opens, you press Escape, and **nothing happens at all**: no close, no
error, the backdrop still up, `document.activeElement` unmoved.

That reads exactly like the handler never having been registered, and it is the
one behaviour `.claude/rules/sheet-history-back-dismissal.md` and
`.claude/rules/popover-vs-sheet-editors.md` both tell you to check.

## The mechanism, and the control that proves it

`computer {action: "key", text: "Escape"}` reports success and the keypress
**never reaches the document at all**. Measured on the add-game sheet (2026-09-02)
with a capture-phase spy on `document`:

```js
window.__seen = [];
document.addEventListener('keydown', e => window.__seen.push(e.key), true);
// → computer {action:"key", text:"Escape"}
window.__seen            // []          ← nothing arrived

document.activeElement.dispatchEvent(
  new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
!document.querySelector('.sheet')       // true — the app closed it correctly
```

So the app is fine and the pane simply swallows the key.

**Tab is NOT affected**, which is what makes this so misleading: in the same
session, `computer {action:"key", text:"Tab", repeat: 25}` moved focus correctly
and proved the focus trap holds. So the pane's key input is *partly* working, and
"my keypresses are being delivered" is a reasonable and wrong conclusion to draw
from the Tab result. Don't generalise from one key to another.

## The probe

Dispatch the event instead, and dispatch it from the focused element so it
follows the real path to the capture listener on `document`:

```js
document.activeElement.dispatchEvent(
  new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
```

That exercises the whole real path — `onKey`, the lookup-menu branch that owns
Escape while a dropdown is open (`.claude/rules/lookup-menu-keyboard-combobox.md`
§1), `dismiss()`, `closeSheet()`, the history marker pop and the focus
restoration. What it does not prove is that Chrome dispatches `keydown` for a
physical Escape, which is platform behaviour every sheet has relied on since
#145 and needs no re-proof per feature.

**Always run the spy first.** An empty `__seen` after a `computer` keypress is
the tell that separates "the pane ate it" from "the handler is broken", and it
costs one call. Without it, the two are indistinguishable — and the wrong
conclusion sends you editing a working Escape handler.

## The neighbouring trap

A failed Escape leaves the sheet **open**, so the next probe's
`document.querySelector('.sheet')` finds the previous attempt rather than the one
you just opened, and a loop over several sheets silently measures the first one
every time. Re-`navigate` (or call `closeSheet()` explicitly) between attempts,
and assert the sheet count before and after opening one — the same accumulation
trap `.claude/rules/blur-events-never-fire-in-the-preview-pane.md` describes for
stale inline editors.

**Related:** `.claude/rules/blur-events-never-fire-in-the-preview-pane.md` (the
same family — the pane reports focus moving while dispatching no event),
`.claude/rules/preview-pane-paint-artifacts.md` (blank captures, wedged input,
dead observers, and the `resize_window` correction),
`.claude/rules/sheet-history-back-dismissal.md` and
`.claude/rules/popover-vs-sheet-editors.md` (the Escape paths this makes
un-verifiable by keypress),
`.claude/rules/accessibility-contrast-and-modals.md` §2 (the focus trap, whose
Tab half the pane *does* let you verify).
