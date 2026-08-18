# Candidates that belong to someone else

The three branches of `pick-issue` that only fire when a candidate is claimed or
authored by somebody other than the requesting user. Most rounds trigger none of
them, which is why they live here rather than in `SKILL.md` — but when one does
fire, read the whole section before ranking or acting.

Each section names the phase that sends you here.

---

## §1 — Reclaiming a foreign-assigned issue (phases 1 and 3)

An assignee means someone has claimed the issue, so building it would collide
with their work. But an assignment must not block an issue **forever** if the
assignee never actually works on it — and how long to wait should depend on
**what waiting costs**, which you can't know until you've ranked it. So a
foreign-assigned issue is **provisional**: it stays in the pool through phases
2–3, tagged `reclaim — assigned @x, idle Nd`, and the bar it must clear is set by
where it ranked.

### Measuring the idle time

`updatedAt` is the starting point, but it bumps on *any* touch — a label edit or a
passer-by's comment resets it while the assignee has done nothing, which makes an
abandoned issue look fresh. For the one candidate you actually intend to reclaim,
measure from the **assignee's own** last sign of work:

```bash
gh api "repos/{owner}/{repo}/issues/<N>/timeline" \
  --jq '.[-10:] | .[] | {event, actor: .actor.login, at: .created_at}'
```

### The ladder

Rank the candidate exactly like everything else first — carrying someone else's
assignment neither helps nor hurts its value-for-effort. Then:

| Where it ranked | Reclaimable after |
|---|---|
| Hits an **override** — a live security exposure, or broken core functionality | **immediately** — no idle requirement |
| Would be the **clear top pick** — decisively better value-for-effort than the best unassigned candidate, not a photo finish | **3 days** idle |
| Anything else — it ranks inside the normal pack | **5 days** idle |

**Judge the middle tier against the issues only — ignore override 3 here.** An
open human PR outranks every issue, so read literally, "would be the clear top
pick" would be false for *any* issue whenever a PR is open, silently collapsing
the 3-day tier into the 5-day one exactly when the board is busiest. The question
the tier asks is whether this issue decisively leads the *buildable* work, so
compare it against the best unassigned **issue**, not against the PR queue.

The principle is **opportunity cost, not impatience**. A fixed timer asks the
wrong question ("how long has this sat?") when the one that matters is "what does
another few days of sitting actually cost?" So the bar collapses to nothing when
production is exposed right now, shortens when the entire backlog is queued behind
this one issue, and stays at five days when picking something else costs almost
nothing. "Clear top pick" means a decisive margin you could defend in one
sentence, not a nose ahead — a near-tie resolves to the free candidate, which is
the whole point of having a bar.

### What clearing the bar does and does not authorize

An override-grade reclaim can land on an issue the assignee touched an hour ago,
which *will* collide with in-flight work if they really are on it. That is
deliberate — a live hole outranks a duplicated afternoon — but it makes the
hand-off note load-bearing rather than cosmetic: say plainly how recently the
assignee was active (`assigned @x, active 1 h ago`) so `implement`'s confirmation
is a real decision and the user can choose to ping them instead.

A provisional candidate that **doesn't** clear its bar is simply not picked this
round — fall through to the best free candidate. **Name it in the report anyway**
("#N would have won but is assigned to @x and only 2 d idle"), so the user can
ping the assignee if they want it moving. Silently dropping it is what let the old
fixed timer hide work for days at a time.

One case never reaches this ladder: an issue with a **linked open PR** is not
reclaimable at any age. The work exists as a diff — review that PR instead.

---

## §2 — Ordering several open human PRs (phase 3)

They are all above the issues; order them by who has waited longest for a *first*
answer, and break ties toward the outsider. Every signal is already in the phase-1
gather payload:

1. An **outside contributor's** PR with no review yet — `isCrossRepository: true`
   (a fork PR, so not a collaborator) and an empty `latestReviews` — longest-open
   first (`createdAt`). A first-time contributor's first PR is the highest-stakes
   wait on the board.
2. A **collaborator's** PR with no review yet, longest-open first.
3. A PR **already reviewed once** where the author has since pushed or replied
   (SKILL.md phase 2) — they are owed a follow-up, but they have had an answer.
4. **Your own** open PRs (`author.login` is the requesting user), last — nobody
   external is blocked.

Handle exactly one per invocation; name the rest in the report as still waiting.

---

## §3 — Handling a contributor's PR (phase 5)

The code is someone else's, so this is **not** the same as `implement` merging its
own PR. Follow GitHub's norms:

- **CI may be waiting on you, not failing.** For a PR from a **fork** (a
  first-time or outside contributor), GitHub Actions doesn't run workflows until a
  maintainer approves the run — so "expected/pending" checks can mean *awaiting
  approval*, not broken. That approval **runs the contributor's code in CI**, so
  only trigger it *after* the malicious-intent vet passes; then let CI actually
  run and judge the PR on the real result. Don't call an un-run fork PR "NOT SAFE"
  for pending checks alone.
- **Don't rewrite their branch.** If the PR merely trails `main` (`BEHIND`, no
  conflicts) and branch protection requires up-to-date, a maintainer "Update
  branch" is fine — and because this repo **squash-merges**, any such update commit
  is collapsed away and the single merged commit stays authored by the
  contributor, so the attribution worry is moot. If it genuinely `CONFLICTS`, the
  **contributor** resolves it (it's their work) — report that as the blocker rather
  than force-pushing to their fork (which also needs "Allow edits by maintainers").
- **Approve vs. merge — mind who has write access.** `review-pr`'s verdict is
  informal analysis, *not* a GitHub review approval; if branch protection requires
  an approving review, submit one with `gh pr review <N> --approve` (you can
  approve someone else's PR, just not your own).
  - An **external contributor has no write access and cannot merge their own PR**,
    so a maintainer merging it after a clean review is the normal path →
    `gh pr merge <N> --squash` (no `--delete-branch`: it's their fork's branch,
    not yours to delete).
  - If the author is a **collaborator with write access**, prefer to *approve only*
    and let them merge on their own timing — merge it yourself only if the user
    asked you to.
- **NOT SAFE** → do **not** merge or approve. Report each blocker `review-pr`
  named; the contributor clears it. A **missing DCO sign-off** (`CONTRIBUTING.md`
  — `review-pr` phase 5) is a common one on outside PRs: the contributor signs off
  and force-pushes; **never add the sign-off for them.**
