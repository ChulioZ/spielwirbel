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
| `FROM node:…` in `Dockerfile` | **exact patch**, Dependabot bumps it | nobody re-pulls on our behalf |
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
`major.minor.patch`, identical across both stages, not below the 22.23.2 floor;
a 40-hex ref plus a version comment in every workflow. Neither can check:

- **that a SHA is the one the version comment claims.** Resolve it yourself, from
  the exact tag rather than the major one, before writing it:
  `gh api repos/<owner>/<repo>/git/ref/tags/v7.0.1` (an annotated tag needs one
  more hop through `.object.url` to reach the commit).
- **that the pinned Node is still current.** That is Dependabot's job; if its
  `docker` ecosystem is ever removed from `dependabot.yml`, the pin silently
  becomes the *worse* of the two policies — frozen instead of floating.

A red `gitleaks` right after re-pinning is most likely the license-probe flake,
not the pin: `.claude/rules/gitleaks-license-flake.md`.

**Related:** `.claude/rules/railway-postgres-floating-major.md` (the deliberate
float this must not be read as contradicting),
`.claude/rules/ci-aggregate-gate.md` (why `gitleaks` being a required context
raises the stakes on that one tag),
`.claude/rules/source-scanning-guards-enumerate-shapes.md` (the workflow scan is
one of these — it must see `- uses:` *and* a keyed `uses:`, proved by breaking
each shape separately).
