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
