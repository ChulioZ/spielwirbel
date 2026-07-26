# A change with NO DIFF still stales the docs — and nothing will remind you

Every doc-currency rule in this repo is **diff-triggered**:
`.claude/rules/keep-readme-current.md` fires "in the `implement` skill's review
phase, before committing"; `.claude/rules/keep-legal-docs-current.md` fires
"when implementing a change … before committing". Both assume a branch, a diff
and a review.

So a change made **in a dashboard instead of a diff** slips past all of them. It
is not a rare shape here — the go-live (#219), the domain moves (#230), three
mail-provider migrations (#440), the Postgres region fix and the BGG token were
all wholly or partly ops actions.

## What it cost, once

Go-live #219 was one action: deleting `AUTH_PASSWORD` from the Railway
environment on 2026-07-24. No branch, no PR, nothing to review — and it changed
the single most load-bearing fact about the instance, from "sealed behind a
shared password, registration closed" to "open to the public".

**Seven files were still asserting the old fact two days later**, found by the
`claude-file-audit` run on 2026-07-26. The worst two were not the obvious ones:

- **`SECURITY.md`** told external security researchers "Public self-registration
  is not open yet … real (if not-yet-public) user data" — i.e. the file whose
  entire job is calibrating severity was understating the blast radius of the
  three vulnerability classes it itself lists as most relevant.
- **`.claude/skills/audit/audit-loop.md`** carries the repo description that
  every domain audit tests a candidate finding against in phase C ("does it bind
  *this* app?"). A wrong premise there silently mis-scopes accessibility, legal,
  security **and** Claude-file findings — a stale fact that corrupts the tool you
  would use to find stale facts.

Neither is reachable from any diff, because there was no diff.

## The rule

**After an ops-only change — anything that alters what the live instance *is*
without producing a commit — walk this list in a follow-up PR.** These are the
files that assert live instance state, and they are the whole list as of
2026-07-26:

| File | What it asserts |
|---|---|
| `CLAUDE.md` — "Current stage" | auth mode, whether registration is public, what a change reaches |
| `README.md` — the `AUTH_PASSWORD` paragraph + the accounts-mode paragraph | what "the maintainer's hosted instance" runs |
| `SECURITY.md` — "Project stage" | the threat model an external reporter calibrates against |
| `.claude/rules/accounts-mode-gate.md` | which of the four modes is "today's prod" |
| `.claude/rules/user-accounts.md` | whether accounts are live or staged |
| `.claude/skills/audit/audit-loop.md` §C | the repo description all four audits test findings against |
| `docs/production-readiness.md` | go-live status and the blocker list |

Qualifying changes: adding/removing/retuning an **env var in production**,
switching a **provider or host**, moving a **region**, acquiring or dropping a
**domain**, opening or closing **registration**, changing a **plan** that gates a
capability (Railway Pro for SMTP).

Two things make this cheap: the list above is the sweep (not a memory exercise),
and the follow-up PR is docs-only, so it needs no coordination with the ops
action — do the ops action, then open the PR.

## Why a test cannot replace this

The facts are about a **remote instance**, so nothing in CI can observe them: a
test cannot know whether `AUTH_PASSWORD` is set on Railway today. That is exactly
why it needs a written rule and a fixed file list. Where a doc claim *is*
mechanically checkable against the repo, prefer a test instead — the README file
tree is checked by `test/readme-tree.test.js`, and the cited paths by
`test/skills.test.js`.

**Related:** `.claude/rules/keep-readme-current.md` and
`.claude/rules/keep-legal-docs-current.md` (the diff-triggered rules this covers
the gap in — a legal-document change driven by an ops action, e.g. a new
processor, is subject to *both*), `.claude/rules/accounts-mode-gate.md` (the four
modes), `docs/deploy-railway.md` ("Going live", the procedure itself).
