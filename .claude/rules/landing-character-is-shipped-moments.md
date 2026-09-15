---
paths:
  - "public/js/views-landing.js"
  - "public/js/landing-moments.js"
---
# The landing's character comes from SHIPPED moments, never from a metaphor

The logged-out hero shows the app's own loop — the pot, the vote card, the Tafel
— built from the real views' markup and moved by the real keyframes through the
real state hooks (`is-race`, `is-reveal`, `is-lift`, `data-unroll`). That is the
whole design constraint of `public/js/landing-moments.js`, and it is a rule
rather than a preference because the appealing alternative has been tried twice
and failed twice:

- **#438** removed six abstract `coverPlaceholder()` gradients from this hero.
  The operator's report was „man erkennt nicht, wie es funktioniert" — the page
  asking a stranger to register told them nothing about what they would get.
- **#1091's own first draft** proposed covers orbiting a table. It looked good
  and was rejected for the same reason one issue later: **no screen in the app
  does that**, so it is a promise the demo cannot keep one click after the CTA.

## The rule

A new piece of character on the landing page must be **something a user will
actually see inside the app**, rendered through the component that renders it
there. If showing it means writing a keyframe, a layout or a choreography that
exists nowhere else, that is the signal to stop — not a licence to build a
prettier hero.

The payoff is that the stage **cannot drift**: retune `trow-fill`, restyle the
mood faces or re-shape the pot and the landing changes with them, because there
is no second copy to forget. That property is spent the moment one scene is
special-cased, so keep the stage's own CSS to the box, the scene switch and the
few places a component must be told it is in a 520px hero.

## The corollary that bit immediately

**The app may DELETE a moment you were showing.** #1122 removed `pot-whirl` and
`press-in` a day after #1091 was filed, i.e. the turn the stage opened on and the
stamp it ended on. It also left two stylesheet-wide guards
(`test/session-pot.test.js`, `test/result-motion.test.js`) that fail if either
keyframe is declared **anywhere**, this stage included.

Both beats were **dropped**, not re-homed under a `.landing-moments` scope. That
is the answer this rule prescribes: scoping them here would have kept the stage
richer while making it show a turn the app no longer performs — the metaphor
problem again, one step subtler, and it would have needed the two guards
weakened to ship. **A stage beat is not a reason to keep a keyframe the app has
retired.**

So when a component the stage uses changes, the stage's job is to **follow**, and
when a component is removed the stage's beat goes with it. Grep before assuming a
hook still exists:

```bash
grep -rn "is-race\|is-reveal\|is-lift\|data-unroll" public/styles.css public/js/
```

## The fixed box is sized in PIXELS, and a ratio is the trap

The stage shows one scene at a time in a fixed box, because a box that grew per
scene would move the page on every cut. Expressing that box as an
`aspect-ratio` is the tidier-looking form and it is wrong: the box's content is
**text**, which gets taller as the column narrows, while a ratio makes the box
**shorter** at exactly the same moment. The two move in opposite directions.

Measured on #1091 with the ratio in place, in WebKit:

| width | box | tallest scene | result |
|---|---|---|---|
| 360px | 581 | 594 | 13px onto the caption |
| 1024px | 483 | 547 | 64px onto the caption |

The 1024 row is the instructive one: that is where the hero becomes two columns,
so the visual column drops to ~448px and the ratio takes the box down with it
while the vote card does not move at all. **Every laptop width was broken by the
mechanism meant to size the box.** `test/landing-moments.test.js` now pins the
explicit `height`, because "express this as a ratio" will be proposed again.

Two corollaries for anyone re-measuring it:

- **Sweep the bands, don't spot-check two widths.** The first pass checked 390
  and 1280 — which sit on *opposite sides* of every band that was broken, so both
  passed. The app's Tafel row is a two-line grid until `min-width: 1280px`, and
  the hero becomes two columns at 1024; those are the edges that matter.
- **Include the margins.** A "content height" summed from child
  `getBoundingClientRect()` excludes the last row's `margin-bottom` and the
  slot's — ~34px here — while the flex centring lays out with them, so the check
  under-reports exactly the overflow it exists to find.

## One clock, not two

The stage's timings live in one `setTimeout` chain in `landing-moments.js`; the
scene changes ride a `data-scene` attribute that same chain writes, cross-faded
by a CSS **transition**. The issue proposed a second CSS keyframe timeline for
scene visibility, which would have put the schedule in two units — percentages
of a keyframe against absolute ms — in two files. A retune then has to be made
twice, and the half nobody remembers drifts silently.

The one number the chain does restate from the stylesheet is `tafel-gold`'s
3.6 s, folded into `LM_LIFT` so the lift lands after the gold. Move it if that
keyframe is retuned; it is named in a comment there for that reason.

**Related:** `.claude/rules/landing-product-screenshots.md` (the walkthrough's
committed shots, which the hero no longer uses),
`.claude/rules/provider-cover-hotlinking.md` (why no game on the stage carries a
cover), `.claude/rules/frontend-script-load-order.md`.
