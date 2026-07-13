# Security Policy

## Project stage

This is a small, self-hosted web app for a single trusted group. It currently
runs **local-only, with intentionally no authentication**, on a private home
network (see [`CLAUDE.md`](CLAUDE.md) and [`README.md`](README.md)). That is the
current MVP scope, not the end goal — hosting and accounts are planned, staged
roadmap work.

Please keep this context in mind when assessing severity. The app is not designed
to be exposed to the public internet in its current form, so "no login screen" or
"anyone on the network can edit data" are known, intentional properties of the
local-only stage — not vulnerabilities. Reports that assume a hardened,
internet-facing deployment may not apply yet.

Genuine security issues are still very welcome, for example:

- ways to read or write files outside the app's data directory (path traversal),
- server-side request forgery (SSRF) through the cover-image or lookup features,
- injection or remote code execution reachable from a request,
- leaking secrets (e.g. `ANTHROPIC_API_KEY`) or a user's private `data/` contents,
- dependency vulnerabilities with a realistic exploitation path here.

## Supported versions

There are no tagged releases. Only the current `main` branch is supported; fixes
land there.

## Reporting a vulnerability

**Please report privately — do not open a public issue for a security problem.**

Use GitHub's **private vulnerability reporting**: go to the repository's
**Security** tab and click **"Report a vulnerability"**
([Security Advisories](https://github.com/ChulioZ/game-sessions/security/advisories/new)).
This opens a private advisory visible only to you and the maintainers.

When reporting, please include:

- a description of the issue and its impact,
- steps to reproduce (a minimal proof of concept if possible),
- the affected file(s), route(s), or dependency, and
- any suggested fix or mitigation you have in mind.

This is a hobby project maintained in spare time, so responses are best-effort
rather than on a fixed SLA. We will acknowledge your report, work with you to
confirm and fix the issue, and credit you in the fix if you would like.
