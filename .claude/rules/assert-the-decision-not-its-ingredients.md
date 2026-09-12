---
paths:
  - "test/retire-score-threshold.test.js"
  - "test/a11y-contrast.test.js"
  - "test/support/css.js"
  - "public/js/game-stats.js"
  - "public/js/vote-score.js"
  - "public/styles.css"
---

# A test that RE-DERIVES a decision cannot see a bug in the decision

`test/retire-score-threshold.test.js` guards which games the archive banner
proposes for retirement. It is a careful file — it reads `LOW_SCORE` out of
`core.js` rather than hand-copying it (#420), it pins the anchor, it wires the
demo fixture into a real assertion. And every assertion in it was of this shape:

```js
assert.ok(scoreRatings([0, 4, 5, 3]).score > LOW_SCORE, 'one veto must not trip the rating branch');
```

That is not the banner's decision. It is the test **re-implementing** the
decision — `score <= LOW_SCORE` — from the two ingredients, and then checking its
own arithmetic. `retireRecommendations()` is never called.

So the file could not see #922: the veto curve is divided by the **voter count**,
so one dissenter weighs `TILE_VALUE[1] / n` — `{1,4,4}` scores exactly 1.0 and is
proposed, `{1,4,4,4}` scores 1.75 and is not. Same votes, same lone dissenter,
opposite verdicts. Every shape the file pinned was n=4, and at n=4 the behaviour
was correct, so it stayed green for months over a banner that was nagging
three-person rounds about games they liked.

## Why the proxy is so convincing

The re-derived form looks *stronger* than calling the function: it names the
threshold explicitly, it reads like the specification, and it needs no fixture,
no harness and no DOM. Calling `retireRecommendations()` here costs a jsdom
context and a round object — real friction, in exchange for a test that appears
to say the same thing.

It does not say the same thing. The proxy sees only the two values the author
thought of; the real function also reads the vote counts, the per-tile histogram
and `minVotes`, and a bug living in **any factor the proxy left out** is
invisible to it. Group size was that factor, and it was invisible precisely
because the proxy has no notion of a group at all — it takes a list of numbers.

## The rule

**Call the function under test with the inputs the app gives it, and assert the
answer the user sees.** Where the decision is "does this appear on screen", the
assertion is `proposed(votes) === false`, not `score > THRESHOLD`.

Keep a threshold assertion only for what it genuinely pins — an **anchor**, i.e.
a claim about what the constant *means* (`scoreRatings([2,2,2,2]).score ===
LOW_SCORE` — "the bar is a flat 2 from everybody"). That is a statement about the
number, and asserting the number is right. Everything about *membership* goes
through the real call.

**And sweep the dimension the ingredients hide.** When the decision divides,
averages or shares, group size is a free variable the proxy never exposed — so
the shapes get run at n=3, 4 and 5. Expect some sizes to be controls that are
green from the start (a lone dissenter can never reach `LOW_SCORE` at n=5); say
in a comment which rows discriminate and which do not, or the next reader assumes
the whole sweep is load-bearing.

## The CSS instance: the decision is the CASCADE, and a token pair cannot see it

Same shape, different medium, and it shipped an invisible control for months
(#1053). `test/a11y-contrast.test.js` measured

```js
['--on-accent on the accent (.btn--primary, .chip.is-on)', t.onAccent, t.brand],
```

which is exactly the right pair for a set add-on chip — and it is the pair the
*rule intends*, not the pair the browser paints. `.chip.is-on` (0,2,0) and
`.setup-addons__chip[aria-expanded="true"]` (0,2,0) tie, and the second is
declared ~5800 lines later, so a chip that was both set and open took its
`background` from one rule and its `color` from the other: `--brand-strong` on
`--brand`, 1.07–1.31:1 on all fifteen designs.

**Both tokens cleared every bar they were measured against.** There is no
ingredient to fix and no assertion to strengthen — the decision is made by the
cascade, which lives in neither rule.

So `test/support/css.js` gained `resolvedDeclaration(el, prop)`: describe the
element (`{ tag, classes, attrs }`), collect every rule whose subject compound
matches, rank by specificity then source order, and measure **whatever wins**.
Reverted, the sweep now reports the real per-design ratios instead of going green
on the intended pair. Three things about it are load-bearing:

- **It throws on any shape it cannot model** — an unknown pseudo-class, a
  `@media`-scoped setter, a selector `specificity()` does not count correctly.
  A cascade model that silently fails to match makes every assertion built on it
  vacuous, which is the failure it exists to prevent.
- **`specificity()` had to be fixed first.** It counted `:not(.a)` as two classes
  and let an attribute selector's *value* count as a tag, so it read the offending
  rule as (0,2,1) — an outright win rather than the tie it is. An over-count
  cannot see a tie, and a tie is the whole bug.
- **The unbroken states are the control.** Assert the closed and unset chips
  resolve as before, or a matcher that matches nothing satisfies the new test by
  accident.

The tell generalises: **whenever a CSS value can be set by more than one rule, a
test naming the tokens is testing the author's intent.** Resolve the element.

## Recognising it before it costs you

The tell is a test that names the implementation's own constants and operators in
its assertion. If you can delete the function under test and the file still
passes, it was never testing that function — which is the
`.claude/rules/break-the-code-on-purpose.md` check, and here it is unusually
cheap: `retireRecommendations` was not referenced by the spec at all, only by its
header comment.

**Related:** `.claude/rules/break-the-code-on-purpose.md` (the discipline this is
an instance of — a green test that guards nothing),
`.claude/rules/state-rules-clobber-component-values.md` (the CSS half's sibling:
a state rule REPLACING what a component declared, also with nothing red),
`.claude/rules/css-text-assertions-strip-comments.md` (the other trap in reading
this stylesheet as text),
`.claude/rules/testing-views-under-jsdom.md` (the harness that makes calling the
real function affordable, and the cross-realm `deepEqual` trap you meet on the
way), `.claude/rules/shared-constants-across-the-stack.md` (the sibling failure:
a test constant hand-copied from the thing under test).
