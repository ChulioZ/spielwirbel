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
app code involved, exactly like the dead IntersectionObserver
(`.claude/rules/provider-cover-sizing.md`). The tell is that whatever runs on
*setup* is correct and only the update is missing, which reads exactly like a
mis-wired callback. See `.claude/rules/anchored-popover-is-placed-once.md`,
where it decided the shape of a fix.

**A real viewport does NOT revive them — the 0×0 reading is a symptom, not the
cause.** This paragraph used to name the degenerate viewport as the root cause,
which reads as "resize and the observers work" given the section below. Measured
2026-09-08 (#979) with `resize_window {width: 1200, height: 900}` in force and
`innerWidth`/`innerHeight` confirming 1200/900, a bare probe with no app code —
an appended 50×50 div, one `IntersectionObserver`, 1.5 s — **never fired**:

```js
const d = document.createElement('div');
d.style.cssText = 'width:50px;height:50px';
document.body.appendChild(d);
new IntersectionObserver(e => console.log('fired', e[0].isIntersecting)).observe(d);
// → nothing, at any viewport size
```

So a lazily-loaded image never loads in the pane, at any width. **Run the bare
probe as your control** before concluding a loader is broken, and check an
*untouched* element on the same screen that uses the same path — on #979 the
`.recap-fav` covers shipped in #695 were equally unloaded, which is what
separated "the pane" from "my change" in one call. To judge the design anyway,
apply by hand what the callback would have done (there, `coverUrl(image,
COVER_THUMB)` onto each frame's `backgroundImage`) and screenshot that; prove the
loader itself in jsdom, where `createCoverLoader` takes its eager fallback branch
because `IntersectionObserver` is absent entirely.

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

**And it lies about TIME:** an animation's clock advances only when the pane
paints, so a `getComputedStyle` sample of a running keyframe reads the start
value on every call until a screenshot forces a frame — measured on #905; the
sampling recipe is in
`.claude/rules/world-artwork-masks-and-single-weight-faces.md`.

**Toggling `data-scheme` at runtime updates the CUSTOM PROPERTY and not the
value that USES it** (measured 2026-09-12, #1041). Setting
`documentElement.setAttribute('data-scheme', 'dark')` mid-session and re-reading
is the obvious way to check that a new colour is theme-derived, and it reports
the derivation working and the paint not:

```js
document.documentElement.setAttribute('data-scheme', 'dark');
getComputedStyle(root).getPropertyValue('--shade')          // '#fff'    ✅ flipped
getComputedStyle(img).getPropertyValue('--gd-edge-ink')     // '…#fff 16%…'  ✅ flipped
getComputedStyle(img).boxShadow.split(',').pop()            // 'oklab(0 0 0 / .16)'  ❌ still black
```

A forced reflow, a `requestAnimationFrame` and a 400 ms wait changed nothing,
and `--surface` → `background` was stale in the same way — so it is the used
value that is not re-resolved, not this one rule. That reads exactly like a
`color-mix()` on `--shade` having been written wrong, which is the one thing the
probe exists to rule out.

**Build the dark subtree instead, so nothing has to be re-resolved.** The app's
second scheme hook is a class, so a fresh element under it is styled once with
the scheme already in force:

```js
const card = document.createElement('div');
card.className = 'theme-card';
card.setAttribute('data-scheme', 'dark');
card.innerHTML = '<div class="gd-cover"><button class="gd-img"></button></div>';
document.body.appendChild(card);
getComputedStyle(card.querySelector('.gd-img')).boxShadow   // oklab(0.99… / .16) ✅
```

Run the light case through the same factory as the control — a single dark
reading proves nothing about which branch produced it.

**The pane lies about focus as well as about pixels.** `document.hasFocus()` is
permanently false there, so `element.blur()` moves `document.activeElement`
without dispatching any `blur`/`focusout` event — which makes every
commit-on-blur inline editor look completely dead. See
`.claude/rules/blur-events-never-fire-in-the-preview-pane.md`.
