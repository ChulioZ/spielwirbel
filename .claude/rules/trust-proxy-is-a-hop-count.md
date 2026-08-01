# `TRUST_PROXY` is a HOP COUNT — one too low makes every per-IP limit a shared bucket

<!-- scope: global — an env-var/ops fact whose symptom appears in production logs -->

<!-- scope: global — an env-var/ops fact whose symptom appears in production logs -->

Production ran with `TRUST_PROXY=1` behind Railway, which has **two** proxy hops.
Express therefore resolved `req.ip` to Railway's own edge proxy rather than to the
visitor, so **every visitor arriving through the same edge proxy counted as one
caller**. All four rate limiters (`RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`,
`REGISTER_RATE_LIMIT_MAX`, `CONTACT_RATE_LIMIT_MAX`) became buckets shared by
everyone, so ~5 requests could exhaust the contact form — the DSA notice channel —
and ~10 could block registration, for all users at once. Found and fixed
2026-07-27 (`TRUST_PROXY=2`).

Nothing detected it: no error, no failed check, no test. The value lives in the
deploy environment, so CI cannot see it, and **every doc in the repo said `1`** —
production was configured exactly as documented. The docs were the bug.

## Why a too-low count fails this way

Express's `trust proxy` is "how many hops nearest me are mine". It walks
`[socket, …X-Forwarded-For reversed]` and takes the first entry it does **not**
trust. With `n = 1` it trusts only the socket and returns the last XFF entry — the
edge proxy. With `n = 2` it skips both hops and lands on the address the outermost
proxy actually observed: the real client.

So the failure is silent *and* directional: too low collapses many callers into
one; there is no crash, just limits that quietly apply to the wrong unit.

## Never "fix" it with `true`

`true` trusts the whole chain and takes its **leftmost** entry — which is supplied
by the client. Anyone can then send a random `X-Forwarded-For` per request and
evade the limits entirely. express-rate-limit rejects this shape explicitly
(`ERR_ERL_PERMISSIVE_TRUST_PROXY`).

A correct hop count is immune, and it is worth knowing why: a forged entry lands
*further up* the chain than the address the proxy itself appended, so counting back
a fixed number never reaches it. Verified on production after the fix — requests
carrying a spoofed `X-Forwarded-For` stayed in the same bucket instead of getting a
fresh one.

## Verifying it (the only real check)

`requestLogger` already emits `ip: req.ip` on every request
(`lib/observability.js`). Request a distinctive path, then find it in the
container's **stdout** logs and compare `ip` to your own public address
(`curl https://api.ipify.org`).

**Railway's HTTP/edge logs are the wrong source.** Their `srcIp` is the true client
IP by construction, so it looks correct no matter what the app derives — it cannot
reveal this bug. It has to be the app's own pino line.

## The diagnostic signature, and the trap it sets

The symptom that exposed it: **`RateLimit-Remaining` on consecutive identical
requests goes UP as well as down.** Within one counter and one window it can only
decrease, so an increase means requests are landing on *different counters*.

**That header cannot tell you why**, and this is where two sessions' worth of effort
went. Two causes produce identical output:

1. two limiter **stores** (two processes), or
2. two limiter **keys** in one store (one process, `req.ip` wrong).

It was (2), but (1) was assumed and "confirmed" three times over — via an operator
report of a replica count, an IPv4-vs-IPv6 probe that was invalid because the domain
has **no AAAA record** (so both runs used one address), and an idle-drift test that
was inconclusive because the app had near-zero other traffic. The tell that finally
separated them: the split survived dropping to one replica **and** two redeploys.

So: **never infer process count from `RateLimit-Remaining`.** Read the instance
list, or log something process-local. And check `req.ip` against a known real client
address before trusting any per-IP behaviour at all — that single check would have
skipped the entire investigation.

**Related:** `.claude/rules/security-middleware.md` (the limiters this keys),
`.claude/rules/ops-only-changes-still-stale-the-docs.md` (an env-var-only change
with no diff — exactly this class), `docs/deploy-railway.md` ("Verifying
`TRUST_PROXY`").
