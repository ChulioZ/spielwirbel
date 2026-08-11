---
paths:
  - "public/js/core.js"
  - "public/js/cover-picker.js"
  - "public/styles.css"
---
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

## The second instance (#653), and why an ASYNC fill is the sharper case

The expansion editor hit this within a day of shipping. Its BGG tick-list is
fetched when the editor opens, so `openPopover` measures a card that still says
"…" — there is no user action between the placement and the growth at all,
which makes it strictly easier to hit than the cover picker's expand-on-click.
Measured on an 800px viewport with a low anchor: the card grew **379px → 592px**,
kept `top: 315`, and the OK button landed at **y=898** — 98px below the fold.

Two things generalise from the fix:

- **Re-place from `.finally()`, not `.then()`.** The empty-list and the failure
  branches also swap the placeholder for a one-line message, so they change the
  height too. A `.then()`-only call leaves the *error* path mis-placed, which is
  the path nobody looks at.
- **A tall card needs a cap as well as a correct placement.** Right placement
  only guarantees the card is *anchored*; it can still be taller than the
  viewport. `.popover--expansions` therefore caps itself and lets the tick-list
  be the flex item that gives way, so the action button is always the last
  visible thing. That needs `min-height: 0` on the intermediate flex item — a
  flex item's default `min-height: auto` is its content size, so the cap is
  silently inert without it.

## The cap's ceiling is HALF the viewport, not most of it (#722)

The third instance was the tags editor, and it is the one that shows the cap
above is not just "pick a big vh". Generalise it: **any editor whose content
scales with round data needs one** — the tag list grows without bound, the chips
are appended before the create row, and creating a tag from a game's detail page
was therefore impossible in production for a round with ~34 tags.

The number is the transferable part. `place()` puts the card **wholly** above or
wholly below its anchor and, when neither side fits, falls back to *below* — so
the room it can count on is the larger of the two sides, whose worst case (an
anchor in the vertical middle) is **half the viewport**. Above that there is a
band of anchor positions with no legal placement, and the card runs past the fold
exactly as if it had no cap. Measured at 1440×900 with a mid-height anchor:
`min(78vh, 620px)` left the OK button **177px past the fold**; `min(45vh, 520px)`
left it 0.

Derive the term from the viewport half (`h > (H − anchorH − 12)/2` is the
dead-zone condition) and keep the `max()` floor at or above the sum of the
children's own floors, or the cap can be tighter than what they need.

**`.popover--expansions` was NOT safe — #728 measured it and it was 78vh's own
victim.** This file used to say its 78vh survived "by luck of the anchor"; the
luck ran out one game page over. On the real editor at 1440×900 the card is
**529px** against a 430px budget, and its OK button landed **96px past the
fold**. Not a stubbed-anchor curiosity: sweeping the demo round's nine game
pages, Codenames put the trigger inside the dead band at **51 of its 119**
reachable scroll positions. It ships at `max(380px, min(45vh, 620px))` — card
405px ending 32px above the fold, tick-list giving way 240 → 117, all nine pages
clean. Fold-safe from ~799px of viewport height up, against ~1097px before.

### The floor has a SECOND job, and it is the half that bit

The floor is easy to read as only the degenerate-viewport guard (§"`min()` alone
will collapse a scroll box"). It is also what stops the cap squeezing the card
**below what its own children accept** — and the two failures look nothing alike:

`.exp-pick` carries `min-height: 0` precisely so the cap can bite, so under the
card's irreducible minimum the card does not shrink. Its tick-list keeps its own
96px floor, spills out of `.exp-pick`, and renders **on top of** the free-text
form — measured, **53px of overlap** at a 315px cap. So lowering a vh term
without re-measuring the floor trades a fold problem for an overlap, which is
strictly worse: the control is visible, looks fine in a screenshot, and is
unusable.

`.popover--expansions`' floor was **280px against a measured 371px minimum** —
91px under, and wrong since #653. At 78vh that only bit under ~476px of viewport;
at 45vh it would have bitten under ~825px, i.e. on ordinary laptops. So the bug
was latent *because* the cap was too generous, and correcting the cap is exactly
what would have detonated it.

**Measure the minimum, don't sum the CSS.** Only 96 of those 371px is declared
anywhere — the rest is rendered text and controls. Squeeze the card
(`el.style.maxHeight = '0px'`) and read what the children insist on.
`test/game-expansions.test.js` then binds the floor to the list's *declared*
floor plus that measured remainder, so raising one without the other goes red.

### When no cap can fix it

A cap works only while the card's irreducible minimum fits the budget. The
edition-cover editor does not: chrome 270px + the grid's own 160px floor = 430px
against `(900 − 180 − 12) / 2 = 354px`, because „Bild ändern" **is** the 180px
cover and a large anchor eats the room. Measured 534px tall, 110px past the fold,
on all nine pages at scroll 0. That one needs `place()` to clamp the card to the
room it has — **#739** — not a smaller number. Check the minimum against the
budget *before* reaching for a cap.

Where several children can grow, **each** needs `min-height` + `overflow-y: auto`
+ `overscroll-behavior: contain`, and the shrink order is a real decision: the
tags editor gives `flex: 1 4 auto` to the chip list so the icon grid — the thing
the user just opened — is not the box that collapses.

**And the `max()` floor below is not optional — it was got wrong here first.**
A bare `max-height: min(78vh, 620px)` on the card computed to **0** in the pane
and collapsed it to **18px tall with its own children rendering outside it**,
the OK button 200px past its bottom edge. Exactly the `min()` trap the next
section records for `.cover-picker__grid`, one element up.

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

**Related:** `.claude/rules/popover-width-is-shrink-to-fit.md` (the WIDTH axis —
why a `max-width` here can be a no-op, and why widening a card is the cheaper
answer to "this editor is cramped" than raising the cap above),
`.claude/rules/popover-vs-sheet-editors.md` (the two presentations
`openEditor` picks between, and why an input-bearing popover must become a sheet
on a phone), `.claude/rules/preview-pane-paint-artifacts.md` (the artifact family
this joins), `.claude/rules/bgg-edition-covers.md` (the picker that surfaced it).
