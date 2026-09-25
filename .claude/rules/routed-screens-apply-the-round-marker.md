---
paths:
  - "public/js/views-session.js"
  - "public/js/views-session-tables.js"
  - "public/js/views-round.js"
  - "public/js/router.js"
---

# A routed screen applies the round's marker ITSELF — and an early return skips it

`applyMarker(round)` (`public/js/round-theme.js`) is what puts a round's colour
marker on `<html>` — `--marker`, `--marker-deep`, `--marker-ink` and the
`data-marked` hook every marker rule keys off. Until the flip (#1202) the same
line was `applyBackground(round.background)` and put the round's whole design
there (palette, accent, scheme, world); since rounds stopped owning a design the
marker is all that is left, and the trap below is unchanged.

The hub calls it, so every screen reached *by navigating* inherits it for free.
That freeness is the trap: a screen with its own URL is also reached **cold** — a
shared link, a reload, a Chronik entry, the browser's back button — and on that
path nothing has run but the router.

#940 fixed this for the results screen, and `showResults` says so in a comment:
the round's look is applied *there*, not left to the hub, because a results URL
is shared and cold-loaded.

## What the fix missed, and why nothing could see it

`showResults` opens with a delegation, and the delegation sits **above** the
line that fixed it:

```js
async function showResults(round, session, gamesHint, reveal, plain) {
  if (!plain && (session.multiTable || isSplitParent(session)))
    return showTableBuilder(round, session, gamesHint);   // ← leaves here
  applyMarker(round);                                     // ← never reached
```

So a split evening's screen rendered without its round's look. Measured on the
seeded demo (2026-09-07), when the look was still a design: a cold load of
`/round/<rid>/session/<parent>` on a Sci-Fi round reported `data-world === null`,
`data-scheme === null`, `--page-bg` unset.

**Nothing goes red over it and nothing looks broken.** The screen is complete,
legible and correctly laid out; it is simply not wearing its round's colour, and
only someone who knows what that round looks like can tell. jsdom applies no
stylesheet, so the only assertion that can see it is one over
`document.documentElement` after running the view
(`test/split-results-spotlight.test.js`, `test/session-screens-apply-design.test.js`).

## The rule

**Every function that owns a URL calls `applyMarker` at its own top** — before
any branch, and before any delegation; `applyMarker(null)` on a screen outside a
round, which is the clear that keeps a round's colour off home. It is idempotent,
so a screen reached from the hub pays nothing for the second call, and that
cheapness is the whole argument for making it unconditional rather than clever.

The general shape, which outlives this one function: **a fix placed after an
early return exempts exactly the branch that returned early**, and a delegating
`return` is easy to read as "handled elsewhere" when the elsewhere is a sibling
that never had the fix. When you add a setup line to a function, check what
leaves above it.

**Related:** `.claude/rules/dark-designs-and-the-on-accent-flip.md` (the
scheme, which since the flip only the account's design decides),
`.claude/rules/theme-color-meta-tag.md` (what `paintDesign` writes),
`.claude/rules/session-flow-history.md` (which session screens the router will
and will not resolve cold — the ones it resolves are exactly the ones this rule
binds).
