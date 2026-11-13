---
paths:
  - "public/styles.css"
  - "public/css/**"
  - "test/support/live-roster.js"
---

# A container query must switch ON the fragile layout, never switch it OFF

The live-vote roster in Der Tisch and Ocean (#1719) made its richer row the
DEFAULT at ≥1280px — „Für …" inline in the row's only flexible track, beside
the boxes (≤180px) and a 122px count — and relied on
`@container tisch-roster (min-width: 930px)` to move the key back to a line of
its own once the rows went two-up. #1817: a Safari user saw two-up rows with the
key squeezed to a 31px pill, „Für / Lau…" spilling out of it.

What was measured (WKWebView probe + headless Chrome, synthetic page over the
shipped sheets):

- **Current WebKit evaluates the query correctly**, at every width from 1350 to
  1420 in 4px steps, after a container resize and after a re-render. It is not
  a WebKit container-query bug.
- **The failing state is exactly "the query does not match while the rows are
  narrow"**: forcing `containerType = 'normal'`, or a one-up roster ~460px wide,
  reproduces the reported numbers in both engines (Tisch 31px, Ocean 43px).
- The likeliest real cause is a **Safari without container queries (before
  16)**: it ignores `container` and `@container` and still flows two-up.

## The rule

Put the composition that is safe at **any** box width outside every container
query, and put the richer one inside a query that **positively** says the box
is wide enough — bounded on both sides when the box can also be too narrow
(here `(min-width: 700px) and (max-width: 929.98px)`). An unmatched or
unsupported query then lands on the safe layout instead of the broken one.

The inverse shape looks equivalent while every query matches, so nothing in
Chromium can tell them apart; force the query off (`containerType = 'normal'`)
as the control. `test/support/live-roster.js` pins the default.

**Related:** `.claude/rules/card-tracks-are-a-fraction-of-a-fraction.md` (why
the roster uses a container, not a viewport query),
`.claude/skills/browser-verification/browser-pane-is-chromium-only.md` (the probe).
