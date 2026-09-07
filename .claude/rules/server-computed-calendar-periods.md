---
paths:
  - "lib/calendar-periods.js"
  - "lib/public-stats.js"
  - "lib/repo/json.js"
  - "lib/repo/postgres.js"
  - "public/js/views-stats.js"
  - "public/js/i18n.js"
  - "public/js/period-recap.js"
---

# A period LABEL and the window it counts are one fact — derive both, never state one

The Discover podiums said „Meistgespielt diesen Monat" and counted the last **30
days**. Same for the week (7) and the year (365). Every card was wrong on every
date that was not a Monday / the 1st / January 1st, and the year card was the
worst: on 2026-09-07 „dieses Jahr" counted mostly 2025.

Nothing could see it. The counts were right for what they computed, the labels
were right German, the cards rendered, and both halves shipped in the same PR
(#564) written by someone who meant the same thing by both. **A label is a claim
about the window beside it, and nothing type-checks a claim.**

The fix is not "compute calendar boundaries" — it is that the card now **names
the period from the same derivation the counts came from** (`period: '2026-09'`
travels in the payload, and `stats.playedMonth` takes it as a parameter). A
label built from a constant string can disagree with its window; one derived
from the window cannot.

## 1. Pick the zone once, on the server, and say why

The payload is built server-side and cached process-wide, so **one set of numbers
is served to everyone** — a client cannot recompute a boundary for its own zone
without recomputing the counts, which it never sees. Europe/Berlin, fixed in
`lib/calendar-periods.js`.

`public/js/period-recap.js` makes the **opposite** call — the Chronik's per-period
recap buckets on the *device's* calendar — and both are right, for a reason worth
knowing before "fixing" either: that one is derived on demand for one round from
a payload the reader already holds, so it can afford to answer "your July". This
one cannot, which is exactly why it names the month instead.

## 2. Both backends take the boundary from ONE derivation

Postgres will do it natively (`date_trunc('week' | 'month' | 'year', now AT TIME
ZONE 'Europe/Berlin')`, already Monday-first) and it is tempting. Don't: the JSON
backend has no such helper, so you get two independent implementations of one
boundary, and `test/support/repo-contract.js` asserts they agree to the hour
across both DST transitions. Derive once in JS, pass the three ISO strings down.

## 3. DST is avoided by CONSTRUCTION, not handled

Anything of the shape `now − N × 86400000` is wrong twice a year — 2026-03-29 is
a 23-hour day in Berlin and 2026-10-25 a 25-hour one. Build every boundary as a
**calendar date** and resolve it to the instant its local midnight begins; then no
arithmetic ever spans a transition.

**The offset correction in `localMidnight` is UNREACHABLE at Berlin's offset, and
that is why the function takes a zone.** Measured: with the second offset pass
deleted, the whole `periodBoundaries` suite stayed **green**, because 00:00 UTC is
01:00/02:00 Berlin on the same date — always after local midnight and never
across Berlin's 02:00 switch. Deleting it would leave the module correct only by
an argument about one zone's offset size, silently wrong the day `ZONE` moves;
keeping it untested would be an unfalsifiable guard. So it keeps the general form
and the spec pins it at **Pacific/Auckland**, where 00:00 UTC lands at 12:00–13:00
local and a 02:00 transition really does fall in between.

Generalisable: **when a defensive branch cannot be reached through the production
input, make its input a parameter rather than choosing between "delete it" and
"ship it untested".**

## 4. A date formatter takes an INSTANT and renders it in the READER's zone

`fmtMonth(iso)` is `new Date(iso).toLocaleString(…)`. Hand it the period's own
boundary — `'2026-09-01T00:00:00Z'`, or Berlin's `'2026-08-31T22:00:00Z'` — and it
renders **August** for every reader west of UTC. The card confidently names the
wrong month, and a CI runner in UTC never sees it.

So the payload carries a bare `"YYYY-MM"` **key**, not an instant, and
`fmtMonthKey` builds the date in **local** time before formatting. Its spec sets
`process.env.TZ = 'America/Los_Angeles'` at the top of its own file, and carries
a control asserting that the naive instant form *does* read August — otherwise
the file silently stops discriminating the day it runs in UTC.

## 5. Calendar periods start EMPTY, and the card is meant to disappear

On a Monday morning the week metric has almost no plays and falls under its
floor; likewise the month card in its first days and the year card through part
of January. **Intended** — it is the stance `lib/public-stats.js` already takes,
that the page fills in on its own rather than publishing a number too thin to
mean anything. Do not lower a default or prorate a floor by how far into the
period we are; an operator can retune any of them live.

## 6. A fixture measured in "days ago" cannot see this bug

The contract case seeded plays at 2, 20 and 200 days back and asserted 1/2/3.
Every one of those numbers is **identical** under rolling and calendar windows for
most `now` values, so the case was green against the bug for two months. Place
fixtures as **absolute instants straddling a boundary** — 23:00 the evening before
versus 00:30 the morning of — and pick a `now` that is deliberately mid-period.
`.claude/rules/break-the-code-on-purpose.md` is the general form; this is the
date-shaped instance of it, and the tell is that a day-offset fixture is
satisfied by the very arithmetic under test.

**Related:** `.claude/rules/shared-constants-across-the-stack.md` (the same
"one fact, two places" shape for a value rather than a period),
`.claude/rules/break-the-code-on-purpose.md`,
`.claude/rules/locale-set-is-data.md` (the i18n parity the new `{month}`/`{year}`
parameters ride on).
