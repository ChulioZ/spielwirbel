---
name: implement
description: >-
  End-to-end workflow for implementing a change: branch from up-to-date main,
  write the prod code + tests, review locally, commit/push, open a PR, review it,
  merge with the user's go-ahead if safe, watch main's CI + the Railway
  production deploy, and clean up the branch. Use whenever you're
  told to implement, build, add, fix, or otherwise ship something — a GitHub
  issue on this repo, a directly requested change, or similar. Not for reviewing
  someone else's PR (use `review-pr`) or triaging Dependabot (use `dependabot`).
---

# Implement a change end-to-end

Goal: take an implementation request (a GitHub issue, a described change, a bug
fix, …) all the way from a fresh branch to a merged PR with green CI on `main`,
without leaving stale local state behind. Work the phases in order; each one
gates the next.

**This ships code and touches the remote.** Pushing, opening a PR, and merging
are outward-facing and hard to reverse — do them deliberately, never merge a PR
your own review says isn't safe, and never merge without the user's explicit
go-ahead (phase 6). If a phase's exit condition isn't met, stop and report rather
than pushing ahead.

First, be sure you understand the task. If it's a GitHub issue, read it:
`gh issue view <N>` (this shows its assignees). If the request is ambiguous in a
way that changes what you'd build, ask before writing code — not after.

**Don't take over someone else's issue.** If the issue is assigned to a GitHub
user *other than* the requesting user (`gh api user --jq .login`), stop and
confirm with the user before doing anything — an assignee means someone has
claimed it, and building it would collide with their work. Two cases are fine to
proceed on without asking: an **unassigned** issue, and one **already assigned to
the requesting user**.

A foreign assignment is **reclaimable** once it has gone idle for long enough —
and "long enough" scales with what waiting costs, rather than being one fixed
timer:

| What the issue is | Reclaimable after |
|---|---|
| A **live security exposure** or **broken core functionality** (a main flow wrong or unusable) | **immediately** — no idle requirement |
| The **clear top priority** — `pick-issue` handed it over as its decisive top pick, or the user has said this is the thing that most needs doing | **3 days** idle |
| Anything else | **5 days** idle |

Being pointed at an issue is *not* by itself the middle tier — a casual "do #42"
is a choice of task, not a statement that it outranks the whole backlog, and
reading it as one would collapse the bottom tier into the middle one. When it's
genuinely unclear which tier applies, ask as part of the confirmation you already
owe the user below, rather than assuming the shorter wait.

Two things sit outside the ladder. An issue with a **linked open PR** is never
reclaimable at any age — the work exists as a diff, so review that PR
(`review-pr`) instead of rebuilding it. And measure the idle time from the
**assignee's own** last activity, not from `updatedAt`, which a label edit or a
passer-by's comment resets while the assignee has done nothing:

```bash
gh api "repos/{owner}/{repo}/issues/<N>/timeline" --jq '.[-10:] | .[] | {event, actor: .actor.login, at: .created_at}'
```

Clearing the bar makes a reclaim *permissible*, never automatic. Taking over
someone's issue is outward-facing, so **surface it and get the user's explicit
go-ahead** — they may prefer to ping or unassign the current assignee first. State
the assignee, how long they've been idle, and which tier cleared it, and be
especially plain in the immediate tier: an override-grade reclaim can land on an
issue someone touched an hour ago and duplicate live work, which is a trade the
user makes, not one you make for them.

`pick-issue` applies the same ladder when it picks (deriving the middle tier from
its own ranking), and hands a reclaim over labelled as one — but its hand-off is
*not* a substitute for this confirmation, and `implement` can also be invoked
directly on an issue number, so the check runs here either way.

## Scope the whole issue — interview for decisions, don't defer them

Aim to carry the issue **all the way to done**, not just to the edge of what you
can do without asking. When a part feels out of reach, separate two cases:

- **A decision or input you need *from* the user** — which of several viable
  approaches, which provider / host / library, a name or value to use, a policy
  call. This is **not** a blocker and **not** a reason to ship a partial result.
  Driving these *with* the user is a core purpose of this skill (and of
  `pick-issue`): the user wants to make them **by interacting with you here**, so
  **embrace them — interview for them** (`AskUserQuestion`; recommend an option
  when you have a view) **and carry the dependent work to the finish line.** Ask
  up front, and again whenever a new decision surfaces mid-build (one that only
  gates a later part can wait until you reach it). Then implement the answer and
  keep going — don't treat "needs a decision" as the edge of the deliverable.
- **A genuine hard limit** — a step *only the user can physically perform*, which
  no interview can hand to you: creating an account, entering a password or
  pasting a secret / credential, provisioning external infrastructure, paying, or
  a real-world action. Even here, still interview for every surrounding decision
  and do + wire up **everything** that doesn't need the user's own hands (config,
  scaffolding, workflows, docs), then hand them a **precise, minimal checklist**
  of the exact actions only they can take ("create the X account, then set secret
  `Y` in repo settings — I've wired the rest"). This is the *only* legitimate
  reason to stop short of a full close.

So narrowing an issue to a partial PR is a **last resort you surface and confirm**
with the user — never a default you pick on your own to avoid asking. When you
genuinely must split (a real hard limit, or the user's own choice), keep the
issue open and say exactly which part landed, which remains, and why.

## Keep the session cheap — it is the whole context, re-read every call

Every tool call is one round trip that re-reads the entire conversation, and its
output then joins that context for all remaining calls. Measured over three real
sessions of this workflow: 224–799 calls each, with the context running 220–390k
tokens. So an avoidable call is not a rounding error, and a large output is a tax
charged again on every call after it.

None of this trades away rigour — it changes *how* you look, never *whether*:

- **Batch independent probes into one call.** Several `git`/`gh`/`grep` reads that
  don't depend on each other go in one Bash invocation separated by
  `echo "=== label ==="`, not one call apiece.
- **Ask for the summary first, the detail only where it matters.** `git diff --stat`
  before any full diff, then read the files that actually changed materially.
  `gh issue list` without `body`; read the one issue you are building.
- **Cap noisy output, but keep the exit status.** `npm test 2>&1 | tail -30` is
  enough when green — and `set -o pipefail` first, or the pipe reports `tail`'s
  status and **a red suite reads as green**. On a real failure, go get the full
  output; that is the case the cap exists to make affordable.
- **Prefer text probes to screenshots.** `read_page`, `get_page_text` and
  `javascript_tool` answer layout and state questions precisely and cheaply; a
  screenshot costs ~1.5k tokens and, per
  `.claude/rules/preview-pane-paint-artifacts.md`, is the *less* reliable
  instrument in this pane. Screenshot once, at the end, as evidence for the user
  — not as a per-step check.
- **Don't re-read what you already have.** A file you just wrote, or output you
  already have in context, does not need fetching again to confirm it took.

## 1. Branch from up-to-date main

Never commit on `main`. Start from a current base:

```bash
git switch main
git pull --ff-only
git switch -c <type>/<short-slug>    # e.g. feat/session-export, fix/vote-tie
```

- Ensure the working tree is clean first (`git status`); stash or resolve
  anything unexpected before branching.
- Pick a descriptive branch name. If implementing an issue, include its number
  (`feat/42-session-export`) so the PR links back.
- **Claim the issue.** For a real GitHub issue — and only after the assignee
  guard above passed — assign it to the requesting user so it reads as taken to
  anyone else looking at the backlog while you work:

  ```bash
  gh issue edit <N> --add-assignee @me
  ```

  Assigning yourself an issue already assigned to you is a harmless no-op. If the
  assignment fails (e.g. the account lacks the permission), note it and carry on —
  it shouldn't block the build. Skip this for a non-issue change (a directly
  described fix with no issue number). If this is a **reclaim** (foreign assignee,
  confirmed above), only *add* yourself here — whether to also `--remove-assignee`
  the previous assignee is the user's call from that confirmation, not something to
  do automatically. That matters most in the immediate tier, where the other
  assignee may still be active: leaving them assigned is what lets them notice the
  collision.

## 2. Implement — prod code plus tests

Build the actual feature/fix in the production code, following this repo's
architecture and `CLAUDE.md` (no frontend framework/build step beyond the
sanctioned optional cache-busting build, no third persistence backend beyond
the JSON/Postgres pair, tenant-scoped data access via `req.repo`; the JSON
backend's `store` mutated in place, never reassigned; routers in
`lib/routes/*.js`; frontend shared-global-scope scripts in load order). Re-read
the relevant `.claude/rules/` before touching an area they cover.

Add automated tests wherever applicable — this is not optional when the change is
testable:

- New/changed backend behavior → add or extend a `test/*.test.js` spec. Use
  `test/helpers.js` so the store gets an isolated temp `DATA_DIR` (see the
  `automated-tests` rule and the `test-data` skill). Never touch the real
  `data/`.
- User-facing text → add the key to **every** `public/js/lang/*.js` — the
  shipped set is `public/js/locales.js` (i18n parity is tested).
- New top-level name in `public/js/**` → update the `globals` list in
  `eslint.config.js`, and watch the load-order trap.

Keep the change focused on the request; don't fold in unrelated edits.

### A small adjacent defect you find mid-build: FIX IT HERE, don't defer it

"Focused" is about not rewriting the neighbourhood — it is **not** a reason to
route a two-line fix into a separate task. When you notice a real, unrelated
defect while working (a dead control, a stale comment, a missing guard), the
default is to **fix it in this PR** and say so at the end (phase 6a already asks
for "what you found mid-build that the issue did not mention"; the phase-9 report
repeats it).

Deferring is the expensive option here, and the cost is not obvious: spawning a
background task or a chip means a **fresh session, a fresh worktree and a fresh
read of the whole context** to land a change you already have in your head, with
the file open. For anything small that is pure waste, and the operator has said
so explicitly (2026-08-13).

**Fold it in when all of these hold** — a handful of lines, you understand the
cause, it is independently testable, and it touches nothing the issue's own
change depends on. Give it its own commit and its own spec, taken red first, so
it stays reviewable and revertable on its own.

**Still defer — and then a separate issue, not a chip** — when it is genuinely
big or risky: a schema or data-format change, anything touching auth, tenant
isolation or money, a refactor spanning several files, a design decision the user
should make, or anything you would have to guess at. The test is *size and
confidence*, not whether it was in the issue.

Two things not to do either way: don't quietly widen the diff without reporting
it, and don't let the adjacent fix grow until it is the larger half of the PR —
at that point it wanted its own issue after all.

Before moving on, check whether the change makes `README.md` stale (new or
renamed user-facing features, changed file tree, routes, npm scripts, env
vars) and update it in the same branch if so — see
`.claude/rules/keep-readme-current.md`.

Same moment, same file, one more question: **does this change warrant a „Was ist
neu" entry** in `public/js/news.js` (#741)? The bar is deliberately high and
**the default answer is no** — only a genuinely new user-facing *capability*
qualifies, never a fix, a tweak, a refactor or a dependency bump. Every entry
lights a dot that competes with the legally load-bearing terms notice, so the
list is a budget rather than a changelog. The rule above states the bar; ask the
question consciously rather than skipping it, in either direction.

## 3. Review the local changes thoroughly

Convince yourself it actually works before anything leaves the machine. Read your
own diff end to end:

```bash
git diff --stat          # then read the files that changed materially, in full
set -o pipefail          # without it, a piped red suite exits 0 and reads as green
npm test 2>&1 | tail -30 && npm run lint && npm run check:syntax && npm run coverage:ci
```

Chained in one call because they are independent of each other and you need all
four green; on a failure, re-run that one command alone for its full output.

- All four must pass. Read the diff critically for correctness, edge cases, and
  the repo constraints above — not just "tests are green."
- **`coverage:ci` is not optional, and it is the one that surprises you.** Branch
  protection requires the aggregate `ci-passed` check, which fails on a coverage
  drop with **every test green** — and the usual cause is not a missing test but a
  newly `require`d view file dragging the global figure under the 90% floor
  (`.claude/rules/frontend-helper-modules-and-coverage.md`, where one export cost
  11 percentage points). Nothing in `npm test`'s output hints at it, which is why
  it belongs here rather than being discovered on the PR.
- **If the diff moved or renamed a function, `const` or file — or changed a value
  another file's prose cites — grep source and docs for the old name and fix every
  pointer in the same PR** (the command is in
  `.claude/rules/token-friendly-source-files.md`; `.claude/rules/` alone is too
  narrow, and the citation it misses is a **code comment** stating another file's
  value as a premise). `test/skills.test.js` catches a
  moved *file*; a moved **function** is invisible to it, and the rule left pointing
  at the wrong place still reads authoritative. The reason this belongs here rather
  than only in the rule: the rule a move invalidates is almost always on a
  *different topic* than the PR doing the moving, so it never occurs to anyone to
  look — which is exactly how `active-games-filter-sites.md` came to name the wrong
  file for the one pointer a future session most needed.
- **If the diff pushed a file past its budget, `test/token-budget.test.js` fails** —
  700 lines for source, 150 for a rule, 250 for a `SKILL.md`. That is not an
  instruction to trim: apply the seam test (several *independently editable*
  concerns, not raw length), split along a real boundary if there is one, and
  otherwise add the allowlist entry with a written reason. A `public/js` split is
  not free — it needs the four wiring points in
  `.claude/rules/frontend-helper-modules-and-coverage.md`.
- For **substantial** UI changes (new views/layouts, non-trivial interaction or
  state, anything easy to get visibly wrong), verify in a real browser via the
  preview workflow (the `run` skill / preview tools), not tests alone. Drive that
  check with `read_page` / `javascript_tool` probes and take **one** screenshot at
  the end as evidence — per-step screenshots are both the expensive instrument and
  the unreliable one (`.claude/rules/preview-pane-paint-artifacts.md`). For
  small, straightforward, low-risk UI tweaks (copy, a class, an icon, a spacing
  value), it's enough to confirm the diff looks correct — a human does the visual
  review. Use judgement; when unsure, verify.
- Consider running `/code-review` on the working diff for a second pass.
- Only proceed once you genuinely expect it to behave as intended. If review
  turns up problems, fix them and re-run this phase.

## 4. Commit, push, open the PR

```bash
git add -A
git commit -s   # clear message: what changed and why; -s adds the DCO Signed-off-by trailer
git push -u origin HEAD
gh pr create --fill   # or --title/--body; reference the issue ("Closes #42")
```

- Write a real commit message (subject + body if the change warrants it). Commit
  with `git commit -s` so it carries the DCO `Signed-off-by` trailer that
  `CONTRIBUTING.md` requires and that the `DCO` CI check + your phase-5 review
  verify (it uses git's configured `user.name`/`user.email`; a username is fine,
  but the email must be reachable and match the commit author). End the message
  with the `Co-Authored-By: Claude … <noreply@anthropic.com>` trailer for the
  model in use (the harness states the exact line — don't hard-code a model name
  from this file).

- The PR body should explain what and why, note that tests were added/updated,
  and link the issue. End the body with:

  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

## 5. Review the PR

Run the **`review-pr`** skill on the PR you just opened. It checks mergeable
state, CI status, reads the diff, and enforces this repo's constraints, then
returns a verdict: `SAFE TO MERGE` or `NOT SAFE` with concrete blockers.

Review your own PR honestly — the fact that you wrote it is not evidence it's
correct. Wait for CI (`gh pr checks <PR> --watch`) so the verdict reflects real
check results, not pending ones.

## 6. Walk the user through the change, THEN ask to merge

Merging is **never automatic**. Three gates must clear, **in this order**: your
review must pass, the user must have been given a **walkthrough**, and the user
must give an explicit go-ahead.

- If the verdict is **NOT SAFE**: do **not** merge. Address each blocker (go back
  to phase 2/3, push fixes, re-review) or, if it's out of your hands, report what
  needs to happen and stop.
- If **SAFE TO MERGE** and required checks are green, do **6a then 6b below, in
  one message, in that order**. Don't merge on your own initiative; the repo's
  branch-protection settings would block an un-approved merge anyway, so asking
  is both the rule here and the only path that actually goes through.

### 6a. Write the walkthrough — never wait to be asked for it

The user is being asked to approve something they have not read. A bare "CI is
green, may I merge?" asks them to rubber-stamp it, and the review verdict does
not substitute: it says *nothing blocks this*, not *here is what it does*. So
produce the walkthrough every time — not on request, not only for large diffs.
It costs one message and it is the only point where a decision is actually
possible.

> **Gate — check this before you call `AskUserQuestion`.** Look at the message
> you are about to send. If it contains only a verdict, a check count and a
> question, you have skipped 6a: stop and write the walkthrough first.
>
> This explicit check exists because 6a is **the one step in this skill with no
> artifact behind it** — no file appears, no test goes red, and the merge
> question reads as complete without it, so skipping it is invisible. It was
> skipped on #558 / PR #593 exactly that way: the instruction was present and
> emphatic, but it sat in prose between two bullets that chained "ask" directly
> to "merge", and the phase heading named only those two actions. Reformatting
> alone would not have caught it — a check you have to perform does.

Write it for someone deciding whether to merge, not as a diff restatement (they
can read the diff; they cannot read your reasoning). Cover:

- **The problem** — what was broken or missing, concretely. For a legal or
  policy-facing change, quote the promise that was unkept.
- **What changed, grouped by concern**, not file by file. A reader should be able
  to follow it without opening the diff.
- **The non-obvious decisions and why**: traps avoided, alternatives rejected and
  what ruled them out, anything where the natural implementation is wrong. This is
  the part that has no other home — it is invisible in the diff.
- **What you found mid-build that the issue did not mention** — a bug in adjacent
  code, a gap the spec missed, a wrong assumption you had to correct. Say so
  plainly; discovering it is not a reason to hide it.
- **Honest limits**: what is *not* covered, which assertions are vacuous today and
  why, anything verified by eye rather than by test. If a test cannot see
  something, say which one and what it would take.
- **How it was verified** — break-on-purpose results, browser checks, and what
  each actually proved.

**Surface the weaknesses rather than selling the change.** A walkthrough that
reads as advocacy is worse than none: it spends the user's trust to skip their
judgement. If part of the work is thin, or you followed the issue's spec without
questioning a choice you now doubt, that belongs here — the user may well have
context you don't, and this is the last cheap moment to use it.

### 6b. Ask for the go-ahead, in the same message

Call `AskUserQuestion` naming the PR, the review verdict, and that CI is green,
and wait for a clear yes.

Keep the same discipline when the answer is not a plain yes: if they push back or
ask for a change, **do not merge on the strength of the earlier approval** —
re-verify, re-state what moved, and ask again. An answer that grants permission
*conditionally* ("after you fix X") is not a yes to merging now.

### 6c. Merge

Once the user says yes, do a **normal** squash merge — no admin override, no
`--admin`, no bypassing branch protection:

```bash
gh pr merge <PR> --squash --delete-branch
```

`--delete-branch` removes the remote branch. Squash keeps `main` history to one
commit per change. If a plain merge is still refused, report what protection
requires (a missing approval, a red or pending check) and stop — never force it
through with `--admin`.

## 7. Monitor main's CI and the Railway deployment

The merge triggers the **CI** and **Lint** workflows on `main`. Confirm they go
green — a merge that red-lights `main` is not "done":

```bash
gh run list --branch main --limit 3
gh run watch <run-id>          # or: gh run view <run-id> --log-failed
```

Every push to `main` also triggers the **Railway production deployment**
(issue #131). Railway reports it as a **commit status** on the merge commit —
not a workflow run, so `gh run list` never shows it. Check the combined status
and wait until it leaves `pending`:

```bash
git fetch origin
gh api repos/{owner}/{repo}/commits/$(git rev-parse origin/main)/status \
  --jq '{state: .state, statuses: [.statuses[] | {context, state, description}]}'
```

The Railway context is `spielwirbel - spielwirbel` (both the Railway *project*
and *service* were renamed from `game-sessions` in #230 — verified against the
live deploy status); a build + deploy
typically takes a few minutes, so poll until the state leaves `pending`. If it ends
`failure`/`error`, GitHub only shows "Deployment failed" — the real reason is in
the Railway **Build/Deploy Logs** (the status's `target_url`); see
`.claude/rules/railway-no-dockerfile-volume.md` for a known build-parse trap.
A merge whose deploy fails leaves production on the old build — treat it like a
red `main` workflow: investigate, fix forward on a new branch through this same
workflow, and report it either way.

**A `success` there is NOT evidence the deploy took effect — finish on the
artifact.** On 2026-08-06 that status went green while the deployment record for
the same SHA ended `inactive` and production served the previous build for 14
hours; the session that had followed this phase reported a shipped feature that
was not shipped. The shell's `CACHE` name is content-derived, so what is actually
deployed is directly observable:

```bash
curl -s "https://spielwirbel.app/sw.js?cb=$(date +%s)" | grep -m1 '^const CACHE'
```

Compare it against a local build of the merge commit — equal means deployed,
different means it never landed. Where the digest can't answer (a change that
moved no `js/**` or `styles.css`), read the **deployment record** instead, which
is the signal that disagreed. Both commands, both caveats and the newest-record
trap are in `.claude/rules/verify-the-deployed-artifact-not-the-status.md`. **Do
not close this phase on the commit status alone**, and be especially suspicious
of every green aggregate signal during a GitHub incident — the same one took out
`ci-passed` on the same merge (#675).

If a workflow fails on `main`, treat it as urgent: investigate the failure and
open a follow-up fix (a new branch through this same workflow). Report it either
way.

## 8. Clean up local state

Back on your machine, return to an up-to-date `main` and drop the merged branch:

```bash
git switch main
git pull --ff-only               # brings in the squash-merge commit
git branch -d <type>/<short-slug>  # delete the now-merged local branch
git remote prune origin          # optional: clear the deleted remote ref
```

Use `git branch -d` (safe: refuses if not merged) rather than `-D`. If `-d`
complains the branch isn't merged, that's a signal something didn't land — stop
and check, don't force-delete.

## Report

Summarize what shipped: the branch, the PR (link + merge state), test coverage
added, the review verdict, main's CI status, the Railway deployment — the
artifact check from phase 7, not just the commit status — and confirmation the
local branch is cleaned up. This is the *outcome* report — it
does not repeat the phase-6 walkthrough, which the user has already read; note
only what changed since then (a fix pushed after review, a surprise in the
deploy). If you stopped early at any gate, say exactly where and why. If the
issue closed only partially (a genuine hard limit or a split the user agreed to),
say which part shipped and which remains, and give the exact remaining actions
only the user can take.

**Name anything you shipped ON TOP of the issue** — the adjacent fixes phase 2
tells you to fold in — as its own short line: what was broken, and that it was
not part of the issue. Folding a fix in is only cheaper than deferring it if the
user still learns it happened; an unreported extra change is a diff they did not
ask for and cannot review.
