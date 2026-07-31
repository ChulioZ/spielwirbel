# An anchored popover is placed ONCE — content that grows later hangs off the fold (#519)

`openPopover` (`public/js/core.js`) decides a popover's `top` from
`el.offsetHeight` at build time: below the anchor if it fits, flipped above
otherwise. Every editor that ever used it had a fixed height, so nothing noticed
that the placement is a **one-shot measurement**.

The edition-cover picker (#519) is the first content that *expands in place*, and
the failure is worse than a cosmetic misalignment:

- The card grows downward from a `top` chosen for its collapsed height.
- **A page scroll CLOSES a popover** (`onScroll`, the #247 handler), so whatever
  ends up below the fold is not merely off-screen — it is **unreachable**.

Measured with a stubbed viewport (800 tall) and a low anchor (top 700): collapsed
352px placed at `top: 342` (= 700 − 352 − 6, correct); expanded to 498px it
**stayed at 342** and overlapped its own anchor by 146px.

## The fix, and why it is an explicit call rather than a ResizeObserver

`openPopover`'s placement moved into a re-runnable `place()`, exposed as
`repositionPopover()`. `cover-picker.js` calls it from `setBody()` — the one
chokepoint through which every height-changing render goes — and from the
collapse branch of its toggle. It is a **no-op when no popover is open**, which
is what lets a component living in three presentations (popover on desktop,
sheet on a phone, inline in the add-game form) call it unconditionally.

**A ResizeObserver on `el` is the obvious better design and was implemented
first. It was removed because it cannot be VERIFIED here** — see below. An
untestable mechanism whose whole failure mode is silence is not worth having;
this is the same call `.claude/rules/psstore-full-game-is-not-every-game.md`
records for a trailing regex anchor that survived nothing.

## The pane never fires a ResizeObserver at all

New member of the artifact family in
`.claude/rules/preview-pane-paint-artifacts.md`, and it costs an hour if you
assume your wiring is wrong. Measured on a **plain div** with no app code
involved:

```js
const el = document.createElement('div');
el.style.cssText = 'position:absolute;width:100px;height:50px';
document.body.appendChild(el);
const seen = [];
new ResizeObserver((e) => seen.push(e)).observe(el);
el.style.height = '200px';
// seen: []   — zero callbacks, ever
```

Same root cause as the dead IntersectionObserver (`provider-cover-sizing.md`):
the pane reports `innerWidth === 0` / `innerHeight === 0` and does not advance
the observer pipeline. The tell is that the *initial* placement is right and only
the update is missing, which reads exactly like a mis-wired callback.

**So probe the geometry, not the observer.** `place()` reads three things, all
stubbable from `javascript_tool` in one call:

```js
Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => 800 });
anchor.getBoundingClientRect = () => ({ top: 700, bottom: 740, left: 100, right: 400, width: 300, height: 40 });
```

A **low** anchor is the load-bearing part of that setup: it forces the
above-the-anchor branch, where `top` is *derived from the card's own height*, so
the invariant `top + height + 6 === anchorTop` holds in every state and a single
number proves the re-placement. With the anchor high the card sits below it, `top`
is a constant, and a correct fix is indistinguishable from a missing one.

Verified by neutralising `window.repositionPopover` in the page and re-running
the identical probe — the expanded card keeps its collapsed `top`.

## `min()` alone will collapse a scroll box to nothing

`.cover-picker__grid` caps its height so the grid scrolls internally instead of
growing the card without bound. The first version was `min(264px, 38vh)`, which
computes to **`0px`** wherever the viewport height is degenerate — the picker
then renders zero covers with nothing to explain why, which reads as a broken
feature rather than a bad number. It is `max(160px, min(264px, 38vh))` now.

The pane is the degenerate viewport (its `innerHeight` really is 0), so this also
happens to be what makes the layout measurable there at all — but the floor is
warranted on its own: one row is always better than none.

**Related:** `.claude/rules/popover-vs-sheet-editors.md` (the two presentations
`openEditor` picks between, and why an input-bearing popover must become a sheet
on a phone), `.claude/rules/preview-pane-paint-artifacts.md` (the artifact family
this joins), `.claude/rules/bgg-edition-covers.md` (the picker that surfaced it).
