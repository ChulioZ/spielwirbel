---
paths:
  - "public/styles.css"
  - "public/js/views-home.js"
  - "public/js/views-regal.js"
  - "public/js/views-pokale.js"
  - "public/js/views-stats.js"
---

# `auto-fit` collapses only EMPTY tracks — one spanning item turns it back into `auto-fill`

`repeat(auto-fit, minmax(340px, 1fr))` is this codebase's answer to the #358
defect: with `auto-fill`, a grid holding ONE item keeps its empty tracks, so
that item renders ~340px wide against the left edge of an up-to-1800px shell
instead of filling the row. `auto-fit` collapses the empty tracks to `0px`, so
one item spans and three share.

**It collapses a track only if that track is empty.** An item spanning every
column — the natural way to put a heading over the grid it labels —

```html
<section class="home-resume">          <!-- display: grid -->
  <h2 style="grid-column: 1 / -1">Läuft gerade</h2>
  <a class="ticket">…</a>
  <a class="ticket">…</a>
</section>
```

occupies all of them, so nothing is ever empty and **`auto-fit` behaves exactly
like `auto-fill`**. Measured on #842 at 1440px: two tickets, three 457px tracks,
one of them a hole — and with a single ticket it would have been the #358 defect
reintroduced, by the heading rather than by the grid.

## The fix: the heading is a SIBLING of the grid, not an item in it

```css
.home-resume { margin-bottom: 26px; }          /* plain block wrapper */
.home-resume__head { margin: 0 0 12px; }
.home-resume__list {                            /* the grid, holding only cards */
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
}
```

Keep the grid holding **one kind of child**. That is the property to preserve;
`grid-column: 1 / -1` is only the commonest way to break it (a full-width note,
an empty-state row and a "load more" button do it too).

Note what this does *not* cost: the wrapper is still the direct `.app` child, so
the `--w-read` exemption keeps naming it in `:is()` and needs no change. The
`:is()`-vs-`:has()` distinction in that rule is about which ELEMENT to match, not
about whether it is itself a grid.

## Why no CSS assertion can catch it

This is the trap, and it is the reason the rule exists rather than a test.
`test/home-dashboard.test.js` asserted the stylesheet says `auto-fit`:

```js
assert.match(bodyOf('.home-resume__list'), /grid-template-columns:\s*repeat\(auto-fit,/);
```

That assertion was **green while the layout was broken**, and would have stayed
green forever, because the stylesheet really did say `auto-fit` — the defect
lived in the DOM the view built. jsdom applies no external stylesheet and
computes no layout (`.claude/rules/testing-views-under-jsdom.md`), so no spec in
this repo can observe the collapse itself.

So the guard has to be on the **DOM shape** instead — the grid's children are all
cards — and the real detection is a `getBoundingClientRect()` sweep in a resized
preview pane:

```js
getComputedStyle(el).gridTemplateColumns   // "693px 693px 0px"  ✅ collapsed
                                           // "457px 457px 457px" ❌ a hole
```

**`resize_window` FIRST**, or every viewport-dependent read is 0
(`.claude/rules/preview-pane-paint-artifacts.md`).

**Related:** `.claude/rules/break-the-code-on-purpose.md` (a text assertion that
passes against the broken behaviour is the "merely weaker assertion" case),
`.claude/rules/responsive-content-width.md` (the `--w-read` cap and its
exemption), `.claude/rules/css-text-assertions-strip-comments.md`.
