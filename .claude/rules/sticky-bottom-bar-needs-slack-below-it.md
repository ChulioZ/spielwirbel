---
paths:
  - "public/styles.css"
---
# `position: sticky; bottom` travels over the element's PRECEDING siblings — so a bar with nothing above it cannot pin

#1015 put the session setup's draw count, summary and „Loswirbeln" into one
`.setup-bar` at the end of `.setup-grid__aside`, declared

```css
.setup-bar { position: sticky; bottom: 12px; z-index: 2; }
```

with a comment promising it would pin to the viewport floor on a long page. It
does not, and the failure is completely invisible: the declaration is valid, the
computed `position` really is `sticky`, and on a page that already fits — which
is every page you check while building the thing that makes it fit — the bar is
in view anyway, so it looks like the rule is working.

## The mechanism

A sticky element is constrained to its **sticky containing block**, the nearest
block-container ancestor. For `bottom`, it is shifted upward and the shift is
clamped by that ancestor's **TOP** edge — i.e. the budget is everything the
element can travel *over*, which is its **preceding siblings**, not the slack
below it.

**This file said the opposite for its first three weeks, and the wrong version
survived a measurement.** It read "it can be pulled upward only as far as that
ancestor's own box reaches below it", because #1015's aside held *nothing above*
its bar — so the only travel available happened to equal the container's bottom
padding, and both readings predicted 50px. A rule derived from one case where
two mechanisms agree is a coin toss that came up heads.

Corrected with the `static` control on #1039's `.gd-bar`, in **both engines**
(390×844, bar bottom relative to the viewport floor):

| scroll | `static` | `sticky; bottom: 12px` |
|---|---|---|
| 0 | −232 | −55 |
| 120 | −112 | **+12** |
| 240 | +8 | **+12** |

177px of travel — far more than any padding below it, and exactly the distance
to `.pass__table`'s top edge. Chromium and WebKit agree to the pixel.

#1015's own numbers, re-read under the corrected mechanism: measured at 390×844
with one add-on open (page 1057px), `sticky; bottom: 12px` put the bar top at
**1001** and `static` at **1051**. 50px, and the aside above the bar was empty —
so there was nothing to travel over and the 50px was all the containing block
had. The reading "it moved by the padding" and the reading "it moved to the
container's top" are indistinguishable on that one case.

## The rule

**Before writing `position: sticky; bottom`, ask what sits ABOVE the element
inside its containing block, and where that block's top edge is on screen.**
Travel is the distance to that top edge, so:

- a bar whose containing block holds **only the bar** cannot move (#1015);
- a bar with real content above it inside the same block pins while that content
  scrolls past (#1039);
- a bar whose containing block **starts below the fold** cannot reach the fold at
  rest, however much content is above it — measured on #1039's phone layout,
  where `.pass__table` began at y=813 in an 844px viewport and the pin stopped
  55px short. The fix is to widen the containing block, not to change the inset:
  `display: contents` on the wrapper below 860px promotes the bar's siblings to
  `.pass` (top at y=120) and it pins at the floor at scroll 0.

**And measure it with the `static` control** — that is what discriminates here,
not the WebKit probe (`.claude/rules/break-the-code-on-purpose.md`). Run the
probe too when the surrounding layout is a recent feature: #1039's is, and both
engines matched to the pixel on the tracks, the pin and `display: contents`.

Reach for `position: fixed` only as a last resort: it overlays content the user
cannot scroll out from under, and it costs the viewport height permanently.

## Why the comment was the dangerous part — in both directions

#1015's CSS was merely useless; its comment asserted a behaviour, so the next
session would have read "the bar pins to the bottom" and designed around a
guarantee that was never there — the
`.claude/rules/deferred-weakness-attributions-rot.md` shape one layer down, where
prose claims a mitigation the code does not implement. A declaration you cannot
demonstrate needs either a measurement beside it or removal.

**The correction above is the same failure with the sign flipped, and it is the
worse one.** For three weeks this file talked sessions *out* of a technique that
works: #1039 came within one commit of shipping an in-flow bar and a comment
saying sticky was impossible here, on this rule's authority. A rule stating a
mechanism is as load-bearing as code, so derive it from a case where the
candidate mechanisms **disagree** — or say in the file that you could not.

**Related:** `.claude/rules/setup-screens-two-column-layout.md` (the screen this
happened on, and the fit that replaced it),
`.claude/rules/card-tracks-are-a-fraction-of-a-fraction.md` (the other #1039
measurement, and the same "a number chosen against the viewport is the wrong
number" shape),
`.claude/rules/browser-pane-is-chromium-only.md` (the probe that found it — run
for `100dvh` and sticky-in-grid, both of which turned out FINE; this was the
unrelated thing the control exposed),
`.claude/rules/break-the-code-on-purpose.md` (the `static` control).
