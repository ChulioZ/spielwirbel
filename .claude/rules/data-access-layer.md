# Routes go through lib/repo.js — the data-access layer (never lib/store.js)

Issue #127 introduced `lib/repo/`: the async API that **every route reads and
writes the data through**. It has two interchangeable backends selected at require
time by `lib/repo/index.js` — `json.js` (default; the `lib/store.js` in-memory
tree + `data.json`) and `postgres.js` (when `DATABASE_URL` is set). The point of
the seam is that both satisfy the same contract, so the routes don't change when
the backend does. Postgres-specific gotchas: `.claude/rules/postgres-backend.md`.

**Rule:** new/changed route code calls `require('../lib/repo')` — never imports
`data`/`saveData`/`findRound`/`pushActivity` from `lib/store` to mutate the tree
directly. If you need a new data operation, add a typed method to **both** backends
(`lib/repo/json.js` and `lib/repo/postgres.js`) and a case to the shared contract
(`test/support/repo-contract.js`), don't reach past it.

Non-obvious things baked into the design — keep them:

- **Reads return SNAPSHOTS, not live references.** `getRound`/`listRounds`
  deep-clone (`structuredClone`) what they return. So a route can read a round for
  validation, but **mutating that object does nothing** — you must persist via a
  repo mutator. This is deliberate: it makes the JSON backend behave like a real
  DB (a fetched row is a copy), so a route that "worked" by mutating a live ref
  would silently break under Postgres. Don't switch `getRound` back to returning
  the live `data.rounds` object to "save a clone".

- **The API is async on purpose.** Every method returns a Promise even though the
  JSON backend is synchronous, so the Postgres backend won't force a second
  rewrite of every handler. Route handlers are `async` and `await` the repo. This
  is safe because the app is **Express 5**, which forwards a rejected promise / a
  thrown error from an async handler to the central `errorHandler` (see
  `lib/app.js`) — no `try/catch` or wrapper needed. (On Express 4 it would not;
  don't downgrade.)

- **404 distinction pattern.** To keep "Round not found" vs "Game/Session/Member
  not found" messages, a route does `const round = await repo.getRound(rid); if
  (!round) 404`, then calls the mutator, which returns `null` when the *sub-entity*
  is missing → the second, specific 404. A couple of methods return a small
  marker instead of a bare entity where a 400 is needed (`deleteGame` →
  `'not_retired'`; `setBackground`/`deleteGame` return the previous background /
  freed image path so the route can do the filesystem cleanup). Preconditions that
  need round/session data (e.g. "game belongs to this session", "session is
  cancelled") are validated in the route against the fetched snapshot *before*
  calling the mutator — that's why the snapshot read is there.

- **`lib/store.js` stays backward-compatible.** `test/store.test.js` and one
  recommendations test still assert against `store.id`/`pushActivity`/`saveData`/
  `data`/`findRound` directly, and the repo uses them internally. Don't delete or
  change those exports as part of "moving everything to the repo".

**Why:** the whole app was built around mutating one shared in-memory tree and
calling `saveData()` (29 sites across 8 routers). That maps to nothing in SQL. The
repo extracts each mutation into one logical operation first — behaviour-preserving
(all pre-existing tests pass unchanged), which is the safety net proving the seam
is faithful before a SQL backend is dropped in behind it.
