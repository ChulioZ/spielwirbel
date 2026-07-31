# The tab title has THREE owners (#522) — pick the right one for a new screen

`setDocTitle(...parts)` (core.js, joining via `docTitle()` in `js/doc-title.js`)
writes `<screen> – <round> · Spielwirbel`. Which of three places calls it is not
a style choice, and getting it wrong fails silently — the tab keeps the previous
screen's title, or stops following the language.

| Screen kind | Where the call goes |
|---|---|
| an ordinary view | **after its `await`**, next to `setContext(round.name)` |
| a view with an internal render loop (the vote wizard) | **inside `render()`** |
| an auth screen | nowhere — `openAuth` reads the card's own `<h1>` |

## 1. Not next to `currentView`, where every other bit of view setup lives

The natural home is the top of the view, beside `currentView` and `syncUrl`. It
is wrong for every round screen: `round.name` does not exist until `fetchRound`
resolves, so a title set there names the screen and not its subject, and the
round name never arrives. `docTitle` drops the empty part rather than rendering
`Regal –  · Spielwirbel`, so the symptom is a *plausible* short title, not a
broken-looking one — which is why it would survive a glance.

Put it after the guard clauses too. `showGameDetail` and `showMember` both bail
to another view when their subject is missing (`if (!game) return showRound(rid)`),
and a title set before that would stick to the screen they bail *to*.

## 2. The vote wizard's title must be re-applied per render — its context label must not

`startVoting` sets `setContext(round.name)` once, with a comment saying it needs
no refresh because the round name is locale-independent. That reasoning is
correct for the label and **does not carry to the title**, which contains
`t('vote.crumb')`. `currentView` there is `() => { render(); }`, so a language
switch re-runs `render()` and nothing else — a title set beside `setContext`
would stay in the old language for the rest of the wizard.

Measured: with the call inside `render()`, switching to German mid-wizard moves
the tab from "Voting – …" to "Abstimmung – …" on the step the user is looking at.

The title is also deliberately **identical on every step**. The wizard is a
hot-seat handover — whose turn it is and which game is on screen are exactly what
the device must not disclose to the person waiting — so the tab says "Voting" and
nothing more. Don't "improve" it with the current voter or game.

## 3. Auth screens are titled from their own `<h1>`, by `openAuth`

All seven go through `openAuth`, which calls `setAuthDocTitle(wrap)` — reading
`.auth__title` back off the card it just rendered. So a new auth screen inherits
a correct, translated title with nothing to remember, and the title cannot drift
from the heading, because it *is* the heading.

The one obligation: **a screen that replaces its heading later must re-apply it.**
`renderVerifyLanding` renders "Verifying…" and swaps in the outcome after an
`await`; without the second `setAuthDocTitle(card)` the tab keeps claiming the
verification is still running on a screen that has finished either way.

## 4. The landing keeps the DEFAULT, and the default is not `setDocTitle()`

`applyTabTitle()` (i18n.js, #566) already existed before #522: it writes
`t('app.tabTitle')` — the app's pitch, the same string the static `<title>`
carries for crawlers — and `initLocale`/`setLocale` both call it.

So `showLanding` calls **`applyTabTitle()`**, not `setDocTitle()`. A part-less
`setDocTitle()` returns the bare brand ("Spielwirbel"), which is a *different*
string and drops the front door's one line of copy. The two are easy to confuse
because both look like "reset the title".

That also explains the sequencing on a language switch: `setLocale()` calls
`applyTabTitle()` (default) and the picker then calls `currentView()`, which
re-renders and re-titles. An async view therefore shows the default for a frame
or two mid-switch — correct, not a flash to fix.

**The static `<title>` in `index.html` must not change.** It is pinned by
`test/seo.test.js` and `test/landing-copy.test.js` and is what a non-rendering
crawler reads (`.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md`);
everything here happens in JS, i.e. invisibly to them by construction.

## Verifying a change here

Nothing about this is visible to a screenshot or to `read_page` — read
`document.title` directly, the same way `.claude/rules/hidden-attribute-vs-display-rule.md`
insists on computed style over the DOM answer.

Drive `dev-temp-data` with the service worker cleared
(`.claude/rules/pwa-service-worker.md`) and mint a demo (`/demo`, `DEMO_ENABLED`
is on in that config) rather than seeding by hand — accounts are on there, so
`curl` against the API answers `auth_required`. Then `routeTo(p)` each path and
read the title; `routeTo`, `showFinale`, `logout` and `setLocale` are all
reachable as `window.*` (`.claude/rules/in-app-nav-links.md` §1), which covers
the session-flow screens the router deliberately will not resolve on a cold load.

Two traps met doing exactly that:

- **A leftover vote-wizard flow contaminates the reading.** Calling `showFinale`
  while the wizard was still registered at `/vote/2` reported the *results* title
  and path; the same call from a clean state reports "Finale – …" correctly.
  `endFlow()` or a fresh `navigate` between probes.
- **A `.rating .mood` click selects a rating, it does not advance the step.** A
  loop that clicks it expecting to walk the wizard spins until the 30 s
  `javascript_tool` timeout and looks like a hang in the app.

**Related:** `.claude/rules/frontend-helper-modules-and-coverage.md` (why
`doc-title.js` is its own file — the pure half is unit-tested there and the DOM
half sits in core.js, which no test requires),
`.claude/rules/locale-set-is-data.md` (the `t()`/locale machinery every title
goes through), `.claude/rules/session-flow-history.md` (the wizard in §2).
