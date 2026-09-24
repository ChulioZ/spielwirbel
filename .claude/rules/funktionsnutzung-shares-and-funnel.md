---
paths:
  - "lib/admin-exclusions.js"
  - "lib/repo/json.js"
  - "lib/repo/postgres.js"
  - "public/js/pages/admin.js"
  - "test/admin-kennzahlen.test.js"
  - "test/status.test.js"
---
# What „Funktionsnutzung" divides by, and why the funnel is not a pipeline

Split out of `.claude/rules/admin-kennzahlen-card.md` (#1124 → #1174): that file
is about the two cards, their tile shapes and the two generic sweeps that keep
them safe. This one is about the **arithmetic on the second card** — which
denominator each share takes, and what the session funnel's lines mean. The two
are edited independently.

## Every share on „Funktionsnutzung" divides by a denominator IN `adoption` (#1174)

`ADMIN_EXCLUDE_TENANTS` removes the operator's own tenants from that card, so
its shares describe other people's usage — on a small instance the operator's
rounds are the oldest and most exercised, and a feature reads as widely adopted
while nobody else has opened it.

The trap is that the exclusion filters **numerators**, and every denominator on
the card used to come from somewhere else: `m.rounds.total`, `m.content.games`,
`m.content.sessions`, `m.accounts.total`. Those are instance-wide by design —
`lib/public-stats.js` reads three of them for the PUBLIC landing counters, and
an operator hidden from `peaks` would be blind to the quota they are about to
hit. Filter one side only and the card reports „Teilen & Freunde 140 %".

So `adoption` carries **its own four totals** — `accountsTotal`, `roundsTotal`,
`gamesTotal`, `sessionsTotal` — plus `accountsWithAvatar`, an adoption-scoped
twin of the accounts block's own figure. `adoptionRows()` reads only those.
`designAdoption` and `social` take the exclusion in place, because both render
as shares on that same card; nothing else reads them. `designAdoption` (#1201)
divides by `accountsTotal` — it counts ACCOUNTS, not rounds, since designs moved
from rounds to accounts, and its per-design rows sum to exactly that total.

**With the variable unset all of them equal their instance-wide twin**, which is
what makes this look like a no-op and is not one: a renderer that reached for
`m.rounds.total` would pass every test on a default instance and be wrong only
on the one instance that set the variable. `test/admin-kennzahlen.test.js`'s
fixture therefore makes the two **disagree on purpose** (40 vs 42 accounts, 10
vs 11 rounds, 80 vs 90 games, 30 vs 33 sessions) — a fixture where they matched
could not tell the two apart at all.

**„Konten" stays the one instance-wide tile.** It is the sanctioned bare count,
and an operator hidden from it could not see their own instance's size.

## The funnel is a BUNDLE, not a pipeline (#1174)

`adoption.funnel`'s seven figures are **independent shares of `started`**, and
reading them as a shrinking pipeline is wrong in a way the numbers themselves
will show you: a direct-pick session is created `done: true` with a game already
chosen and `votes: {}`, so „Abstimmung beendet" routinely exceeds „von ≥2
bewertet". `cancelled` is counted apart — an evening nobody played on purpose is
a resolved outcome, not a loss.

**Split parents are outside the funnel entirely; their tables are counted
instead.** A parent split across three tables holds a real vote, was never
played, and is not an abandoned evening either — counting it books a loss
against „gespielt" for a round that played three games. It still counts toward
`sessionsTotal`, because it is a session the instance holds.

`result` goes through the shared `sessionEnding()` (`public/js/session-outcome.js`),
never a bare `winnerIds.length` — that is the exact site that file's header says
fails silently, and the allowlist means an `ending` nobody has heard of reads as
unrecorded rather than as a recorded result.

**`roundsByFinished` is a partition and Postgres derives `none` by subtraction.**
A group-by over `sessions` cannot see a round that never held one at all, which
is precisely the round the tile exists to count, so counting `none` directly
would drop it silently.

**The exclusion list is read from the environment on EVERY call**
(`lib/admin-exclusions.js`). The repo modules are required once per process and
long before anything sets it, so a cached copy makes the setting inert — the
same property the quota ceilings are tested for, and the same reason.

## „Konten ohne Runde" is the sharpest `atx()` case on the card

Every adoption figure must be read under the admin escape
(`.claude/rules/admin-kennzahlen-card.md`), because an RLS-scoped table returns
zero rows rather than an error. This one is worse than a zero: it joins `users`
(no RLS) to `rounds` (RLS-scoped) with a `NOT EXISTS`, so outside the escape the
rounds side matches nothing and **every account reads as roundless** — a
confident, plausible number, wrong in the flattering direction.

`test/repo.postgres.test.js`'s plain-role probe seeds an account whose own tenant
holds a round and asserts `accountsWithoutRound < accountsTotal`: exactly the
comparison that collapses to equality when the escape is missing.

## `not in (?)` with a JS array binding excludes NOTHING, silently

The exclusion list has to reach ~20 SQL predicates, and the natural spelling is
the one that does not work. Knex does **not** expand an array binding for a raw
`?` — it hands the array to node-pg, which serializes it as a Postgres array
*literal*, so the comparison is against one string instead of a list. Measured
on PG 18:

```sql
select 'x' not in (?)                                   -- ['x']     -> TRUE   ✗
select 'x' <> ALL(?)                                    -- ['x']     -> false  ✓
select 'x' not in (select jsonb_array_elements_text(?)) -- '["x"]'   -> false  ✓
```

The first keeps the row it was written to exclude, with **no error** — so the
card would quietly report the operator's own tenants after all, and only on the
one instance that ever sets the variable. Both correct forms are fine;
`lib/repo/postgres.js` uses the jsonb one because it reads identically in a
`WHERE` and inside a `FILTER`, which is where most of these sit.

**An empty list must take the same path.** `not in (select
jsonb_array_elements_text('[]'))` is an empty set, so the predicate is TRUE for
everybody — which means CI, where the variable is never set, exercises the real
expression rather than a `true` shortcut it would never take in anger.

**Related:** `.claude/rules/admin-kennzahlen-card.md` (the cards, the tile
shapes, the two sweeps and the `atx()` contract — including why „Konten ohne
Runde" is the sharpest instance of it),
`.claude/rules/propose-an-admin-stat-for-new-features.md` (when a feature earns
a tile at all), `.claude/rules/guest-demo-accounts.md` §1 (the demo exclusion
this one sits beside, and which it never replaces).
