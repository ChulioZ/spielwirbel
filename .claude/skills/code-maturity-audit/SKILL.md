---
name: code-maturity-audit
description: >-
  Audit the codebase's production maturity — repo-wide structure/refactoring
  smells, hand-rolled code that should become a mature dependency,
  single-process in-memory-state assumptions under the multi-replica
  deployment, and test-suite maturity (hand-copied constants, vacuous
  assertions, undated fixtures) — against a maintained criteria list, and
  periodically re-check the build-vs-buy calculus against the library
  ecosystem. Use when asked for a code maturity or refactoring audit, a
  code-quality review, to find hobby-project patterns unfit for a production
  multi-tenant SaaS, or hand-rolled code worth replacing with a vetted
  library. Repo-wide and read-only — unlike the diff-scoped /simplify;
  exploitable weaknesses belong to security-audit. Produces a ranked report;
  files issues only with your approval.
---

# Code-maturity audit

The app began as a local, no-auth hobby MVP and is now a live, public,
multi-tenant SaaS. `CLAUDE.md` reframed the priorities accordingly (*staying
minimal* → *production-ready*), and `docs/production-readiness.md` §7 ran this
exact lens once, on 2026-07-19 — it produced the Knex (#211), pino (#212), zod
(#213) and JWT (#214) adoptions and left two items open. Nothing re-runs that
lens as the codebase grows. This skill makes it recurring.

The realistic finding is therefore **code that has outgrown its original
context, or newly hand-rolled code that skipped the build-vs-buy question** —
not a wholesale redesign. The architecture calls were re-examined for the
public end-state and held; they live in `criteria.md` as rejected entries so no
run re-litigates them.

**Read `.claude/skills/audit/audit-loop.md` first** — it owns the loop
(research gating, the critique test, the report format, the rule that findings
only become issues with the user's approval). This file owns the domain.

Pass `--research` to force a research pass; otherwise the cadence in
`criteria.md` decides (90 days — the library ecosystem moves slowly relative to
this codebase, and most of the value is in the repo-facing audit, which runs
every time).

## Calibration — the two ways a "maturity" audit goes wrong

Both failure modes produce confident, useless findings; kill them in phase C.

- **Enterprise cargo-cult.** The scale anchor is real and small: one operator,
  two Railway replicas, a ~€25–50/month cost envelope, a curated backlog.
  Kubernetes, microservices, an IdP migration, event sourcing, a service mesh —
  a criterion must name the problem *this app at this scale* has, or it is
  rejected (M-R06 is the standing meta-rejection, the mirror of
  claude-file-audit's C-R02). "Production SaaS" is a correctness bar, not a
  licence to import big-company architecture.
- **Re-litigating settled calls.** No frontend framework, no build step beyond
  `scripts/build.js`, Knex-not-full-ORM, no third round-data store, the JSON
  backend's deliberate simplicity — each was decided with reasoning that still
  holds and each is a rejected entry in `criteria.md`. A finding that restates
  one is not a finding. Re-opening one requires new evidence that the original
  reasoning failed on its own terms (audit-loop §C.4), put to the user — never
  adopted silently.

Two more rules that shape every finding:

- **A dependency recommendation names the library, the migration cost, and the
  legal check.** "Use a library" is not a remedy. And if the candidate is a
  *service* (error tracking, monitoring, a CAPTCHA), it is a new processor —
  that is `keep-legal-docs-current.md` territory and a decision the user makes
  deliberately, never a side effect of a maturity finding (the #448 no-CAPTCHA
  decision is the precedent).
- **`docs/production-readiness.md` is a decision record.** Read §7 as this
  domain's prior ledger; never write live status into it — findings go in the
  report, adoptions/rejections go in `criteria.md`.

## Research sources (phase B)

The research question is narrow: **has the ecosystem changed the build-vs-buy
calculus since `last-researched`?** Three shapes of answer are worth adopting:

- A dependency this repo relies on became unmaintained, deprecated, or
  superseded (the survival question — *versions* are Dependabot's job via the
  `dependabot` skill, never this audit's).
- A Node built-in landed that obsoletes a dependency or a hand-rolled piece
  (the repo already rides `node --test`, `fetch`, `--env-file`; the platform
  keeps absorbing more).
- A library category this repo rejected or deferred has matured enough to
  re-ask the question — with evidence, through the user, per the calibration
  above.

Prefer primary sources: the package's own repository (commit/release activity,
deprecation notices), official Node.js release notes. Star counts and
"best-stack" listicles are the lowest-value input here.

## The audit (phase E)

The valuable half needs no research and runs every time. Four passes; each
criterion names its observable, so work criterion-by-criterion rather than
wandering the tree.

### 1. Structure & duplication → M-001..M-003

`wc -l` the source tree and check outliers against
`token-friendly-source-files.md`'s seam test (independent concerns, not raw
line count — `public/js/views-session.js` and `lib/legal.js` are documented
non-findings). Grep for "keep in sync" comments and un-licensed client/server
constant duplication (`shared-constants-across-the-stack.md` — the palette bug
is what this class costs). Check that new mutating routes go through the shared
zod boundary (`lib/validate.js`) rather than regressing to hand-rolled checks.

### 2. Build vs buy → M-004..M-005

Continue §7's ledger: any newly hand-rolled implementation of a commodity
concern gets the question, answered in writing. The two §7 items still open are
**already tracked** — the error-tracking half of #212 (constrained by the
operator's deliberate `ERROR_WEBHOOK_URL` decision, see
`.claude/rules/liveness-vs-readiness-probes.md` and `docs/deploy-railway.md`)
and the multi-process limiter store (#215) — so they are context, not fresh
findings; dedupe against them.

### 3. Multi-process state → M-006

Sweep module-level mutable state in `lib/` and `routes/` and classify each
instance: correct per-process by design, a documented accepted trade-off, or a
finding. Production runs **two replicas** (`guest-demo-accounts.md` §1 records
the class), so "works on my one process" is the sharpest hobby-vs-SaaS smell
this repo has. The done-right model is the demo machinery: liveness counts and
cooldowns are read from the store per request, so replicas agree by
construction.

### 4. Test-suite maturity → M-007..M-010

The traps the rules document case-by-case, checked systematically: test
constants hand-copied from the code under test, text-matching assertions never
proven capable of going red, external-service fixtures written from the same
assumption as the parser, and assertions that pass vacuously because the
asserted value also exists somewhere else. When performing a break-on-purpose
check yourself, back the files up to the scratchpad first — `git checkout`
restores from the index and discards the whole uncommitted change
(`css-text-assertions-strip-comments.md`).

## Remedies, in order of preference

1. **A test or an assertion** when the drift is mechanizable — this repo pins
   things with tests, and a check that runs in CI forever beats re-auditing the
   class (the `test/skills.test.js` model).
2. **A GitHub issue** for real implementation work — most build-vs-buy and
   multi-process findings land here, since a dependency swap is never a
   drive-by fix.
3. **A rule file** in `.claude/rules/` when the finding is a learning future
   sessions would rediscover.
4. **Nothing, deliberately** — record it as a rejected entry in `criteria.md`
   with its `Why:`, so it stops resurfacing.

**Value here is front-loaded.** The first run surfaces most of what exists;
after that the skill guards regressions and newly hand-rolled code — the same
profile as `claude-file-audit`. A quiet run against a codebase that keeps its
discipline is a success, not an empty result.

## Seams — who owns what

- **`security-audit`** — attribution by remedy: an *exploitable weakness* in
  hand-rolled auth/limiter/token code is security's, even when a library swap
  would also fix it; *fragile or unmaintainable but not exploitable* is
  maturity's. One finding, one owner.
- **`claude-file-audit`** — a stale *document about* code is claude-file's; the
  code itself is maturity's.
- **The built-in `/simplify`** — diff-scoped quality cleanup during
  implementation; this audit is the repo-wide, criteria-driven counterpart.
  Don't file findings `/simplify` would catch in the next touching PR anyway —
  unless the file is rarely touched, which is exactly when an audit earns its
  keep.
- **The `dependabot` skill** — owns dependency *versions*; this audit owns
  dependency *existence* (adopt, replace, retire).
