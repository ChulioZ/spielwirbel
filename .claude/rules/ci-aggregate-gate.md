# Branch protection requires `ci-passed`, not the individual matrix contexts (#364)

Branch protection on `main` used to require CI checks **by exact job name** —
`test (18.x)  test (20.x)  test (22.x)  dco`. Two silent gaps followed: the
`test (24.x)`/`(26.x)` matrix versions ran on every PR but never gated (job
names embed the version, so every Node bump re-desyncs the required list), and
whole jobs — `coverage` (the `coverage:ci` floor that guards untested
auth/tenant-isolation paths) and `postgres` (the data-access contract every
route depends on) — were never required at all. So a PR that broke the Postgres
contract, dropped coverage, or regressed on a newer Node could merge to `main`
under a green "required checks passed".

## The fix, and the rule

`.github/workflows/ci.yml` has an aggregate **`ci-passed`** job:
`if: always()`, `needs: [test, coverage, postgres]`, and a step that `exit 1`s
when any dependency result is `failure`/`cancelled`/`skipped`. Branch protection
requires **only** `ci-passed` from the CI workflow (plus the stable-named jobs of
the *other* workflows: `eslint`, `syntax`, `gitleaks`, `dco`).

- **Never re-add an individual `test (X.x)` context to branch protection.** That
  reintroduces the desync. Adding/removing/bumping a Node matrix version needs
  **no** branch-protection change — the version stays under the `test` job, which
  `ci-passed` already depends on.
- **A new CI job must be added to `ci-passed`'s `needs`.** `needs:` can only
  reference jobs in the same workflow file, so this only covers CI-workflow jobs;
  a job added to a *different* workflow must be required directly by its (stable)
  name. `test/ci-workflow.test.js` asserts `ci-passed` `needs` **every** other
  job defined in `ci.yml`, so forgetting to wire a new CI job into the gate fails
  the suite rather than silently leaving it ungated.
- **`if: always()` + the explicit `needs.*.result` check are both load-bearing.**
  A plain `needs:` gate *succeeds* when a dependency is skipped (a skip doesn't
  fail `needs`), which is exactly the vacuous-pass this job exists to prevent —
  hence `skipped` is treated as failure even though nothing skips conditionally
  today.

## Part B is an ops step, not code

Requiring `ci-passed` is a repo-admin change in GitHub branch-protection
settings — it is **not** in the workflow file and `implement` cannot make it.
The command (run once, after `ci-passed` has appeared at least once):

```bash
gh api --method PUT repos/ChulioZ/spielwirbel/branches/main/protection/required_status_checks \
  -F strict=true \
  -f 'checks[][context]=ci-passed' \
  -f 'checks[][context]=eslint' \
  -f 'checks[][context]=syntax' \
  -f 'checks[][context]=gitleaks' \
  -f 'checks[][context]=dco'
```

No deadlock while the Part-A PR is open: the *old* required checks
(`test (18/20/22)` + `dco`) still gate it, so it merges normally; the switch to
`ci-passed` happens only afterwards. Whether to also require the `docker` job
(a broken Dockerfile breaks the Railway deploy — see
`.claude/rules/railway-no-dockerfile-volume.md`) was left as an explicit
decision for whoever flips the setting, not pulled in silently.
