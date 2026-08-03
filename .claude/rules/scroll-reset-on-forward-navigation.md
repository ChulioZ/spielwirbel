---
paths:
  - "public/js/router.js"
  - "public/js/views-session.js"
  - "test/support/dom.js"
  - "test/nav-scroll-reset.test.js"
---

# Reset scroll AFTER `pushState`, and only in the push branch — either mistake fails silently

`syncUrl()` (`public/js/router.js`) resets scroll on a forward navigation (#623).
`pushState` does not touch scroll, so without it every navigation keeps the
previous screen's offset and the browser merely clamps it to the new document.
Measured before the fix: a Regal (8871px tall) scrolled to **2600**, opening a
game detail (2080px tall), landed at **2080 — the very bottom of the game
detail**, past the cover, the title and every chip.

Eighteen views had no reset. Only the session flow hand-rolled any, and those are
gone now — the central one subsumes them.

## 1. AFTER `history.pushState()`, never before

The browser records the **outgoing** entry's scroll position at navigation time.
Reset first and you write **0** into that entry, which destroys back-restoration
— for every screen, permanently, with nothing red anywhere to show for it.

Measured in isolation on a router-free page:

| Order | Scroll after `history.back()` |
|---|---|
| `pushState` → then `scrollTo(0, 0)` | **2600** — restored |
| `scrollTo(0, 0)` → then `pushState` | **0** — restoration lost |

`history.scrollRestoration` is left at `'auto'` and Chrome restores correctly
across the app's async re-renders — verified with a discriminating probe (leave
the Regal at 2600 → open a game detail → scroll *it* to 200 → Back → the Regal
came back at **2600**, not 200, so the restore is real and not an artifact of the
scroll never having changed). That behaviour is what this ordering protects.

## 2. The PUSH branch only — the replace branch is in-place re-rendering

`syncUrl`'s replace branch is not only "the router is driving". It is also how a
screen **re-renders itself**: `updateGame()` → `showGameDetail()` after every
PATCH, and the same shape in `showMember`, `showFriends` and others. A reset
written before the branch — or into the `show*()` bodies — jumps the user to the
top of the page every time they rename a game.

`test/nav-scroll-reset.test.js` pins both halves as an ordered sequence
(`['push', 'scroll:0,0']` vs `['replace']`), because two separate counters cannot
state the ordering that §1 is about.

## 3. Don't hand-roll one in a view — especially not in a render loop

The four calls removed from `views-session.js` fired on **every** `render()`,
including a popstate-driven re-render (where the browser is restoring the
position) and a language switch (where nothing navigated at all). So they did not
merely duplicate the central reset — two of them actively fought back-restoration
inside the vote wizard. The forward case there is `go()`, which routes through
`syncUrl` like everything else
(`.claude/rules/session-flow-history.md` §2: never `history.pushState` directly).

If a screen genuinely needs to scroll somewhere other than the top on arrival,
that is a positional scroll *within* the view, not a second reset.

## Testing it: jsdom has no scrolling, so `window.scrollTo` is a seam

jsdom does not implement `window.scrollTo` — it prints a "Not implemented" line
to the console and does nothing. `test/support/dom.js` therefore replaces it with
a recorder, which both silences that on every push navigation and gives a spec
the only observable there is.

**An array built inside the `vm` context belongs to another realm**, so
`assert.deepEqual` fails it against a native array on the prototype alone — a
false red that reads `['replace'] !== ['replace']`. Round-trip through
`JSON.stringify` inside the context before asserting.

**Related:**
`.claude/rules/persistent-chrome-defines-the-main-pages.md` (shipped together —
the back control is largely pointless without this, since you would otherwise
arrive part-way down the screen it sits at the top of),
`.claude/rules/session-flow-history.md` (the wizard whose hand-rolled resets this
replaced, and why its steps go through `syncUrl`),
`.claude/rules/testing-views-under-jsdom.md` (the harness),
`.claude/rules/preview-pane-paint-artifacts.md` (why a scroll claim is verified
with JS probes rather than screenshots).
