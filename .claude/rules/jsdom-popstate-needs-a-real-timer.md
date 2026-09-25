---
paths:
  - "test/support/dom.js"
  - "test/bulk-select-view.test.js"
  - "test/add-game-search-tisch.test.js"
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

## "Cannot reach it" is true only while the process is IDLE — under load it is a flake

jsdom queues the traversal and then the `popstate` on two real
`window.setTimeout(…, 0)`s. Node runs due timers before `setImmediate` callbacks on
every loop turn, so whether they land inside a `flush(); flush();` depends on
whether a millisecond has passed yet. Quiet process: they never land inside it.
Loaded process: sometimes they do.

#1320 was that race. `test/add-game-search-tisch.test.js` saved its form, flushed
twice and finished. `closeSheet(back)`'s deferred `showRound` rendered the Regal
from the api stub's `{}` and threw `reading 'filter'` into the test **whenever the
timers came due in time**. That was 0 in any number of isolated runs, and **1 in
40** with the full suite running beside it. A different test failed each time,
because whichever test was running when the timers fired got the blame. A 20 ms
real sleep after the click turned it into a deterministic red, which is how to
confirm this cause for any spec suspected of it.

## The fix

**Stub the screen `next` navigates to, and `waitFor` it** (`test/support/dom.js`,
#1320). The call arriving IS the pop having landed, so the test waits for exactly
the right thing and leaves no timer queued for a later test:

```js
dom.set('showRound', (rid, tab) => navigations.push([rid, tab]));
…
await waitFor(() => navigations.length, { label: 'the saved form closing back to the Regal' });
```

This replaces the fixed count below where you can use it: six ticks is still a
bet on scheduling, just a safer one. The older form, for a close with no `next`
to observe, awaits a real timer. Six is what #972 measured as sufficient; one was
not.

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
