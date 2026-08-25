# Production readiness: the decisions and why

> Originated as issue #40's gap analysis for "local-only → publicly hosted."
> The going-live spine and the SaaS blockers below (the hard blockers) have
> since **shipped** — this doc is now the living record of what was decided
> and why, kept current as work lands, not a one-off report. Sections
> describing already-shipped work are deliberately short **pointers to the
> code / `.claude/rules/` file that now owns the operative detail** — read
> those, not this doc, for how something works today. **Go-live happened on
> 2026-07-24 (#219) and the legal and branding questions are settled**, so the
> sections that once tracked them are now records of what was decided rather
> than open items. The reasoning is kept in full where nothing else captures it.
>
> **This document does not track live status.** For what is open, blocked or
> next, read GitHub — `gh issue view 219` and the issues' own
> blocked-by/blocking relations are authoritative
> ([`.claude/rules/`](../.claude/rules/), `pick-issue`). Any status claim
> written here will drift; it has three times already.
>
> The Legal section (§9) is **research, not legal advice**; the Branding
> section's (§10) domain-availability checks are a snapshot, **not** a
> trademark clearance. Both flag where a professional must confirm before
> anything is committed.

---

## 0. TL;DR

- **End-state: multi-tenant SaaS** (public sign-up, many independent groups,
  per-tenant isolation) — because the product's own framing is "any group or
  gaming round" ([`CLAUDE.md`](../CLAUDE.md)), which a single-instance
  deployment can't serve. **Sequenced through a single authenticated instance
  first** (one group, auth gate, real database, TLS) to de-risk auth/DB/ops
  before multiplying tenants — same destination, safer path.
- **The three hard blockers — all shipped (2026-07-19):** (1) authentication +
  authorization on every route, (2) a real database replacing the
  process-local in-memory store, (3) transport security + production hosting
  (#127–#133, live on Railway — see §12's shipped list). **Public sign-up is
  LIVE since 2026-07-24** (#219): layered mode (#266) exercised the real
  account flows behind the shared password, the `'default'` tenant was
  claimed, and removing `AUTH_PASSWORD` opened registration — see §12.
- **Kept the stack, no rewrite.** Node/Express, the no-build vanilla frontend,
  and hand-rolled-but-tested logic all proved out in production — see §2.
- **The delivery target is the web app plus the installable PWA** (#142,
  shipped). Native iOS/Android store apps were evaluated and **dropped on
  2026-07-27** (#143/#144 closed won't-do-now, deliberately reversible) — see
  §2.4.
- **Data lives in managed PostgreSQL** (§3) with S3-compatible object storage
  for cover images — both shipped, both non-negotiable once there's more than
  one concurrent writer or process.
- **Legal (DE/EU):** once hosting real users, an **Impressum (§ 5 DDG)** and a
  **GDPR/DSGVO privacy policy** are legal musts (§9) — **implemented (#134)**:
  `/impressum` + `/datenschutz` are server-rendered from the `IMPRESSUM_*` env
  identity and stay 404 until it is configured at go-live (#219). A
  cookie-consent banner is **not required today** (no non-essential cookies,
  `localStorage`-only, § 25 Abs. 2 TDDDG); re-check if that ever changes.
- **Brand: rebranded to "Spielwirbel"** on 2026-07-19 (#147), with the
  operational surfaces following in #230 — `spielwirbel.de`/`.com`/`.app` are
  registered and `spielwirbel.app` is canonical. The old working name
  "Spieleabend" was generic German for "game night", i.e. descriptively weak and
  unregistrable as-is (§10). A formal DPMA + EUIPO trademark clearance is still
  **deferred**, not done — advisable before brand spend, effectively mandatory
  before a paid tier.

The rest of this document is the reasoning behind each of these.

---

## 1. Which end-state? — decided

**Decided and executed: target multi-tenant SaaS, reached in phases.** A
single-instance-only product could never serve "any group," so building only
for one group would mean a second migration later. The data model was already
close to multi-tenant: a "round" was already a self-contained unit (its own
members, games, sessions, activities), so the tenant boundary (§6) wrapped
rounds without reshaping them.

| | **Multi-tenant SaaS** (the destination) | **Single instance** (milestone one) |
|---|---|---|
| Who it serves | Many independent groups, public sign-up | One group, reachable from the internet |
| Auth | Full registration, roles, password reset | A single shared gate |
| Legal exposure | High — data processor for strangers | Moderate — your own group's data, hosted |

**Rejected, as planned: single instance as the permanent end-state.** Cheapest,
but forecloses the stated "any group" product.

---

## 2. Architecture & tech stack

### 2.1 Runtime & backend — kept, as decided

Node + Express 5 stayed the runtime; `server.js` only calls `listen()`,
`lib/app.js`'s `createApp()` wires everything else, which is exactly what let
auth, `helmet`, and rate-limit middleware slot in later without restructuring.
**Rejected, as planned:** a Nest/Fastify rewrite — no payoff at this size.

### 2.2 Frontend — kept, thin build shipped

**Decision (still binding — cross-referenced from [`CLAUDE.md`](../CLAUDE.md)):
no SPA framework.** The app is already a working client-side-routed SPA
([`public/js/router.js`](../public/js/router.js)); a framework rewrite buys
nothing it can't already do. The one real risk — shared-global-scope
load-order fragility — is a maintainability tax contained by
[`.claude/rules/frontend-script-load-order.md`](../.claude/rules/frontend-script-load-order.md),
not a production-safety issue.

**Shipped since this call was made:** the cache-busting + minification gap
this section originally flagged is closed. `npm run build` (issue #141, see
[`.claude/rules/frontend-build-cache-busting.md`](../.claude/rules/frontend-build-cache-busting.md))
content-hashes and minifies `public/js/**` + `styles.css` into `dist/`, served
only under `NODE_ENV=production`. It stays a one-command, optional,
non-bundling step (`minifyIdentifiers: false`, never `esbuild.build`/bundling)
— not a license to grow it into a framework or add a build step elsewhere.

**Rejected, still rejected: SPA framework rewrite (React/Vue/Svelte).** Defer
indefinitely; revisit only if the shared-scope pattern's complexity outgrows
what it can hold — a code-quality trigger, not a going-live one.

### 2.3 Statefulness & scaling — resolved

Was the real architectural blocker: `lib/store.js` held the whole dataset in
one in-memory object, unsafe the moment more than one process touched it
(rolling deploys, horizontal scaling). **Resolved by the Postgres backend**
(§3, shipped #127) — the app is stateless once `DATABASE_URL` + `S3_BUCKET`
are set, so any number of processes can run behind a load balancer with safe
rolling deploys. Running more than one process isn't done yet (not needed at
current traffic) — see the rate-limit-store caveat in §7 item 5 (#215) before
it is.

### 2.4 Delivery: web and PWA (native store apps dropped)

**Status:**
- **PWA — shipped** (#142, see
  [`.claude/rules/pwa-service-worker.md`](../.claude/rules/pwa-service-worker.md)):
  manifest + service worker, installable, offline app shell, reusing 100% of
  the existing UI. Not itself an App Store / Play Store listing (Android
  installs it well; iOS support is partial). **This is the delivery target.**
- **Capacitor wrapper → App Store + Play Store — dropped 2026-07-27**
  (#143/#144 closed won't-do-now). It remained the right *technical* route if
  the stores were ever wanted — a thin native shell per platform loading the
  same HTML/JS/CSS, no frontend rewrite — but the destination itself was
  dropped. Deliberately reversible; the reopen conditions are recorded on
  #143.
- **Native/cross-platform rewrite (React Native/Flutter) — rejected,** as
  planned: a second full frontend codebase to build and maintain forever, not
  warranted for this UX.

**Why native was dropped.** Push notifications are the substantive reason to go
native, and this app has little use for them. Its core moment is a group already
sitting together, passing one device around — nobody needs to be alerted to
something they are in the middle of doing. There is no scheduling, no
asynchronous flow, and no background state change a user would want to be told
about while away from the app. The installed PWA already covers the home-screen
case, so what a native shell would actually add is push we do not need plus store
listings.

Not needing an install is also a property worth keeping rather than trading away:
a round works from a URL, for participants who hold no account and may never open
the app again.

The honest counterargument, recorded so it is not lost: app-store listings are a
genuine **discovery** channel. It was weighed and rejected on cost — two paid
developer accounts, store compliance, a separate release pipeline and ongoing
review overhead is a large standing commitment for a project maintained by one
person.

**What this does *not* invalidate.** The backend is API-first (every operation
a JSON call under `/api/*`) and auth is token-first (#135). Both were noted at
the time as native prerequisites, but neither was built *solely* for that —
they are the right shape for a web SPA talking to its own API, and they remain
so. Nothing needs undoing, and nothing blocks a future reversal.

**What a reversal would still cascade into** (kept for whoever reopens #143):
store compliance (Apple App Review + Google Play policies, privacy nutrition
labels/Data Safety, an age rating, a public privacy-policy URL, and per Apple
in-app account deletion — the API already supports a clean delete); paid
developer accounts (Apple ~$99/yr, Google ~$25 one-time), app signing and a
mobile release CI pipeline separate from the web deploy; and push
infrastructure (APNs/FCM).

---

## 3. Data persistence — shipped

**Decision executed:** managed **PostgreSQL** (#127) is the production
backend, selected via `DATABASE_URL`; the default JSON-file backend
(`data/data.json`) remains for local/self-hosted use, and both satisfy the
same contract (see
[`.claude/rules/data-access-layer.md`](../.claude/rules/data-access-layer.md),
[`.claude/rules/postgres-backend.md`](../.claude/rules/postgres-backend.md)).
Cover images moved to S3-compatible object storage (#128, see
[`.claude/rules/cover-image-storage-backend.md`](../.claude/rules/cover-image-storage-backend.md))
so the app tier is stateless. Managed Postgres gives automated backups +
point-in-time recovery for free.

> **Correction (2026-08-04) — that last sentence was wrong, and it was
> load-bearing.** Railway's managed Postgres ships with PITR **off**, no backup
> schedule and no snapshots; both layers must be enabled explicitly. Nothing was
> backed up for the entire public life of the instance. The premise went
> unchecked *because* it was written down as settled here, and it propagated into
> the Art. 32 record (`docs/legal/toms.md`) and `docs/legal/retention.md`, which
> both then asserted platform backups that did not exist. Backups were configured
> on 2026-08-04 (manual snapshot → PITR → daily schedule kept 6 days). Left in
> place rather than rewritten, because a decision record should show what was
> believed — see `.claude/rules/railway-postgres-floating-major.md` §5.

**Why Postgres, over the rejected alternatives — still the right call:**
relational data (round → games/sessions → votes) maps naturally to tables,
with `JSONB` for the messier bits (votes maps, activity payloads), so the
migration didn't need to fully normalize on day one. **SQLite** would have
been fine for a single instance but not multi-tenant horizontal scaling,
forcing a second migration later; a **document DB (Mongo)** would have
re-created joins in app code and weakened the tenant-isolation guarantees a
relational `tenant_id` FK gives for free.

---

## 4. Security — hard blockers shipped, hardening ongoing

**Shipped:** authentication + authorization on every route (shared-password
gate #129; token-first accounts #135; tenant-scoped authorization #136, see
[`.claude/rules/tenancy-rls.md`](../.claude/rules/tenancy-rls.md)); TLS
(terminated at Railway's edge, #156); `helmet` security headers +
`express-rate-limit` (#130, see
[`.claude/rules/security-middleware.md`](../.claude/rules/security-middleware.md));
hardened uploads — content-sniff/re-encode, safe extension derived from the
detected type, not `originalname` (#133).

**Already strong, kept:** the cover-image host allowlist (see
[`.claude/rules/add-game-lookup-provider.md`](../.claude/rules/add-game-lookup-provider.md))
— since #172 it gates what may be *stored and hotlinked* rather than downloaded,
and the server no longer fetches cover bytes at all (see
[`.claude/rules/provider-cover-hotlinking.md`](../.claude/rules/provider-cover-hotlinking.md))
and `.env`-only secrets management (see
[`.claude/rules/no-reading-env-files.md`](../.claude/rules/no-reading-env-files.md))
— extend the same discipline to any new user-supplied-URL fetch.

**Still open (fast-follow hardening, not launch blockers — tracked in §7):**
- **Centralized request validation — shipped (#213).** The mutating routers
  (`rounds`, `games`, `sessions`, `account`) now validate request bodies via
  `zod` schemas through a shared `lib/validate.js` helper, replacing the
  per-handler `typeof`/`Array.isArray` checks. (Genuinely stateful checks that
  reconcile against stored data — the game-edit min/max range, session
  round-membership filters — stay in the handlers by design; they aren't
  body-shape validation.)
- **Real error tracking** — the logging engine is now `pino`/`pino-http`
  (**#212 shipped**, same log shape/fields, no-PII request allowlist
  preserved); what remains hand-rolled is only the *error-tracking* stand-in:
  `captureError`'s `ERROR_WEBHOOK_URL` forward. Choosing a real provider (e.g.
  Sentry) is a later, separate decision (cost/DPA implications, §9).
- **Rate-limit store** — `express-rate-limit`'s in-memory store only works
  correctly for one process; fine today (single Railway instance), tracked as
  a prerequisite for horizontal scaling as **#215**.

---

## 5. User registration & authorization — shipped

**Both milestone-one (single shared gate) and the full account model
shipped.** `AUTH_PASSWORD` gates a single shared login (#129); the
token-first account model — email + password (Argon2id), email verification,
access/refresh tokens, password reset (#135, see
[`.claude/rules/user-accounts.md`](../.claude/rules/user-accounts.md)) — runs
alongside it behind `ACCOUNTS_ENABLED`, staged for opening public registration
(see [`.claude/rules/accounts-mode-gate.md`](../.claude/rules/accounts-mode-gate.md)).
"Member" stayed decoupled from "user" as recommended — a name-only seat at a
round, optionally nothing more — which is what let a single-owner tenant
launch without building roles or invitations first (see §6, §12).

**Rejected, as planned:** a full home-grown password stack beyond the hashing
itself (would concentrate high-risk surface for no product benefit) and
passwordless-only login (hard-depends on reliable transactional email).
Offloading identity to an IdP/OAuth was considered and **deferred, not
rejected** — revisit if maintaining the hand-rolled token issuance
(`lib/accounts.js`) becomes a burden; tracked as **#214** (§7).

---

## 6. Multi-tenancy & data isolation — shipped

**`tenant_id` on every top-level entity, enforced centrally.** The tenant
middleware ([`lib/tenant.js`](../lib/tenant.js)) resolves the caller's tenant
and scopes the repo (`req.repo`) to it on every request — the single
enforcement point recommended here, not per-handler `WHERE` clauses. Postgres
**Row-Level Security** backs it as defense-in-depth (#136, see
[`.claude/rules/tenancy-rls.md`](../.claude/rules/tenancy-rls.md)).
**Rejected, as planned:** database-per-tenant — operationally heavy at this
scale (migrations × N databases) for no real isolation gain over `tenant_id` +
RLS.

**Shipped (#139, 2026-07-19):** per-tenant quotas — a rounds-per-tenant cap, a
games-per-round cap (which transitively bounds cover-image storage), and a
tags-per-round cap — enforced in accounts mode only, all env-tunable. (A fourth
cap bounded the billed buy-next spend until that feature was removed in #264.)
Bounds abuse/cost before opening public sign-up (§12).

---

## 7. Code quality & maintainability

**Current — genuinely good for the size:**
- **Tests:** 19+ spec files ([`test/`](../test)) driving the app in-process via
  `supertest`, each in an isolated temp `DATA_DIR`
  ([`.claude/rules/automated-tests.md`](../.claude/rules/automated-tests.md)),
  including i18n key-parity enforcement and provider parsers tested against
  sample HTML with no network.
- **CI/CD:** `CI` (test matrix + coverage-threshold job) + `Lint` (eslint +
  syntax) on every push/PR; Dependabot weekly.
- **Coverage:** measured via Node's built-in `--experimental-test-coverage`;
  CI's `coverage:ci` job enforces line/function/branch floors.
- **Codified learnings:** a strong [`.claude/rules/`](../.claude/rules) culture
  captures the non-obvious traps — a real maintainability asset.

**Gap for production — mostly shipped but hand-rolled.** Observability
baseline (#132, [`lib/observability.js`](../lib/observability.js)) — `/healthz`,
structured JSON request logs, a central error handler — all shipped, but
deliberately **hand-rolled and dependency-free** ("no Sentry bundle" per the
file's own doc-comment). That trade-off made sense pre-launch; it doesn't
anymore now that real users hit this — see the shortlist below.

**Battle-tested-dependency candidates (production-readiness lens, not "keep it
minimal").** The mindset shift in [`CLAUDE.md`](../CLAUDE.md) applies most
directly here: several hand-rolled, security-or-correctness-critical pieces
now have a stronger case for a mature library than for growing the homegrown
version further. Filed as #211–#215 (2026-07-19).

1. **Postgres schema migrations + "no ORM" reopened — shipped (#211).**
   [`lib/repo/postgres.js`](../lib/repo/postgres.js) used to evolve the schema
   via `CREATE TABLE`/`ALTER TABLE ... IF NOT EXISTS` on every `init()`, tracked
   only by code comments, no migrations table, no rollback (a real incident: it
   needed a hand-written advisory lock to survive concurrent boots), and it
   hand-wrote every parameterized SQL string with the `JSON.stringify` +
   `::jsonb`-cast footgun (arrays silently becoming Postgres array literals).
   Now on **Knex** (query builder + built-in migrations, one dependency): the
   `~30` data-access methods use the fluent builder, schema lives in versioned
   migration files under [`lib/repo/migrations/`](../lib/repo/migrations)
   (`npm run migrate`), and `init()` runs `knex.migrate.latest()`. The baseline
   migration mirrors the old DDL idempotently, so it's a safe no-op on the live
   prod DB (records the baseline, no data change). It's **not** a full ORM — RLS,
   the tenant-scoped `tx`/`qt` `set_config`, advisory locks and `FOR UPDATE`
   stay on `knex.raw()` (a full ORM was rejected: it doesn't retrofit cleanly to
   RLS + the tenant-transaction pattern). The advisory lock **stays** — Knex's
   own migration lock doesn't cover the first-boot bookkeeping-table create race
   (verified). See [`.claude/rules/postgres-backend.md`](../.claude/rules/postgres-backend.md).
2. **Structured logging + error tracking** — the logging half is **shipped
   (#212)**: the hand-rolled JSON-line writer + request logger are now
   `pino`/`pino-http` internally, with the public `lib/observability.js` exports,
   the exact log shape/fields, and the no-PII request allowlist unchanged. The
   webhook-forward stand-in for a real error tracker (e.g. Sentry) is still
   open — **decided 2026-07-19 to scope the logging half only** and leave the
   error-tracking provider for a later decision (cost/DPA implications, §9).
3. **Request validation — shipped (#213).** Mutating routes used to hand-roll
   their own `typeof`/`Array.isArray` checks. A `zod` schema per body shape,
   run through the shared `lib/validate.js` helper, now makes body validation
   uniform at the router boundary (`rounds`/`games`/`sessions`/`account`).
4. **Identity/token issuance — access tokens shipped (#214).**
   [`lib/accounts.js`](../lib/accounts.js) was a well-built hand-rolled HMAC
   access-token + rotating-refresh-token scheme, but it gates real users'
   accounts. The access token is now a standard HS256 JWT issued/verified via
   the vetted `jsonwebtoken` library (`sub` = user id, `exp` = 15-min TTL,
   `SESSION_SECRET`-signed, `alg` pinned) — a code-only swap, **not** an IdP
   migration (that build-vs-buy question stays a separate, later decision, see
   §9). The refresh token deliberately stays opaque + hashed-at-rest — it isn't
   a JWT and doesn't need to be. Filed and shipped as **#214**.
5. **Rate-limit store** — `express-rate-limit`'s default in-memory store only
   works correctly for exactly one process. Fine today (single Railway
   instance); becomes wrong the moment horizontal scaling (§12) adds a
   second process. Track `rate-limit-redis` (or similar) as a prerequisite for
   scaling out, not an immediate fix. Filed as **#215**.

**Recommendation.** #1 (migrations/Knex) is **shipped (#211)** — it was the one
place a real production incident risk already existed. The rest are fast-follow
hardening, sequenced by how much production traffic has grown.

---

## 8. Hosting & operations — shipped

**Railway** builds the repo's `Dockerfile` and auto-deploys on push to `main`,
health-checked at `/healthz` (#131); paired with **managed PostgreSQL** (§3)
and **Cloudflare R2** for uploads. TLS terminates at Railway's edge (#156).
Full step-by-step, including the checklist of account/credential steps only a
human can do: [`docs/deploy-railway.md`](./deploy-railway.md).

**Rejected, as planned:** self-hosting Postgres, rolling your own TLS, or a
Kubernetes setup — all add operational burden managed services remove at this
scale. Cost envelope stayed hobby-scale (~€25–50/month); since #264 removed the
buy-next feature there is no pay-per-use AI spend on top of it.

---

## 9. Legal & compliance (DE/EU)

> **Research, not legal advice.** German/EU rules are fact-specific. The
> decision recorded in #134 (revised 2026-07-21) is that the launch texts are
> **self-reviewed against primary sources, not lawyer-reviewed** — a paid
> review buys little for a free, donations-only, no-tracking service. The
> "confirm with a lawyer" notes below are therefore **optional post-launch
> hardening**, not pre-launch gates; a professional review becomes effectively
> mandatory if a paid tier is ever introduced (#173).

Assume German UI, German/EU users, and (for the SaaS end-state) that you host
**strangers'** personal data — the line that turns most of this from optional
to mandatory.

### 9.1 Impressum — legal must (once non-private) — implemented (#134), activated at go-live

- The Impressum obligation moved from **§ 5 TMG to § 5 DDG** (Digitale-Dienste-
  Gesetz) effective **14 May 2024** (BGBl. 2024 I Nr. 149) — any Impressum/legal
  text must reference **DDG**, not TMG.
- A **purely private** site for friends/family generally needs no Impressum —
  today's shared-password-gated instance may fall under that exception. The
  moment the service is **public / offered to others** (multi-tenant
  sign-up), it is no longer "purely private" and an Impressum is **required**;
  omitting or mislabeling it is an *Ordnungswidrigkeit* with fines cited up to
  €50,000 in the worst case.
- **Optional post-launch hardening (lawyer):** whether the specific launch
  shape counts as private, and exactly what the Impressum must contain. The
  home-address exposure is solved by the **rented service address** (#134
  decision), consumed at runtime via `IMPRESSUM_ADDRESS`.

### 9.2 GDPR/DSGVO — legal must (once hosting real users' data) — implemented (#134/#140)

- The app stores **personal data**: member names, ratings/opinions tied to
  people, and (with accounts) emails; server logs contain **IP addresses**.
  This triggers the full GDPR stack: a **privacy policy**, a **lawful basis**
  per processing purpose, **data-subject rights** (access/export/deletion —
  the app already deletes cleanly), **data minimization**, and **retention**
  limits.
- **Third-party processors** need **Data Processing Agreements**: the host,
  the managed DB, and object storage. Since **#264** removed the buy-next
  feature, the app makes **no outbound AI call** and there is no US
  LLM-processor transfer left to cover — the remaining processors are the
  hosting stack itself.
- **Optional post-launch hardening (lawyer/DPO):** lawful basis per purpose,
  retention periods, whether a DPIA is needed, and the international-transfer
  basis for the hosting processors — the launch texts (#134) record the
  self-reviewed answers (Art. 6(1)(b)/(f) per purpose; no DPIA — low risk, no
  special categories; SCC/DPF for Railway and Cloudflare).

### 9.3 Cookie / consent banner — probably not required today (verify)

- German cookie/consent law lives in **§ 25 TDDDG** (renamed TTDSG): consent
  is required for storing/reading device information **unless strictly
  necessary** for a requested service.
- **The app sets no cookies and uses `localStorage` only** for strictly
  necessary function (locale preference, auth session token) — likely falls
  under the necessity exception, so a consent banner is likely **not
  required**. Fonts are self-hosted, so no Google-Fonts consent issue either.
- **This changes** the moment analytics, ads, or other non-essential tracking
  is added. That the auth cookies qualify as "strictly necessary" is the
  self-reviewed position published in the #134 policy; a lawyer's confirmation
  is optional post-launch hardening.

### 9.4 Terms of use / DSA content rules — implemented (#140)

**Recorded conclusion (#173, 2026-07-21): no AGB obligation and no
Widerrufsbelehrung are due** — the service is free with unconditional
voluntary donations, so there is no consideration and no consumer contract.
That is a decision, not a gap. What *does* apply to any hosting service
regardless of size are the **DSA base duties** (Arts. 11/12/14/16–18 —
contact points, publicly stated content rules, notice-and-action, statements
of reasons, criminal-offence notification), and #140 shipped them as
**Nutzungsbedingungen** at
`/nutzungsbedingungen` (`lib/legal.js`, DE authoritative + EN, env-gated like
the other legal pages): explicit prohibited-content list, takedown/measures
clause, liability cascade, DSA contact points, plus the internal workflow +
Art. 17 statement-of-reasons templates (`docs/legal/notice-and-action.md`)
and a retention schedule (`docs/legal/retention.md` — moderation-log entries
with personal data: 3 years, § 195 BGB-aligned). Drafted Claude-only under
the same self-review bar as #134; there is deliberately **no minimum-age
clause** (no consent-based processing → Art. 8 DSGVO not triggered; hosting
service, not platform → no Art. 28 DSA duty) — the re-evaluation triggers
live in `.claude/rules/keep-legal-docs-current.md`. A lawyer pass remains
optional post-launch hardening, effectively mandatory before any paid tier
(#173).

---

## 10. Branding, name & domain — decided and executed (#147/#230)

> Availability is a **snapshot** (checked via authoritative RDAP: Verisign for
> `.com`, DENIC for `.de`, registry bootstrap via `rdap.org` for `.app`) and is
> **not a trademark clearance**. A DPMA (German) + EUIPO (EU) register search
> in the relevant Nice classes, by an attorney, is required before committing.
> Rebranded to **"Spielwirbel"** on 2026-07-19 (issue #147): `app.title`/`<title>`
> and all brand-facing text now read "Spielwirbel", and `spielwirbel.de`/`.com`/
> `.app` are registered. The scope was deliberately the lightweight one (a
> Claude-assisted availability search, no attorney); a **formal DPMA + EUIPO
> clearance remains deferred** — still advisable before brand spend and
> effectively mandatory before a paid tier (see below and #173). The analysis
> that follows is kept as the rationale for why the old generic name was dropped.

**Current brand.** "Spieleabend" is **generic German for "game night."** As a
trademark it is descriptive → not distinctive → effectively unregistrable and
unenforceable, and the space is crowded (e.g. the AI game-night organizer
[Boardy](https://www.boardyboard.com/)). Fine as an *internal*/product name;
weak as a *brand*. `CLAUDE.md` already treats "Spieleabend" as the product
name and the entity as "Session," so a rebrand would touch `app.title`/
`<title>` and marketing copy, not the domain model.

**What makes a good pick:** a **coined / distinctive** word, short,
pronounceable in German *and* English, with `.com` **and** `.de` **and**
`.app` free.

**Shortlist (RDAP snapshot, all `avail` as of the original check):**

| Candidate | Angle | Notes |
|---|---|---|
| **`rundenwahl`** | DE "the round's choice" | **Top pick.** On-brand, distinctive, all TLDs free. Slightly descriptive in German → get an attorney read on distinctiveness. |
| **`ludopick`** | "ludo" (play) + "pick" | **Top pick.** Language-neutral, clearly coined, all TLDs free. |
| `ludoround` | "ludo" + "round" | Solid backup; a touch generic. |
| `spielwahl` | DE "game choice" | Descriptive in German (weaker mark). |
| ~~`meeplevote`~~ | meeple + vote | **Avoid** — "meeple" is a registered EU/DE trademark (Hans im Glück / Carcassonne), real conflict risk despite the domain being free. |

**Outcome.** None of the shortlist above was taken — a further search wave
produced **"Spielwirbel"**, which won on being distinctive, pronounceable in
German, and free across `.de`/`.com`/`.app`; all three were registered and
`spielwirbel.app` is canonical (#147, #230). The table is kept as the record of
what was considered and why. **The attorney trademark clearance (DPMA + EUIPO)
was not done and remains deferred** — advisable before spending on brand assets,
effectively mandatory before a paid tier (#173).
**Rejected: keep "Spieleabend" as the public brand** — unregistrable,
undifferentiated, SEO-invisible against the generic term; fine as a friendly
subtitle, not the brand to build on.

---

## 11. Internationalization & product readiness

**Current.** Solid i18n foundation: DE/EN/ES/FR/IT with enforced key parity, locale
follows system language, overridable, persisted in `localStorage` — ahead of
most hobby projects and a real launch asset.

**Status of the product-readiness gaps this section originally flagged:**
- **Onboarding / empty states — shipped** (#138): sign-up → create-round →
  empty states. No invite step (see below).
- **Invitations** — a way to invite a *second account* into a tenant so it's a
  genuine co-member rather than a name-only seat. **Deferred (#207, no
  relation to go-live #219 either way — see §12)**, not a launch requirement:
  a public first-run already works end-to-end with a single owner account
  adding name-only members.
- **Accessibility — shipped** (#145, see
  [`.claude/rules/accessibility-contrast-and-modals.md`](../.claude/rules/accessibility-contrast-and-modals.md)):
  focus management, ARIA, contrast (checked against the color-mix-derived
  theme system, see
  [`.claude/rules/theme-derived-colors.md`](../.claude/rules/theme-derived-colors.md)).
- **Mobile web — still open, verify.** The app is used on a couch; mobile is
  likely the primary device — and since native store apps were dropped (§2.4),
  mobile *web* is the only mobile experience there is.
- **Legal surfaces in-product — shipped (#134):** the gated site footer links
  Kontakt, `/impressum` and `/datenschutz` on the SPA, the login page and the
  contact page; everything appears together once the go-live env is set (#219).

---

## 12. Roadmap: shipped, go-live dependencies, and everything else

> **Go-live executed 2026-07-24 (#219): public registration is open on
> production.** The two-step #266 process ran as designed — layered mode
> (accounts + shared password together), owner registration, the
> `'default'`-tenant claim via the admin panel, private smoke tests (which
> caught and fixed the #399 auth-limiter reload loop before opening), then
> removing `AUTH_PASSWORD` as the actual trigger. The blocking relations
> below stay as the historical record of what gated it.

**No more "phases."** This section used to group work into numbered phases
(0–4); that framing was retired 2026-07-22 in favor of what actually
determines build order: **GitHub's native issue-blocking relations** on
**#219** ("Go live: open public registration on the production instance").
The rule is simple and machine-checkable via `gh issue view <N>` /
`pick-issue`, instead of living in prose that drifts:

- **Blocks go-live** — #219 is "blocked by" the issue; it must land before
  public sign-up opens.
- **Waits for go-live** — the issue is "blocked by" #219; it must not land
  before public sign-up opens. (The only members were the native-app issues —
  shipping store apps before the web launch would have meant two go-lives in
  parallel — and both were later dropped outright, so the category is currently
  empty.)
- **No relation to #219 either way** — genuinely optional relative to
  launch: build it before, after, or never, purely on value-for-effort.
  `pick-issue` no longer down-ranks these just for being "post-launch" —
  only their own merits matter.

Effort: **S** ≈ hours–1 day · **M** ≈ days · **L** ≈ 1–2 weeks · **XL** ≈ weeks.
Risk = chance of getting it subtly wrong / blast radius. These are historical
labels on already-decided/shipped work below, not a live prioritization
signal — the open issues' own `gh issue view` state is the current source of
truth.

### Shipped — the going-live spine and the SaaS blockers

**Status: shipped and live** — see [`docs/deploy-railway.md`](./deploy-railway.md).

| Item | Effort | Risk | Notes |
|---|---|---|---|
| **Move to PostgreSQL** + object storage for uploads; one-time file→DB migration | **L** | **High** | HARD BLOCKER (§3, §2.3) — **shipped** (#127, #128) |
| Make backend **stateless / single-writer-safe** (falls out of DB move) | M | High | HARD BLOCKER — **shipped** (#127) |
| **Auth gate** (single shared/small-user login, session cookies) | M | High | HARD BLOCKER (§5) — **shipped** (#129) |
| **TLS + `helmet` + rate limiting** | S–M | Med | HARD BLOCKER (§4) — **shipped** (#130, #156) |
| **Containerize + deploy pipeline + managed host** | M | Med | HARD BLOCKER (§8) — **shipped** (#131) |
| Central error handler, `/healthz`, structured logging, error tracking | M | Low | **shipped** (#132); see §7 for the follow-up (real error tracking, not the webhook stand-in) |
| Harden file uploads (content sniff/re-encode, safe extension) | S–M | Med | **shipped** (#133) |
| Impressum + privacy policy | S (+external) | Med | Required if not "purely private" (§9) — **implemented** (#134, self-reviewed per its revised completion bar); pages activate when the rented address is configured at go-live (#219/#226) |
| Account model (users, email verify, password reset) — built **token-first** (§2.4/§5; native clients were a motivation at the time, but it is the right shape for the web SPA regardless) | **L** | **High** | Blocker for public sign-up (§5) — **shipped** (#135) |
| **Tenant model + isolation** (`tenant_id` everywhere, central enforcement, RLS) | **L** | **Very High** | Blocker — cross-tenant leak is catastrophic (§6) — **shipped** (#136) |
| Onboarding / first-run flow + empty states | M | Med | Blocker for usable sign-up (§11) — **shipped** (#138) |
| Per-tenant quotas (rounds, games, tags) | S–M | Med | Cost/abuse control — **shipped** (#139) |
| Terms of use (DSA content rules), DPAs (host, DB), transfer basis, retention | S (+external) | Med | Legal must for SaaS (§9) — **implemented** (#140; no AGB/Widerruf due per #173 — recorded in §9.4) |
| Provider cover-art rights decision | S (+decision) | Med | Had to be decided before public hosting — **shipped** (#172) |
| Thin frontend build (content-hash cache-busting + minify) | S–M | Low | **shipped** (#141) |
| **PWA** — manifest + service worker, installable + offline (§2.4) | M | Low | **shipped** (#142) |
| Accessibility audit | M | Low | **shipped** (#145) |
| Test coverage reporting | S | Low | **shipped** (#146) |
| Brand name + domain registration | S | Low | **shipped** (#147) — see §10 |

*Exit (reached):* the group's data runs in the cloud, gated, on TLS, on a real
DB, with backups and monitoring. Public multi-tenant sign-up followed on
2026-07-24 via the layered two-step (#266): `ACCOUNTS_ENABLED=true` behind the
shared password first, then — after the `'default'` claim and the smoke
tests — removing `AUTH_PASSWORD` as the actual go-live trigger (#219).

**Also shipped — battle-tested-dependency hardening batch** (recommended, was
never a go-live blocker; see §7 for the reasoning behind each):

| Item | Effort | Risk | Issue |
|---|---|---|---|
| **Postgres schema migrations** + adopt **Knex** | L | Med | #211 |
| **Structured logging** — `pino`/`pino-http` | S–M | Low | #212 |
| **Centralized request validation** — `zod` at the router boundary | M | Low | #213 |
| **Identity/token issuance** — access-token JWTs via `jsonwebtoken` | M | Med | #214 |

### Blocked go-live — #219 was blocked by these (all closed; executed 2026-07-24)

| Issue | What | Notes |
|---|---|---|
| **#226** | Set up Brevo (transactional e-mail) and configure it on the Live instance | **Shipped/closed** — mail + operator identity configured in production |
| **#266** | Allow accounts mode behind the shared-password gate (layered auth) + claim the `'default'` tenant | **Shipped** (PR #394) and executed: layered mode exercised the account flows privately, the claim preserved the pre-accounts data |
| **#399** | Auth-limiter 429 reload loop + misleading auth-form errors | Found live in the go-live smoke test, **fixed** (PR #400) before opening registration |

### Dropped — native store apps

| Issue | What | Notes |
|---|---|---|
| **#143** | Ship native iOS/Android apps via Capacitor (§2.4) | **Closed won't-do-now 2026-07-27**; reopen conditions recorded on the issue |
| **#144** | App-store compliance & mobile release pipeline (§2.4/§9) | **Closed with #143** — no purpose without the native shell it exists to ship |

These waited on go-live #219 while it was open, and were dropped outright
afterwards rather than picked up. The reasoning is in §2.4; the decision is
deliberately reversible.

### No relation to go-live either way — build anytime, purely on merit

A single-owner tenant with name-only members (today's model, unchanged) is a
complete public product on its own — none of the below is required to open
public sign-up, but none of it is barred from happening before, during, or
after that either. `pick-issue` ranks these on ordinary value-for-effort,
same as anything else.

| Issue | What | Notes |
|---|---|---|
| **#137** | Roles & permissions | **Open.** Round sharing (#207) shipped, so "which grantee may do what" is now a real question rather than a hypothetical one |
| **#173** | Voluntary donations support link | **Shipped** 2026-07-22 — legally invisible (unconditional, no AGB/Widerruf) |
| **#207** | Invitations & round sharing (multi-user rounds) | **Shipped** 2026-07-24 as per-round grants, *not* co-tenancy — see [`.claude/rules/round-grant-resolver.md`](../.claude/rules/round-grant-resolver.md) |
| **#209** | Per-device voting | **Open**, and deliberately deprioritised — the group needing no accounts is a defining property, so this stays opt-in and never the default |
| **#215** | Move `express-rate-limit` to a shared Redis store | **Open.** Prerequisite for horizontal scaling |
| **#311** | Automate the 3-year moderation-log retention purge | **Open.** Extremely low priority until ~2029 (year-end cutoff math) |
| — | Horizontal scaling (multi-process behind LB — enabled by stateless tier) | Not yet filed as its own issue; depends on #215 |
| — | Mobile-web responsiveness pass | Not yet filed as its own issue |
| — | Localize server-side error messages if user-facing surfaces grow | Not yet filed as its own issue |
| — | Attorney trademark clearance (DPMA + EUIPO) for the chosen brand | Advisable before heavy brand spend, not blocking anything shipped (§10) |
| — | Consent mechanism (cookie/tracking banner) | Conditional, not yet needed — only if non-essential tracking is ever added (§9.3) |

**Hard blockers, consolidated — all shipped:** real database + stateless tier
(§3/§2.3), authentication (§5), TLS + security headers + rate limiting (§4),
production hosting + deploy (§8), tenant isolation (§6), accounts (§5), the
legal pack (§9), per-tenant quotas (§6), the cover-art rights decision (§4).
**Public sign-up opened on 2026-07-24** (#219), so there is nothing left before
launch — the table above is a record, not a queue. What to work on next is a
`pick-issue` question answered from GitHub, not from this file.

---

## 13. Summary

The codebase was well-built for what it was, and none of it needed throwing
away — no rewrite happened or is planned (§1, §2). Going public was never an
architecture problem; it was an **operations, security, and data-model**
problem, concentrated in four hard blockers — a real database + stateless
tier, authentication, transport/edge security, and production hosting — **all
shipped**, along with the legal pack, quotas, and the battle-tested-dependency
hardening batch (§7, §12). **Public multi-tenant sign-up opened on 2026-07-24**
(#219), so every question this document was written to answer is now closed.
Delivery is the **web app plus the installable PWA** (#142); native store apps
were evaluated and dropped on 2026-07-27 (§2.4), reversibly. The legal musts
(Impressum under DDG, DSGVO privacy policy, the SaaS pack) are implemented
(#134/#140), and the app's no-tracking, self-hosted-fonts, `localStorage`-only
design **needs no cookie banner** — re-check only if non-essential tracking is
ever added (§9.3). Branding is settled: **Spielwirbel** (#147/#230), with a
formal DPMA + EUIPO clearance still deferred (§10).

What remains of this document's value is the **reasoning** — why the stack was
kept, why there is no framework and no third persistence backend, why covers are
hotlinked, why native was dropped. Status belongs on GitHub.
