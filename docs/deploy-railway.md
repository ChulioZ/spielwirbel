# Deploying to Railway (production)

The production target is [Railway](https://railway.com). It builds the repo's
`Dockerfile` (config in [`railway.json`](../railway.json)) and auto-deploys on
push to `main`, so the container we publish is what runs. This is the "deploy"
half of issue #131 and it also satisfies the TLS work (#156) — Railway terminates
TLS at its edge.

## The production shape

Unlike the local/home setup (JSON file + on-disk uploads), a hosted deployment
uses the **stateless app-tier** backends the repo already ships, so the container
holds no state and can be redeployed/scaled freely:

- **Data → managed PostgreSQL** (`DATABASE_URL`, the #127 backend) instead of
  `data/data.json`.
- **Cover images → Cloudflare R2** (S3-compatible, the #128 backend via
  `S3_ENDPOINT`) instead of local `data/uploads/`. Railway has no native object
  storage; R2 (or Backblaze B2) is the cheap, S3-compatible pairing. The app only
  ever stores the `/uploads/<key>` path and streams bytes through itself, so
  nothing changes but where the bytes live.
- **TLS + real client IP** — Railway serves the app over HTTPS at its edge and
  forwards plain HTTP to the container. Set `TRUST_PROXY=2` so the rate limiter
  and the `Secure` session cookie key off the real client IP (#156). **Two**, not
  one: Railway puts two proxy hops in front of the container, and the value is a
  hop *count* — see "Verifying TRUST_PROXY" below for why a wrong number fails
  silently.

Everything is configured with the same env vars documented in
[`.env.example`](../.env.example) — no code changes to switch backends.

## Steps

### 1. Create the project (auto-deploy from GitHub)

1. In Railway, **New Project → Deploy from GitHub repo**, pick this repo.
2. Choose an **EU region** (e.g. `europe-west4`, Amsterdam) so user data stays in
   the EU — simplest under DSGVO and consistent with the Impressum/privacy work
   (#134).
3. Railway detects the `Dockerfile` and `railway.json`, builds the image, and
   redeploys on every push to `main`. The deploy is health-checked at `/healthz`.

### 2. Add managed PostgreSQL

1. In the project, **New → Database → PostgreSQL** — and check the new service's
   **region**: it MUST be the app's region. The region is per *service*, so the
   database does **not** inherit the app's; a mismatched default (e.g. a US
   region under an EU app) is easy to miss and costs a full cross-continent
   round trip on **every** query — the app's data endpoints sit at 300–600 ms
   instead of ~100 ms, scaling with response size (TCP windows over the long
   link). It is also a data-residency problem: EU user data at rest outside the
   EU contradicts the DSGVO posture this doc sets up. The private network spans
   regions transparently, so a `railway.internal` hostname is NO guarantee of
   proximity — verify the region in the service settings, and after deploy check
   the request logs: `durationMs` for `/api/rounds` should be ~10 ms, not ~500.
   See `.claude/rules/railway-db-same-region.md` for how this was diagnosed.
2. In the **app service → Variables**, add `DATABASE_URL` referencing the DB, e.g.
   `${{Postgres.DATABASE_URL}}`. This resolves to the **private-network**
   hostname (`postgres.railway.internal`) — always prefer it over the public
   `…rlwy.net` proxy endpoint, which adds TLS + public-internet hops to every
   query. The app creates its schema on first boot.
3. Add `DATABASE_SSL=true` only if you connect over Railway's **public** Postgres
   endpoint (managed Postgres over the internet requires TLS); over the project's
   **private** network leave it unset — the handshake is pure per-connection cost.
   Once you are on the private network, **disable the public TCP proxy** in the
   database service's Networking tab and delete the leftover
   `DATABASE_PUBLIC_URL` variable — nothing in the app reads it (the app reads
   `DATABASE_URL` only), so it is a dead credential-bearing string that outlives
   the endpoint it names.
4. **Size the volume — the default is the *trial* ceiling, not a considered
   number.** Railway's per-plan volume maximums are 0.5 GB (Free/Trial), 5 GB
   (Hobby) and 50 GB (Pro), and a volume created on a lower plan **does not grow
   when the plan does**. This deployment ran a live public instance on a 0.5 GB
   volume long after moving to Pro (found 2026-08-04). Grow it from the volume's
   **Size → Live resize** control (that button *is* the grow action — there is no
   separate one), and do it early: a resize below 100% is performed live, but at
   100% Railway forces an **offline** resize that restarts the service. You are
   charged for data stored rather than capacity allocated, so headroom is free;
   a volume can never be shrunk again.

   Read the usage before extrapolating from the percentage — most of a small
   number is fixed cost (catalog + WAL), and the guest demo (#427) churns up to
   `MAX_LIVE_DEMOS` seeded accounts *per day* through the same tables, which sets
   a floor unrelated to how many real users you have:

   ```sql
   SELECT pg_size_pretty(pg_database_size(current_database())) AS db,
          (SELECT pg_size_pretty(sum(size)) FROM pg_ls_waldir()) AS wal;
   ```

   ```sql
   SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total,
          n_live_tup, n_dead_tup, last_autovacuum
   FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC;
   ```

   A stale or null `last_autovacuum` next to a large `n_dead_tup` on
   `rounds`/`games`/`sessions`/`activities` is the one way this grows without user
   growth. Run these in the **Database** tab — the Console tab is a container
   shell, where SQL is a bash syntax error
   (`.claude/rules/railway-postgres-floating-major.md`).
5. *(Optional hardening, #136)* the round tables are protected by **Row-Level
   Security**, but Postgres **superusers bypass RLS entirely** — and Railway's
   default `postgres` user is one. The app's own queries are tenant-filtered
   either way; for the database-level backstop to actually bind, run the app as
   a dedicated **non-superuser role that owns the tables** (`FORCE ROW LEVEL
   SECURITY` binds owners, and ownership lets `repo.init()` keep managing the
   schema/policies on boot), then point `DATABASE_URL` at it:

   ```sql
   CREATE ROLE spieleabend_app LOGIN PASSWORD '<generate one>';
   GRANT CONNECT ON DATABASE railway TO spieleabend_app;
   GRANT USAGE, CREATE ON SCHEMA public TO spieleabend_app;
   ALTER TABLE rounds     OWNER TO spieleabend_app;
   ALTER TABLE members    OWNER TO spieleabend_app;
   ALTER TABLE games      OWNER TO spieleabend_app;
   ALTER TABLE sessions   OWNER TO spieleabend_app;
   ALTER TABLE activities OWNER TO spieleabend_app;
   ALTER TABLE users      OWNER TO spieleabend_app;
   ```

   (On a fresh database the `ALTER TABLE … OWNER` lines are unnecessary — the
   app role creates the tables itself on first boot and owns them from the
   start.)

### 3. Add object storage (Cloudflare R2)

1. In Cloudflare, create an **R2 bucket** and an **API token** (Access Key ID +
   Secret Access Key) scoped to it.
2. In the app service → Variables, set:
   - `S3_BUCKET` = your bucket name
   - `S3_ENDPOINT` = `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - `S3_REGION` = `auto`
   - `S3_FORCE_PATH_STYLE` = `true`
   - `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` = the R2 token pair

3. **Decide the bucket's recovery story — R2 has none by default.** Cover images
   are user data with no second copy anywhere: object versioning is off unless you
   turn it on, and unlike the database there is nothing to restore from. A bad
   delete path or a leaked token loses them permanently. Enable **object
   versioning**, or add a lifecycle/replication rule to a second bucket. Scope the
   API token to the one bucket while you are there — an account-wide token is a
   much wider blast radius than the app needs.

*(Simplest-start alternative: attach a Railway **volume** mounted at `/data` and
skip R2 — uploads then live on the volume. It works, but a volume pins the service
to one replica, so it can't scale horizontally. Prefer R2 for the product path.)*

### 4. Set the proxy + protect the instance

- `TRUST_PROXY=2` — **required** behind Railway's edge (see above), and verify it
  (below) rather than assuming it took.
- **Gate the app with the shared password.** Set `AUTH_PASSWORD` (the single
  shared-login gate, #129) **and** a long random `SESSION_SECRET` so an
  unauthenticated visitor only gets the login page. Don't put this instance on the
  public internet without it. Accounts have since shipped (#135/#136/#138); opening
  public registration is a deliberate later step — see *Going live* below, which
  layers accounts behind this gate first (#266) rather than swapping it out.

#### Verifying `TRUST_PROXY` (do this — a wrong value fails silently)

`TRUST_PROXY` is a **hop count**, not a boolean, and getting it wrong produces no
error, no failed check and no visible symptom. It broke production once (fixed
2026-07-27): the value was `1` — as every doc here used to say — while Railway
actually has **two** hops, so Express resolved `req.ip` to Railway's own edge
proxy instead of the visitor. Every visitor arriving through the same edge proxy
then counted as **one caller**, and all four rate-limit ceilings became shared
buckets: a handful of requests could exhaust the contact-form or registration
limit for *everybody*.

The app already logs what you need — `requestLogger` emits `ip: req.ip` on every
request (`lib/observability.js`). So:

1. Request any path, e.g. `https://<your-domain>/trustproxy-check`.
2. In the **deploy logs** (the container's stdout — the pino JSON lines with
   `"event":"request"`, *not* Railway's HTTP/edge logs, which show the true client
   IP by construction and so can't reveal this), find that path.
3. Compare its `ip` field with your own public address (`curl https://api.ipify.org`).

- **They match** → correct.
- **They differ**, especially if you see only one or two recurring addresses across
  many visitors → the count is too low and `req.ip` is a proxy. Raise it by one and
  repeat.

Two symptoms of the broken state, if you ever meet them again: `RateLimit-Remaining`
on consecutive identical requests **increases** as well as decreases (you are being
bounced between one bucket per proxy), and the number of distinct buckets equals the
number of edge proxies rather than anything about your app.

Don't "fix" a wrong count with `TRUST_PROXY=true`. That trusts the entire
`X-Forwarded-For` chain, and its leftmost entry is supplied by the *client* — so
anyone can send a random header per request and evade the limits completely.
A correct hop count is immune: a forged entry lands further up the chain than the
address the proxy itself recorded, so counting back a fixed number never reaches it.

### 5. Custom domain

Add your domain in the app service → **Settings → Networking → Custom Domain** and
point the DNS record Railway shows you. Railway issues and renews the TLS
certificate automatically — this completes #156.

## Env var summary

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Managed Postgres backend (#127) |
| `DATABASE_SSL` | `true` (public endpoint) | TLS to the DB |
| `S3_BUCKET` / `S3_ENDPOINT` / `S3_REGION` / `S3_FORCE_PATH_STYLE` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | R2 bucket + token | Cover-image storage (#128) |
| `TRUST_PROXY` | `2` | Real client IP behind Railway's proxy (#156). Hop count — Railway is 2, not 1 |
| `AUTH_PASSWORD` / `SESSION_SECRET` | your choice / long random | Shared-password gate (#129); with `ACCOUNTS_ENABLED` also set → layered mode (#266). `SESSION_SECRET` must be its own dedicated secret, not `AUTH_PASSWORD` |
| `ACCOUNTS_ENABLED` | `true` to layer real accounts behind the gate (#266) | Off = shared-password-only. See *Going live* |
| `BGG_API_TOKEN` | bearer token from your registered BGG application | BoardGameGeek lookup (#117) — unset means board-game search silently returns nothing |
| `PORT` | *(injected by Railway)* | The app already honours it |

`NODE_ENV=production` is baked into the image (serves the hashed `dist/` build).
Other optional tuning (`LOG_LEVEL`, `RATE_LIMIT_MAX`, `ERROR_WEBHOOK_URL`, …) is in
[`.env.example`](../.env.example).

## Deploy settings that are pinned in code, not the dashboard

`railway.json`'s `deploy` block carries three settings that look like ordinary
dashboard dials and are not. Railway's config-as-code takes precedence over the
dashboard, so editing them means editing the file:

| Key | Value | Why it is pinned |
|---|---|---|
| `healthcheckPath` | `/healthz` | The shallow probe. Pointing the *deploy* check at `/readyz` restart-loops the container on a database blip ([`liveness-vs-readiness-probes.md`](../.claude/rules/liveness-vs-readiness-probes.md)) |
| `numReplicas` | `1` | The rate limiters and the `MAIL_DAILY_MAX` budget are per process and in memory, so a second replica silently doubles every ceiling. **#215** (shared Redis store) is the prerequisite for raising it |
| `sleepApplication` | `false` | A sleeping container runs no demo-purge tick (`lib/scheduler.js`) |

`test/docker.test.js` asserts all three, so a change goes red rather than quiet.
The full reasoning — including why `numReplicas: 1` does **not** mean "only ever
one process" — is in
[`.claude/rules/deploy-invariants-are-pinned-in-code.md`](../.claude/rules/deploy-invariants-are-pinned-in-code.md).

**The container shuts down gracefully.** Railway sends `SIGTERM` to the outgoing
container on every deploy; `server.js` installs the handler from `lib/shutdown.js`,
which stops the scheduler, drains in-flight requests (`server.close()`) and
destroys the knex pool before exiting, with a 10 s force-exit fallback. Without it
Node's default action is an immediate exit, cutting whatever was in flight.

## Account-level settings (nothing in the repo can see these)

- **Set a hard usage limit with an alert threshold below it.** Railway *shuts
  services down* when the hard limit is reached, so an unset limit risks a
  runaway bill and a too-tight one is a self-inflicted outage.
- **Protect the account itself.** A passkey is a stronger floor than TOTP, but
  check that no weaker login method is still enabled alongside it, and that
  recovery does not dead-end on a single device. Railway, the domain registrar,
  Cloudflare and the operator mailbox all gate production, and account recovery
  for several of them loops through that mailbox.
- **PR environments off** unless you want a service + database per pull request;
  CI already covers PRs.

## Monitoring (#462)

Nothing in the app watches itself — the probes below only *answer*; something
outside the process has to ask. Until you set that up, an outage is noticed by
whoever happens to be using the app (which is how the 2026-07-26 degradation was
found).

### The two probe endpoints

Both are unauthenticated, mounted ahead of the rate limiter, and excluded from
the request log, so a monitor can poll them as often as it likes without
credentials, throttling, or ~1440 log lines a day each.

| Endpoint | Answers | Means |
|---|---|---|
| `/healthz` | always `200 {status, uptime, timestamp}` while the process is up | **liveness** — the container is running |
| `/readyz` | `200 {"status":"ok"}` / **`503 {"status":"degraded"}`** | **readiness** — the data backend is reachable |

**Why both.** `/healthz` deliberately never touches Postgres, so it answers
`200 ok` throughout a *total database outage* — the exact failure where every
data route and the whole admin panel stop working while the container looks
perfectly healthy. `/readyz` runs a `select 1` (result cached ~5 s, so poll
frequency can't drive database load) and answers 503 when it fails; a failed
probe also logs a `warn`, so it lands in the admin panel's recent-errors card
and in the Railway log search.

**`railway.json`'s `healthcheckPath` must stay `/healthz`.** Pointing the *deploy*
health check at `/readyz` would make a transient database blip fail the deploy and
restart-loop the container — the same flapping trap the canonical-host redirect
avoids for Railway's probe host.

### Testing that the alerting works — NOT with a made-up path

Setting up a monitor and never seeing it fire is how you discover on incident day
that the push permission was off. But the obvious test does not work on this host,
and it fails in the direction that looks like success:

```
GET https://spielwirbel.app/nope-does-not-exist  ->  200, text/html, ~11 KB
```

The app is a client-side-routed SPA, so **every unmatched GET falls through to the
SPA fallback and is answered with `index.html` and a 200**. There is no invented
path on this host that 404s, so a monitor pointed at one sits green and proves
nothing. (Same mechanism as the asset-name trap in
[`.claude/rules/security-middleware.md`](../.claude/rules/security-middleware.md),
where `/made-up.js` also returns the whole shell.)

Two tests that do fail:

- **`https://does-not-exist.spielwirbel.app`** — no DNS record for that subdomain,
  so the check fails at resolution. It exercises the whole detect → alert → phone
  chain without touching the app or spending any of its rate-limit budget. Delete
  the monitor once the notification lands.
- Your monitoring service's own **"send test notification"** button — quicker, but
  it only proves delivery, not detection.

Don't test by pointing a monitor at `/api/…`: it does answer a real `401`, but
every poll spends from the global per-IP rate limit for a fake purpose. And don't
test by breaking production.

**Keyword monitoring is optional defense-in-depth.** If your monitoring plan
offers a keyword/body check, requiring `"status":"ok"` is strictly better than a
status-code check — it also catches a `/readyz` that has silently become the HTML
shell. It is *not* worth paying or switching services for:
[`test/observability.test.js`](../test/observability.test.js)
drives both probes over HTTP and asserts the parsed body, so a removed or renamed
route turns CI red long before it could reach production. The two failures that
actually happen — database down (a real `503`) and app unreachable (no response) —
are caught by a plain HTTP(S) monitor.

### Error alerting

`ERROR_WEBHOOK_URL` POSTs a compact `{"text": …}` on any unhandled 500. It covers
**only** unhandled 500s routed through the central error handler — not slowness,
restarts or 4xx floods, which is what the uptime monitor is for. A non-2xx reply
from the webhook is logged at `warn` rather than vanishing; the URL itself is
never logged, so it may carry a token.

It is **currently unset, deliberately** (operator decision, 2026-07-27). The
forwarded text includes the real request path, so it can carry round ids — which
makes any third-party destination a recipient of personal data, requiring an AVV
plus the privacy-policy and `vvt.md` work in
[`.claude/rules/keep-legal-docs-current.md`](../.claude/rules/keep-legal-docs-current.md).
If you do configure one later:

- **Slack / Mattermost / Google Chat** — work with today's payload unchanged.
- **Discord** — expects `{"content": …}` and 400s on `{"text": …}`.
- **ntfy** — takes a raw body; self-hosting it is the only option that adds no
  processor, but a private topic also needs an auth header, which `captureError`
  does not send today. Note iOS cannot get instant push from a self-hosted ntfy
  without relaying a wake-up ping through ntfy.sh.
- **E-mail** — needs an HTTP-to-e-mail relay; `captureError` only speaks HTTP
  POST. Don't route it through `lib/mail.js`: an error loop would burn the daily
  send budget that `MAIL_DAILY_MAX` protects for *registration* mail.

## What only you can do (checklist)

These need an account or a credential I can't create or hold:

- [ ] Create the **Railway** account + project; connect this repo; pick an **EU region**.
- [ ] Add the **PostgreSQL** service and reference `DATABASE_URL` in the app.
- [ ] Create the **Cloudflare R2** bucket + API token; set the `S3_*` vars.
- [ ] Set `TRUST_PROXY=2` (then **verify** it, see below), and `AUTH_PASSWORD` +
      `SESSION_SECRET` before any public URL.
- [ ] Register the **BoardGameGeek application**, create a token under
      [Applications → Tokens](https://boardgamegeek.com/applications), and set
      `BGG_API_TOKEN` — without it the board-game search answers every query
      with an empty list, silently, so nothing else will tell you it is missing.
- [ ] Add the **custom domain** and its DNS record.
- [ ] Set up an **external uptime monitor** (~1 min interval, alerting to your
      phone) with two checks: `/healthz` for liveness and `/readyz` for the
      database. Alert on any non-2xx **and** on a latency threshold — the latency
      check is what would have caught the 2026-07-26 degradation, which never
      became a hard outage. A monitor polling only these endpoints receives no
      personal data, so it is not a processor and needs no privacy-policy change.
      It must run **off this infrastructure**: self-hosting the monitor beside the
      app means it dies in the incident it exists to report, and silence looks
      exactly like "all fine". Then verify it fires — see *Testing that the
      alerting works* above, and note the made-up-path test does **not** work here.
      *(Set up 2026-07-27: UptimeRobot.)*
- [ ] Point Railway's **project-level webhook** at your alerting channel, for
      deploy failures. Railway exposes this under **Project → Settings** only:
      there is no service-level alerting and no e-mail toggle to turn on (checked
      2026-07-27), so the webhook is the whole mechanism. Note the payload is
      deploy metadata — project, service, environment, commit, status — and
      carries **no personal data**, so unlike `ERROR_WEBHOOK_URL` a third-party
      chat/push destination here adds no recipient of user data and needs no AVV.
      The tidiest destination is an *incoming* webhook on the uptime monitor you
      just set up, so a failed deploy arrives as the same phone push as an outage.
      Lowest-priority item on this list: a failed deploy leaves the previous build
      serving, so production stays up either way.
- [ ] *(Optional)* Set `ERROR_WEBHOOK_URL` — see **Monitoring** above for the
      destination trade-offs and the legal follow-through a third party needs.

## Going live: opening public registration (#219/#266)

Don't flip the instance from shared-password to public accounts in one step — that
would swap the auth model, drop the only perimeter, and activate quotas all at
once against real data, on a day nothing rolls back gently. Use **layered mode**
(#266) so it's two small, separately verifiable moves:

1. **Prerequisites.** mailbox.org mail is configured (#226 — verification links must
   actually deliver), and `SESSION_SECRET` is its **own** dedicated secret, *not*
   equal to `AUTH_PASSWORD` (it signs access-token JWTs; the shared password is
   known to the whole group). `ADMIN_PASSWORD` is set (a separate secret again),
   so the operator panel is reachable.
2. **Turn on layered mode.** Set `ACCOUNTS_ENABLED=true` while keeping
   `AUTH_PASSWORD`. The instance stays sealed behind the shared password, and
   everyone inside now registers → verifies e-mail → logs in with a real account
   (their own tenant). Exercise every account flow for as long as you like.
3. **Claim the `'default'` data (only if migrating an existing shared-password
   instance).** Enabling accounts freezes the pre-tenancy `'default'` rounds out
   of reach (no request acts as `'default'` in layered mode), so an owner with
   pre-accounts data would otherwise log into an empty app. A **one-time
   „Standard-Daten übernehmen" admin action** re-tenanted that data into a fresh
   owner account; it shipped in #266 (PR #394) and was executed on this
   deployment during the 2026-07-24 go-live, then **removed in #405** (its
   standing cross-tenant RLS write-escape had no further purpose on a public
   instance). A fresh deployment with no pre-accounts data needs nothing here. A
   self-hoster migrating an *existing* shared-password instance to accounts mode
   should check out a revision that still includes the tool (it was present from
   #266/PR #394 through the #219 go-live, i.e. any commit before #405 merged —
   e.g. `e2d581e`), register the owner account, run the claim there, then upgrade.
4. **Open registration.** Once the account flows are proven and any claim is done,
   **remove `AUTH_PASSWORD`** (and `AUTH_RATE_LIMIT_MAX` if you tuned it). That is
   the whole go-live change: the SPA fallback stops serving `login.html`, and
   `/api/account/register` becomes reachable without the shared session. Quotas
   (#139) were already active in layered mode, so nothing new switches on here.

## CD note

Railway's native GitHub integration *is* the CD pipeline (build + deploy on push
to `main`), so no GitHub Actions deploy job is needed — the repo's `Docker`
workflow keeps building/publishing the image to GHCR for portability and as an
independent build check. If you'd rather drive deploys from GitHub Actions
instead, that's a `railway up` step gated on a `RAILWAY_TOKEN` secret — ask and
it's a small addition.
