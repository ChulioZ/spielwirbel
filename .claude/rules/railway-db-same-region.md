# A `railway.internal` DB hostname does NOT mean the DB is nearby

Found investigating the post-#203 production slowness (2026-07-20): every data
endpoint still took 150–600 ms although the hot reads were long since one
single round trip (#203), query execution measured 1–4 ms on a
production-shaped dataset, and the app's fixed cost (edge + TLS + the whole
middleware chain, measured via `/healthz` and an unauthenticated 401) was only
~85 ms. The culprit: the **Postgres service had been provisioned in a US region
while the app runs in the EU** — Railway's region is per *service*, a new
database does not inherit the app's region, and the **private network spans
regions transparently**, so the `postgres.railway.internal` hostname looked
perfectly healthy while every single query crossed the Atlantic (~115 ms RTT).

## The diagnostic signature (recognize it before rebuilding anything)

- Fixed app cost is small: `/healthz` and an unauthenticated `/api/*` (which
  401s before the DB) answer in well under 100 ms.
- Every DB-touching endpoint costs roughly `RTT × (1 + ceil(payload growth
  over TCP windows))`: latency **scales with response size in discrete steps**
  (~14 KB first window, doubling per RTT). In the logs that read: activities
  (small) ~160 ms, one-round read ~300–450 ms, `listRounds` (largest blob)
  ~590 ms — all for queries that execute in single-digit ms.
- Because the per-query cost is *network*, no code change to queries, indexes,
  or schema moves the numbers materially. Fix the topology first.

Reproduce/verify locally with Toxiproxy (latency toxic ≈ the suspected RTT) —
with 110 ms injected, every repo read lands at ~120–135 ms flat, matching the
model's fixed part (Toxiproxy terminates TCP locally, so the size-proportional
window part only shows on the real link).

## Rules

- **Provision the database in the app's region**, always; check the service's
  Settings → Region against the app's, don't infer from the hostname. For EU
  deployments this is also a DSGVO data-residency requirement, not just perf.
- **Keep responses' DB blobs proportional to what the endpoint answers.**
  `listRoundSummaries` exists exactly because `listRounds` moved the tenant's
  whole dataset (~80 KB today, MBs at quota scale) to answer the sub-KB home
  screen — over any non-ideal link the transfer dominates. Don't reintroduce a
  full-dataset read for a summary-sized response.
- After any deploy/topology change, sanity-check `durationMs` in the request
  logs (Railway log search): data routes ~10 ms means same-region private
  networking; hundreds of ms means go look at the topology, not the code.

Related: `.claude/rules/postgres-backend.md` (the one-round-trip READ_SQL
contract this builds on), `docs/deploy-railway.md` (step 2 now carries the
region warning).
