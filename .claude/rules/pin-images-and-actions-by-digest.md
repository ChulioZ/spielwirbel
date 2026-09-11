---
paths:
  - "Dockerfile"
  - ".github/workflows/**"
  - ".github/dependabot.yml"
  - "test/docker.test.js"
  - "test/ci-workflow.test.js"
---

# OUR images and actions pin exactly; Railway's Postgres floats — the difference is who re-pulls

Two tags in this repo look like the same decision and are opposite ones. Getting
them the same way round is how #977 happened.

| Tag | Policy | Why |
|---|---|---|
| `FROM node:…` in `Dockerfile` | **exact patch**, Dependabot bumps it — **majors included** (#994) | nobody re-pulls on our behalf |
| every `uses:` in `.github/workflows/` | **40-hex commit SHA** + `# vN.x.y` | a tag can be retargeted at new code |
| `postgres-ssl:18` (Railway) | **floating major**, on purpose | Railway re-pulls it in a 02:00–06:00 window |

`.claude/rules/railway-postgres-floating-major.md` argues — correctly — that
floating is *safer* there, because the platform applies the minor and restarts the
service. **That argument does not transfer**, and the reason is the whole rule:
floating is only safe when something is guaranteed to re-pull.

## What the floating base image actually cost

`node:22-slim` resolves at **build** time, and a build reuses a layer cache. So
Node 22.23.2 (2026-07-28, 11 CVEs — among them CVE-2026-58044, HTTP header
truncation, a request-smuggling primitive sitting in front of the per-IP rate
limiters) reached production only if Railway happened to miss the cache. Whether
the fix shipped was decided by a cache, and:

- **nothing failed.** No error, no red check, no test. A floating tag that never
  re-resolves and a floating tag that just re-resolved are byte-identical in the
  diff, which is to say invisible.
- **nothing could report it.** `process.version` was not surfaced anywhere, so the
  question "which Node is production on?" had no answer short of a Railway
  console. That is why the pin shipped **with** the admin Kennzahlen row: a pin
  describes what the *next* build will use, never what is running now.

## Why the actions are pinned harder than the image

A mutable major tag (`actions/checkout@v7`) is a *pointer the upstream owner can
move*, so it is not a staleness problem but an execution one — the 2025
`tj-actions/changed-files` incident is the precedent. Two of these workflows make
that concrete: `gitleaks` in `secret-scan.yml` is a **required branch-protection
context** (a retargeted tag could green-light a merge), and `docker.yml` logs into
GHCR with `GITHUB_TOKEN` and publishes the self-hoster image under this project's
name. Production itself is not exposed — Railway builds the Dockerfile from the
repo — which is exactly why this is easy to under-rate.

Pinning costs no freshness: Dependabot's `github-actions` ecosystem updates SHA
pins **and rewrites the trailing comment**, which is why the `# vN.x.y` trailer is
load-bearing rather than decorative. Drop it and the pin freezes forever.

## Two things the tests do NOT cover

`test/docker.test.js` and `test/ci-workflow.test.js` assert the *shape* — an exact
`major.minor.patch`, identical across both stages, not below `NODE_FLOOR`; a
40-hex ref plus a version comment in every workflow. **`NODE_FLOOR` rises with the
pinned major**, by design: it names the security release on the line currently
ridden (22.23.2 on v22, 26.5.1 on v26 — both 2026-07-28), so crossing a major
raises it in the same change, and a downgrade has to edit it. Neither test can
check:

- **that a SHA is the one the version comment claims.** Resolve it yourself, from
  the exact tag rather than the major one, before writing it:
  `gh api repos/<owner>/<repo>/git/ref/tags/v7.0.1` (an annotated tag needs one
  more hop through `.object.url` to reach the commit).
- **that the pinned Node is still current.** That is Dependabot's job. The
  *removal* case this bullet used to warn about — the `docker` ecosystem deleted
  from `dependabot.yml`, leaving the pin frozen instead of floating, the worse of
  the two policies — **is now asserted** (#994, below). What no test can see is
  Dependabot working and simply having nothing to say.

## The patch channel freezes behind a held major — so majors are NOT ignored (#994)

The `docker` ecosystem opens **one PR per dependency**. While a major sits open, a
patch or minor security release therefore produces **no PR at all**: the channel
added to prevent a silent freeze is itself frozen, in the state that looks
healthiest — an open, green Dependabot PR. Nothing in the repo could observe it;
the rule above anticipated only the *removal* freeze mode.

The tempting fix is an `ignore` rule for `version-update:semver-major`, mirroring
the deliberate-majors reasoning in `railway-postgres-floating-major.md`. **That is
not the policy here** (operator decision, 2026-09-11): majors arrive as ordinary
PRs and get handled like any other. The Postgres argument does not transfer for
exactly the reason the float does not — nobody re-pulls this tag for us, so an
ignored major is a major that never arrives at all.

What makes the freeze real rather than theoretical is that **the hold does not
stick**, measured on #988/#999:

- **A `blocked` label does not survive the PR being superseded.** #988 (22.23.2 →
  26.8.1) was held and labelled `blocked` by the `dependabot` skill; Dependabot
  then closed it and opened **#999** (→ 26.8) carrying no label at all. So the
  hold mechanism silently resets itself, and the label that is supposed to mean
  "we decided about this" is gone while the decision still has not been made.
- **A major can arrive RED and unmergeable.** #999 proposed `node:26.8-slim` —
  major.**minor**, not an exact patch — which the first test in this file rejects
  on every matrix job. Dependabot does not reliably preserve the pin granularity
  this whole design rests on, so a major can sit in front of the patch channel
  *forever* without ever being mergeable. **When a docker PR arrives without a
  patch component, hand-correct the tag** rather than merging or holding it.

**CI's own Node versions ride the pin.** `ci.yml`'s `coverage` and `postgres` jobs
track the Dockerfile's major, and the `test` matrix must include it — asserted in
`test/docker.test.js`. `postgres` is the sharp one: it is the only job exercising
the data-access contract against a real database, so while it sat on 24.x under a
26 production pin, the pg/Knex stack was unproven on the runtime that actually
ships. `lint.yml` deliberately stays on the `engines` floor (22.x) and is not
scanned — `node --check` there answers the opposite question, whether the source
still parses on the OLDEST supported Node.

One consequence to expect rather than debug: **a Dependabot major bump now goes
red until `ci.yml` moves with it.** That is the intended prompt, not a defect —
under the accept-majors policy a major is reviewed by hand anyway (and, per #999,
usually needs its tag granularity corrected first).

`test/docker.test.js` asserts both halves: the `docker` ecosystem exists, and its
block contains no `semver-major` anywhere. The ban is deliberately blunt rather
than matching an `ignore:` shape — the same rule can be written as an inline array
or a nested list, and a shape a source scan does not enumerate is a shape it
cannot see (`.claude/rules/source-scanning-guards-enumerate-shapes.md`). It strips
comments first, because the place a rule is written down is where its banned
phrase legitimately appears.

A red `gitleaks` right after re-pinning is most likely the license-probe flake,
not the pin: `.claude/rules/gitleaks-license-flake.md`.

**Related:** `.claude/rules/railway-postgres-floating-major.md` (the deliberate
float this must not be read as contradicting),
`.claude/rules/ci-aggregate-gate.md` (why `gitleaks` being a required context
raises the stakes on that one tag),
`.claude/rules/source-scanning-guards-enumerate-shapes.md` (the workflow scan is
one of these — it must see `- uses:` *and* a keyed `uses:`, proved by breaking
each shape separately).
