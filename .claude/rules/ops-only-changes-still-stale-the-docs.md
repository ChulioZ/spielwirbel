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
files that assert live instance state, and this table is the **canonical** list
as of 2026-07-30 — `claude-file-audit`'s `SKILL.md` §5 and its criteria C-016
point here rather than restating it, because the copy that gets forgotten is the
one that rots (`.claude/rules/shared-constants-across-the-stack.md`, applied to a
checklist instead of a constant):

| File | What it asserts |
|---|---|
| `CLAUDE.md` — "Current stage" | auth mode, whether registration is public, what a change reaches |
| `README.md` — the status callout | whether registration is open, and what self-hosting defaults to |
| `docs/configuration.md` — the `AUTH_PASSWORD`, accounts-mode and layered-mode paragraphs | what "the maintainer's hosted instance" runs (these moved out of `README.md` on 2026-07-30) |
| `SECURITY.md` — "Project stage" | the threat model an external reporter calibrates against |
| `.claude/rules/accounts-mode-gate.md` | which of the four modes is "today's prod" |
| `.claude/rules/user-accounts.md` | whether accounts are live or staged |
| `.claude/skills/audit/audit-loop.md` §C | the repo description every domain audit tests findings against |
| `docs/production-readiness.md` | go-live status and the blocker list |
| `lib/legal.js` — the published privacy policy (both languages) | any aside about what *this instance* runs (auth mode, cookies in use, providers); a change here also bumps `REVISION` (`keep-legal-docs-current.md`) — missed after #219, found 2026-07-29: §14 still said "solange die Registrierung noch nicht geöffnet ist" five days past a REVISION bump |
| `.github/FUNDING.yml` | the donation handle — must equal the live `DONATE_URL` (`GET /api/config`) |
| `.github/ISSUE_TEMPLATE/config.yml` | that private vulnerability reporting is on and the Discussions Q&A category exists at that slug — **repo settings, not files** |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | that spielwirbel.app runs accounts-only, in the auth-mode dropdown's help text |
| `lib/quota.js` — the header comment | which mode is "today's production"; it described prod as sitting "behind the shared-password gate" for six days past the go-live (found 2026-07-30). A *code comment* asserting instance state is the easiest row to forget, because no docs sweep looks in `lib/` |

Qualifying changes: adding/removing/retuning an **env var in production**,
switching a **provider or host**, moving a **region**, acquiring or dropping a
**domain**, opening or closing **registration**, changing a **plan** that gates a
capability (Railway Pro for SMTP), and — for the three `.github/` rows —
**flipping a repo setting** (disabling Discussions or renaming a category,
turning private vulnerability reporting off).

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
