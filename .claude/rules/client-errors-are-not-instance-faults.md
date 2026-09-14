---
paths:
  - "lib/observability.js"
  - "lib/app.js"
---

# A 4xx logged as an application error hands any bot a key to the alert channel

`errorHandler` called `captureError(err, …)` **before** it looked at the status.
Everything that reached it — including a client's own malformed or oversized
request — was logged as `event: 'unhandled_error'` at `level=error`, with a full
stack, and forwarded to `ERROR_WEBHOOK_URL`.

Two WordPress-shaped scanner probes on 2026-09-12 (`POST /` and
`POST /wp-json/batch/v1`, each >100 KB of JSON) are what surfaced it. Both got a
correct 413. Both were recorded as faults of ours.

## Why this is worse than log noise

`express.json()` is mounted **globally and ahead of routing**, so it is the app's
outermost source of 4xx: it rejects before any route, any auth check, or any
tenant scoping exists. Anyone on the open internet can produce one on demand, at
any volume, against a path that does not exist.

That put unauthenticated traffic into three channels reserved for instance
faults:

- **`ERROR_WEBHOOK_URL`** — unset in production today, which is the only reason
  nobody was paged. Setting it would have opened a flood channel with no
  rate limit of its own.
- **The admin panel's ring buffer** (#359), which captures warn+error only and
  holds 200 entries. The surface that answers "what just went wrong on this
  instance" is trivially filled with things that did not go wrong.
- **Whatever error tracking eventually lands** (`docs/production-readiness.md`
  §7, the last hand-rolled item). `unhandled_error` at `level=error` is exactly
  what such a tool keys on, so it would have arrived pre-flooded.

## The rule

**Classify by whose fault it is, not by whether something threw.** A 4xx is the
client's; a 5xx is ours.

```js
const status = Number.isInteger(err && err.status) ? err.status : 500;
if (status >= 400 && status < 500) logger.info({ event: 'client_error', … });
else captureError(err, { method: req.method, path });
```

Three properties of the 4xx branch are load-bearing:

- **Below `warn`.** `emit()` buffers warn and error regardless of `LOG_LEVEL`, so
  `warn` would keep the ring-buffer flood exactly as it was. `info` is the only
  level that actually closes it.
- **`type`/`code`, never `message`.** A body-parser `SyntaxError` quotes the
  offending token from the request body — `Expected property name or '}' in JSON
  at position 1` — and this logger's allowlist promises no request body ever
  reaches the logs. `err.type` is body-parser's machine-readable code
  (`entity.too.large`, `entity.parse.failed`): more greppable, and it cannot
  carry a body byte.
- **No stack.** A client error is not a fault to debug, and the stack is pure
  volume.

Nothing is lost by the downgrade: `requestLogger` already emits its own line for
the same request, carrying method, path, status and duration.

## Check the other half before downgrading — a real 413 is a real signal

The downgrade is only safe if a 4xx on a *routed* endpoint is not something you
needed to see. Verify that before shipping it, because the same investigation
turned one up: `importSchema` permitted 2000 games while the global 100 KB parser
refused a realistic import body at ~431, so the server's own schema promised more
than the transport would carry — and the failure is silent, since the parser
rejects before routing and the route never runs.

Muting the log without fixing that would have hidden a genuine user-facing
failure behind a change made for noise. **When you quieten a channel, first go
and look at what is legitimately using it** — the per-route ceiling in
`lib/app.js` shipped in the same change for exactly that reason.

**Related:** `.claude/rules/pino-http-customprops-runs-twice.md` (the other
defect in this file the same day),
`.claude/rules/product-event-logging.md` (the no-personal-data allowlist the
`type`-not-`message` choice follows),
`.claude/rules/secrets-in-paths-reach-the-logs.md` (why the 5xx branch must keep
using `reqPath()`), `.claude/rules/deploy-invariants-are-pinned-in-code.md` (the
in-memory, per-process controls a flood interacts with).
