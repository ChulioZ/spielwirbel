---
paths:
  - "public/js/confirm-dialog.js"
  - "public/js/views-round-detail.js"
  - "public/js/views-session.js"
  - "public/js/router.js"
  - "test/support/dom.js"
---
# The themed confirm is a PROMISE on a sheet layer that holds exactly one sheet

#939 replaced 26 of the app's 27 `window.confirm()` calls with `confirmDialog()`
(`public/js/confirm-dialog.js`). Three things about that shape are non-obvious,
and each of them fails quietly.

## 1. `openSheet` REPLACES — so a confirmation raised inside a sheet closes it

`activeSheet` (views-round-detail.js) is a single slot, and `openSheet`'s first
act is `teardownSheet({ keepLock: true })`. That is deliberate — one history
marker, one focus trap, one page lock — but it means **a confirmation opened from
inside a sheet dismisses the sheet that raised it**, and declining then drops the
user on the screen behind it with whatever they had assembled gone.

Exactly one call site does this: `go` in `showTransferGames`
(views-round-actions.js), where the selection is real work. It re-opens itself on
a decline for that reason. **Before adding a confirmation inside a sheet, decide
what a decline should restore** — the alternative (stacking sheets) is a refactor
of the marker, the trap and the lock together, not a flag.

Everything else is raised from a screen, where there is nothing to replace.

## 2. The promise is settled from `onClose`, and the sentinel is load-bearing

Four of the five dismissal paths run a `closeSheet` callback. **Browser Back does
not** — `handleSheetPop` tears the sheet down directly — so the promise has to be
settled from `openSheet`'s third argument, the `onClose` hook.

But `onClose` fires *inside* `teardownSheet`, which runs **before** the
`closeSheet(next)` callback. So a hook that unconditionally resolved `false`
would win the race against the confirm button's own `finish(true)` and every
confirmation would read as a decline. Hence the `outcome` sentinel: the two
buttons set it before calling `closeSheet`, and the hook only speaks when it is
still `null`.

Measured: deleting the hook leaves Escape, the backdrop, the × and Back all
unsettled — four named specs red in `test/confirm-dialog.test.js`.

## 3. An unsettled promise HANGS `node --test`; it does not go red

That measurement only reads that way because those specs carry
`{ timeout: 5000 }`. Without it the runner waits forever, and a wedged CI job is
the one failure mode that reports nothing at all. **Any spec awaiting a dialog's
promise takes a deadline.**

The neighbouring half: a confirmation is now a turn late, so a spec that clicks
and asserts in the same tick sees nothing sent — which reads as a handler wired
to the wrong element. Use `flush()` from `test/support/dom.js`, and stub
`confirmDialog` (a function declaration, so `dom.set` reaches it), never
`window.confirm`. Note the flush lets the *whole* handler run, including the
follow-up round refresh — so assert on the POST the action makes, not on a total
call count, which now counts one more.

## 4. `vote.leaveConfirm` cannot be converted, and that is not laziness

The one hold-out. It is read by `confirmLeave()` (router.js), a **synchronous
boolean** that `onPopstate` (views-session.js) answers with *while the pop is
already in flight* — and `confirmDialog` arbitrates the very history stack that
guard is arbitrating: it pushes a marker of its own and pops it to close. Making
the guard promise-aware means making the router's popstate path promise-aware,
which is a redesign; a half-converted guard drops votes.

`test/confirm-dialog.test.js` pins the count at exactly one, so the hold-out
cannot quietly become two — and it scans with comments **stripped**, because this
module's own header and views-session.js's hold-out comment both spell out
`if (!confirm(msg)) return;`. A raw-text scan flags the places that document the
rule (`.claude/rules/source-scanning-guards-enumerate-shapes.md`).

**Related:** `.claude/rules/sheet-history-back-dismissal.md` (the async pop this
resolves through), `.claude/rules/overlay-page-lock.md` (the lock `keepLock`
protects on a replace), `.claude/rules/session-flow-history.md` §"Verifying a
change here" (the leave guard, and why its `window.confirm` stub is still the
right instrument), `.claude/rules/testing-views-under-jsdom.md`.
