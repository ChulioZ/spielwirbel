---
paths:
  - "lib/observability.js"
  - "lib/app.js"
  - "lib/repo/**"
  - "railway.json"
  - "test/observability.test.js"
---
# `/healthz` and `/readyz` are two probes on purpose — never point the DEPLOY check at the thorough one (#462)

`lib/app.js` mounts both, ahead of the rate limiter and the auth gates:

| Endpoint | Touches the DB | Answers | Consumed by |
|---|---|---|---|
| `/healthz` | **no** | always `200` while the process is up | `railway.json`'s `healthcheckPath` |
| `/readyz` | **yes** (`repo.ping()`) | `200 ok` / **`503 degraded`** | the external uptime monitor |

The split looks like duplication, and each half fails in an opposite, silent way
if it is collapsed into the other.

## Why `/healthz` must stay shallow

It is the **deploy** health check. Railway restarts a deploy that fails it
(`restartPolicyType: ON_FAILURE`, 10 retries), so making it query Postgres means
a transient database blip fails the deploy and **restart-loops the container** —
turning a recoverable blip into an outage. Same family as the flapping trap in
`.claude/rules/canonical-host-redirect.md`, where an over-broad redirect would
301 Railway's own probe.

`test/docker.test.js` already pins `cfg.deploy.healthcheckPath === '/healthz'`,
which is what stops someone repointing it at the "better" endpoint. That
assertion predates #462 and is now load-bearing for a second reason — don't
relax it.

## Why `/healthz` alone was not enough

Because it never touches the database, it answers **`200 ok` throughout a total
database outage** — precisely the failure where every data route and the whole
admin panel are dead. An uptime monitor on `/healthz` alone reports green through
exactly the incident you bought it for. Hence `/readyz`, and hence the 503: a
monitor needs a non-2xx to alert on.

## Three things in `createReadyz` that are load-bearing

- **The probe must not catch.** `repo.ping()` *rejects* on failure — that
  rejection is the entire signal. A `try/catch` inside either backend's `ping()`
  would make it report healthy forever. Both backends assert something real (JSON
  checks `data` is loaded; Postgres round-trips `select 1`) rather than
  `return true`, so the check can't stay green if the store ever loads lazily.
- **A cache alone only dedupes SEQUENTIAL polls.** The ~5 s result cache is what
  stops an unauthenticated, un-rate-limited endpoint from being a cheap way to
  drive DB load — but requests arriving *before the first resolves* all miss it
  and each issue their own query, which is the shape a monitor burst actually
  has. So the in-flight promise is shared too. `test/observability.test.js` pins
  the concurrent case separately from the sequential one; the sequential test
  passes fine against code with no coalescing.
- **The cache must expire, or a blip pins the endpoint at 503** for the life of
  the process. Pinned by the recovery test with an injected `ttlMs`.

`ping` is **global** — no tenant argument, absent from `TENANT_METHODS`
(`.claude/rules/tenancy-rls.md`). `select 1` touches no round table, so it needs
no `tx()`/RLS tenant setting.

## The polling is hidden from the logs; the degradation is not

Both paths are in `PROBE_PATHS` (`autoLogging.ignore`), because a 1/min monitor on
each is ~2900 log lines a day of pure noise. A *failed* probe still logs a `warn`
from `createReadyz`, so it lands in stdout and in the #359 ring buffer the admin
panel renders. Skipping the request log and skipping the failure are different
things — keep them different.

## `fetch` does not reject on a non-2xx — so a broken webhook was invisible

`captureError`'s `ERROR_WEBHOOK_URL` forward had a bare `catch {}` and never
checked the status. `fetch` only rejects on a **transport** failure, so a 404, a
401, or Discord 400ing our `{"text": …}` payload resolved normally and the catch
was never reached: a misconfigured alerting channel failed **completely
silently**, which is worse than having none configured. It now logs a `warn` on
`!res.ok` — **status only**, never the URL (it can embed a token) or the response
body.

`ERROR_WEBHOOK_URL` is deliberately **unset** in production (operator decision,
2026-07-27): the forwarded text includes the real request path, so it can carry
round ids, making any third-party destination a recipient of personal data —
an AVV plus the work in `.claude/rules/keep-legal-docs-current.md`. The
destination trade-offs are written up in `docs/deploy-railway.md` §Monitoring
rather than re-derived. Note in particular that routing alerts through
`lib/mail.js` is **not** the easy way out: an error loop would burn the daily
send budget `MAIL_DAILY_MAX` protects for *registration* mail
(`.claude/rules/bounding-bulk-registration-mail.md`).

## You cannot test a monitor with a made-up path — the SPA fallback 200s it

Verified on production 2026-07-27, and it cost real time: the natural way to prove
an uptime monitor actually alerts is to point a throwaway one at a URL that
"obviously" 404s. **On this host nothing does.** Every unmatched GET falls through
to the SPA fallback and is answered with `index.html`:

```
GET https://spielwirbel.app/nope-does-not-exist  ->  200, text/html, ~11 KB
```

So the test monitor sits **green**, which reads as "my monitoring is broken" when
it is in fact reporting correctly. Same mechanism as the asset-name trap in
`.claude/rules/security-middleware.md` (`GET /made-up.js` → 200, the whole shell),
which is the other place this fallback surprises someone.

Test with something that fails *before* reaching the app — a subdomain with no DNS
record (`does-not-exist.spielwirbel.app`) — or the monitoring service's own
send-test-notification button. Not `/api/…`: it answers a real 401, but each poll
spends from the global per-IP rate limit.

The same fallback means a **keyword/body check is strictly better than a
status-code check** for these probes (require `"status":"ok"`; the shell does not
contain that string) — a `/readyz` that had silently become the HTML shell would
otherwise stay green. Treat it as optional defense-in-depth, not a requirement:
the tests below drive both probes over HTTP and assert the *parsed body*, so a
removed or renamed route reddens CI long before production, and the failures that
actually occur (a real 503, or no response at all) need no keyword to be caught.

## Testing note

The shared test app from `test/helpers.js` runs **accounts-off**, so `/api/rounds`
answers `200` there, not `401`. A test asserting a probe sits ahead of the auth
gate has to build its own app with `ACCOUNTS_ENABLED` + `SESSION_SECRET` (the
`buildApp` shape in `test/layered-auth.test.js`) — writing it against the shared
app produces an assertion that is simply false rather than one that fails
usefully.

Every assertion above was verified by breaking the production code on purpose
(the discipline in `.claude/rules/break-the-code-on-purpose.md`): dropping
`/readyz` from `PROBE_PATHS`, removing the in-flight sharing, deleting the
`!res.ok` warn, and adding `ping` to `TENANT_METHODS` each redden exactly one
test and nothing else. Back the files up to the scratchpad first — `git checkout`
restores from the index and discards the whole uncommitted change
(`.claude/rules/css-text-assertions-strip-comments.md`).

**Related:** `.claude/rules/railway-no-dockerfile-volume.md` (the other way a
Railway deploy config breaks the container),
`.claude/rules/canonical-host-redirect.md` (the health-check host that must never
be redirected), `.claude/rules/product-event-logging.md` (the allowlist
discipline the `warn` fields follow).
