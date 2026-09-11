---
paths:
  - "public/styles.css"
---
# `position: sticky; bottom` on a container's LAST CHILD moves it by the container's padding, and nothing more

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
block-container ancestor. For `bottom`, it can be pulled upward only as far as
that ancestor's own box reaches below it. A **last child** has nothing below it
but the container's bottom padding/border/margin — so that is the entire budget.

Measured at 390×844 with one add-on open (page 1057px), in **both engines**:

| | bar top at scroll 0 |
|---|---|
| `position: sticky; bottom: 12px` | **1001** |
| `position: static` | **1051** |

50px of travel, viewport 844 — out of view either way. Chromium and WebKit agree
to the pixel, so this is the spec, not an engine quirk. Don't reach for the
WebKit probe here; reach for the **`static` control**, which is the measurement
that discriminates (`.claude/rules/break-the-code-on-purpose.md`).

## The rule

**Before writing `position: sticky; bottom`, ask what sits below the element
inside its containing block.** If the answer is "nothing", the declaration is
decoration. To make it real, one of:

- give the element **following siblings** in the same container (it sticks while
  they scroll past);
- make the container **taller than its content** — but on a full-page scroll
  that means adding page height, which is self-defeating when the whole point
  was to shorten the page;
- use `position: fixed`, accepting that it overlays content the user cannot
  scroll out from under, and that it costs the viewport height permanently.

#1015 took none of them: the bar is a plain in-flow card, and what keeps the
button reachable is the screen **fitting** — measured at 390×844, 768×1024,
1280×800, 1470×870 and 1728×1030 with the button in view at scroll 0.

## Why the comment was the dangerous part

The CSS was merely useless; the comment asserted a behaviour, so the next
session would have read "the bar pins to the bottom" and designed around a
guarantee that was never there — the
`.claude/rules/deferred-weakness-attributions-rot.md` shape one layer down, where
prose claims a mitigation the code does not implement. A declaration you cannot
demonstrate needs either a measurement beside it or removal.

**Related:** `.claude/rules/setup-screens-two-column-layout.md` (the screen this
happened on, and the fit that replaced it),
`.claude/rules/browser-pane-is-chromium-only.md` (the probe that found it — run
for `100dvh` and sticky-in-grid, both of which turned out FINE; this was the
unrelated thing the control exposed),
`.claude/rules/break-the-code-on-purpose.md` (the `static` control).
