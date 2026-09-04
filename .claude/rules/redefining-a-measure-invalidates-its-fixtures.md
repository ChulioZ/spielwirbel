---
paths:
  - "public/js/win-score.js"
  - "public/js/vote-score.js"
  - "public/js/vote-scale.js"
  - "public/js/core.js"
  - "test/podium-ranks.test.js"
  - "test/win-score.test.js"
  - "test/vote-score.test.js"
---
# Redefining a measure invalidates every fixture that fed the OLD one — starting with the fields nobody looked at

When a number gains a **denominator** — #893 (the mean became a veto-aware
curve), #895 (a win count became a win *above chance*), and #894/#909 next — the
code change is the easy half. The expensive half is that every fixture in the
suite was written against the old meaning, and a fixture field that was
**inert** under it can become the thing under test.

`test/podium-ranks.test.js` seated every session like this:

```js
const session = (id, winnerIds) => ({ …, memberIds: ['m1'], winnerIds });
```

A **solo** night, for a spec about the podium's arrangement. That was perfectly
fine for as long as the ranking was `wins[wid]++`, which never asks who else was
at the table — the field simply did not participate. #895 made the field the
denominator, so every one of those nights became worth exactly `1 − 1/1 = 0`,
every member scored zero, and **seven tests failed with an empty stage**.

## Why this is worse than an ordinary red

The failure is **total, not proportional**, so it does not read as "the fixture
needs rebalancing" — it reads as the new code being broken. `colOrder(dom)`
returned `[]` where three columns were expected, which is what a view that
crashed would produce. The instinct is to debug the implementation; the fixture
is the last place anyone looks, because it did not change and it had been right
for years.

**Read the failing fixture before the failing code**, and ask specifically which
field the old measure ignored. It is usually the one carrying an obviously
placeholder value — `['m1']`, a single rating, one member — chosen when it stood
for nothing.

## The arithmetic that decides the new fixture (and the trap inside it)

Rebalancing is not "seat everyone and adjust the win counts". A zero-sum measure
makes that impossible, and the reason is worth having written down:

> If every member plays every night, the scores **sum to zero** by construction.
> So you can never have all of them above chance, however you distribute the wins.

For the Siegwertung with everyone present across `T` nights and `p` parties, a
member's score is `wins − T/p`. A single-win member therefore sits above chance
only when `p > T` — which is why `test/podium-ranks.test.js` now pads each night
with guests to `FIELD = 8` rather than seating the four or five round members
alone. Attendance has to vary, or the field has to exceed the schedule; there is
no third option, and hand-tuning win counts against a zero-sum measure is a loop
that cannot terminate.

Note the same fixture must keep a case on the **wrong** side of the line — its
`{4,3,2,1}` round still has a member below chance — or the "who is off the
podium" assertion is satisfied by a stage nobody could fall off.

## What to sweep when a measure changes

Not only the specs that fail. A fixture can be **correct by irrelevance in the
other direction** too: green afterwards, and no longer testing what its name
says. Grep for the fixtures feeding the changed number and re-read each against
the new definition, rather than trusting the suite to tell you.

`.claude/rules/break-the-code-on-purpose.md` is the check that catches the
survivors: a spec whose fixture went inert still passes, and only breaking the
implementation shows that it stopped discriminating.

**Related:** `.claude/rules/break-the-code-on-purpose.md` (the "fixture too small
to fail" family this belongs to), `.claude/rules/session-teams.md` (a party is
the unit any such denominator counts), `.claude/rules/shared-constants-across-the-stack.md`
(`vote-score.js` / `win-score.js`, the measures themselves),
`.claude/rules/rank-encodings-must-not-be-growable-by-ties.md` (the component
whose specs this was found in).
