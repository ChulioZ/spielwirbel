---
paths:
  - "public/styles.css"
  - "public/js/views-regal.js"
  - "public/js/views-archive.js"
  - "test/phone-width-overflow.test.js"
  - "test/vote-card-viewport-fit.test.js"
---

# `flex: none` and `flex-wrap: wrap` on the same rule contradict each other — `none` wins

```css
.section-tools { display: flex; gap: 8px; flex: none; flex-wrap: wrap; }
```

That reads as "sized to content, and it wraps if it has to". It is not: `flex:
none` is `0 0 auto`, so the element is sized at **max-content and can never
shrink** — and an element that is never squeezed never has a reason to wrap. The
`flex-wrap` is dead code sitting next to the declaration that killed it, which is
exactly why it survives review: the line you would look for is *there*.

Found on #621. The Regal's header row (BGG import link ~269px + search pill 205px
+ sort select 117px ≈ 540px of tools) sat in a **280px** content column at 320px,
so the whole page went into horizontal scroll and `.sort-select` rendered entirely
off-screen (measured at 390px: **231px** of page overflow, sort starting at
x=504). It had been that way since the tools row was built.

**The fix is `flex: 0 1 auto` (shrink, don't grow) plus `min-width: 0`, not
`1 1 auto`.** A grow factor makes the row fill the space `.section-head`'s
`justify-content: space-between` uses to push it to the right edge, so the desktop
toolbar silently re-lays-out. Measured at 1000px: `0 1 auto` is byte-identical to
the old `none` (tools 607.1px at x=372.9); `1 1 auto` is not.

## The floor one level down: a flex item's automatic minimum size

Shrinking the container is not enough on its own. Every flex item defaults to
`min-width: auto`, i.e. **its min-content width**, so one fixed-width descendant
pins the whole chain: `.search-pill input { width: 150px }` held the pill at
~205px however hard the row was squeezed. Both the pill *and* the input need
`min-width: 0`.

Express the input's size as a **flex basis** (`flex: 0 1 150px`), not a `width`.
Same rest geometry, but it can shrink — and keep the grow factor at 0 for the
reason above: with `1 1 150px` the input takes its ~178px *max-content* wherever
the pill has slack, widening the desktop row by 27.5px.

## The ≤520px block is declared ABOVE the components it overrides

`@media (max-width: 520px)` sits at ~line 876 of `styles.css`, while the
components it re-styles live hundreds to ~1600 lines further down. So a
phone-block override at the **same specificity** as its base rule loses on source
order — and every such loss is silent.

This bit twice in one PR:

| Override | Lost to | What shipped |
|---|---|---|
| `.tools-label--short { display: inline }` | `.tools-label--short { display: none }` (~40 lines below) | **both** spellings hidden → the BGG import control rendered as a bare icon with **no accessible name** |
| `.result-row__score { text-align: left }` | `.result-row__score { text-align: right }` (~1600 lines below) | the block stayed right-aligned under a left-aligned title |
| `.mood { width: 56px; height: 60px }` | `.mood { width: 64px; height: 68px }` (~770 lines below) | every phone rendered the rating faces at the **desktop** size, for the life of the block |

**The third one is the instructive one: it was already there while #621 was being
fixed, and #621 did not find it.** Both of its own losses were caught by *looking
at* the affected control; a face that is 8px too tall looks like a design choice,
so the only way it surfaced was measuring `getComputedStyle` for an unrelated
reason (#666's height budget, where the 8px was real money). So when you find one
of these, **sweep the block** — `getComputedStyle` every declaration in it and
diff against what it says — rather than fixing the one you tripped over.

Compound them (`.section-tools .tools-label--short`, `.result-row
.result-row__score`, `.rating .mood`) so they win on specificity. This is
`.claude/rules/responsive-content-width.md`'s "your rule will lose" — same
lesson, opposite end of the viewport axis; that file records it for the ≥1280px
rail block, where three of five hides lost on the first try.

`test/phone-width-overflow.test.js` compares the two selectors' specificity
rather than asserting a rule exists, because "the rule is there" is exactly what
is true in the broken state. `test/vote-card-viewport-fit.test.js` does the same
for `.mood` and for every override in the vote card's own phone block; the shared
`specificity`/`outranks` helper lives in `test/support/css.js`.

## Verifying overflow: `clientWidth` is honest, `window.innerWidth` is not

The Browser pane is known to report `innerWidth === 0`
(`.claude/rules/preview-pane-paint-artifacts.md`). **On an overflowing page it
fails the other way**: measured 390px viewport, `window.innerWidth` reported
**621** — the overflowed width — while `documentElement.clientWidth` correctly
said 390. So every rect comparison against `innerWidth` reports *no overflow* on
precisely the pages that have it.

```js
const de = document.documentElement;
de.scrollWidth - de.clientWidth;              // the number that matters; must be 0
// offenders: skip position:fixed, which is measured against the ICB
[...document.querySelectorAll('*')].filter((el) => {
  const b = el.getBoundingClientRect();
  return (b.width || b.height) && getComputedStyle(el).position !== 'fixed'
    && (b.right > de.clientWidth + 0.5 || b.left < -0.5);
});
```

Sweep whole screens with `window.routeTo(path)` in a loop rather than one
`navigate` per screen — `routeTo` is a top-level `function`, so it is reachable
as a `window` global (`.claude/rules/in-app-nav-links.md` §1), and the transient
session-flow screens the router refuses to resolve on a cold load are reachable
the same way (`showStartSession(round)`, then click through). That is how #621's
sweep found the **second** overflow site, on the results screen, which nobody had
reported.

Clear the service worker before believing any `styles.css` check
(`.claude/rules/pwa-service-worker.md`) — the shell is cache-first.

## A CSS comment error is invisible to every check in this repo

While editing the block above, an edit left prose *outside* a `/* … */` pair. No
lint, no `check:syntax` and no test reads `styles.css` as CSS, so nothing
reported it; the browser's parser recovered and the page still rendered. It was
caught only because a CSS-**text** test looked up a rule by exact selector and
could not find it. Worth knowing when a rule you just added seems not to apply.

**Related:** `.claude/rules/flex-none-item-makes-the-row-data-dependent.md` (the
same declaration one level down — on an ITEM of a wrapping row, where it makes the
row's wrap point a function of that item's text, count and locale),
`.claude/rules/responsive-content-width.md` (the same specificity
lesson in the ≥1280px block, and why the column has one width),
`.claude/rules/responsive-hub-tabs.md` (where 520/860 come from),
`.claude/rules/css-text-assertions-strip-comments.md` (how the guarding test
parses the sheet), `.claude/rules/break-the-code-on-purpose.md` (each of the five
assertions was seen red against a deliberate break).
