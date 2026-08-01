---
paths:
  - "public/js/router.js"
  - "public/js/account.js"
  - "public/js/views-home.js"
  - "lib/app.js"
  - "test/auth-routes.test.js"
---
# The auth screens own URLs (#501) — and `/` is what makes Back work

`/login`, `/register` and `/forgot-password` are real routes since #501. The
three-line addition to `resolveRoute()` is the obvious part; everything below is
a coupling that fails silently if undone.

## 1. Giving login a URL breaks Back unless `showHome()` yields `/` to the landing

Before #501 a logged-out visitor could not reach `popstate` at all: the auth
screens pushed no history entries, so the router never ran for them. Give them
URLs and the very first Back — landing → login → **Back** — pops to `/`, which
`resolveRoute` maps to `showHome()`. In accounts mode a logged-out `showHome()`
has nothing to render: every read in it 401s, `api()` answers that with
`onSessionLost()`, and the visitor is bounced to the login screen they were
trying to leave.

So `showHome()` carries the guard:

```js
if (accountsActive() && !isLoggedIn()) return showLanding();
```

**That line, in a file the issue never mentions, is what makes the whole feature's
Back behaviour correct** — and nothing about `views-home.js` suggests it is part
of routing the auth screens. It also fixes the pre-existing `return showHome()`
fallback in `showInbox`/`showFriends`/`showAccount`, which had the same defect for
a logged-out visitor.

Consequently `/` deliberately stays `showHome()` in `resolveRoute` rather than
gaining a landing case: one route, whose view depends on session state, exactly
like `/inbox`. `routeTo('/')` is then the canonical "go to the front door" call
and is right in both states — which is why the failed-`/demo` path uses it
instead of the manual `history.replaceState` + `showLanding()` pair it used to.

## 2. The post-login return path had to leave the URL first

The old shape had no store because it did not need one: `bootApp()` rendered the
login card **at the deep-link path**, and `enterApp()` then read
`location.pathname` back. Giving login its own URL destroys that store, so the
path moves into a module-level `pendingPath` in `account.js`.

Two halves, and the second is the subtle one:

- `enterApp()` must read `pendingPath`, never `location.pathname` — which now
  says `/login` and would bounce the user straight back to the login screen.
- `bootApp()` must reach login through **`routeTo('/login')`, not
  `showLogin()`**. `routeTo` sets `routing`, which makes `syncUrl` **replace**;
  a direct call pushes. The deep-link URL was never a rendered view, so a pushed
  entry leaves Back sitting on a path that renders nothing.

A reload of `/login` therefore forgets the pending path and login lands Home.
That is accepted, not a bug to fix with `?next=` — a redirect parameter is an
open-redirect surface bolted onto a one-screen convenience.

## 3. The guard belongs to the view, not to the route

`showLogin`/`showRegister`/`showForgot` each begin with
`if (!authScreensAvailable()) return showHome();` — the inverse of how
`showInbox`/`showAccount` guard themselves. Putting it in `resolveRoute` instead
would cover the typed URL and miss every in-app call site, of which there are
seven: the landing's two buttons, the cross-links between the three cards, both
mail landings' "back to login", `showAuthDone`, `onSessionLost()` and the demo
banner's register CTA.

It is safe at all of them because the two that could plausibly run while a
session exists — `onSessionLost()` and the demo banner's CTA — both
`clearTokens()` *before* calling in, so `isLoggedIn()` is already false.

## 4. `/login` is one option away from serving the retired `login.html`

`public/login.html` is the legacy shared-password page — the document that was
Google's result for this app until #510 noindexed it. The **only** thing keeping
it from answering `/login` is that `express.static` is configured without its
`extensions` option (`lib/app.js`). Add `extensions: ['html']` there, or drop a
`register.html` into `public/`, and these routes are shadowed: the SPA never sees
them and a visitor gets a retired, noindexed screen on the path every "sign up"
link now points at.

`test/auth-routes.test.js` pins it by asserting each path returns **byte-identical
bytes to `GET /`**, plus that `login.html` is a genuinely different document
(it still carries its noindex) so the equality cannot pass vacuously. Verified by
adding `extensions: ['html']` on purpose — both tests go red.

**No robots.txt change belongs here.** These paths serve the shell, whose
canonical already points at the front door, exactly like `/round/…`. A
`Disallow` would freeze rather than remove an index entry — see
`.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md`, which is also why
`login.html` keeps its own noindex and stays crawl-allowed.

## 5. Logout and session-expiry go to different screens on purpose

`logout()` → `showLanding()`; `onSessionLost()` → `showLogin()`. A deliberate
logout is a departure, and the landing owning `/` is what stops the address bar
still naming the round just left (defect 4 of the issue). An expired session is
not a departure — that user was working and wants back in, so marketing copy
they have already read would be a detour.

## Verifying a change here

The routing is client-side and `resolveRoute` is deliberately not exported (a
`module.exports` guard would drag `router.js` into the coverage report at a low
percentage — `.claude/rules/frontend-helper-modules-and-coverage.md`), so the
behaviour wants a browser pass. Drive it against the committed `dev-temp-data`
config and clear the service worker first
(`.claude/rules/pwa-service-worker.md`).

**The pane's `element.click()` + `history.back()` probes work here**, unlike the
session flow's, and the discriminator to assert is **`history.state.idx`**: a
cold load or a replace leaves it at 0, a push increments it. That single number
is what separates "the deep link was replaced by /login" from "/login was pushed
on top of it" — the two look identical on screen.

**Related:** `.claude/rules/in-app-nav-links.md` (the history-probing traps, and
which globals are reachable as `window.*`),
`.claude/rules/session-flow-history.md` (the other owner of `popstate`),
`.claude/rules/accounts-mode-gate.md` (why the shell is always served in accounts
mode, which is what lets these paths resolve client-side at all).
