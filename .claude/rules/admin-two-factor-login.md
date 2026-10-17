---
paths:
  - "lib/admin.js"
  - "lib/admin-passkeys.js"
  - "lib/webauthn.js"
  - "lib/routes/admin/index.js"
  - "lib/routes/admin/passkeys.js"
  - "public/admin.html"
  - "public/js/pages/admin.js"
  - "test/admin-passkeys.test.js"
---
# The operator panel's login is two factors — password, then passkey (#1670)

`POST /api/admin/login` no longer sets `aid`. It returns a **password-step
token** plus WebAuthn options; only `POST /api/admin/login/passkey` with a
verified assertion (user verification **required**) mints the session. Every
trap below either reopens single-factor access or locks the operator out, and
neither shows up as a red test unless the test was written for it.

## 1. The step token IS the signed challenge — and its own domain

`lib/admin-passkeys.js` signs the authentication challenge under the scope
`wa.admin.auth` (enrollment: `wa.admin.reg`) with **`admin.signingSecret()`**,
through `webauthn.signChallengeWith`. Three properties, each load-bearing:

- **Own scopes, never `wa.auth`/`wa.reg`.** The account ceremonies sign with
  the same machinery and, when `ADMIN_SESSION_SECRET` is unset, the same
  `SESSION_SECRET`. A shared scope would let an account login challenge — which
  anyone can request — stand in for the password step.
- **`admin.signingSecret()`, not `accounts.signingSecret()`.** The panel works
  in every mode; an instance without `SESSION_SECRET` must still log in.
- **Binding the challenge to the step** means the challenge cannot be obtained
  without the password. A separate "password passed" token next to a separate
  challenge would need a check that the two belong together — a check that is
  easy to forget and invisible when missing.

`test/admin-passkeys.test.js` crosses every token kind against every verifier
(step, enroll challenge, account login/registration challenge, `aid`), each with
an anti-vacuous "verifies as itself" beside it. Add a new token kind → add it to
that matrix.

## 2. Enrollment is NEVER reachable from a session

The two `/enroll` routes 404 while `ADMIN_ENROLL_TOKEN` is unset — **including
for a signed-in operator**. That is the point: a stolen `aid` cookie must not be
able to add a persistent key. Don't "simplify" enrollment into the panel behind
`requireAdmin`. The token is compared constant-time and re-checked on the second
step, so a window closed mid-ceremony stays closed.

## 3. Fail closed, and say so only to the operator

With **no** key enrolled and enrollment closed, the password step answers
exactly like a wrong password (`401 invalid_password`) and logs
`admin_login_no_passkey`. A correct password reveals nothing to someone who has
only that. With enrollment open it answers `409 no_admin_passkey` so the page can
point at the enrollment form. The deploy order that follows from this is in
`docs/deploy-railway.md` — set the token **before** the merge deploys, or the
operator is locked out until they set it.

## 4. Removing the last key is refused server-side

`DELETE /api/admin/passkeys/:cid` 409s on the last key. Recovery is the
env-token path, never an empty list. The check-then-delete is not atomic
(accepted: one operator).

## 5. Testing it: a real authenticator, not a stub

`test/support/soft-authenticator.js` makes real P-256 attestations and ES256
assertions, so `@simplewebauthn/server` actually runs. That is the only way to
prove `requireUserVerification: true` and the counter check: with the library
stubbed, a test can only assert what the route *passed in*. Other specs that need
an operator session mint `aid` directly with `adminSessionCookie()` from
`test/helpers.js` — they are about what the panel does, not about the login.

**Related:** `.claude/rules/admin-moderation-surface.md` (the surface and its
password gate), `lib/routes/passkeys.js` (account passkeys, #418 — `preferred`
UV and discoverable credentials, deliberately different), `docs/deploy-railway.md`
(enrollment and recovery).
