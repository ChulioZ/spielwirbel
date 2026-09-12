---
paths:
  - "lib/observability.js"
---

# `customProps` runs TWICE — a value that changes between the two duplicates every field

`pino-http` evaluates `customProps(req, res)` at **two** moments: once in its
middleware, as the request starts, and again in `onResFinished`. There is a
dedupe guard, and it is why this is a trap rather than an obvious bug:

```js
// node_modules/pino-http/logger.js, onResFinished
const customPropBindingStr = logger[stringifySym](customPropBindings).replace(/[{}]/g, '')
if (!logger[chindingsSym].includes(customPropBindingStr)) {
  log = logger.child(customPropBindings)   // ← only when the two DIFFER
}
```

It compares the **serialized** bindings against what is already bound. Identical
on both calls → skipped, one clean copy. Differ by so much as one character →
the *whole object* is bound a second time.

Our `customProps` returned `status: res.statusCode`, which is still the default
**200** when the middleware runs. So on every non-200 response the guard saw two
different strings and re-bound all five fields:

```
{"level":"info","ts":"…","event":"request","method":"POST","path":"/","status":200,"ip":"…",
                          "event":"request","method":"POST","path":"/","status":413,"ip":"…","durationMs":13}
```

Every 4xx and 5xx line in production carried a phantom `"status":200` **first**.
200 responses were clean, because there the two calls agreed.

## Why nothing caught it for the life of the file

`JSON.parse` resolves a duplicate key to its **last** occurrence. So the line
parses to the correct status, every consumer that parses it is right, and the
existing spec — which asserted the exact field set with
`Object.keys(parsed).sort()` — could not see it: the duplicate had already
collapsed before the assertion ran. It also only ever exercised a **200**, the
one status where the bug does not occur.

The exposure is real even so: a consumer or log search that reads the *first*
occurrence sees `200` for every failed request — precisely the lines an operator
greps during an incident.

**So a spec about a log line's integrity must read the RAW serialized text.**
`test/support/log-capture.js` exports `rawLogLines` beside `parseLogLines` for
exactly this, with the reason on it. Asserting on the parsed object is the
natural thing to write and is vacuous by construction — the
`.claude/rules/break-the-code-on-purpose.md` family, where the instrument
resolves the defect away before you look.

And **make the fixture's status change after the middleware runs.** The existing
`fakeReqRes(path, method, status)` sets the final status up front, so both calls
agree and the duplicate never appears — a reproduction attempt through it reports
the code as fine. Set `res.statusCode = 200`, run the middleware, *then* set the
real status and emit `finish`.

## The rule

**`customProps` may only carry values that are already final when the middleware
runs.** `event`, and nothing else that varies. Anything request- or
response-derived goes in `customSuccessObject` / `customErrorObject`, which run
once, at finish:

```js
customProps: () => ({ event: 'request' }),
customSuccessObject: (req, res, val) => ({
  method: req.method, path: reqPath(req), status: res.statusCode, ip: req.ip, ...val,
}),
```

Spread `val` **last**: it carries `durationMs`, so this is what keeps the field
order the file's header comment promises.

`customErrorObject` additionally has to **drop `val`'s `err` key**. pino-http
manufactures an `Error` from the status for any 5xx, and pino derives a `msg`
field from an `err` — a sixth field the no-personal-data allowlist says cannot
appear. It is benign in content (`failed with status code 500`) and was there
unnoticed for the same reason: no spec exercised a 5xx line's field set.

**Related:** `.claude/rules/product-event-logging.md` (the allowlist this line
shape belongs to), `.claude/rules/client-errors-are-not-instance-faults.md` (the
other defect found in this file the same day),
`.claude/rules/break-the-code-on-purpose.md`,
`.claude/rules/source-scanning-guards-enumerate-shapes.md` (the same shape one
level up — a guard blind to the case it was written for).
