---
paths:
  - "lib/storage/**"
  - "lib/store.js"
  - "lib/app.js"
  - "lib/game-owners.js"
  - "lib/routes/**"
  - "test/fault-logging.test.js"
---

# Logging a caught fault: the MESSAGE can carry the payload, and the LOOP can carry away the buffer

#1148 added a log line at twelve sites that catch an instance fault and convert
it into a status code, a `null` or a `[]`. The line itself is one call each. Both
things that can go wrong are in what it carries — and neither is visible from a
green suite, because the feature works either way.

## 1. An error MESSAGE is not a safe field — `JSON.parse` quotes the file back

`.claude/rules/client-errors-are-not-instance-faults.md` established this for
body-parser (`err.type`, never `err.message`, because a `SyntaxError` quotes the
offending token out of the request body). The same trap is waiting on
**`lib/store.js`'s `loadData()`**, and it is worse there — the bytes being parsed
are `data.json`, i.e. the whole group's private data. Measured on Node 26:

```js
JSON.parse('not json at all with a member name Anna Schmidt')
// SyntaxError: Unexpected token 'o', "not json at"... is not valid JSON
```

So the message of a corrupt-dataset error is a snippet of the dataset. The line
logs `code: err.code || err.name` — which is `SyntaxError`, `EACCES`, `EISDIR`,
exactly what you would grep for — and never `message`.

**The same question, different answer, one file over.** `err.message` is fine at
the storage sites (an SDK transport message: `connection refused`) and at
`game-owners`. It is NOT fine at `lib/routes/account.js`'s `confirm-email`: a
23505 from `users_email_idx` is reachable there, and a Knex-wrapped message can
carry the SQL that names the address. That one logs `code` too.

**The test that proves it has to look for the payload, not for the field.**
Asserting `line.message === undefined` passes against a line that simply spells
the field differently; the spec also asserts the whole buffer, serialised, does
not contain the fixture's invented member name. Same for the lookup sites and
`req.query.q`.

## 2. A log line inside a BOUNDED LOOP is a ring-buffer flood

The operator panel's „Fehlerprotokoll" reads a 200-entry in-memory ring
(`LOG_BUFFER_MAX`), and warn/error are buffered **regardless of `LOG_LEVEL`**.
So a line is not just a line: it is an eviction of whatever the operator would
otherwise have seen.

`disk.usage()` stats up to `USAGE_MAX = 5000` files. The natural one-line-per-site
edit puts the warn inside that loop, and then the first unreadable uploads folder
erases the entire panel with 5000 copies of one fact — at exactly the moment
somebody opens it to find out what is wrong.

**Count in the loop, log once after it**, carrying the count:

```js
if (unreadable) {
  logger.warn({ event: 'storage_usage_incomplete', backend: 'disk', unreadable, listed: page.length });
}
```

The spec plants **three** broken symlinks and asserts exactly one line with
`unreadable: 3` — three is the smallest fixture that can tell "aggregated" from
"per file", and a fixture of one is green against both.

## 3. Only log what is OURS — the fault/expectation split runs inside one catch

Two of the twelve catches cover a real fault *and* a routine non-event, and
logging the pair together is how a channel gets trained out of existence:

| Site | Silent | Logged |
|---|---|---|
| `s3.serve()` | `NoSuchKey` → 404 (an orphaned reference) | anything else → 502, `error` |
| `disk.remove()` | `ENOENT` (the documented no-op) | `EACCES`/`EPERM` — a delete that did **not** happen |
| `store.loadData()` | `ENOENT` — a fresh instance, and **every test process** | corrupt/unreadable → `error` |

The `store` one is the sharpest: without its guard, every `npm test` process and
every first boot opens with an `error` in the buffer, and the panel's normal
state becomes "there is an error". Note this cannot be caught by asserting the
line exists — it needs the **inverse** spec ("a missing data.json logs nothing at
all"), which is the direction nobody writes.

Level by whose fault it is, not by how loud it feels: a BGG outage breaks „Spiel
suchen" app-wide and is still `warn`, because it is not our bug.

## Testing these at all

`loadData()` runs at **require time**, so its spec has to fork a process
(`execFileSync(process.execPath, ['-e', …])`) with its own `DATA_DIR` — the store
in the test process loaded its dataset before the first test ran.
`assetPathSet` is exported from `lib/app.js` for the same reason: its catch is
unreachable through `createApp()` with a readable `public/` tree.

All of this is Route 2 (`.claude/rules/break-the-code-on-purpose.md`): the
behaviour already existed, so every assertion was earned by deleting the line and
watching **one named test** go red — 24 breaks, 24 single reds, including the
four that do not remove a line at all but make it carry the wrong thing (log the
query, log `err.message`, log per file, drop the ENOENT guard). Those four are
the ones worth keeping if this spec is ever trimmed; the rest only prove presence.

**Related:** `.claude/rules/client-errors-are-not-instance-faults.md` (which
faults must NOT be recorded as ours, and the ring buffer this shares),
`.claude/rules/product-event-logging.md` (the no-personal-data allowlist),
`.claude/rules/secrets-in-paths-reach-the-logs.md` (the third field that leaks),
`.claude/rules/break-the-code-on-purpose.md`.
