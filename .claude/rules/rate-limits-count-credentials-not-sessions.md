---
paths:
  - "lib/app.js"
  - "lib/route-limits.js"
  - "lib/routes/**"
  - "test/rate-limit-scope.test.js"
---
# The strict limiter counts CREDENTIAL ATTEMPTS; the general one counts ACCOUNTS (#1836)

`AUTH_RATE_LIMIT_MAX` used to be mounted on whole routers — `/api/admin`,
`/api/account` and its five sub-routers — so every signed-in request spent the
budget that exists to slow down password guessing. Confirming ~100 games'
scoring in the operator panel (#1786/#1787: one request per game) locked the
operator out of their own panel for 15 minutes, and a household's inbox and
friend-feed browsing shared one bucket with its logins (#399 had already raised
it 20 → 100 and carved out `GET /me` for exactly this).

## The shape

- **`credentialLimit` (lib/route-limits.js) sits on each route that tries a
  credential or a guessable secret**, never on a router: the shared and account
  logins, refresh, forgot/reset, resend and both verify-email routes,
  confirm-email, change-password, change-email, `DELETE /api/account`, register
  and demo, the passkey login pair, `POST /join` and `/join/preview` (an
  invite-link token in the body), and the operator's `/login`, `/login/passkey`,
  `/enroll/options`, `/enroll`. `test/rate-limit-scope.test.js` holds that list
  and pins each with a ceiling of ONE.
- **Per route rather than an allowlist at the mount, on purpose.** Express routing
  is case-insensitive and ignores a trailing slash, so `POST /API/Account/Login/`
  reaches the login handler; a `skip` predicate matching `req.path` would have to
  re-derive that, and the bypass is the silent direction. Per route also makes the
  old double-mount trap (two mounts, two units per attempt) unrepresentable.
- **The limiter instance is per app, the routers are singletons**, so the route
  reaches its limiter through `req.app.locals.routeLimiters`. A missing one fails
  the request (`next(err)`) rather than waving it through.
- **The general limiter keys `acct:<id>` only for a token `verifyAccessToken`
  accepts** (Bearer or the `sa` cookie), else `ipKeyGenerator(req.ip)`. Keying on
  anything unverified lets a caller mint a fresh bucket per request. The admin
  `aid` session needs a DB lookup to verify, so operator requests stay IP-keyed
  there — 1000/15 min is far above what the panel spends.

## The endpoint audit, and its one new cap

Every router mounted in `lib/app.js` was walked. Already capped: register, demo,
avatar, the vote link, contact, client-error, round chat. **Added:**
`IMAGE_UPLOAD_RATE_LIMIT_MAX` (30 per account per 15 min) on cover uploads
(`POST`/`PATCH …/games`) and the session photo — the avatar argument, decoding
caller bytes; it counts multipart bodies only, so a JSON game edit spends none.
Left on the general backstop, with the reason: the BGG lookups and price search
(answers cached; BGG's own retry budget, the price source's failure cooldown),
the collection and play imports (state caps bound the work, no decoding),
invitations and friend requests (mail goes through `notifyInboxItem`'s
per-recipient throttle), and everything else (an ordinary authenticated write).

**Related:** `.claude/rules/security-middleware.md` (the limiters' other traps),
`.claude/rules/trust-proxy-is-a-hop-count.md` (what makes the per-IP keys right),
`.claude/rules/deploy-invariants-are-pinned-in-code.md` (why every store is in
memory and single-replica), `.claude/rules/webauthn-ceremony-defaults.md` §4.
