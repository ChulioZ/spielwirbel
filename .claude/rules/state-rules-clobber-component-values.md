---
paths:
  - "public/styles.css"
  - "test/**"
---

# A `:active`/state rule's ABSOLUTE value replaces what the component declared

The chunky-button press effect shrinks `.btn`'s bottom border by 2.5px and adds a
compensating bottom margin so nothing below the button moves:

```css
.btn:active { transform: translateY(2px); border-bottom-width: 1.5px; margin-bottom: 2.5px; }
```

The intent is stated in the block comment and the arithmetic is right. The bug
(#615) is that `2.5px` is **absolute where it has to be additive**. `.btn:active`
is (0,2,0) and every component rule is (0,1,0), so on press the value is
**replaced**, not added to — and it works only for a button whose resting bottom
margin happens to be 0, which was every button until `.hub-cta`.

`.hub-cta` declares `margin: 4px 0 18px`, so pressing "Session wirbeln" took its
bottom margin 18px → 2.5px and **the entire Start tab below it jumped up 18px for
the duration of the press** (measured at 390px; the visible gap went 18px → 0.5px
because the face also translates down 2px). Worst on touch, where `:active`
persists for the whole press instead of flashing for one frame.

Nothing detects this: the resting page is correct, no test is red, and the effect
looks deliberate to anyone who doesn't know what the gap should be.

## The rule

A state rule (`:active`, `:hover`, `.is-*`) that adjusts a property a component
may also declare must express the adjustment **relative to a custom property the
component can set**, never as a literal:

```css
.btn            { --btn-mb: 0px; }                              /* the default */
.btn:active     { margin-bottom: calc(var(--btn-mb) + 2.5px); } /* 4px -> 1.5px */
.btn--ghost:active { margin-bottom: var(--btn-mb); }            /* 1.5px, no shrink */
.btn--sm:active    { margin-bottom: calc(var(--btn-mb) + 1.5px); } /* 3px -> 1.5px */
.btn.hub-cta    { --btn-mb: 18px; }
```

`.btn--ghost` is the instructive one: its border is already 1.5px at rest, so it
compensates by **nothing** — but it must still restate `var(--btn-mb)`. Writing a
bare `0` there (which is what it had) is the identical bug one variant over,
waiting for the first ghost button with a margin.

## Two ways to get the fix itself wrong, both silent

**1. The override must be COMPOUNDED.** `.btn` declares the `--btn-mb` default
and sits ~450 lines *below* `.hub-cta` in the sheet. A bare `.hub-cta { --btn-mb:
18px }` ties at (0,1,0) and **loses on source order**, resetting the compensation
to zero with the fix apparently in place. `.btn.hub-cta` is (0,2,0) and wins
outright — the same remedy as `.ds-row.ds-row--static`.

**2. Leave the resting margin where it is.** Moving it into the custom property
(`.hub-cta { --btn-mb: 18px; margin: 4px 0 0 }` + `.btn { margin-bottom:
var(--btn-mb) }`) reads better — one number, one place — and creates a *second*
(0,1,0) tie, this time deciding the app's primary CTA's **resting** look by block
order. Keeping the 18px in the shorthand means only `:active` (0,2,0) ever reads
the property, so the resting geometry cannot be affected at all. The cost is that
two declarations hold the same number; `test/button-press-compensation.test.js`
asserts they agree.

That test also pins the arithmetic per variant (pressed margin === resting margin
+ the border shrink, derived from the declared border widths), so a future retune
of the press effect cannot silently reintroduce the clobber.

## The same tie without a state rule: declarations that are simply DEAD

`.hub-cta` and `.btn` are both (0,1,0) and `.btn` is declared ~450 lines later,
so **every property named in both resolves to `.btn`'s value**. That is not
specific to `:active` — it had also been quietly discarding the CTA's own
`font-size`, `padding` and `border-radius` since the button was built. It
rendered at ordinary `.btn` size (`11px 20px` / 18px / 14px) while its rule asked
for `18px` / 22px / 18px, and the tell was visible on screen the whole time:
`.hub-cta .ti` *is* more specific, so the icon sized at 26px next to a label that
never got past 18px.

`.rail__cta` (the ≥1280px rail's copy of the CTA) had it too — a
`var(--text-md)`/`12px 16px` that never once applied. Being inside a media block
buys a rule no specificity.

**The two were resolved in opposite directions, and both are correct.** The phone
CTA's declarations moved into `.btn.hub-cta` and now apply; the rail's were
**deleted**, so `.btn`'s 18px/`11px 20px` becomes the decision rather than the
accident (operator call: the primary action should read a step above the 16px
section links beside it). Either answer is fine — what is not fine is leaving a
declaration that looks live and is not. So the test asserts the invariant both
satisfy — **no button component may declare what `.btn` also declares** — over a
list of *selectors*, not of properties, so a new dead declaration in either block
is caught without editing it.

**But do NOT promote the whole block to (0,2,0) to fix this.** `.hub-cta`'s
`display: flex` is competing with `.app .rail-owned { display: none }` (0,2,0),
declared ~200 lines *above* it, which is what removes the phone CTA from the
desktop layout. Raise the block and that hide becomes a tie this rule wins on
source order — so the phone CTA renders on desktop **beside the rail's own**.
Nothing errors; there are simply two CTAs. Hence the split: layout properties
stay at (0,1,0) in `.hub-cta`, and only what must beat `.btn` moves into
`.btn.hub-cta`. Both halves have their own test.

## The one that got away

`.handover__go:active` carries its own hand-copied `margin-bottom: 2.5px` and is
**not** a `.btn`, so `--btn-mb` does not reach it — and being outside the family,
the test above does not see it either. It is correct today only because
`.handover__go` declares no resting margin. Give it one and the bug is back, with
none of the above protecting it.

## Verifying this without a real press

`:active` cannot be forced from `javascript_tool`, and the Browser pane's input
pipeline is unreliable anyway (`.claude/rules/preview-pane-paint-artifacts.md`).
Apply the state rule's declarations **inline** instead — inline styles outrank
every rule, so this exercises real layout — and measure what must not move:

```js
const before = ticket.getBoundingClientRect().top;
cta.style.transform = 'translateY(2px)';
cta.style.borderBottomWidth = '1.5px';
cta.style.marginBottom = 'calc(var(--btn-mb) + 2.5px)';   // vs '2.5px' for the old behaviour
ticket.getBoundingClientRect().top - before;               // 0 fixed, -18 before
```

Measuring the *old* literal in the same probe is what makes the result mean
something: a shift of 0 proves nothing until you have seen the same probe report
−18 against the value that shipped. Clear the service worker first, or you are
measuring the cached stylesheet (`.claude/rules/pwa-service-worker.md`).

**Related:** `.claude/rules/label-rows-lose-to-field-label.md` and
`.claude/rules/ds-row-is-a-click-target.md` (the same family — a component rule
losing to a more specific base rule, with no error and no failing test),
`.claude/rules/responsive-content-width.md` (win on specificity, never on source
order), `.claude/rules/break-the-code-on-purpose.md`.
