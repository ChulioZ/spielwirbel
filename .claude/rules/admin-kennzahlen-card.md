---
paths:
  - "lib/status.js"
  - "lib/repo/json.js"
  - "lib/repo/postgres.js"
  - "public/admin.html"
  - "public/js/pages/admin.js"
  - "test/status.test.js"
---
# The Kennzahlen cards report COUNTS — and two GENERIC sweeps are what keep them safe

Extracted from `.claude/rules/admin-moderation-surface.md` (#274 → #404): this
has its own file set (`lib/status.js` + the panel's renderer + its test) and
changed independently of the rest of that rule.

`lib/status.js` began as a go-live checklist ("is `ACCOUNTS_ENABLED` really on?
did this deploy migrate?"). **#404 removed all of that**: once registration
opened, every config row answered the same way on every deploy forever, and
nobody read them. What is carried now is `quotas` (the ceilings) + `metrics`
(aggregate usage, from the global repo method `instanceMetrics`). The accepted
losses — pending migrations, the deployed commit, built assets, mail degrading to
the outbox, the secret-distinctness checks, the BGG token — go back to Railway's
env vars and logs.

**The endpoint, the file name and the DOM ids deliberately did not change**
(`GET /api/admin/status`, `lib/status.js`, `#statusGrid`/`#statusError`, the
`.status` grid CSS). Rules and tests cite them and a rename buys nothing
(`.claude/rules/token-friendly-source-files.md`). **#1124 split the card in two
and kept those ids on the first one** for the same reason — „Grenzen &
Kontingente" (`#statusGrid`, what is close to refusing a user) and
„Funktionsnutzung" (`#adoptionGrid`, whether anything is being used). One
`/status` fetch feeds both, so a failure must be shown in **both** error slots:
a silently empty second card reads as „nothing is used", not as „this did not
load".

**Two tile shapes, and no third.** A **limit** is `used / limit` and carries a
graded pill; an **adoption share** is `n / total` and carries the neutral one —
low uptake is not a fault condition, and a green pill would grade something
nobody set a threshold for. A **bare count** is what the card was cleaned of;
„Konten" is the single sanctioned exception, because site adoption has no
denominator to divide by. A zero denominator renders „—", never „0 / 0".
`.claude/rules/propose-an-admin-stat-for-new-features.md` is when to add one.

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

**#941 made that sweep RECURSE TO THE LEAVES, and swept the KEYS too**, since a
payload field is no longer always a scalar — the two-level form reported a nested
block as "not a number" the moment the design histogram appeared. #1124's
`adoption` block inherited that for free, which is the point. Keys matter as well
as values, and not theoretically: the histogram is keyed by the **stored design
id**, the one thing on these cards that comes from data rather than from code.

**The tempting fix to either sweep is an allowlist of known-safe or known-nested
fields. Do not add one** — it has to be maintained by the same person who just
added the nesting, i.e. by the person who would also be adding the leak.
Recursion has no such gap. Same argument the aggregate-CI gate makes for
allowlists over denylists (`.claude/rules/ci-aggregate-gate.md`).

## What the cards no longer carry (#941, #1124)

#941 removed `accounts.new7d`, `accounts.new30d` and `rounds.tenants` from
`instanceMetrics` in both backends. **#1124 removed the two weekly series with
their charts** (`accounts.history`, `content.sessionHistory`, and the
`metrics-history` bucketing module with them) and `content.sessions30d`, and dropped the
six inventory tiles — a count the operator reads once and cannot act on. The
public statistics block (#564) publishes those totals in the form that matters.

**Three of those fields stayed in the payload anyway, and deleting them is the
trap in this file.** `content.activeGames`, `content.members` and
`content.sessionsFinished` have no tile, but `lib/public-stats.js`'s `COUNTERS`
read exactly them for the **public landing counters**. An absent field there
simply fails its threshold, so the block stops rendering with no error, no red
test and nothing in the logs — while the diff looks like tidying up an operator
card. `test/status.test.js` pins all three by name.

**A time series is not coming back cheaply, and that is why neither returned.**
`createRound` writes no `createdAt` and the rounds/games/members tables carry only
a `seq`, so only accounts and sessions were ever datable — and the two that
existed cost a bucketing module shared by both backends, because neither may cast
a stored date in SQL: `date_trunc('week', (data->>'createdAt')::timestamptz)`
**throws for the whole query** on one malformed value (measured: `invalid input
syntax for type timestamp with time zone: "t"`) where the JSON backend silently
drops that row — so the backend meant to agree instead 500s the panel, and only
on the instance holding the bad row.

## The adoption figures MUST be read under `atx()`

`rounds`, `games` and `sessions` are RLS-scoped, so a plain query under a
non-superuser role returns **zero rows rather than an error** — and **zero is a
plausible reading for an adoption figure**, so the panel would report „nobody
uses anything" on a production instance full of data while every superuser-run
test stayed green. `test/repo.postgres.test.js` holds it with a plain-role child
process, seeded so `sessionsWithGuests` and `roundsWithTags` must be non-zero
(`.claude/rules/admin-cross-tenant-escape.md` §2).

**`session_vote_links` is the one that is correctly OUTSIDE `atx()`** — it is
deliberately not tenant-scoped and not under RLS (its own migration says why:
the `/vote/:token` caller is unauthenticated, so there is no `app.tenant_id` to
scope by), and it carries its tenant inside `data` rather than as a column, which
is what the demo filter reads. Check a table's migration before choosing a side;
guessing is how a figure becomes a permanent zero.

## Smaller things

- **The secret-comparison idiom is `safeEqual` in `lib/admin.js`** (also
  `lib/auth.js`) — bare length check, then `timingSafeEqual`. **Don't "harden" it
  by hashing the operands first**: a SHA-256 there made CodeQL fail a PR with
  high-severity `js/insufficient-password-hash`. (`lib/status.js` carried its own
  copy as `distinct()` until #404 deleted the rows that used it; the trap is a
  property of the idiom, not of that file.)
- The server reports facts; the ok/warn/off opinions live in `limitRows()` /
  `adoptionRows()` (`public/js/pages/admin.js`), so changing an opinion never
  changes the API shape. A **null** verdict is the neutral pill, which every
  adoption tile gets — see the two tile shapes above.
- The un-scoped, no-RLS tables `instanceMetrics` also reads (`users`,
  `round_grants`, `invitations`, `friendships`, `session_vote_links`) take plain
  `knex` — everything else goes under `atx()`, per the section above.
- **Demo tenants are excluded from every metric except the demo row**, by the
  `demo-` tenant prefix (`.claude/rules/guest-demo-accounts.md` §1). `demo.live`
  is deliberately assembled in `lib/status.js` from the existing
  `countLiveDemoUsers` rather than inside `instanceMetrics`: it must stay the
  number the `MAX_LIVE_DEMOS` cap itself enforces, and a second liveness
  definition in the repo could drift from it.
- **`metrics.peaks` is keyed exactly like `quotas`** so the panel can zip the two
  without a mapping — that pairing is the whole point of the tile: the ceiling
  alone never said whether anyone was near it.
- **`metrics.mail` is the #448 daily send budget (`mail.budgetState()`), and it
  is PROCESS state, not database state** — each replica books its own counter, so
  the tile shows the answering process's share and its note must keep saying so.
  Two shape constraints: it stays **inside `metrics`** (the payload's top-level
  keys are pinned to `metrics` + `quotas`, and a top-level `mail` block is
  asserted gone), and it stays **numbers-only** (`sent`/`limit`, never
  `budgetState()`'s `day` string — the sweep types every metrics field a number).
- `assetsBuilt()` moved **into `lib/app.js`** with the assets row (#404), so the
  old "`status.js` must never require `lib/app.js`" cycle warning is moot.

**Related:** `.claude/rules/admin-moderation-surface.md` (the panel these cards
sit on), `.claude/rules/admin-cross-tenant-escape.md` (the `atx()` contract),
`.claude/rules/per-tenant-quotas.md` (the ceilings `peaks` is paired against),
`.claude/rules/propose-an-admin-stat-for-new-features.md` (when a new feature
earns a „Funktionsnutzung" tile).
