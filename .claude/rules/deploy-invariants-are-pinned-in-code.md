# Two Railway dials silently break four controls — so they live in `railway.json`, not the dashboard

<!-- scope: global — the trap is an ops action (moving a dashboard slider), which no file edit triggers -->

`numReplicas` and `sleepApplication` are pinned in `railway.json` (#644 follow-up,
2026-08-04). Railway's config-as-code takes precedence over the dashboard, so the
pins are what stop either being changed by someone reasoning about *availability*
and never seeing what they actually cost.

## Why a second replica is not a free win

Everything below shares one process's memory. A second replica gives each its own
copy, so every ceiling doubles and every per-caller bound stops bounding:

| Control | What a second replica does |
|---|---|
| `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`, `REGISTER_RATE_LIMIT_MAX`, `CONTACT_RATE_LIMIT_MAX` | `express-rate-limit`'s default store is per process — each replica counts a caller separately |
| `MAIL_DAILY_MAX` | the budget is per process and in memory, so N replicas send up to N× the operator mailbox's daily quota |
| `MAX_LIVE_DEMOS_PER_IP` | *not* affected — it counts rows, not memory. Listed because the neighbouring `DEMO_RATE_LIMIT_MAX` **is**, and the two are easy to conflate (`.claude/rules/per-ip-live-caps.md`) |

None of that errors, fails a check, or reddens a test — the limits simply stop
meaning what the env vars say. **#215 (a shared Redis store) is the prerequisite
for raising the count**, and until it ships the pin is the control.

`sleepApplication` is the smaller one: a sleeping container runs no 15-minute
demo-purge tick (`lib/scheduler.js`), so expired demos accumulate against
`MAX_LIVE_DEMOS` until a request happens to wake it.

## `numReplicas: 1` does NOT mean "only ever one process"

Worth stating, because it is the natural misreading and it would make the
in-memory reasoning look safe in the wrong places. Railway's zero-downtime deploy
**overlaps** the outgoing and incoming containers, so two processes serve
concurrently for a few seconds on **every** deploy. The pin bounds steady-state
concurrency, not all concurrency.

So anything that must be correct across processes still has to be correct — which
is exactly why the demo/real-tenant split rides on the **tenant id prefix** rather
than an in-memory registry (`.claude/rules/guest-demo-accounts.md` §1), and why
the purge is idempotent. Don't read this pin as a licence to add process-local
state.

## What `railway.json` cannot pin

Only the **app** service is deployed from this repo. The Postgres service's own
settings — region, source-image tag, backups, volume size — are dashboard-only and
have no file to guard them. That asymmetry has already cost: the database was
provisioned in a US region under an EU app
(`.claude/rules/railway-db-same-region.md`), and it ran with **no backups at all**
for the life of the instance, on a volume still at the 0.5 GB trial ceiling
(found 2026-08-04). Those belong to the ops-action sweep in
`.claude/rules/ops-only-changes-still-stale-the-docs.md`, not here.

`railway.json` also takes no comments — it is strict JSON — so the reasoning lives
in this file, in `docs/deploy-railway.md`, and in the assertions in
`test/docker.test.js`, which is what turns a silent edit into a red suite.

**Related:** `.claude/rules/liveness-vs-readiness-probes.md` (the third pinned
`deploy` key, and why it must stay `/healthz`),
`.claude/rules/railway-no-dockerfile-volume.md` (the other way a Railway deploy
config breaks the container), `docs/production-readiness.md` §7 item 5 (#215).
