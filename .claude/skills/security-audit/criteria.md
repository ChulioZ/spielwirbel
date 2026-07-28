# Security criteria

- **last-researched:** 2026-07-24
- **cadence:** 45 days

Seeded 2026-07-24 from `lib/app.js`, `lib/accounts.js`, `lib/auth.js`,
`lib/admin.js`, `lib/tenant.js`, `lib/repo/postgres.js`, `lib/storage/`,
`lib/upload.js`, `lib/providers/`, and the security rules under `.claude/rules/`
— **not** from research. The first run must do a full research pass.

**Premise.** This app already has a deliberate, documented security posture:
Argon2id passwords, algorithm-pinned HS256 JWTs, timing-safe compares, forced
Row-Level Security, an SSRF host allowlist, magic-byte upload sniffing, a strict
CSP, Bearer-only `/api` (CSRF-immune). CI runs CodeQL, gitleaks and a secret
scan. So the realistic finding here is a **regression or a subtle drift**, not a
missing control — and the criteria are written to catch exactly that. A finding
that restates a control the code already has is not a finding.

**Compose, don't duplicate.** For the SAST-style pass (injection sinks, tainted
data flow, unsafe APIs) invoke the built-in **`/security-review`** command rather
than re-deriving it here; this skill's value is the app-specific invariants below
that a generic scanner does not know about.

---

## Authentication & tokens

### S-001 — Account access tokens stay algorithm-pinned HS256, signed with SESSION_SECRET, never AUTH_PASSWORD
- **Status:** adopted · 2026-07-24
- **Source:** `lib/accounts.js` · `.claude/rules/user-accounts.md`
- **Check:** `jwt.verify` passes `algorithms: ['HS256']` (rejects `alg:none` and
  RS/HS confusion). The signing secret is `SESSION_SECRET` and must **not** fall back
  to `AUTH_PASSWORD` — the shared password is known to the whole group, so a fallback
  lets any member forge any user's tokens. Accounts are double-gated on
  `ACCOUNTS_ENABLED` + a non-empty `SESSION_SECRET`.
- **Enforced by:** `test/account.test.js`, `test/layered-auth.test.js` (partial)

### S-002 — Passwords hashed with Argon2id; all secret comparisons are constant-time
- **Status:** adopted · 2026-07-24
- **Source:** `lib/accounts.js`, `lib/auth.js`, `lib/admin.js`
- **Check:** Passwords → `argon2.argon2id`. Refresh/verify/reset tokens → SHA-256 at
  rest, never plaintext. Every secret/token equality test goes through
  `crypto.timingSafeEqual` behind a length pre-check — never `===` on a secret. Login
  burns a dummy Argon2 verify when the account is absent, so timing doesn't reveal
  existence.
- **Enforced by:** `test/account.test.js` (anti-enumeration)

### S-003 — A valid token for a deleted/suspended account must fail closed, never fall back to a tenant
- **Status:** adopted · 2026-07-24
- **Source:** `.claude/rules/erased-account-token-fallback.md`
- **Check:** Access tokens are stateless with a 15-min TTL, so one outlives the row it
  names. `lib/tenant.js` must distinguish "no token" (→ `'default'`, legacy mode) from
  "valid token, no such user" (→ 401 `auth_required`, the `ERASED` marker). Suspension
  is enforced at tenant resolution (where the user row is loaded), not only at login —
  a login-only guard is up to one TTL late.
- **Enforced by:** `test/admin.test.js` (erasure → 401)

### S-004 — Anti-enumeration answers are identical for known and unknown identifiers
- **Status:** adopted · 2026-07-24
- **Source:** `.claude/rules/unique-violation-reports-one-constraint.md` · `routes/account.js`
- **Check:** Register and forgot-password answer the same for known/unknown e-mails.
  `email_taken` stays hidden behind `{ ok: true }`; `username_taken` is openly a 409 by
  design. A 23505 on both indexes at once names `users_email_idx` — so the mapping must
  check the username explicitly, not infer from the constraint name (the trap the rule
  documents).
- **Enforced by:** `test/account.test.js`, `test/support/repo-contract.js`

## Authorization & tenant isolation

### S-005 — Every round-scoped route reads/writes through `req.repo`, never the module repo
- **Status:** adopted · 2026-07-24
- **Source:** `.claude/rules/tenancy-rls.md`, `data-access-layer.md`
- **Check:** Handlers use `req.repo` (tenant-scoped by `lib/tenant.js`); only global user
  methods come from `require('../lib/repo')`. A new round-scoped method absent from
  `TENANT_METHODS` is unreachable *or*, if reached via the module repo, cross-tenant.
  Bare `pool.query` on round tables bypasses the tenant `set_config` and RLS.
- **Enforced by:** `test/tenant.test.js`, `test/repo.postgres.test.js`

### S-006 — RLS is FORCE-enabled and app-layer WHERE clauses are the primary filter
- **Status:** adopted · 2026-07-24
- **Source:** `.claude/rules/tenancy-rls.md`, `postgres-backend.md`
- **Check:** Policies compare `tenant_id` to a transaction-local `app.tenant_id` set with
  `set_config(..., true)`; unset → NULL → zero rows (fail-closed). **FORCE binds
  non-superusers only** — a superuser connection bypasses RLS entirely, so the app-layer
  WHERE is the enforcement that always holds and the plain-role probes are what actually
  test the policy. Production should run as a non-superuser.
- **Enforced by:** `test/repo.postgres.test.js` (plain-role probes)

### S-007 — Cross-tenant escapes widen reads only, admit their own writes, and are transaction-local
- **Status:** adopted · 2026-07-24 · updated 2026-07-24 (retenant escape removed, #405)
- **Source:** `.claude/rules/admin-moderation-surface.md` §2, `.claude/rules/tenancy-rls.md`
  ("for any future cross-tenant write"), `round-grant-resolver.md`
- **Check:** The moderation escape is a separate `FOR SELECT` policy, never `OR`-ed onto
  the tenant policy (an `OR` silently permits cross-tenant `DELETE`, which is governed by
  `USING` alone). The one-time retenant write escape (#266) was removed after go-live
  (#405) — no standing cross-tenant write escape should exist; a future one must be a
  self-contained pair gated on a tx-local flag, never an edit to the tenant policy (the two
  PG facts are folded into `tenancy-rls.md`). A grantee *acts as* the owner tenant
  (re-scoped `req.repo`) keyed on **this** round's id — RLS stays un-widened. Every flag
  dies at COMMIT.
- **Enforced by:** `test/repo.postgres.test.js` (plain-role DELETE/INSERT refusals; the
  retenant escape is proven *gone*)

### S-008 — A grant is not authority to delete; owner-only actions stay owner-only
- **Status:** adopted · 2026-07-24
- **Source:** `.claude/rules/round-grant-resolver.md`
- **Check:** `resolveRoundGrant` re-scopes on `/api/rounds/:rid` (after `withTenant`,
  before the routers), never on `/api/rounds` (so create lands in the caller's own
  tenant), and matches this rid only (not "any grant in the tenant"). `DELETE
  /api/rounds/:rid` refuses a grantee (403 `not_owner`). Gated on `req.userId`, so legacy
  mode is a no-op.
- **Enforced by:** `test/round-grants-access.test.js`

## Transport, CSRF & cookies

### S-009 — `/api` is Bearer-only in accounts mode; the cookie is honored only for read-only `/uploads`
- **Status:** adopted · 2026-07-24
- **Source:** `.claude/rules/accounts-mode-gate.md`
- **Check:** `requireApiAccount` takes an `Authorization: Bearer` token only — the cookie
  is deliberately not honored, so a cross-site form can't authenticate a state-changing
  route (CSRF-immune by construction). `/uploads` accepts Bearer **or** the `sa` cookie
  because `<img>`/`background-image` GETs can't send a header — safe because the cookie is
  `sameSite=lax` and the route is read-only GET. Never collapse the two gates into one
  "Bearer or cookie" gate.
- **Enforced by:** `test/layered-auth.test.js`

### S-010 — Every auth cookie is httpOnly + sameSite + Secure-when-TLS; admin is domain-separated
- **Status:** adopted · 2026-07-24
- **Source:** `lib/accounts.js`, `lib/auth.js`, `lib/admin.js` · `admin-moderation-surface.md` §1
- **Check:** `httpOnly: true`, `secure: req.secure` (Secure once TLS terminates in front),
  `path: '/'`. App session/access cookies are `sameSite=lax`; the admin `aid` cookie is
  `sameSite=strict` **and** its HMAC payload is prefixed `admin.` with its own token
  version — so an app `sid` token can never be replayed as an admin token even when both
  share `SESSION_SECRET`. `ADMIN_PASSWORD` must never equal `AUTH_PASSWORD`.
- **Enforced by:** `test/admin.test.js` (app token rejected as admin)

### S-011 — Security headers and CSP stay tight; no directive weakened without a documented reason
- **Status:** adopted · 2026-07-24
- **Source:** `lib/app.js` · `.claude/rules/security-middleware.md`
- **Check:** `script-src`/`font-src`/`connect-src` are `'self'`-only. `img-src` widens to
  exactly the provider `IMAGE_HOSTS` (via `imageCspSources()`) and `data:` — no wildcard
  to arbitrary third parties. `style-src 'unsafe-inline'` and `img-src data:` are the two
  deliberate loosenings (inline `style=` attributes, the SVG grain) — do not report them,
  and do not add a third. HSTS ships via helmet defaults; `upgrade-insecure-requests` is
  intentionally nulled (the app also serves plain HTTP locally).
- **Enforced by:** `test/security.test.js` (headers, self-only sources, img-src↔hosts)

### S-012 — Rate limits protect auth and contact, and are read per `createApp()`
- **Status:** adopted · 2026-07-24
- **Source:** `lib/app.js` · `.claude/rules/security-middleware.md`
- **Check:** A global limiter plus tighter `AUTH_RATE_LIMIT_MAX` on the auth routes and a
  contact limiter. Ceilings are read from env **inside** `createApp()`, never bound at
  module load. `/healthz` sits before the limiter so uptime probes aren't throttled. Note
  the store is in-memory per instance — horizontal scaling needs a shared store (#215),
  which is a known gap, not a finding.
- **Enforced by:** `test/security.test.js` (429 on the global cap)

## Injection, SSRF & untrusted input

### S-013 — All round-data SQL goes through Knex builders or parameterized `knex.raw`; never string-concatenated
- **Status:** adopted · 2026-07-24
- **Source:** `lib/repo/postgres.js` · `.claude/rules/postgres-backend.md`
- **Check:** No SQL built by string concatenation of request data. Knex parameterizes;
  the `knex.raw()` escape hatches (RLS `set_config`, advisory locks, `FOR UPDATE`) take
  bindings, not interpolated values. jsonb writes go through `J()` — a raw array binding
  into jsonb throws `22P02`, which is a correctness *and* an injection-surface concern.
- **Enforced by:** `test/support/repo-contract.js` (both backends) — parameterization is
  structural; verify no new interpolation crept in

### S-014 — Request bodies are validated by a zod schema before use
- **Status:** adopted · 2026-07-24
- **Source:** `lib/validate.js` · `routes/*.js`
- **Check:** State-changing routes run `validateBody(schema, req, res)` and reject shape
  violations with the route's own message. Unknown fields are stripped, not trusted.
  A new write route that reads `req.body.x` without a schema is a finding. The two
  pre-zod routes that validate inline (`routes/members.js`, `routes/background.js` —
  every field checked before use) are accepted as-is; converting them is optional
  consistency work, not a finding (audit 2026-07-24).
- **Enforced by:** `test/validate.test.js`, per-route validation specs

### S-015 — Server-side fetch is confined to an allowlist of provider hosts (SSRF)
- **Status:** adopted · 2026-07-24
- **Source:** `lib/providers/index.js` · `.claude/rules/add-game-lookup-provider.md`, `provider-cover-hotlinking.md`
- **Check:** The server fetches only provider search/detail endpoints and never a
  user-supplied URL. A stored/accepted cover URL passes `isAllowedImageUrl` (host on a
  provider's `IMAGE_HOSTS`, or a subdomain) **and** `providerCoverUrl`'s stricter gate:
  **https-only**, and no `'`, `"`, `(`, `)`, backslash or whitespace (the value is
  interpolated into `background-image:url('…')`, so those are CSS-injection vectors).
  The host allowlist is one source of truth shared with the CSP.
- **Enforced by:** `test/providers*.test.js`, `test/provider-covers.test.js`, `test/cover-size.test.js`

### S-016 — Uploads are sniffed by magic bytes, size-capped, and stored under a traversal-proof key
- **Status:** adopted · 2026-07-24
- **Source:** `lib/upload.js`, `lib/storage/`
- **Check:** The client `mimetype`/`originalname` are ignored for the real decision — the
  file is sniffed by magic bytes; a 10 MB `fileSize` cap is set. Storage keys are a single
  `<id><ext>` segment, and `save`/`remove`/`serve`/`size` all take `path.basename()` so a
  key can never escape the prefix. `storage.remove()` ignores anything that isn't a
  `/uploads/` path, so a hotlinked provider URL basename can't delete our object.
- **Enforced by:** `test/storage.test.js`, `test/provider-covers.test.js` (colliding basename)

## Storage, logging & disclosure

### S-017 — No secret or personal data reaches logs, the Kennzahlen card, or any error body
- **Status:** adopted · 2026-07-24 (card reshaped by #404, 2026-07-28)
- **Source:** `.claude/rules/product-event-logging.md`, `admin-moderation-surface.md` §6
- **Check:** `requestLogger` logs method/path/status/timing/ip only — never bodies, query
  strings, headers or cookies. `trackEvent` logs `event` + `tenantId` only and drops any
  other field. `lib/status.js` reports quota ceilings and aggregate counts — never a
  secret (not even hashed), and never a name, address or id.
  `listUsers()` returns raw user rows *including secrets* — the admin route must project
  down to safe fields; never respond with it directly.
- **Enforced by:** `test/status.test.js` (two generic sweeps: planted secret values, and
  "every metric is a number") · the logging allowlists are manual

### S-018 — The uploads/cover object lifecycle frees bytes and never serves them unauthenticated
- **Status:** adopted · 2026-07-24
- **Source:** `.claude/rules/cover-image-storage-backend.md`, `deletion-paths-must-free-cover-objects.md`
- **Check:** `/uploads` is behind the auth gate; cover URLs stay same-origin `/uploads/…`
  paths (never public bucket URLs that bypass the gate and CSP). Any row deletion that can
  hold an `image` returns the freed paths so the route removes the object — an orphaned
  object is unreachable forever. Provider covers (absolute https URLs) are passed through
  `remove()` safely because it ignores non-`/uploads/` paths.
- **Enforced by:** `test/games.test.js`, `test/provider-covers.test.js`

### S-019 — The mode gate never leaks data to an unauthenticated visitor, in any of the four modes
- **Status:** adopted · 2026-07-24
- **Source:** `.claude/rules/accounts-mode-gate.md`
- **Check:** Four modes (open, password-only, accounts-only, layered) from two independent
  switches. In layered mode the SPA fallback checks the shared gate **first** (a logged-out
  visitor gets `login.html`, not the shell). Account routers sit behind
  `requireSharedIfLayered` so "accounts on" is not public sign-up on a sealed box.
  Navigations are network-first so the server always decides the gate; only *offline*
  serves the cached shell.
- **Enforced by:** `test/layered-auth.test.js`, `test/spa-fallback.test.js`

### S-020 — CI security tooling stays wired and green
- **Status:** adopted · 2026-07-24
- **Source:** `.github/workflows/` · `.claude/rules/ci-aggregate-gate.md`, `gitleaks-license-flake.md`
- **Check:** CodeQL (javascript-typescript + actions), gitleaks and the secret scan run on
  every PR and gate merge. `npm audit` is clean and Dependabot alerts are zero — a new
  advisory is a finding routed to the `dependabot` skill. A red gitleaks with only a
  license-probe message is the documented transient flake (re-run), not a leak.
- **Enforced by:** CI (CodeQL, gitleaks, secret-scan)

## Public-repo disclosure risk

### S-021 — No control depends on the source being secret
- **Status:** adopted · 2026-07-24
- **Source:** Kerckhoffs's principle · this is a **public** GitHub repo
- **Check:** The whole source is readable by any attacker, so *assume* it. "Public repo →
  attacker knows more" is true of every line and is **not**, by itself, a finding (see
  S-R06). A finding is the narrower case where that readability turns a theoretical
  weakness into a **cheap, practical** exploit — where the code's *secrecy* is
  load-bearing. Publishing the source must not be what protects the live service. Look
  for, concretely:
  - **A security check done only client-side** (`public/js/**`) and not re-enforced on the
    server — the public code hands an attacker the exact bypass. The server is the trust
    boundary; the client is a convenience. (This app is generally good about this — the
    finding is any *new* gate that lives only in the client.)
  - **A hardcoded value acting as a de-facto secret or access control** — a fixed token, a
    magic bypass constant, a hardcoded id/e-mail allowlist that grants power. Contrast the
    *correct* pattern already in the code: HS256 is public and harmless because the entropy
    lives in `SESSION_SECRET`, not in the algorithm. The weakness is a control whose entropy
    lives in the *code* instead of in a secret or in server-side state.
  - **A predictable/guessable identifier that is the *only* thing guarding a resource** —
    the source reveals the generation scheme, so absent an independent ownership/authz check
    the resource is enumerable. (The documented per-tenant `/uploads` byte-leak by key
    guess, #207/#137, is exactly this archetype: the key scheme is public and the gate does
    not check ownership. Known and tracked — a *new* instance of the shape is the finding.)
  - **An anti-abuse control whose exact parameters, now public, make it trivially evadable
    or expose an oracle** — a rate-limit/lockout/anti-enumeration measure that only holds if
    the attacker cannot read its thresholds.
  - **Public prose (README, `docs/`, `.claude/rules/`, comments) that spells out a
    currently-unmitigated exploitable weakness in attack-usable specificity** — a candid
    limitation note is valuable internally, but in a public repo it is also a map.
- **Remedy — fix the weakness, do not hide the code.** The correct fix always makes
  security independent of source secrecy: add the server-side check, introduce a real
  secret or server-side state, add the ownership check, make the identifier
  unguessable-*and*-authz-gated. Only where the underlying weakness genuinely cannot be
  closed yet is reducing the public specificity of the *live* hole (and restricting access)
  a **secondary** mitigation — never the primary one, and never a reason to delete an honest
  internal rule once the weakness itself is closed. A confirmed, currently-exploitable hole
  found here is disclosed the private way (see SKILL.md "Handling a confirmed hole"), never
  as a public issue with a reproduction.
- **Enforced by:** — (manual; a judgement criterion, not a mechanizable one)

---

## Rejected — settled, do not re-litigate

### S-R01 — "Add a CSRF token / double-submit cookie to `/api`"
- **Status:** rejected · 2026-07-24
- **Why:** `/api` is Bearer-only in accounts mode (S-009): a cross-site page cannot attach
  the `Authorization` header, so the state-changing routes are CSRF-immune by
  construction. A CSRF token would guard against a threat the header requirement already
  eliminates. The one cookie-accepting gate (`/uploads`) is read-only GET with a
  `sameSite=lax` cookie, which a cross-site subresource cannot ride. Reopens only if a
  state-changing route is ever made to accept a cookie.

### S-R02 — "Move rate limiting to Redis / a shared store now"
- **Status:** rejected · 2026-07-24
- **Why:** The in-memory limiter is correct for a single instance, which is today's
  deployment. A shared store matters only when scaling horizontally — tracked as #215, a
  known and scheduled gap, not a vulnerability. Reporting it every run is noise. Reopens
  when a second app instance is actually run.

### S-R03 — "Store account tokens server-side / make them revocable immediately"
- **Status:** rejected · 2026-07-24
- **Why:** Access tokens are deliberately stateless JWTs with a 15-min TTL; refresh tokens
  *are* stateful and revocable. The 15-min window is the accepted trade, and the paths
  that must bite sooner (suspension, erasure) are enforced at tenant resolution where the
  row is loaded (S-003) — not left to token expiry. A server-side session store would
  reintroduce the stateful-session complexity the token model was chosen to avoid. Reopens
  only if the TTL window proves too wide for a concrete threat.

### S-R04 — "Widen the SSRF/cover allowlist to a same-origin image proxy" (as a finding)
- **Status:** rejected · 2026-07-24
- **Why:** A same-origin image proxy is the *tighter* hardening for a hosted deploy and is
  already noted as deferred follow-up in `security-middleware.md` — it is an improvement,
  not a hole. The current allowlist is exactly the download/render set with no wildcard to
  arbitrary hosts. Flag the proxy as an enhancement if asked; do not report the present
  allowlist as a vulnerability.

### S-R05 — "The app runs as a Postgres superuser, so RLS is bypassed — critical"
- **Status:** rejected · 2026-07-24 — **verify the deployment, don't assume the hole**
- **Why:** RLS `FORCE` binding non-superusers only is a documented, understood property
  (S-006); the app-layer WHERE clauses are the enforcement that holds regardless of role,
  and the hardening (run as a non-superuser) is called out in `docs/deploy-railway.md`.
  This is not a code finding. The audit *may* verify the production role once (an ops
  check, not a code check) and note it — but "the code relies on RLS alone" is false and
  must not be reported as such.

### S-R06 — "The repo is public, so any file that reveals implementation is a finding"
- **Status:** rejected · 2026-07-24 — **the boundary for S-021, do not remove**
- **Why:** Every line of a public repo tells an attacker something; treating that as the
  bar would flag the entire codebase and drown the one signal that matters. A correct
  system is safe *with* its source public (Kerckhoffs) — helmet's CSP, the HS256 choice,
  the RLS model and the zod schemas lose nothing by being readable. S-021 fires only where
  the code's **secrecy is load-bearing** *and* a **cheap exploit path** follows from
  publishing it. "This reveals how auth/queries work" is not itself a finding; "this reveals
  a control an attacker can now bypass for free" is. If you cannot name the concrete cheap
  exploit that the disclosure enables, there is no S-021 finding.
