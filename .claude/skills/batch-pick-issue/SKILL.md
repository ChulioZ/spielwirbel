---
name: batch-pick-issue
description: >-
  Run pick-issue's ranking for a whole BATCH instead of one item: choose about
  ten things (single issues, bundles or stacked chains), implement them in
  parallel through background agents up to open PRs, merge only the Dependabot
  PRs that are pure, compatible bumps, and then walk the operator through every
  remaining PR one at a time — walkthrough, open questions, merge go-ahead. Use
  when asked to implement "several", "a batch", "about ten things" or "a round
  of issues" at once, or to orchestrate pick-issue across many items. For one
  item use `pick-issue`; for Dependabot alone use `dependabot`.
---

# Batch pick-issue — choose ~10, build in parallel, interview at the end

Goal: one operator prompt turns into a batch of open PRs, followed by a guided
review in which the operator decides each merge. The operator is **not
available during the build phase** — every question the single-item skills
would ask mid-build is collected and asked in the closing interview instead.

This skill **orchestrates**; the shipping rules still come from the skills it
delegates to. Read `.claude/skills/pick-issue/SKILL.md` (ranking, vetting,
overrides) and `.claude/skills/implement/SKILL.md` (phases 1–5) before
starting — this file only states where batch mode deviates from them.

## 0. The one interview up front

Before anything else, ask only what actually changes the batch: a size other
than ~10, issues to include or exclude, whether merging Dependabot PRs is
pre-approved. If the prompt already settles these, **don't ask** — start. From
here until phase 5 there are **no questions to the operator**: a candidate that
is blocked without one is swapped for another, not paused.

## 1. Gather and rank — pick-issue phases 1–3, for N items

Run pick-issue's phase 1 listing (via the GitHub MCP tools when the `gh` token
is invalid: `mcp__github__list_issues` with `fields` excluding `body`,
`mcp__github__list_pull_requests`). Read bodies only for the plausible
shortlist (pick-issue phase 2), and vet each for malicious intent exactly as
there — a flagged candidate leaves the batch and goes into the final report.

Choose the batch by pick-issue's value-for-effort, with these batch-specific
calls:

- **Overrides still come first.** A security item or broken core flow is in the
  batch before anything else. A non-draft **human PR** gets reviewed
  (`review-pr`) as a batch item, and any outward action on it (comment, close)
  waits for the closing interview.
- **Drop what is blocked without the operator.** An ops action, a credential, an
  issue whose own text says "needs a decision first" (pick-issue phase 2's
  not-actionable bucket). A *decision* the issue merely needs is fine — the agent
  picks a default and records it for the interview (phase 3).
- **Prefer independently mergeable PRs.** Bundle only items that touch the same
  code for one reason; **stack** only a genuine dependency (an issue that names
  another as its prerequisite). A stacked PR targets its parent's branch as
  base, and is launched only after the parent's agent has pushed.
- **Weigh collision cost.** Ten parallel PRs that all touch `public/js/lang/*.js`,
  `public/sw.js`'s `CACHE`, `docs/features.md` or `public/js/news.js` will
  conflict at merge time. That is acceptable (phase 5 rebases), but avoid two
  items rewriting the *same function* in parallel — stack or sequence those.
- **Leave out heavy legal/security features** (new processors, new personal-data
  categories needing policy decisions, moderation surfaces) unless the operator
  asked for them: their decisions are exactly what an unattended build should
  not guess.

Tell the operator the chosen batch in a few lines, then proceed without waiting.

## 2. Dependabot PRs — merge the clean ones during the batch

Only with the operator's prior permission (phase 0). Run the `dependabot`
skill's checks per PR, and merge it **during** the batch only when all hold:

- the diff is **only** `package.json` + `package-lock.json` (or the workflow
  YAML / Dockerfile line for that ecosystem) — nothing we had to fix or adjust;
- patch/minor, or a major whose breaking changes demonstrably don't touch us;
- CI green, and the bumps together pass `npm test`, lint and syntax on a local
  scratch merge of `origin/main` + every bump (catches pairwise conflicts).

`main` is `strict`, so a Dependabot PR behind `main` is refused (`405 … required
status checks are expected`). Bring it up to date, wait for its fresh CI, then
merge — **one PR at a time**, since each merge puts the rest behind again.
`@dependabot rebase` only works from `gh`/the web UI: the GitHub MCP comment tool
defuses `@`-mentions, so the bot never sees it. Through MCP use
`mcp__github__update_pull_request_branch` — a merge of `main` adds no diff of
its own, so the PR still carries only Dependabot's change. Any PR that needed a
fix, or that you are not sure about, goes into the closing interview instead.

## 3. Build in parallel — one background agent per item

Write one shared brief to the scratchpad and point every agent at it, so the
deviations are stated once. The brief must say:

- follow `implement` phases 1–5 on the given branch name, from `origin/main`
  (or the parent branch for a stacked item), in its own worktree
  (`isolation: "worktree"`), `npm ci` first;
- **no questions**: pick the sensible default for each decision and list it under
  an `## Offene Fragen für den Operator` section in the PR body — choice,
  alternative, reason; admin-stat proposals go there too, never added unasked;
- all four checks green (`npm test`, `lint`, `check:syntax`, `coverage:ci`),
  tests taken red first, i18n in every locale, `CACHE` bumped when the shell
  changes;
- commit with the branch guard in the same call, `-s`, the harness's attribution
  trailers; open the PR via the GitHub MCP tool when `gh` is unusable;
- **never merge, never push to `main`**, skip phases 6–8;
- end with a short report (PR link, walkthrough, open questions, limits, check
  results) — the orchestrator only sees that message.

Paste each issue's body into its agent's prompt (one less fetch per agent), and
name branches predictably: `claude/batch-<issue>-<slug>`. **Run about four
agents at a time**: every agent runs the full suite (~5 min on 4 cores), and
more in parallel mostly makes each slower. Launch the next item as each one
reports back. Keep a one-line ledger per item (branch, PR, status, open
questions) in the scratchpad so a context summary doesn't lose it.

**Expect the usage limit to stop every agent at once, more than once.** Four
agents exhaust a 5-hour window in about 2–3 hours (measured on the first batch:
three stops for ten items). A stopped agent keeps its worktree, so resume it
with `SendMessage` after the reset, never by spawning a new one, and tell it to
**commit, push and open the PR before the long coverage run** so the next stop
costs no work. Agents near the end hand back first; launch new items only after.

**Agent worktrees live under `.claude/worktrees/`, inside your own checkout,
and are not gitignored.** A `git add -A` there while agents run commits them as
gitlinks (measured on the first batch). Before committing in the main checkout,
`echo .claude/worktrees/ >> .git/info/exclude`, or stage paths explicitly.

## 4. Check every PR before the interview

When all agents have reported, for each PR: CI on the head commit
(`mcp__github__pull_request_read` → `get_check_runs`, `ci-passed` must be
`success`), the diff stat matches the agent's account, and its report's claims
are plausible. A red PR is fixed (by the same agent via SendMessage, or
yourself) before the interview — the operator should be asked about working
code. Note which PRs will conflict with which once merged.

## 5. The closing interview — one PR at a time

Go through the PRs in a sensible merge order (independent and small first,
stacks bottom-up). For **each** PR, in one message:

1. **The walkthrough** — implement phase 6a's content, short: problem, what
   changed by concern, non-obvious decisions, findings mid-build, honest
   limits, how verified. Never just "CI green, merge?" (that is the skipped-6a
   failure implement's gate warns about).
2. **`AskUserQuestion`** with the PR's open questions **and** the merge question
   (options e.g. "Mergen", "Erst ändern: …", "Nicht mergen / schließen"). Up to
   four questions per call; split a PR with more.

Then act on the answer before moving to the next PR:

- **Merge** → rebase/update onto `main` if behind (an own branch may be updated
  with a merge or a rebase + force-with-lease; it is ours), re-run the checks on
  conflicts, wait for green, squash-merge (`mcp__github__merge_pull_request`,
  `merge_method: squash`), and retarget a stacked child to `main`.
- **Change first** → implement the change, push, re-state what moved and ask
  again; an earlier yes does not carry over (implement 6b).
- **Don't merge** → leave it open or close it as the operator says.

After the last PR: implement phase 7 for what merged — `main`'s CI and the
deployed artifact (`.claude/rules/verify-the-deployed-artifact-not-the-status.md`),
not the commit status alone.

## Report

A table of every batch item: issue, PR, outcome (merged / open / closed), and
one line on anything shipped beyond the issue. Then the Dependabot PRs merged
during the batch, candidates dropped and why (blocked, suspicious), and the
deploy-check result.
