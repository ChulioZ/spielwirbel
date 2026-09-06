# Preview-pane blank screenshots & scroll timeouts are (often) not app bugs

<!-- scope: global — a Browser-pane artifact — it surfaces while verifying, whatever file is under test -->

<!-- scope: global — a Browser-pane artifact — it surfaces while verifying, whatever file is under test -->

Discovered verifying #198 (lazy covers + `content-visibility`): in the Claude
Code Browser pane, the app's Regal grid produced **blank screenshots after any
programmatic scroll** (`scrollTo`/`scrollBy`), and `computer` **scroll/input
actions timed out after 30s** — which looks exactly like a layout/paint loop
caused by the change under test (`content-visibility: auto` is a prime suspect).

It wasn't. The control experiments that proved it:

- The same blank capture happened with the suspect CSS **disabled** (injected
  `content-visibility: visible !important` override).
- Input scrolls timed out on the **untouched Home page** too.
- Page JS stayed fully responsive the whole time (`javascript_tool` probes),
  no console errors, and DOM/layout numbers (rects, `scrollHeight`, computed
  grid columns) were correct at every probe.
- A **fresh `navigate` always painted correctly** — the artifact only appeared
  on captures after programmatic scrolls in the same page instance.

**Rule:** before blaming the change, run those controls. Verify scroll-dependent
behavior in the preview pane with **JS probes, not pixels**: element rects,
`document.scrollHeight`, `performance.getEntriesByType('resource')` /
`read_network_requests` counts (e.g. lazy-load = N requests at top, more after
`scrollBy`). Take screenshots only right after a fresh navigation. A capture
that's blank while the DOM probes are healthy is the pane, not the app.

This extends the CLAUDE.md note about non-painted preview tabs and rAF: the
pane can also fail to produce fresh frames after synthetic scrolls, and its
input pipeline can wedge per-session (a reload/re-navigate recovers painting;
input may stay broken) — while the page itself is fine in a real browser.

**The pane fires NO ResizeObserver, either** — measured on a plain detached-then-
appended div whose height was changed 50px → 200px: **zero callbacks**, with no
app code involved. Same root cause as the dead IntersectionObserver
(`.claude/rules/provider-cover-sizing.md`): the reported viewport is 0×0 and the
observer pipeline never advances. The tell is that whatever runs on *setup* is
correct and only the update is missing, which reads exactly like a mis-wired
callback. See `.claude/rules/anchored-popover-is-placed-once.md`, where it
decided the shape of a fix.

## `resize_window` DOES clear the 0×0 viewport — re-test before writing it off

Measured 2026-08-09 (#722), and it contradicts four rule files that state the
opposite (`overlay-page-lock.md`, `popover-vs-sheet-editors.md`,
`label-rows-lose-to-field-label.md`, `provider-cover-sizing.md`). A **freshly
opened** tab reports `innerWidth === 0 / innerHeight === 0`, as those files say —
but an explicit `resize_window` clears it, and a plain resize with **no**
navigate afterwards was enough:

```js
// after resize_window {width: 1100, height: 640}
window.innerWidth / innerHeight        // 1100 / 640
document.documentElement.clientWidth   // 1100
```

That matters more than a footnote, because those files talk future sessions out
of measuring layout in the pane at all — and with a real viewport the whole of
#722 (a `vh` cap, `place()`'s arithmetic, flex give-way, a low-anchor control)
was directly measurable, no stubbing needed. `vh` resolves to **0** while the
viewport is degenerate, so the *unresized* pane silently tests only a rule's
`max()` floor and never its viewport term.

This is one measurement on one pane build, so treat neither claim as settled:
**resize first, read the numbers back, and believe what they say.** If they are
still 0, the stubbing recipes in the files above are the fallback.

**A card that is mid-ANIMATION captures as a hole in the page** (measured
2026-09-06, #940). While the winner spotlight's reveal was running — a
`transform`/`opacity` animation on the card and on its pseudo-elements — a
screenshot showed the page painted correctly *around* a blank rectangle where
the card is; two seconds later the same call captured the finished scene. The
DOM was healthy throughout: `getComputedStyle(el, '::before').transform` sampled
at 0.3/1.2/2.1/3.6s read the keyframes' own interpolation (`scaleY` 0.06 →
0.25 → 0.72 → 1) and `document.getAnimations()` listed every animation running.
It is the compositor: an animating box gets its own layer, and the pane's
capture omits it. So **prove motion with computed values sampled over time,
and screenshot only the resting state** — which is the thing to judge anyway.

**The pane lies about focus as well as about pixels.** `document.hasFocus()` is
permanently false there, so `element.blur()` moves `document.activeElement`
without dispatching any `blur`/`focusout` event — which makes every
commit-on-blur inline editor look completely dead. See
`.claude/rules/blur-events-never-fire-in-the-preview-pane.md`.
