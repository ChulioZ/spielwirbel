---
paths:
  - "test/support/dom.js"
  - "test/bulk-select-view.test.js"
  - "public/js/sheet.js"
  - "public/js/router.js"
---

# `flush()` cannot await a sheet's Back-dismissal — jsdom's popstate needs a REAL timer

`test/support/dom.js` exports `flush = () => new Promise(r => setImmediate(r))`,
and it is the right tool for every async view interaction in this repo — except
one. **jsdom queues `popstate` on a task source `setImmediate` does not drain.**

That matters because the whole sheet layer closes through it:

```js
closeSheet(next)  →  history.back()  →  popstate  →  handleSheetPop()  →  next()
```

So a spec that clicks a sheet's OK button and `await flush()`es before asserting
is reading the page *before the callback has run*, however many times it flushes.
Measured on #972: twenty `flush()` calls moved it no further than one.

## The failure is displaced, which is what makes it expensive

The pop does not vanish — it lands during the **next test**, so the symptom
appears one test away from its cause:

| after | `sheetHistory` | `history.state` | posts |
|---|---|---|---|
| T1 cancel | `true` | `{sheet:true}` | 0 |
| T2 pick + OK | `false` | `null` | **1** ✓ |
| T3 pick + OK | `true` | `{sheet:true}` | **0** ✗ |
| T4 pick + OK | `false` | `null` | **1** ✓ |

Two identical tests, alternating pass/fail. And because a leftover `sheetHistory`
makes the *next* `openSheet` skip its `pushState`, the tests interfere both ways:
the same spec passes in a full-file run and fails under `--test-name-pattern`, or
the reverse. Every reading of that points at the view code, and the view is fine.

## The fix

Await a real timer instead. Six is what #972 measured as sufficient; one was not.

```js
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => dom.window.setTimeout(r, 0));
};
```

`dom.window.setTimeout`, not the bare global — it is the jsdom window's own timer,
i.e. the same task queue the popstate is sitting in.

**Only sheet-closing paths need this.** Every other async view interaction —
including `runBulk`'s confirm → POST, which never opens a sheet because
`confirmDialog` is stubbed — settles under a single `flush()`, so don't replace it
wholesale.

## Recognising it

The tell is a request that is never made *plus* a sibling test that passes doing
the same thing. Before suspecting the view, print the sheet layer's own state
after the interaction — both are readable through the harness:

```js
dom.run('sheetHistory')            // true here means the pop has not landed yet
dom.window.history.state           // {sheet:true} means the marker is still up
```

**Related:** `.claude/rules/testing-views-under-jsdom.md` (the harness, and what
`flush()` is for), `.claude/rules/sheet-history-back-dismissal.md` (why the close
goes through history at all, and why `next` must be passed to `closeSheet` rather
than called on the line after it), `.claude/rules/blur-events-never-fire-in-the-preview-pane.md`
(the same shape in the Browser pane — an environment that reports the state
changing while dispatching no event).
