# Railway's Postgres tracks a FLOATING major tag — minors install themselves, overnight

<!-- scope: global — the trap surfaces during an ops incident (a 3am uptime alert with no deploy behind it) and as a version drift nobody edits a file to cause. No diff touches it, so no scoped path would ever load this. -->

The production database service's **Source Image** is
`ghcr.io/railwayapp-templates/postgres-ssl:18` with **auto updates enabled**
(window 02:00–06:00). That tag pins the **major only**, so the minor moves on its
own: a redeploy re-pulls whatever `:18` currently resolves to. Confirmed
2026-08-04, when a redeploy silently took production from an older 18.x to
**18.4**.

Five consequences, each of which has bitten or would:

**1. Minor upgrades apply themselves, with nobody watching.** Postgres restarts
in the small hours. This is good and intended — by PostgreSQL's own policy a
minor release carries only bug, security and data-corruption fixes, never
features, and running the current minor is *less* risky than staying behind.

**2. A 3am uptime alert with no deploy behind it is probably this.** The restart
makes `/readyz` answer 503 for a few seconds, and UptimeRobot emails the operator
(#462 — email, not push). Before treating it as an incident, check whether a
minor landed. The signature is specific: **`/healthz` stays 200 throughout**
(it never touches the database, by design — `lib/app.js`) while `/readyz` goes
red. An app-side fault takes both down; this takes exactly one.

**3. CI must track the production MAJOR, and nothing tells you when it doesn't.**
`.github/workflows/ci.yml`'s `postgres` service image is pinned while production
floats. It sat on `postgres:16` while production ran 18.4 — so the `postgres`
job, a required check via `ci-passed`, was proving the data-access contract
against a database production does not run. Nothing goes red as they drift; the
gap just widens with nobody touching the repo. Fixed 2026-08-04; re-check the
pin whenever the production major moves.

**4. The major will NOT move on its own — keep it that way.** Reaching 19 means
editing the tag to `:19`, which is a genuine major upgrade (`pg_upgrade` or
dump/restore, not a restart). That asymmetry is the point: minors are automatic
and safe, majors stay deliberate. Do **not** "simplify" the tag to `:latest`.

**5. Backups have to lead this ordering.** Unattended overnight restarts are only
safe once recovery exists — and until 2026-08-04 this project had **none at all**
(PITR off, no schedule, zero snapshots, on a live public instance). The order
that made auto-updates defensible was: manual backup → PITR → daily schedule →
*then* auto-updates. Restore that order if any of those is ever turned off.

**What that recovery covers, and the trap in checking it** (2026-08-16): PITR
keeps the last 4 weekly full backups, so the window is **up to ~4 weeks**, is
**not configurable**, and **starts at activation** — it can never reach back
before 2026-08-04. The trap is reading the dashboard too early: until the archive
is older than the retention policy, the window's left edge is pinned to the
activation time and only ever grows, so **an edge that keeps reaching further
back is not evidence of an absent limit.** Checked twelve days in it still
reached day one, which says nothing either way; the first truncation was due
around 2026-09-01. The figures live in `docs/legal/retention.md`, where they are
an Art. 17 statement rather than an ops note.

## Reading the live minor (the Console tab is a shell, not psql)

Railway's **Console** tab gives you a container shell, so `SELECT version();`
typed there is a bash syntax error (`syntax error near unexpected token '('`) —
which reads like a broken database rather than the wrong prompt. Use:

```bash
postgres --version
```

No auth needed, and since the running server came from that binary it is
accurate. For the server's own answer: `psql "$DATABASE_URL" -c 'SELECT
version();'`, or run the SQL in the **Database** tab instead.

## One clean data point, not a general licence

The 16 → 18 move changed nothing this repo depends on: the full 120-case Postgres
contract passed unchanged on 18.4, and all three claims previously measured on 16
re-verified identically — the unique-violation constraint naming
(`.claude/rules/unique-violation-reports-one-constraint.md`) and both FORCE-RLS
UPDATE facts in `lib/repo/migrations/20260724130000_retenant.js`. Don't read that
as "major upgrades are free here". It is one measurement that happened to be
clean, and it only stayed cheap because the schema uses no extensions, no
`MERGE`, no generated columns, no deferrable constraints and no logical
replication.

**Related:** `.claude/rules/ci-aggregate-gate.md` (why the `postgres` job gates
the merge at all), `.claude/rules/railway-db-same-region.md` (the other
Railway-Postgres property that looks healthy while being wrong),
`.claude/rules/ops-only-changes-still-stale-the-docs.md` (this change had no
diff — and it staled `docs/legal/toms.md`), `docs/deploy-railway.md`.
