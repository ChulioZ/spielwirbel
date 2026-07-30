# Code-maturity criteria

- **last-researched:** 2026-07-29
- **cadence:** 90 days

Seeded 2026-07-29 from `CLAUDE.md` (the production-readiness mindset shift and
the architecture calls), `docs/production-readiness.md` §7 (the 2026-07-19
build-vs-buy review, #211–#215), and the maturity-relevant rules under
`.claude/rules/` — **not** from research. The first run must do a full research
pass.

**The premise:** this codebase's architecture was re-examined for the public
multi-tenant end-state and held; its hand-rolled pieces that mattered most were
already replaced (#211 Knex, #212 pino, #213 zod, #214 JWT). So the realistic
finding is code that has *outgrown its original context* — a hobby-era pattern
now carrying production load — or *newly* hand-rolled code that skipped the
build-vs-buy question. A finding that restates a settled architecture call is
not a finding; the rejected entries below are that ledger.

---

## Structure & duplication

### M-001 — Source files stay one-concern and token-friendly
- **Status:** adopted · 2026-07-29
- **Source:** `.claude/rules/token-friendly-source-files.md`
- **Check:** No file mixes several *independently editable* concerns — the seam
  test, not raw line count. `wc -l` the tree and judge outliers past ~700 lines
  by that test. Documented non-findings: a single cohesive flow
  (`public/js/views-session.js`) and flat data tables (`lib/legal.js`, the
  `lang` tables). A split must respect the frontend load order and the four
  wiring points `frontend-helper-modules-and-coverage.md` lists — a finding
  here names the seam, not just the size.
  **`test/token-budget.test.js` now holds the 700-line line**, with an allowlist
  whose entries are split `judged` (measured against the seam test and kept) and
  `recorded` (over budget, never actually judged). **The `recorded` entries are this
  criterion's worklist** — the test deliberately cannot tell the two apart, so
  reading them and either judging or splitting them is the manual half that stays
  here. A file arriving over budget with no entry fails CI, so the audit no longer
  has to catch growth; it only has to catch a bad seam.
- **Enforced by:** `test/token-budget.test.js` (the threshold and the allowlist);
  the seam judgement is manual

### M-002 — A value the client offers and the server validates has one source of truth
- **Status:** adopted · 2026-07-29
- **Source:** `.claude/rules/shared-constants-across-the-stack.md` (the palette
  bug: six of eight UI colours rejected in production for months, silently)
- **Check:** Grep for "keep in sync" comments and hand-copied cross-boundary
  constants. Every duplicate either becomes a shared file the route `require`s
  out of `public/js/`, or carries a parity test as its explicit licence
  (`test/tag-icons.test.js`, `test/contact-page-brand.test.js`,
  `test/landing-copy.test.js` are the sanctioned instances). A copy that could
  have been a `require()` is the bug waiting to happen.
- **Enforced by:** the named parity tests for the existing licensed copies —
  new duplicates are manual

### M-003 — Mutating routes validate through the shared zod boundary
- **Status:** adopted · 2026-07-29
- **Source:** `docs/production-readiness.md` §7 item 3 (#213) · `lib/validate.js`
- **Check:** Every mutating route in `routes/*.js` runs its body through the
  shared `lib/validate.js` schema pattern. A new route hand-rolling
  `typeof`/`Array.isArray` checks is a regression to the pre-#213 shape —
  uniformity at the router boundary is the point, not zod for its own sake.
- **Enforced by:** — (manual)

## Build vs buy

### M-004 — New hand-rolled solutions to solved problems get the build-vs-buy question, answered in writing
- **Status:** adopted · 2026-07-29
- **Source:** `CLAUDE.md` ("What this changes about how to work here") ·
  `docs/production-readiness.md` §7
- **Check:** Any newly hand-rolled implementation of a commodity concern
  (parsing, validation, schema evolution, auth primitives, retry/backoff,
  scheduling, queueing) either adopts a mature, widely-used dependency or
  records why not — in a rule, an issue, or a rejected entry here. Per concern,
  not per line: a ten-line helper is not a finding; a growing homegrown
  subsystem is. The two open §7 items are already tracked (#212's
  error-tracking half, #215's limiter store) — context, not fresh findings.
- **Enforced by:** — (manual)

### M-005 — Adopted dependencies stay maintained and still fit
- **Status:** adopted · 2026-07-29
- **Source:** `package.json` · the #211–#214 adoptions
- **Check (research phase):** For each production dependency — knex,
  pino/pino-http, zod, jsonwebtoken, argon2, express, helmet,
  express-rate-limit, multer, nodemailer, pg, @aws-sdk/client-s3, compression —
  the survival question: still maintained, not deprecated, not superseded by a
  Node built-in? Judge by the package's own repository activity and official
  Node release notes, not star counts. Versions are the `dependabot` skill's
  job; this asks whether the dependency should *exist*.
- **Enforced by:** Dependabot (versions only) — the survival question is
  research-phase manual
- **2026-07-29 (first research pass):** all 14 pass. knex is actively
  maintained again (3.2.x releases through 2026-05). The slowest-moving is
  **jsonwebtoken** (last release 2023-08; not deprecated, no unpatched
  advisory; the ecosystem default has shifted to `jose`) — re-check it first
  each pass, and see the rejected M-R08 before proposing the swap.

## Multi-process & in-memory state

### M-006 — State that must be correct across the deployment lives in the store, not process memory
- **Status:** adopted · 2026-07-29
- **Source:** `.claude/rules/guest-demo-accounts.md` §1 (production runs two
  replicas) · `docs/production-readiness.md` §7 item 5
- **Check:** Sweep module-level mutable state (module-scope counters, Maps,
  caches) in `lib/` and `routes/`. Classify each instance: (a) correct
  per-process by design; (b) a **documented accepted trade-off** — the
  in-memory rate-limiter stores (#215 tracks the Redis store as a scaling
  prerequisite), the `MAIL_DAILY_MAX` budget in `lib/mail.js` (per-process by
  documented decision, `bounding-bulk-registration-mail.md`), the 10-minute
  lookup cache in `routes/lookup.js`, the `/readyz` result cache in
  `lib/observability.js`; or (c) a finding — state whose *correctness* (not
  merely efficiency) assumes one process. The done-right model is the demo
  machinery: liveness counts and cooldowns are read from the store per request,
  so replicas agree by construction. A new (b) requires the documentation, not
  just the intent.
- **Enforced by:** — (manual)

## Test-suite maturity

### M-007 — Test constants come from the source under test, never hand-copied
- **Status:** adopted · 2026-07-29
- **Source:** `.claude/rules/shared-constants-across-the-stack.md` ("Why no
  test caught it": `test/members.test.js` pinned an old-palette literal and
  passed forever)
- **Check:** A spec that pins a literal hand-copied from the implementation
  proves nothing once the implementation moves. Test inputs that exist to
  round-trip the real system `require` the real source (`MEMBER_COLORS[0]`,
  not `'#7f77dd'`); loops over an imported list beat single-value probes.
- **Enforced by:** — (manual)

### M-008 — Text-matching assertions are proven capable of going red
- **Status:** adopted · 2026-07-29
- **Source:** `.claude/rules/css-text-assertions-strip-comments.md` ·
  `.claude/rules/admin-moderation-surface.md` §3 (the break-on-purpose
  discipline)
- **Check:** A test that matches source *text* (CSS strings, HTML, regexes
  over files) gives no signal that it is wired to anything real until the
  guarded code is broken on purpose and the test observed red. New tests of
  this shape document that verification; when performing it in an audit, back
  the files up to the scratchpad first — `git checkout` restores from the
  index and discards the whole uncommitted change. Confirm the break actually
  landed (`grep -c`) and the baseline test count before trusting a red or a
  green (`session-guests-are-not-members.md` — `node --test` on a wrong path
  reports success).
- **Enforced by:** — (manual, self-verifying discipline)

### M-009 — External-service fixtures reflect measured reality, dated
- **Status:** adopted · 2026-07-29
- **Source:** `.claude/rules/psstore-full-game-is-not-every-game.md` ·
  `.claude/rules/storefront-lookup-locale.md` (both bugs lived under green
  suites whose fixtures were written from the same assumption as the code)
- **Check:** Parser fixtures for live external services carry a capture date
  and provenance. Where a premise *about the service* is load-bearing
  (classification enums, localized separators, region-scoped ids), the fixture
  is a dated live capture, not a hand-written sample — a fixture that merely
  agrees with the code cannot falsify it.
- **Enforced by:** — (manual)

### M-010 — An assertion that can pass vacuously names its counter-check
- **Status:** adopted · 2026-07-29
- **Source:** `.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md`
  §3 (the hero assertion that stayed green with the hero deleted) ·
  `.claude/rules/bounding-bulk-registration-mail.md` (two limiters answering
  identical 429s) · `.claude/rules/storefront-lookup-locale.md` (one shared
  cache answering later specs)
- **Check:** When the asserted value also exists somewhere else in the
  response (head vs body), when two mechanisms produce identical output, or
  when a shared cache/fixture can answer for the code under test, the spec
  pairs the assertion with whatever makes it non-vacuous (scope the match,
  drive the sibling out of reach, use per-spec keys) — and says so.
- **Enforced by:** — (manual)

---

## Rejected — settled, do not re-litigate

### M-R01 — "Adopt a frontend framework, bundler, or TypeScript build"
- **Status:** rejected · 2026-07-29
- **Why:** Re-examined for the public multi-tenant end-state on 2026-07-19 and
  held (`CLAUDE.md`, `docs/production-readiness.md` §2.2): the app is a working
  client-side-routed SPA, a rewrite buys nothing it can't already do, and the
  load-order fragility is a contained maintainability tax, not a
  production-safety issue. The one sanctioned build is the optional
  cache-busting `scripts/build.js` (#141). A TypeScript migration is a build
  step and falls under this. Re-open only on evidence the fragility causes
  real production incidents — through the user, never as a maturity finding.

### M-R02 — "Adopt a full ORM"
- **Status:** rejected · 2026-07-29
- **Why:** Reopened deliberately and settled with **Knex** (#211): query
  builder + versioned migrations, with `knex.raw()` for RLS, the tenant
  `set_config` pattern, advisory locks and `FOR UPDATE` — the raw escape hatch
  is exactly why Knex won over Prisma. A full ORM does not retrofit cleanly to
  RLS + the tenant-transaction pattern (`.claude/rules/postgres-backend.md`).

### M-R03 — "Add a third round-data store"
- **Status:** rejected · 2026-07-29
- **Why:** `CLAUDE.md`: round data keeps exactly two backends behind the
  `lib/repo/` seam. The boundary matters — a Redis dependency for something
  that isn't round data (the #215 limiter store) does not violate it, and #215
  is tracked as a scaling prerequisite, not an audit finding.

### M-R04 — "Rewrite or optimize the JSON backend"
- **Status:** rejected · 2026-07-29
- **Why:** `lib/repo/json.js` deliberately favors simple, readable code over
  optimization for one small self-hosted dataset (`CLAUDE.md` conventions).
  Production runs the Postgres backend; the JSON backend's simplicity is what
  keeps the repo contract legible. Performance findings against it are
  out of scope by design.

### M-R05 — "Bundle a vendor error-tracking SDK / set ERROR_WEBHOOK_URL"
- **Status:** rejected · 2026-07-29
- **Why:** The logging half is shipped on pino (#212); the error-tracking
  *provider* decision is deliberately deferred, and `ERROR_WEBHOOK_URL` is
  deliberately unset in production (operator decision 2026-07-27,
  `.claude/rules/liveness-vs-readiness-probes.md` — the forwarded text can
  carry personal data, so any destination is a new processor needing an AVV).
  A future adoption is a legal + ops decision the user drives
  (`.claude/rules/keep-legal-docs-current.md`), never a maturity finding that
  "the gap is still open".

### M-R06 — "Adopt <enterprise pattern> because production SaaS" — meta-criterion
- **Status:** rejected · 2026-07-29
- **Why:** The scale anchor is one operator, two replicas, a ~€25–50/month cost
  envelope. Kubernetes, microservices, an IdP migration, event sourcing, CQRS,
  a service mesh — each becomes a criterion only when it solves a problem this
  app has *at its actual scale*, and the research phase must name that
  problem. The mirror of claude-file-audit's C-R02: a capability is not a
  requirement. §8 of `docs/production-readiness.md` already rejected the
  infrastructure tier of this list explicitly.

### M-R07 — "Optimize the dependency count in either direction"
- **Status:** rejected · 2026-07-29
- **Why:** Count is not the metric. The test is `CLAUDE.md`'s: hand-rolled,
  correctness-critical code with a mature, widely-used replacement should be
  replaced; a dependency must earn its supply-chain and maintenance surface.
  "Too many deps" and "not enough real libraries" are both taste claims until
  they name a concrete instance that fails one of those two tests.

### M-R08 — "Swap jsonwebtoken for jose"
- **Status:** rejected · 2026-07-29 (first research pass)
- **Why:** The usage here is narrow and hardened: HS256 only, the algorithm is
  pinned at verify time, and the token payloads are domain-separated
  (`.claude/rules/admin-moderation-surface.md` §1). jsonwebtoken's last release
  is 2023-08 but it is not deprecated and carries no unpatched advisory; `jose`
  is ESM-first, which frictions this CommonJS repo for zero behavioural gain.
  Re-open on a formal deprecation, an unpatched CVE, or a real need for an
  algorithm/feature jsonwebtoken lacks.
