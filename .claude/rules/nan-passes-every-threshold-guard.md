---
paths:
  - "test/**"
  - "public/js/**"
  - "lib/**"
---

# `NaN` satisfies every `<` and `>` guard — a type slip makes a threshold sweep unfailable

`test/a11y-contrast.test.js`'s helpers take **RGB triples**, not hex strings.
#1187 added a sweep over every design's marker colours and handed `contrast()`
the hex straight out of the registry:

```js
const ratio = contrast(tok.onAccent, stop);      // stop === '#2f6b4d'
if (ratio < 4.5) fails.push(…);                  // ratio is NaN — never pushes
```

Every comparison against `NaN` is **false**, so `ratio < 4.5` never fired. The
test reported sixteen designs' worth of colours as clearing AA while measuring
nothing at all. Measured: with one marker set to `#ffdd00` — white on it is
1.35:1, a colour nobody could read — the sweep stayed **green**.

## Why this one is worse than an ordinary vacuous test

- **The assertion is real and the loop is real.** `checked` counted the right
  number of pairs, the anti-vacuous floor passed, and the failure list was
  genuinely built from the loop. What was wrong sat one call deeper.
- **`NaN` fails in the SAFE-LOOKING direction.** A guard phrased as "collect
  everything below the bar" reports an empty list, which is exactly what a clean
  sweep reports. Had the guard been `assert.ok(ratio >= 4.5)` it would have gone
  red immediately — the phrasing that reads as more forgiving is the one that
  silently stops working.
- **No type error anywhere.** `contrast` destructures its arguments, so a string
  yields `undefined` components and arithmetic on them, not a throw.

## The rule

**A threshold sweep is not evidence until you have seen it red.** Break one input
on purpose — a value you can compute the wrong answer for by hand — and check the
failure message names *that* input. It is one run, and it is the only thing that
distinguishes a measurement from a shape.

And when a helper takes a parsed type, **convert at the boundary rather than
trusting the caller**: `contrast(ink, rgb(stop))`, where `rgb()` passes an array
through and parses a hex. `test/support/theme.js` already exported it.

The same slip is available anywhere a number is compared to a bar —
`durationMs`, a coverage floor, a quota check, a size budget. Ask what the
expression evaluates to when the input has the *wrong shape*, not only when it
has the wrong value.

## The second half: the break found a REAL defect

Fixing the type turned the sweep red for Der Tisch, at 2.81:1 — the picker's
check glyph was `--on-accent`, which is near-black on a dark design, painted on a
dark felt. So the vacuous version was hiding a shipped bug on the one screen the
issue was adding. That is the usual shape: a guard nobody has seen fail is
usually guarding something that is already wrong.

**Related:** `.claude/rules/break-the-code-on-purpose.md` (the discipline this is
an instance of — Route 2, because the colours already existed),
`.claude/rules/measure-text-ink-not-its-box.md` (the sibling: a probe that
answers a *different* question and therefore agrees with every implementation),
`.claude/rules/theme-derived-colors.md` (the non-flipping-ink rule the real
defect broke), `.claude/rules/accessibility-contrast-and-modals.md` (the suite).
