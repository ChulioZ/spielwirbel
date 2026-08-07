# A green Railway commit status does NOT mean the deploy took effect

<!-- scope: global — surfaces while watching a production deploy, an ops action with no diff and no file to key on -->

Observed 2026-08-06 on the #664 merge (`480c93e`). Four facts, all for the same
SHA:

| Signal | What it said |
|---|---|
| Railway **commit status** `spielwirbel - spielwirbel` | **`success`**, 15:15:21 |
| Railway **deployment** record (`5782040339`) | `in_progress` 15:10:17 → **`inactive`** 15:15:25 — never `success` |
| Production's served shell | `spielwirbel-shell-5a1b9c62` — the build of **`main~1`** (`a92f4d1`) |
| A local build of the merge commit | `spielwirbel-shell-a45cfed9` |

So the deploy never took effect, and production stayed on the previous build for
**14 hours**, until the next merge's deploy succeeded at 2026-08-07 05:48. The
one check `implement` phase 7 prescribed — poll the commit status until it leaves
`pending`, treat `success` as done — passed the whole time. A session following
the skill reported a shipped feature that was not shipped, which is exactly what
occurred.

The commit status went green **four seconds before** the deployment went
`inactive`, so it reflects the build/handoff and not the running container. Don't
reason about it further than that; treat it as a signal that can be green over a
deploy that did not happen.

## 1. Verify the ARTIFACT — the deployed commit is directly observable

The optional production build (#141) content-hashes `js/**` + `styles.css` and
derives the service worker's `CACHE` name from that set plus the source `CACHE`
literal (`.claude/rules/frontend-build-cache-busting.md`). That makes the
deployed build readable over plain HTTP, with no credentials and no dashboard:

```bash
curl -s "https://spielwirbel.app/sw.js?cb=$(date +%s)" | grep -m1 '^const CACHE'
```

Cache-bust the request (`?cb=…`) — `sw.js` is served `no-cache`, but you are also
going through whatever sits in front of it.

Build the merge commit locally and compare. Build into a **temp dir**, not the
repo's `dist/`: a stray `dist/` is what `assetDir()` serves under
`NODE_ENV=production`, and it shadows your `public/` edits until you remember to
`rm -rf` it.

```bash
OUT=$(mktemp -d); node -e "require('./scripts/build').build({outDir:process.env.OUT})" \
  && grep -m1 '^const CACHE' "$OUT/sw.js"
```

**Equal = deployed. Different = not deployed.** The second direction is
decisive on its own; the first needs one guard.

**The check answers only if the merge actually moved the digest.** Two ways it
does not:

- A change confined to a **copied-through** asset (`manifest.webmanifest`, icons,
  fonts, `fonts/tabler-icons.css`) hashes nothing — already the caveat in
  `frontend-build-cache-busting.md`, and the reason the `CACHE` literal is in the
  digest at all (#617).
- A change touching **no shell asset whatsoever**. Measured here: `e1aeb35`
  (#675 — a CI workflow file and a test) builds to the *same* `a45cfed9` as its
  parent `480c93e`. Nothing is wrong with that; it just means the digest cannot
  tell the two apart.

So build **both** the merge commit and its parent first. If they differ, the
`curl` is conclusive. If they don't, this check has no opinion — fall back to §2.
For the #664 case it was decisive: `480c93e` changed frontend JS, so its digest
moved off `a92f4d1`'s.

## 2. Read the DEPLOYMENT record — it disagreed with the commit status

```bash
gh api "repos/{owner}/{repo}/deployments?per_page=1" --jq '.[0] | "\(.id) \(.sha)"'
gh api "repos/{owner}/{repo}/deployments/<id>/statuses" --jq '.[] | "\(.created_at) \(.state)"'
```

A **newest** deployment whose latest state is `inactive` rather than `success`
did not take effect.

**"Newest" is load-bearing — `inactive` on an older record is normal.** It is
how a superseded deploy is marked: `5780187104` (`a92f4d1`) read
`success 2026-08-06T13:24` and then took two `inactive` statuses at
`2026-08-07T05:48`, seconds after the *next* deployment succeeded. Read that
state on the wrong row and you conclude a healthy deploy failed. Check the
record's `sha` matches `origin/main` before reading its state at all.

## The trigger, for the record

The failed deploy straddled the GitHub Actions incident `qcvjkzcs7j74`, and
Railway's GitHub integration rides the same APIs. The correlation is tighter than
"same day" — **the same merge, in the same minute, broke twice**:

- CI run `31114551171` attempt 1 on `480c93e`: the `postgres` job died in
  **`Set up job`** (runner/service-container provisioning) at 15:15:14, which is
  the failure that exposed the `ci-passed` denylist hole and got fixed in #675.
- Railway's deployment for that same SHA went `inactive` at 15:15:25, eleven
  seconds later, under a green commit status.

**During a GitHub incident, treat every green aggregate signal as suspect** and
go look at the thing the signal is standing in for.

## Same failure shape as the `ci-passed` hole

`.claude/rules/ci-aggregate-gate.md` is the same bug one layer over: a green
aggregate signal standing in for work that never ran, where the enumeration
behind the signal could not see an infrastructure failure. The remedy is the same
in both places — **check the outcome, not the summary of it**. There, name every
job and compare to `!= 'success'`; here, read the built artifact rather than the
status that claims it was built.

And it belongs to the family in
`.claude/rules/ops-only-changes-still-stale-the-docs.md`: the deploy is an ops
action with no diff, so nothing in the repo goes red, no test can observe it, and
the only thing standing between a silent no-op and a wrong "shipped" report is a
written check somebody actually runs.

**Related:** `.claude/skills/implement/SKILL.md` phase 7 (which now ends on the
artifact check, not the status), `.claude/rules/frontend-build-cache-busting.md`
(what the digest covers), `.claude/rules/railway-no-dockerfile-volume.md` (a
deploy that fails *loudly*, and where its real reason lives),
`.claude/rules/pwa-service-worker.md` (why the `CACHE` name exists in the first
place).
