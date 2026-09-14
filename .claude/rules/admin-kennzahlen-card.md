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

**#941 made that sweep RECURSE TO THE LEAVES, and swept the KEYS too.** It
added two history objects and a design histogram, so a payload field is no longer
always a scalar — and the two-level form then reported `accounts.history` as
"not a number" the moment nesting appeared.

The tempting fix is an allowlist of known-nested fields. **Do not add one.** It
has to be maintained by the same person who just added the nesting, i.e. by the
person who would also be adding the leak; recursion has no such gap. Same
argument the aggregate-CI gate makes for allowlists over denylists
(`.claude/rules/ci-aggregate-gate.md`).

Keys matter now as well as values, and that is not theoretical: the design
histogram is keyed by the **stored design id**, which is the one thing on this
card that comes from data rather than from code. A histogram keyed by something
user-authored would put that text in the payload with every value still a tidy
number.

## What the card no longer carries, and why it can't come back cheaply (#941)

Three fields were **removed from `instanceMetrics` in both backends**, not merely
hidden: `accounts.new7d`, `accounts.new30d` and `rounds.tenants`. The first two
are superseded by the Konten history (a weekly series says what "last 7 / 30
days" was reaching for, and keeps saying it); „Aktivierung" was read once and
never again.

**Only Konten and Sessions have history, and adding a third is not a small
change.** They are the only dated rows: `createRound` writes no `createdAt`, and
the rounds/games/members tables carry only a `seq` bigserial. The operator
decided (2026-09-05) to derive history from the timestamps that exist rather than
add a snapshot table or backfill a date. Giving Runden/Spieler*innen/Spiele a
series needs either a daily snapshot table written by a `lib/scheduler.js` job
or a `createdAt` on new rows from that point on — neither of which backfills the
past, which is the part that makes it a decision rather than a chore.

**Neither backend casts a stored date in SQL, and that is load-bearing.** The
obvious `date_trunc('week', (data->>'createdAt')::timestamptz)` **throws for the
whole query** on one malformed historical value — measured:
`invalid input syntax for type timestamp with time zone: "t"` — while the JSON
backend silently drops that row. The backend that was supposed to agree instead
500s the panel, and only on the instance that has the bad row. Both now filter
by a plain text compare (ISO-8601 sorts chronologically) and bucket through
`lib/metrics-history.js`, so they agree **by construction** rather than by two
implementations someone has to keep in step. Same reasoning as the moderation
log's own `at` comparison.

## The session history MUST be read under `atx()`

`sessions` is RLS-scoped. A plain query under a non-superuser role returns
**zero rows rather than an error**, so the panel would draw a healthy-looking
**empty chart** on production while every superuser-run test stayed green. The
plain-role probe in `test/repo.postgres.test.js` is what holds it — verified by
moving the read off `trx` and watching it fail with "the session history was
empty without the admin escape". See `.claude/rules/admin-cross-tenant-escape.md` §2.

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
- **`metrics.mail` is the #448 daily send budget (`mail.budgetState()`), and it
  is PROCESS state, not database state** — each replica books its own counter,
  so the card shows the answering process's share and the row's note must keep
  saying so. It is not the retired "mail degrades to the outbox" config row
  coming back: that reported *configuration* (same answer on every deploy),
  this reports *usage today*. Two shape constraints: it stays **inside
  `metrics`** (the payload's top-level keys are pinned to `metrics` + `quotas`,
  and a top-level `mail` block is explicitly asserted gone), and it stays
  **numbers-only** (`sent`/`limit`, never `budgetState()`'s `day` string — the
  personal-data sweep types every metrics field as a number).
- `assetsBuilt()` moved **into `lib/app.js`** with the assets row (#404); it has
  one caller there. The old "`status.js` must never require `lib/app.js`" cycle
  warning is moot — `lib/app.js` no longer requires `lib/status.js` at all.

**Related:** `.claude/rules/admin-moderation-surface.md` (the panel this card
sits on), `.claude/rules/admin-cross-tenant-escape.md` (the `atx()` contract the
last bullet depends on), `.claude/rules/per-tenant-quotas.md` (the ceilings the
`peaks` row is paired against).
