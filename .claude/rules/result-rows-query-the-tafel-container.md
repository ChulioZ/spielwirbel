---
paths:
  - "public/styles.css"
  - "public/css/designs/*.css"
  - "public/js/result-compose.js"
  - "public/js/views-session-result-tafel.js"
---
# The result's row form queries `.result-main`, never `.tafel` — and the columns query the screen

Since #1846 the session result is laid out by phase (`public/js/result-compose.js`),
and two things on it change *presentation* with the room they get — the case
`.claude/rules/card-tracks-are-a-fraction-of-a-fraction.md` reserves `@container`
for. Both used to be viewport queries measuring the wrong box: the Tafel's
one-line row switched at `@media (min-width: 1280px)` while the two-column screen
gave the Tafel 576–626px at 1280–1470, so titles got ~60px and rows 240px.

| Container | Name | What queries it |
|---|---|---|
| `.result-screen` | `result-screen` | the two columns (900px), the 380px aside (1100px), the pinned aside |
| `.result-main` | `tafel` | every design's one-line row and its phone row |

## Why the `tafel` container is `.result-main`, not `.tafel`

The issue proposed `.tafel { container: tafel }`. It does not work for every
design: **an element cannot be styled by its own container query**, only its
descendants can, and Der Tisch and Das Programmheft lay out the `.tafel` ITSELF
(its `grid-template-columns`, which its rows inherit as a subgrid). On `.tafel`
those rules would silently never apply. `.result-main` is the Tafel's parent and
the Tafel is its full width, so the measurement is the same and both kinds of
rule can query it. (Die Brücke pads `.result-main` from 860px; its threshold is
measured against that box, which is what the number means.)

The landing page's `.tafel` sits in no `.result-main`, so it never matches a
container rule; it keeps the viewport rule its stage box is sized against
(`.landing-moments .tafel .trow`, pinned by `test/landing-moments.test.js`).

## The thresholds are MEASURED per row shape — re-measure if a row changes

Each one is where that design's one-line row leaves the title track ≥ ~180px:
Klassisch 720, Der Tisch 560, Die Brücke 540, Das Programmheft 540, Ocean 600,
Forest 600 (measured at 1024 with a 588/548px Tafel). Re-run the probe in
`test/result-phase-layout.test.js`'s spirit — the narrowest `.trow__main` across
designs at 1024, 1280 and 1470 — after touching a row's tracks; a CSS-text test
cannot see the width.

## `container-type` has a cost: check what is positioned inside

`inline-size` containment makes the element a size container, not a containing
block for `position: fixed` — but it does establish style containment and an
independent formatting context. Nothing on the result screen is fixed (the phone
bar is `sticky`, which is unaffected), and WebKit agreed with Chromium on every
rule (measured #1846 with the WKWebView probe). A `position: fixed` descendant
added later is the thing to check first if it renders in the wrong place.

**Related:** `.claude/rules/card-tracks-are-a-fraction-of-a-fraction.md` (the
general rule, and the first two instances), `.claude/rules/tiles-vs-lists.md`
(why the ranking stays a list while the screen gains columns),
`.claude/skills/browser-verification/browser-pane-is-chromium-only.md` (the probe).
