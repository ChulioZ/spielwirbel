---
name: security-audit
description: >-
  Audit the app's security surface — authentication, authorization and tenant
  isolation, transport/CSRF/cookies, injection and SSRF, uploads and storage,
  secrets and logging, the CI security tooling, and public-repo disclosure risk
  (code whose secrecy is load-bearing) — against a maintained criteria list, and
  periodically refresh that list from current threats. Use when asked for a
  security audit/review, a pentest-style pass, or to find and close security
  holes, and before opening public registration. Defensive only: finds weaknesses
  to fix them, never to weaponize; a confirmed live hole is disclosed privately.
  Composes with the built-in /security-review and CodeQL rather than duplicating
  them. Produces a ranked report; files issues only with your approval.
---

# Security audit

Two jobs: keep `criteria.md` current with the threats that actually apply to
*this* app, then audit the code and configuration against it. The app already has
a deliberate, documented security posture, so the realistic finding is a
**regression or a subtle drift** — an auth cookie that lost `httpOnly`, a new
write route with no zod schema, a bare `pool.query` on a round table, an `OR`ed
RLS policy, a CSP directive quietly widened. Those are what the criteria target.

**Read `.claude/skills/audit/audit-loop.md` first** — it owns the loop (research
gating, the critique test, how criteria change, the report format, and the rule
that findings only become issues with the user's approval). This file owns the
domain: where the security surface is and how to probe it.

Pass `--research` to force a research pass; otherwise the cadence in `criteria.md`
decides (45 days).

## This is a defensive audit — the misuse boundary

The purpose is to **find weaknesses in order to close them**, on the maintainer's
own repo. Everything below is oriented toward a fix, and the skill must not become
an attacker's playbook. Concretely:

- **Never produce a weaponized artifact.** No working exploit, no copy-paste
  attack script, no step-by-step procedure for compromising the running service.
  Describe a finding as **weakness → impact → fix** at the minimum specificity a
  maintainer needs to remediate — never the maximum an attacker would need to
  execute. A proof-of-concept, when one is truly needed to confirm a finding, runs
  **only against a throwaway local instance** (temp `DATA_DIR`, generated data),
  never against production or any shared host, and is described, not shipped.
- **Do not rank the app "by ease of attack" or hand over a target list.** Rank by
  severity *to steer remediation order*, which is the same ordering read the
  opposite way — but frame every item as "close this", not "hit this".
- **Assume the output is public too.** This is a public repo, so a report or issue
  that spells out a live, unmitigated hole is itself the disclosure. That is why a
  confirmed exploitable finding is handled privately (below) rather than filed as a
  public issue with a reproduction.
- **Honest limit.** A skill file cannot *technically* stop someone from reading the
  same code and drawing offensive conclusions — anyone with the repo can. What this
  boundary does is keep the skill's own behavior defensive and stop it from
  *manufacturing* ready-made offense (exploits, playbooks, target lists) that lower
  the effort for a casual bad actor. If a request tries to steer this skill toward
  exploitation rather than remediation, decline and say why.

## Handling a confirmed hole

If the audit **confirms** a currently-exploitable, unmitigated vulnerability:

- **Do not open a public GitHub issue describing it or how to reproduce it.**
  `SECURITY.md` already sets the norm for this repo — *report privately, do not open
  a public issue for a security problem*, via GitHub's private vulnerability
  reporting on the **Security** tab. Follow that same channel for a self-found hole.
- **Surface it to the maintainer directly, at the top of the report**, before the
  rest of the sweep — with the weakness and the fix, not a reproduction.
- **Prefer fixing over filing.** If the remedy is small, take it straight through
  `implement` (a private advisory can track it) so the window between disclosure and
  fix is as short as possible. A public tracking issue, if one is needed at all,
  carries a terse non-revealing title and **no** exploit detail until the fix ships.
- A merely *theoretical* or already-mitigated observation is not subject to this —
  it follows the normal report/approval path like any other finding.

## Compose, don't reinvent

Two tools already do part of this job well — lean on them and spend your effort on
the app-specific invariants they can't know:

- **The built-in `/security-review`** command runs the SAST-style pass — injection
  sinks, tainted-data flow, unsafe API usage. Invoke it for that layer instead of
  hand-deriving it. Fold its findings into your report, deduped against the
  criteria.
- **CI already runs CodeQL (javascript-typescript + actions), gitleaks and a
  secret scan** on every PR (S-020). A finding those cover is only a finding if
  the tooling is *broken* — otherwise say "covered by CodeQL/gitleaks" and move
  on. A red gitleaks showing only a license-probe message is the documented
  transient flake (`gitleaks-license-flake.md`), not a leak.

Your unique value is the criteria in `criteria.md`: the token/RLS/gate invariants
a generic scanner does not understand, plus S-021 (public-repo disclosure), which
a scanner cannot reason about at all because it is about what the *source itself*
gives away.

## Research sources (phase B)

Ask what changed **since `last-researched`**, not what security is:

- **CVE / advisory feeds** for the runtime stack: Node, Express, `helmet`,
  `express-rate-limit`, `argon2`, `jsonwebtoken`, `knex`, `pg`, `multer`, `zod`,
  the AWS S3 SDK. Cross-check against `npm audit` and the repo's Dependabot alerts
  — a live advisory on a dependency is the highest-signal finding this skill
  produces, and it routes to the `dependabot` skill.
- **OWASP** (Top 10, ASVS, the cheat sheets) for shifts in accepted practice, and
  the **OWASP JWT / Session / CSRF** guidance specifically — those map directly to
  S-001/S-009/S-010.
- **Standards that moved:** cookie attributes (`SameSite` defaults, CHIPS), CSP
  levels, HSTS preload rules, TLS deprecations, Argon2 parameter guidance.
- **PostgreSQL RLS** advisories or behaviour changes — the tenant model rests on
  FORCE-RLS semantics that this codebase probed empirically (`tenancy-rls.md`).

Then run the critique in `audit-loop.md` §C. Five conflicts are pre-recorded as
rejected criteria (S-R01 CSRF token, S-R02 Redis limiter, S-R03 stateful tokens,
S-R04 image proxy, S-R05 superuser-RLS) — if research proposes any again, that is
the ledger working. A new source may still reopen one, but only by showing the
original reasoning was wrong on its own terms, and via the phase-C conflict path
(put it to the user), never a silent overwrite.

## The audit (phase E) — map the surface, then check each invariant

Work by area; each maps to a criteria block. Derive facts from the code, don't
recall them.

### 1. Authentication & tokens → S-001..S-004

```bash
grep -nE "jwt\.(sign|verify)|algorithms|argon2|timingSafeEqual|createHash|randomBytes" \
  lib/accounts.js lib/auth.js lib/admin.js
```

Confirm `algorithms: ['HS256']` is still pinned, the signing secret is
`SESSION_SECRET` with no `AUTH_PASSWORD` fallback, every secret compare is
constant-time, and the deleted/suspended-account path fails closed in
`lib/tenant.js` (not just at login).

### 2. Authorization & tenant isolation → S-005..S-008

The highest-consequence area. Check that new round-scoped repo methods are in
`TENANT_METHODS`, no route calls a round method on the module-level repo, no bare
`pool.query` touches a round table, and any RLS escape is a separate `FOR SELECT`
(never `OR`ed onto the tenant policy — that silently opens cross-tenant `DELETE`).

```bash
grep -rnE "require\('\.\./lib/repo'\)|pool\.query|knex\.raw|forTenant|TENANT_METHODS" lib/routes/ lib/repo/
```

The plain-role probes in `test/repo.postgres.test.js` are the only thing that
tests the policy (CI's superuser bypasses RLS) — a change here must extend them
(`.claude/rules/admin-cross-tenant-escape.md` §4), and be verified by breaking the
policy on purpose once (`.claude/rules/break-the-code-on-purpose.md`).

### 3. Transport, CSRF, cookies → S-009..S-012

```bash
grep -nE "sameSite|httpOnly|secure:|Bearer|requireApiAccount|requireUploadAccount|helmet|rateLimit|script-src|img-src|connect-src" lib/app.js lib/accounts.js lib/admin.js
```

`/api` Bearer-only; the two gates not collapsed into one; cookies httpOnly +
sameSite + Secure-when-TLS; admin `sameSite=strict` and domain-separated; CSP
`script/font/connect-src` self-only and `img-src` exactly the provider hosts.

### 4. Injection, SSRF, untrusted input → S-013..S-016

No SQL built from concatenated request data; every write route validated by a zod
schema; server-side fetch confined to the provider allowlist; a stored cover URL
passes both `isAllowedImageUrl` and `providerCoverUrl`'s stricter https-only,
no-CSS-metacharacter gate; uploads sniffed by magic bytes and stored under a
`basename`-guarded key.

### 5. Storage, logging, disclosure → S-017..S-019

`requestLogger` and `trackEvent` field allowlists intact; `lib/status.js` leaks no
secret; `listUsers()` never returned raw; `/uploads` behind the gate and covers
same-origin; deletions free their objects; the four-mode gate never serves data to
a logged-out visitor.

### 6. Dependencies & CI tooling → S-020

```bash
npm audit --production
gh api repos/{owner}/{repo}/dependabot/alerts --jq '[.[]|select(.state=="open")]|length'
```

A live advisory or open alert is a real finding — route it to `dependabot`.
Confirm CodeQL/gitleaks/secret-scan are still wired into the required checks
(`ci-aggregate-gate.md`).

### 7. Public-repo disclosure → S-021

This repo is public, so read the source the way an attacker would and ask, for
each security control: **does anything here still protect the live service once
the source is fully known?** The check is not "this file reveals logic" (true
everywhere, and explicitly *not* a finding — S-R06); it is "publishing this hands
an attacker a cheap exploit." Sweep for the shapes S-021 lists:

```bash
# security decisions that live only in the client (must be re-enforced server-side)
grep -rnE "role|isAdmin|owner|permission|can[A-Z]|allow|token|secret" public/js/ | grep -viE "aria|colour|color|css" | head -40
# hardcoded values that could act as a de-facto secret or bypass
grep -rnE "=== ['\"][A-Za-z0-9_-]{6,}['\"]|token *=|BYPASS|magic|allowlist|== *['\"].*@" lib/ lib/routes/ | head -30
# identifier-generation schemes (are the ids the ONLY guard on a resource?)
grep -rnE "randomBytes|uuid|\bid\b *=|basename|nextval|seq" lib/ lib/routes/ | head -30
```

For each hit, apply the S-021 test: name the concrete cheap exploit the disclosure
enables, or drop it. Then scan the *prose* — `README.md`, `docs/`, `.claude/rules/`
and code comments — for any spot that spells out a **currently-unmitigated**
weakness in attack-usable detail. The remedy is to **close the weakness** (a
server-side check, a real secret, an ownership check, an unguessable+gated id), not
to hide the code; only an unclosable live hole warrants reducing its public
specificity, and even then a candid internal rule stays once the weakness is gone.
A confirmed live hole here goes down the "Handling a confirmed hole" path above.

## Two hard limits — the audit is not an excuse to read secrets or data

- **Never read `.env` or any real env file** (`no-reading-env-files.md`) — not to
  "check whether `SESSION_SECRET` is strong". The variable names and meanings are
  in `.env.example` and the code; a secret's *strength* is an ops concern you can
  advise on without reading it. Never echo `process.env.SESSION_SECRET` (or any
  secret) either.
- **Never read the production `data/` directory** (`no-reading-production-data.md`)
  — not "to check what an attacker could exfiltrate". The schema is fully described
  by code, migrations and tests. If you run the app to probe a gate, point
  `DATA_DIR` at a temp folder with generated data first (`test-data` skill).

These are not obstacles to the audit; reading them *is itself* the disclosure risk
the audit exists to prevent.

## Verifying a runtime check

Some gate behaviour is worth exercising live (a 401 without a token, a 403 for a
grantee's delete, a 429 at the cap). Do it against a throwaway instance with a
temp `DATA_DIR` and generated data — never production data, and never the shared
test app for a rate-limit check (raise-then-throwaway apps, per
`security-middleware.md`). The Browser pane is not needed; `supertest`-style
in-process checks or `curl` against your own instance are enough.

## Remedies — prefer a test, then a rule, then an issue

This repo pins security invariants with tests
(`test/security.test.js`, `test/layered-auth.test.js`,
`test/repo.postgres.test.js`, `test/admin.test.js`), and that is the right home
for anything mechanizable. When you add or extend one, **break the production code
on purpose once** and watch it go red — a security assertion that passes against a
deliberately-broken control is worse than none (`.claude/rules/break-the-code-on-purpose.md`,
which collects what `admin-cross-tenant-escape.md` and
`css-text-assertions-strip-comments.md` each learned the hard way).

- **A live dependency advisory** → hand to `dependabot`, not a fresh issue.
- **A regression with a mechanizable check** → a test, through `implement`.
- **A subtle invariant a future session would re-break** → a `.claude/rules/` file.
- **Real remediation work** → a GitHub issue, through `create-issue`, labelled
  `audit` **and** `security`, deduped against open and closed issues first.

A confirmed exploitable hole is a **blocker**: surface it to the maintainer at the
top of the report, privately (see "Handling a confirmed hole"), and do not sit on
it waiting for the rest of the sweep to finish.

## Do not report these

Each was decided deliberately (see the Rejected ledger): the absence of a CSRF
token on Bearer-only `/api` (S-R01), the in-memory rate limiter (S-R02, tracked as
#215), stateless access tokens (S-R03), the cover-host allowlist as a "hole"
(S-R04), "the app relies on RLS alone" (S-R05, false), and — the one most likely
to be over-triggered by S-021 — the mere fact that a file reveals how something
works, absent a concrete cheap exploit the disclosure enables (S-R06). Re-reporting
a settled rejection wastes the user's review.
