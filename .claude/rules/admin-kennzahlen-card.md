---
paths:
  - "lib/status.js"
  - "public/js/pages/admin.js"
  - "test/status.test.js"
---
# The Kennzahlen card reports COUNTS — and two GENERIC sweeps are what keep it safe

Extracted from `.claude/rules/admin-moderation-surface.md` (#274 → #404), which
had grown to eleven sections over one surface. This one has its own file set
(`lib/status.js` + the panel's renderer + its test) and changed independently of
everything else in that rule, which is what made it a real seam rather than a
long section.

`lib/status.js` began as a go-live checklist ("is `ACCOUNTS_ENABLED` really on?
is `ADMIN_PASSWORD` distinct? did this deploy migrate?"). **#404 removed all of
that**: once registration opened, every config row answered the same way on every
deploy forever, and nobody read them. What the card carries now is `quotas` (the
ceilings) + `metrics` (aggregate usage, from the global repo method
`instanceMetrics`). The accepted losses — pending migrations, the deployed
commit, built assets, mail degrading to the outbox, the two secret-distinctness
checks, the BGG token — go back to Railway's env vars and logs.

**The endpoint, the file name and the DOM ids deliberately did not change**
(`GET /api/admin/status`, `lib/status.js`, `#statusGrid`/`#statusError`, the
`.status` grid CSS). Rules and tests cite them and a rename buys nothing
(`.claude/rules/token-friendly-source-files.md`).

## The two sweeps, and why they are generic

`lib/status.js` must never let a **secret** reach the response — not truncated,
not hashed (the panel is password-gated, and a screenshot of it must be
harmless). `test/status.test.js` plants recognisable values in the secret env
vars, serializes the whole response, and asserts none appears — plus no long hex
blob, which catches "I'll just show a hash".

**Since #404 a second generic sweep does the same job for personal data**: it
seeds rounds/accounts with recognisable names and asserts every field of
`metrics` is a `number`. A row that "just shows the biggest tenant's name" fails
without anyone remembering the test exists.

Both are generic on purpose: a new leaking field fails without anyone extending
them. **Keep them that way** — an allowlist of known-safe fields would have to be
maintained by the same person who just added the leak.

## Smaller things

- **The secret-comparison idiom is `safeEqual` in `lib/admin.js`** (also
  `lib/auth.js`) — bare length check, then `timingSafeEqual`. **Don't "harden" it
  by hashing the operands first**: a SHA-256 there made CodeQL fail a PR with
  high-severity `js/insufficient-password-hash`. (`lib/status.js` carried its own
  copy as `distinct()` until #404 deleted the rows that used it; the trap is a
  property of the idiom, not of that file.)
- The server reports facts; the ok/warn/off opinions live in `statusRows()`
  (`public/js/pages/admin.js`), so changing an opinion never changes the API
  shape. A **null** verdict is the neutral pill and is what a plain count gets —
  a green one would read as an all-clear about a number nobody graded.
- **`instanceMetrics` must read the round tables under `atx()`.**
  rounds/games/sessions are RLS-scoped, so a plain query under a non-superuser
  role returns **0 rows, not an error** — the card would report a healthy-looking
  zero on production while every superuser test stayed green (the silent shape in
  `.claude/rules/admin-cross-tenant-escape.md` §2, here in read form).
  `test/repo.postgres.test.js` pins it with a plain-role child-process probe. The
  un-scoped, no-RLS tables it also reads (`users`, `round_grants`, `invitations`,
  `friendships`) take plain `knex`.
- **Demo tenants are excluded from every metric except the demo row**, by the
  `demo-` tenant prefix (`.claude/rules/guest-demo-accounts.md` §1). `demo.live`
  is deliberately assembled in `lib/status.js` from the existing
  `countLiveDemoUsers` rather than inside `instanceMetrics`: it must stay the
  number the `MAX_LIVE_DEMOS` cap itself enforces, and a second liveness
  definition in the repo could drift from it.
- **`metrics.peaks` is keyed exactly like `quotas`** (`roundsPerTenant` /
  `gamesPerRound` / `tagsPerRound`) so the panel can zip the two without a mapping
  — that pairing is the whole point of the row: the ceiling alone never said
  whether anyone was near it.
- `assetsBuilt()` moved **into `lib/app.js`** with the assets row (#404); it has
  one caller there. The old "`status.js` must never require `lib/app.js`" cycle
  warning is moot — `lib/app.js` no longer requires `lib/status.js` at all.

**Related:** `.claude/rules/admin-moderation-surface.md` (the panel this card
sits on), `.claude/rules/admin-cross-tenant-escape.md` (the `atx()` contract the
last bullet depends on), `.claude/rules/per-tenant-quotas.md` (the ceilings the
`peaks` row is paired against).
