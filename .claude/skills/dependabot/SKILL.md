---
name: dependabot
description: >-
  Check for, review, and merge open Dependabot dependency-update PRs. Use when
  asked to handle/triage/merge Dependabot PRs, clear the dependency-update
  backlog, or "merge what's safe". Merges every PR that passes review and, for
  each that fails, leaves a PR comment explaining why and what would unblock it.
---

# Handle open Dependabot PRs

Dependabot opens weekly PRs for npm deps and GitHub Actions (see
`.github/dependabot.yml`, limit 5 npm at a time). Each already runs the CI + Lint
workflows. Your job: get every safe one merged, and for the rest, leave a
paper trail so a human knows exactly what's blocking it.

**Merging is outward-facing and hard to reverse.** Only merge PRs that pass
review. Report every action taken (merged / commented / skipped) at the end.

## 1. Find the open Dependabot PRs

```bash
gh pr list --author "app/dependabot" --state open \
  --json number,title,labels,mergeable,mergeStateStatus,url
```

If none, say so and stop. Otherwise process each PR independently, oldest first
(older PRs may be superseded by newer ones for the same package — note that).

## 2. Review each PR

Run the **`review-pr`** skill on each PR number — that covers mergeable state, CI
status, diff reading, and this repo's constraints. Do that first.

Then apply the **Dependabot-specific** checks on top:

- **Bump type (semver).** Read the title (`Bump X from 1.2.3 to …`).
  - *patch* / *minor*: low risk for a well-behaved package. Still confirm CI is
    green and the diff is only a lockfile + `package.json` version change.
  - *major*: potentially breaking. Read the release notes / changelog in the PR
    body (Dependabot includes them) and the package's CHANGELOG for the version
    range. Check whether our code actually uses the changed/removed APIs. A major
    bump is `NOT SAFE` unless you can point to why the breaking changes don't
    affect us. Express, multer, and eslint are the ones most likely to bite.
- **Security update?** A `security`/`Dependabot security` label or a linked
  advisory raises priority — but does *not* lower the safety bar. Still review;
  a fix can itself be a major bump.
- **Grouped PRs.** If a PR bumps several packages at once, review each package in
  it; the whole PR is only as safe as its riskiest member.
- **What changed beyond the manifest.** For a pure version bump the diff should be
  just `package.json` + `package-lock.json` (or the workflow YAML for an Actions
  bump). Any source change in the diff is unexpected → scrutinize.
- **Compatibility signal.** Dependabot's compatibility-score badge is a weak
  hint, not proof; CI + the checks above are what decide it.

## 3. Merge the ones that pass

For each PR whose verdict is SAFE TO MERGE:

```bash
gh pr merge <PR> --squash --delete-branch
```

- Squash keeps history clean (one commit per update). Don't merge a PR whose
  required checks aren't green — if a check is still pending, wait and re-check
  rather than forcing it.
- After a merge, later PRs may now be `BEHIND`/conflicting. Dependabot usually
  rebases them automatically within a minute or two; if one is stuck, comment
  `@dependabot rebase` on it rather than resolving conflicts by hand.

## 4. For each PR that did NOT pass — leave a trail

Do **not** silently skip it. Post a comment stating the blocker and the exact
next step, so a human can act without re-deriving your analysis:

```bash
gh pr comment <PR> --body "Not merged: <reason>. To unblock: <concrete step>."
```

Examples of reason → next step:

- *Major bump with breaking changes we use* → "review `<API>` usage in
  `<file>`, adapt call sites, then re-run CI."
- *CI failing* → name the failing check and the error; "fix X, push, re-review."
- *Merge conflict / behind base* → "comment `@dependabot rebase`, then re-review."
- *Introduces a build step / auth / dependency the project forbids* → cite the
  `CLAUDE.md` rule it violates; "close unless we decide to change that policy."

If a Dependabot control command fits the situation, prefer it over manual work:
`@dependabot rebase`, `@dependabot recreate`, `@dependabot close` (add the reason
in a preceding human comment first).

## 5. Report

Summarize as a short list: each PR → action (merged / commented-and-left-open /
skipped) → one-line reason. Make clear how many merged and how many still need a
human, and what those humans need to do.
