# Accounts mode: the /api + /uploads gate and the SPA shell (issue #138)

Issue #138 built the onboarding/auth UI and flipped the app between two auth
modes. `accounts.accountsEnabled()` (ACCOUNTS_ENABLED + SESSION_SECRET) is the
switch, read per request in `lib/app.js`. Non-obvious things, keep them:

- **`/api` is Bearer-ONLY in accounts mode; `/uploads` also accepts a cookie.**
  `lib/app.js` wires two accounts-aware gates:
  - `/api` → `accounts.requireApiAccount`: a valid **Authorization: Bearer**
    access token is required (401 `auth_required` otherwise). The cookie is
    deliberately **not** honored here, so a cross-site form can't attach a header
    and the state-changing data routes stay CSRF-immune.
  - `/uploads` → `accounts.requireUploadAccount`: Bearer **or** the `sa` access
    cookie. Cover images render as `background-image`/`<img>`, which can't send a
    header — so login/refresh mirror the access token into a `sameSite=lax`,
    httpOnly cookie (`accounts.setAccessCookie`). Lax + read-only GET = no CSRF
    exposure (a cross-site subresource can't ride a lax cookie).
  When accounts are **off**, both gates fall back to `auth.requireAuth` (the
  shared-password gate, itself a no-op when AUTH_PASSWORD is unset) — production
  is byte-for-byte unchanged. Don't collapse the two gates into one "Bearer or
  cookie" gate: that would let the cookie authenticate `/api` and reintroduce CSRF.

- **LAYERED mode (#266): AUTH_PASSWORD *and* accounts on at the same time.** Two
  independent switches — `auth.authEnabled()` (AUTH_PASSWORD) and
  `accounts.accountsEnabled()` — give **four** modes, not two: open,
  password-only, **accounts-only (today's prod)**, and **layered** (both).
  In layered mode the instance stays sealed behind the shared password while
  everyone inside uses real accounts; production ran layered until the go-live
  (#219) *removed* AUTH_PASSWORD on 2026-07-24, which is what left it
  accounts-only. The wiring lives in `lib/app.js` and is built so the three
  pre-existing modes stay byte-for-byte unchanged — only the both-on path is new:
  - `apiGate` / `uploadGate` compose `auth.requireAuth` (a no-op unless
    AUTH_PASSWORD is set) **in front of** the account gate, so `/api` and
    `/uploads` require the shared session **and** the account credential when both
    are configured. `/api` stays Bearer-only; `/uploads` still takes Bearer-or-`sa`.
  - The account routers (`/api/account`, `…/invitations`, `…/friends`) sit behind
    **`requireSharedIfLayered`**, so "accounts on" is **not** public sign-up on a
    sealed box. It gates on **both** switches (not just `requireAuth`) so
    password-only mode keeps answering the account routes' own **404
    `accounts_disabled`** rather than a 401 — that mode must not change. `/api/auth`
    (the shared login) and the public `/api/contact` + legal surfaces are
    deliberately NOT fronted — a logged-out visitor must still reach them.
  - The SPA fallback checks the shared gate **first** (before serving the shell),
    so an unauthenticated visitor in layered mode gets `login.html`, not the shell.
    (This is the hole layering closes: before #266 the `accountsEnabled()` branch
    short-circuited to `index.html`, letting ACCOUNTS_ENABLED bypass `login.html`.)
  `test/layered-auth.test.js` pins the layered path and the two most fragile
  unchanged behaviours (password-only's 404, accounts-only's shell).

- **Claiming the `'default'` tenant was a one-time admin-panel action (#266),
  now REMOVED (#405).** Flipping accounts on freezes the pre-tenancy `'default'`
  data out of reach (no request acts as `'default'` in layered mode), so an owner
  migrating pre-accounts data would log into an empty app. `POST
  /api/admin/users/:uid/claim-default` re-tenanted every `'default'` round into a
  chosen fresh account, via a dedicated RLS write escape. It ran on production
  during the 2026-07-24 go-live (#219) and was then removed together with its
  escape policies (#405) — a standing cross-tenant write escape has no purpose on
  a public instance. A self-hoster migrating an existing shared-password instance
  later should run the claim from a revision before #405 (present from #266/PR
  #394 through the go-live); see `docs/deploy-railway.md` "Going live". The
  cross-tenant-write RLS facts it relied on are folded into
  `.claude/rules/tenancy-rls.md`.

- **The cookie is short-lived and self-healing.** Its maxAge is the 15-min access
  TTL; every `/refresh` re-sets it. So a cover load right after the token expires
  can 401 (blank cover) until the next `/api` call refreshes and re-sets the
  cookie. That's an accepted limitation (transient — it self-heals on the next
  `/api` call). Per-tenant `/uploads` isolation
  is still follow-up (#207/#137) — today any valid account passes the uploads gate.

- **In accounts mode the SPA shell is ALWAYS served** (never `login.html`). The
  fallback in `lib/app.js` short-circuits to `index.html` so the client can render
  the auth UI; the data routes above stay token-gated, so an unauthenticated
  visitor still gets no round data. `login.html` is only for the legacy
  shared-password gate.

- **Frontend detects the mode via `GET /api/account/me`** (mounted before the
  gate). `initAccounts()` (public/js/account.js) treats **404** = accounts off
  (legacy mode, everything inert), **401** = accounts on, not logged in,
  **200** = logged in. Only a definitive 200/401 flips on accounts mode — a
  boot-time network error falls back to legacy, so a shared-password instance is
  never stranded on the login screen.

- **`core.js api()` is the token chokepoint.** It attaches the Bearer header when
  `getAccessToken()` is non-null (no-op in legacy mode) and, on a 401
  `auth_required` in accounts mode, does ONE silent `refreshAccessToken()` +
  retry, then `onSessionLost()` (→ login). Legacy mode keeps the old
  `window.location.assign('/')` bounce. The account helpers live in the
  later-loaded `account.js` but are only referenced at call time, so the load
  order (core → account → main) is safe — see frontend-script-load-order.md.

- **What #138 did NOT do:** invitations / tenant-sharing (a second user can't see
  your rounds under RLS — that's #207, shipped since) and roles (#137, still
  open). Which mode an instance runs in is an ops decision, not something this
  code turns on — production has been accounts-only since the 2026-07-24
  go-live, and a self-hosted checkout is whatever its env says.
