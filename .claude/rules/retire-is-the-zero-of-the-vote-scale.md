---
paths:
  - "public/js/vote-scale.js"
  - "public/js/core.js"
  - "public/js/recap.js"
  - "public/js/views-member.js"
  - "public/js/views-session.js"
  - "public/js/views-vote-link.js"
  - "lib/recommend.js"
  - "lib/session-votes.js"
  - "lib/repo/json.js"
  - "lib/repo/postgres.js"
---
# Never read `vote.rating` directly — the `retire` flag IS the 0

Since #797 a vote proposing retirement is not a flag beside a rating; it is the
**zero** of the 0–5 scale. `effectiveRating(vote)` in `public/js/vote-scale.js`
is the only thing that may answer "what is this vote worth", and
`wantsRetire(vote)` the only thing that may answer "does this person want it
gone".

```js
if (typeof v.rating === 'number') ratings.push(v.rating);   // WRONG since #797
const r = effectiveRating(v); if (r !== null) ratings.push(r);   // right
```

## Why a raw read is worse than an ordinary bug

**It cannot fail loudly.** A raw `v.rating` read silently drops every zero, so
the average it computes is simply *higher* than the one the screen next door
shows — a plausible number, no exception, no 400, no blank. The retire-only
shape (`{ rating: null, retire: true }`) reads as "did not vote", and the legacy
contradiction (`{ rating: 4, retire: true }`) reads as a 4 from someone who
asked for the game to be thrown out.

**Storage was NOT migrated**, on purpose (CLAUDE.md's no-one-time-migration-code
convention). Both legacy shapes are still on disk in every round that voted
before #797, so this is not a transitional concern that ages out — the rule is
permanent for as long as those rows are.

## The write side closes the door the read side has to keep open

`sanitizePersonVotes` (`lib/session-votes.js`) drops the rating when the flag is
set, so **new** data cannot carry the contradiction, and the vote card's tiles
are mutually exclusive. Don't read that as "the both-shape is impossible" and
simplify `effectiveRating`: the normalisation is what stops the set of
contradictory rows from *growing*, not what removes the ones already there.

## The tenth site is SQL and cannot require the module

`lib/repo/postgres.js`'s cross-tenant corpus aggregate restates both halves by
hand — the `WHERE` must admit a retire-only vote, and the `CASE` must let
retirement win. Two things there are exact, not stylistic:

- `vote.val->'retire' = 'true'::jsonb`, **not** `->>'retire' = 'true'`: the text
  form also matches the *string* `"true"`, which `effectiveRating`'s `=== true`
  rejects — and the legacy `POST …/results` route validates a member's column
  with `z.unknown()`, so that shape can really be stored.
- `effectiveRating` uses `Number.isFinite`, **not** `Number.isInteger`, because
  it is the exact JS equivalent of `jsonb_typeof(…) = 'number'`. JSON has no NaN
  or Infinity, so the two admit precisely the same values by construction. Swap
  in `isInteger` and the backends disagree on a fractional rating with nothing
  red.

`test/support/repo-contract.js` runs one fixture carrying both legacy shapes
through both backends and asserts the same `{ count, sum }` — that comparison is
the only thing standing between the two spellings.

## The eleventh site reads it through an INJECTED reference (#796)

`public/js/table-split.js` scores a multi-table split from the same votes, and it
takes `effectiveRating` as a parameter rather than requiring it — the shape
`recap.js` already uses, because a public/js file cannot require a sibling and the
suite loads this one into Node. The consequence for this rule is that the
**threshold moves with the scale**: `VIOLATION_MAX = 2` is "the bottom two of the
0-5 scale", so a retire vote is a tier-1 violation by construction and needs no
clause of its own. Change the scale and that constant changes in the same PR.

## What the thresholds do NOT mean any more

`retireRecommendations`' `LOW_AVG = 2.0` is now a point on a **0–5** scale, and
zeros land in the average that feeds it, so the Ø reason fires more often than it
used to. That is intended (#797 decision 5) and the constant was deliberately not
retuned — don't "correct" it back on the assumption that it still describes a
1–5 scale.

**Related:** `.claude/rules/shared-constants-across-the-stack.md` (the ninth
inventory entry, and why this is one file rather than nine copies),
`.claude/rules/session-guests-are-not-members.md` §4 (a guest's scale starts at
1, which is what keeps `gameStats` free of guest-specific exclusions).
