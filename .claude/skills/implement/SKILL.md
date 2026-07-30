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
`routes/*.js`; frontend shared-global-scope scripts in load order). Re-read
the relevant `.claude/rules/` before touching an area they cover.

Add automated tests wherever applicable — this is not optional when the change is
testable:

- New/changed backend behavior → add or extend a `test/*.test.js` spec. Use
  `test/helpers.js` so the store gets an isolated temp `DATA_DIR` (see the
  `automated-tests` rule and the `test-data` skill). Never touch the real
  `data/`.
- User-facing text → add the key to **both** `public/js/lang/en.js` and
  `de.js` (i18n parity is tested).
- New top-level name in `public/js/**` → update the `globals` list in
  `eslint.config.js`, and watch the load-order trap.

Keep the change focused on the request; don't fold in unrelated edits.

Before moving on, check whether the change makes `README.md` stale (new or
renamed user-facing features, changed file tree, routes, npm scripts, env
vars) and update it in the same branch if so — see
`.claude/rules/keep-readme-current.md`.

## 3. Review the local changes thoroughly

Convince yourself it actually works before anything leaves the machine. Read your
own diff end to end:

```bash
git diff
npm test
npm run lint
npm run check:syntax
npm run coverage:ci
```

- All four must pass. Read the diff critically for correctness, edge cases, and
  the repo constraints above — not just "tests are green."
- **`coverage:ci` is not optional, and it is the one that surprises you.** Branch
  protection requires the aggregate `ci-passed` check, which fails on a coverage
  drop with **every test green** — and the usual cause is not a missing test but a
  newly `require`d view file dragging the global figure under the 90% floor
  (`.claude/rules/frontend-helper-modules-and-coverage.md`, where one export cost
  11 percentage points). Nothing in `npm test`'s output hints at it, which is why
  it belongs here rather than being discovered on the PR.
- **If the diff moved or renamed a function, `const` or file, grep the rules for
  the old name and fix every pointer in the same PR** (the command is in
  `.claude/rules/token-friendly-source-files.md`). `test/skills.test.js` catches a
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
  preview workflow (the `run` skill / preview tools), not tests alone. For
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

## 6. Merge — ask first, then merge normally

Merging is **never automatic**. Two gates must both clear: your review must pass
*and* the user must give an explicit go-ahead.

- If the verdict is **NOT SAFE**: do **not** merge. Address each blocker (go back
  to phase 2/3, push fixes, re-review) or, if it's out of your hands, report what
  needs to happen and stop.
- If **SAFE TO MERGE** and required checks are green: **ask the user for
  permission to merge** (`AskUserQuestion`) — name the PR, the review verdict, and
  that CI is green — then wait for a clear yes. Don't merge on your own
  initiative; the repo's branch-protection settings would block an un-approved
  merge anyway, so asking is both the rule here and the only path that actually
  goes through.
- Once the user says yes, do a **normal** squash merge — no admin override, no
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
typically takes a few minutes, so poll until the state is `success`. If it ends
`failure`/`error`, GitHub only shows "Deployment failed" — the real reason is in
the Railway **Build/Deploy Logs** (the status's `target_url`); see
`.claude/rules/railway-no-dockerfile-volume.md` for a known build-parse trap.
A merge whose deploy fails leaves production on the old build — treat it like a
red `main` workflow: investigate, fix forward on a new branch through this same
workflow, and report it either way.

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
added, the review verdict, main's CI status, the Railway deployment status, and
confirmation the local branch is cleaned up. If you stopped early at any gate, say exactly where and why. If the
issue closed only partially (a genuine hard limit or a split the user agreed to),
say which part shipped and which remains, and give the exact remaining actions
only the user can take.
