---
paths:
  - "lib/observability.js"
  - "lib/routes/vote-link.js"
  - "lib/app.js"
---

# A secret in the URL PATH lands in the logs — the logger is doing its job

Every credential in this app rides somewhere the request logger already refuses to
record: a header (`Authorization`), a cookie, or a body. `requestLogger`'s
`customProps` is an allowlist of five fields — method, **path**, status, duration,
ip — and the deliberate omission of bodies, query strings, headers and cookies is
what makes that safe (`.claude/rules/product-event-logging.md`).

Put a secret in the **path** and that reasoning inverts: the one field the logger
records *by design* is now the credential.

Found reviewing #652. The vote link is `/vote/<token>`, and its API calls are
`GET /api/vote/<token>` — so every request wrote a **working ballot credential**
into the logs, where it outlived the session and was readable by anyone with log
access. The issue's own security checklist had said "never logged"; it had been
written down and then not implemented.

**Nothing detects this.** No error, no failing check, no CodeQL finding — the
feature works perfectly and the leak is invisible unless you go and read the logs.

## The fix, and the shape of it

`reqPath()` redacts that one segment:

```js
const VOTE_TOKEN_IN_PATH = /^(\/api\/vote\/)[^/]+/;
// …
return p.replace(VOTE_TOKEN_IN_PATH, '$1:token');
```

Keeping the route **shape** rather than dropping the line: log search still
answers "how much is this endpoint used", which is the log-the-count-never-the-
secret discipline the product-event allowlist already follows. It matches both
shapes the router serves (`/api/vote/<t>` and `/api/vote/<t>/votes/<pid>`).

**`errorHandler` must use `reqPath()` too, not `req.path`.** That value is
forwarded to `ERROR_WEBHOOK_URL` — i.e. to a *third party* — which makes it the
last place a live token may appear. `ERROR_WEBHOOK_URL` is unset in production
today (`.claude/rules/liveness-vs-readiness-probes.md`), so this is defence for a
setting somebody may turn on later without thinking about tokens.

## Test BOTH directions, or the fix becomes the bug

The obvious spec asserts the token is gone. A redaction that eats **every** path
satisfies that perfectly — and turns a leak into a logger that records nothing
useful, which is worse, because now the thing you would use to notice a problem
is blind.

So the spec also pins that ordinary paths survive byte-for-byte
(`/api/rounds/abc/sessions/def`, `/healthz`) and that a loose prefix does not
swallow a neighbour (`/api/voters/x`). Both breaks redden it.

**And keep the fixture obviously fake.** A realistic 32-char base64url literal in
the spec trips `gitleaks`' `generic-api-key` rule at 4.5 entropy — correctly, since
it is indistinguishable from a live credential by inspection. The redaction matches
`[^/]+`, so the literal's entropy was never part of what the test exercises: use
`'NOT-A-REAL-TOKEN-just-a-path-segment'`. Allowlisting the finding instead would
teach the next person to wave the secret scanner through, which costs more than a
less lifelike fixture. (Note `gitleaks` scans the whole **PR commit range**, so
fixing this forward does not clear it — the branch has to be rewritten.)

## The rule

**Before putting a secret in a URL path, grep for what logs paths** — the request
logger, the error forwarder, any future analytics or APM — and redact at each. A
secret in a header is safe here by default; one in a path is not, and the default
is the unsafe one.

Consider first whether it needs to be in the path at all. For the vote link it
does: the whole artefact is a URL someone pastes into a group chat, so a header is
not available and a query string is *worse* (it is stripped from our own logs but
leaks through `Referer` to any third-party resource the page loads).

**Related:** `.claude/rules/capability-links-gate-on-the-target.md` (the feature
this was found in, and how its validity is decided),
`.claude/rules/product-event-logging.md` (the allowlist discipline both ends
follow), `.claude/rules/gitleaks-license-flake.md` (the *other* reason that check
goes red — read the log before assuming either).
