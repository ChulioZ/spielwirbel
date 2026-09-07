---
paths:
  - "public/js/views-session.js"
  - "public/js/views-session-tables.js"
  - "public/js/views-round.js"
  - "public/js/router.js"
---

# A routed screen applies the round's design ITSELF — and an early return skips it

`applyBackground(round.background)` is what puts a round's palette, accent,
`data-scheme` and `data-world` on `<html>`. The hub calls it, so every screen
reached *by navigating* inherits it for free. That freeness is the trap: a
screen with its own URL is also reached **cold** — a shared link, a reload, a
Chronik entry, the browser's back button — and on that path nothing has run but
the router.

#940 fixed this for the results screen, and `showResults` says so in a comment:
the design is applied *there*, not left to the hub, because a results URL is
shared and cold-loaded.

## What the fix missed, and why nothing could see it

`showResults` opens with a delegation, and the delegation sits **above** the
line that fixed it:

```js
async function showResults(round, session, gamesHint, reveal, plain) {
  if (!plain && (session.multiTable || isSplitParent(session)))
    return showTableBuilder(round, session, gamesHint);   // ← leaves here
  applyBackground(round.background);                      // ← never reached
```

So a split evening's screen — the whole screen, not one component — rendered on
the Standard light palette however the round is dressed. Measured on the seeded
demo (2026-09-07): the round stored `{ type: 'theme', id: 'scifi' }`, a dark
world, and a cold load of `/round/<rid>/session/<parent>` reported
`data-world === null`, `data-scheme === null`, `--page-bg` unset.

**Nothing goes red over it and nothing looks broken.** The screen is complete,
legible and correctly laid out; it is simply wearing another round's clothes,
and only someone who knows what that round should look like can tell. There is
no error, no console warning, and no test — jsdom applies no stylesheet, so a
CSS assertion cannot see it either. The only assertion that can is one over
`document.documentElement`'s attributes after running the view
(`test/split-results-spotlight.test.js`).

## The rule

**Every function that owns a URL calls `applyBackground` at its own top** —
before any branch, and before any delegation. It is idempotent, so a screen
reached from the hub pays nothing for the second call, and that cheapness is the
whole argument for making it unconditional rather than clever.

The general shape, which outlives this one function: **a fix placed after an
early return exempts exactly the branch that returned early**, and a delegating
`return` is easy to read as "handled elsewhere" when the elsewhere is a sibling
that never had the fix. When you add a setup line to a function, check what
leaves above it.

**Related:** `.claude/rules/dark-designs-and-the-on-accent-flip.md` (what
`data-scheme` then changes), `.claude/rules/theme-color-meta-tag.md` (the other
thing `applyBackground` writes),
`.claude/rules/session-flow-history.md` (which session screens the router will
and will not resolve cold — the ones it resolves are exactly the ones this rule
binds).
