---
paths:
  - "lib/routes/admin.js"
  - "lib/routes/account.js"
  - "docs/legal/retention.md"
  - "test/account-deletion.test.js"
---
# A new moderation-log action inherits the 3-year purge — erasure evidence must opt OUT (#419)

`docs/legal/retention.md` deletes moderation-log entries **3 years after the end
of the year of the action**, with one permanent carve-out: the Art. 17(3)(b)/(e)
*Löschnachweis*, the record proving a deletion request was honoured. That
carve-out is keyed on the **action name**, and #311's proposed purge spells it as
a single literal:

```js
keep = entry.action === 'user_erased' || entry.at >= cutoffIso;   // INCOMPLETE
```

Since #419 there are **two** erasure actions, not one:

| Action | Written by | Path |
|---|---|---|
| `user_erased` | `lib/routes/admin.js` | operator-assisted (#273) |
| `account_deleted` | `lib/routes/account.js` | self-service from `/konto` (#419) |

**The one the naive exemption drops is the common one.** Most people delete their
own account rather than writing to the operator, so a purge exempting only
`user_erased` would, in 2030, delete the overwhelming majority of the evidence
the exemption exists to preserve — while the retention document still promised it
was permanent. Nothing would fail: the purge would report a large, plausible
number of deleted rows.

## The rule

**Adding any path that erases personal data means adding its action to the
exemption in the same PR**, in `docs/legal/retention.md` (the authoritative
description the purge must implement) — not only in the route that writes it. The
inverse also holds: a *new* action that is ordinary moderation (a takedown, a
redaction) must **not** be added, or it outlives its retention period.

Treat the direction as the asymmetry it is: the default for a new action is
"purged after 3 years", which is the safe direction for ordinary moderation and
the **wrong** one for an erasure record. Only erasure evidence opts out.

## Why the action name carries this at all

`account_deleted` is deliberately distinct rather than `user_erased` +
`reason: 'self-service'` (both were on the table; the operator chose the distinct
action on 2026-07-28). The payoff is that the panel's action filter is **derived
from the data** — `GET /api/admin/log/actions` → `repo.moderationActions()`
returns the distinct actions actually present — so self-service and assisted
erasures became separately filterable with **no frontend change at all**.
Verified against a running instance: the new action appeared in
`{"actions":["account_deleted"]}` on its first write.

The cost of that choice is exactly this file: the exemption became a set, and a
set has to be maintained. That trade was made knowingly — don't "simplify" it
back by folding the two actions together, and don't leave the set un-widened.

## What the log entry may contain

Nothing that survives the erasure it evidences. Both routes write account id,
tenant id, timestamp, counts and a reason — **no e-mail address, no round or game
names, no member names**. `test/account-deletion.test.js` sweeps the serialized
entry for each of those, which is what stops a future field being added "for
context". The record's only job is proving the request was honoured.

**Related:** `.claude/rules/admin-cross-tenant-escape.md` §2 (the operator-side
erasure this mirrors, and why its log entry omits the address),
`.claude/rules/keep-legal-docs-current.md` (the two-directional check that should
catch this at implementation time),
`.claude/rules/erased-account-token-fallback.md` (the still-valid token both
erasure paths have to refuse).
