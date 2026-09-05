# The current branch can change under you — re-check it in the SAME call as `git commit`

<!-- scope: global — the trap is in the git/tool workflow, not in any file you could be editing -->

`implement` phase 1 creates a branch and confirms it. Phase 4 commits and
pushes. Between them sit dozens of tool calls, and **the checked-out branch is
process-global state that nothing in this session owns**: another Claude session
in the same working copy, the desktop app's own git tooling, or an IDE file-
history view can move `HEAD` while you are editing.

Measured 2026-09-05 on #928. `git branch --show-current` printed
`fix/928-fixed-score-prior` right after phase 1. By phase 4 the reflog read:

```
c974ed0 HEAD@{5}: checkout: moving from fix/928-fixed-score-prior to main
cd4ab9f HEAD@{4}: checkout: moving from main to main~1
c974ed0 HEAD@{3}: checkout: moving from cd4ab9f... to main      ← twice more
```

Nothing in this repo does that — `grep` over `test/`, `scripts/`, `lib/`,
`package.json` and `.git/hooks` finds no `git checkout`/`git switch` at all. The
commit therefore landed on `main`, and `git push -u origin HEAD` pushed it to
`origin/main`, deploying to production without a PR, without a review, and
without the user's go-ahead.

## The rule

**Put the check in the same Bash call as the commit, so it cannot be stale:**

```bash
test "$(git branch --show-current)" != main || { echo "ON MAIN — ABORT"; exit 1; }
git add -A && git commit -s -F - <<'MSG'
…
MSG
```

`git commit` runs only if the guard passed *in that same shell*. A separate
`git status` call one message earlier proves nothing about the state at commit
time — which is exactly the gap that was exercised here.

Read the push output too, and do not stop at the first plausible line:
`git push` printed

```
remote: - 5 of 5 required status checks are expected.
```

which reads like a rejection and is not — it is GitHub reporting *pending*
checks on an accepted push. The only proof is `git log --oneline origin/main -1`.

## Why branch protection did not save it — and what changed the same day

`enforce_admins` was **false** on `main` when this happened, so the required PR,
the required reviews and all five required contexts (`ci-passed`, `eslint`,
`syntax`, `gitleaks`, `dco`) applied to **everyone except the repo owner** — and
this session runs as the owner. The push was accepted, and nothing but the
missing self-check stood between an editing session and production.

**It was turned on 2026-09-05, immediately after** (operator decision, on being
shown the above):

```bash
gh api repos/{owner}/{repo}/branches/main/protection \
  --jq '{enforce_admins: .enforce_admins.enabled, required_pr: (.required_pull_request_reviews != null)}'
# {"enforce_admins": true, "required_pr": true}
```

So a direct push to `main` is now refused for everyone, and the guard above is a
second line rather than the only one. **Do not read that as a reason to relax
it**: the guard fails *locally and cheaply*, where the server-side refusal
arrives only after a commit has been written on the wrong branch and has to be
unpicked — and `enforce_admins` is one API call from being off again, since
turning it off is the intended escape hatch for an emergency hotfix.

**Use the dedicated sub-endpoint to change it**, never a full `PUT` on
`…/protection` — that form requires every field to be resent and silently drops
whatever is omitted:

```bash
gh api --method POST repos/{owner}/{repo}/branches/main/protection/enforce_admins   # on
gh api --method DELETE repos/{owner}/{repo}/branches/main/protection/enforce_admins # off
```

Verified by diffing the whole protection object before and after: exactly one
field moved.

**It does not deadlock a solo maintainer**, which is the question to ask before
flipping it on any repo: `required_approving_review_count` is **0** here, so the
owner can still merge their own PR once the checks are green. Were it ≥ 1,
enforcing admins would make every merge impossible, because GitHub does not let
anyone approve their own pull request.

`implement` phase 6c says "the repo's branch-protection settings would block an
un-approved merge anyway, so asking is both the rule here and the only path that
actually goes through." That sentence was false for this repo and is now true —
but it is true because of a setting, not because of the code, so verify it
rather than assuming it.

## Recovering, if it happens anyway

Do **not** force-push and do not revert on your own judgement — both are
outward-facing on a live public branch, and a revert triggers a second
production deploy. Tell the user what landed, that CI and the deploy are already
running on it, and let them choose. Then finish the phases you skipped against
the commit: watch CI, verify the deployed artifact
(`.claude/rules/verify-the-deployed-artifact-not-the-status.md`), review the
diff, and give the walkthrough late rather than not at all.

**Related:** `.claude/rules/ci-aggregate-gate.md` (the required contexts, and
the Part-B ops step this completes),
`.claude/rules/ops-only-changes-still-stale-the-docs.md` (turning the setting on
is exactly that class — a change with no diff, which staled this very file),
`.claude/rules/data-json-external-edits.md` (the other rule in this repo about
another session mutating shared state under you),
`.claude/skills/implement/SKILL.md` phases 1, 4 and 6c.
