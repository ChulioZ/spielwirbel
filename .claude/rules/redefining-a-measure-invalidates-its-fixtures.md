---
paths:
  - "public/js/win-score.js"
  - "public/js/vote-score.js"
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

## Fixing the fixture is where you find out what the feature should do

The repair here was one line — seat the round instead of one member — and the
detour on the way to it is the part worth keeping.

A zero-sum measure makes "seat everyone and adjust the win counts" impossible:

> If every member plays every night, the scores **sum to zero** by construction.
> So you can never have all of them above chance, however you distribute the wins.

With everyone present across `T` nights and `p` parties a member scores
`wins − T/p`, so a single-win member clears chance only when `p > T`. Chasing
that, the fixture grew guests padding every night out to eight parties — an
elaborate, unreal table whose only job was to lift members over a **score
threshold on the podium**. The padding was a fixture bending itself around a
product decision that was itself wrong, and when live use killed the threshold
(`.claude/rules/rank-encodings-must-not-be-growable-by-ties.md`) the padding
evaporated with it: `wins − T/p` is a constant offset from the win count, so
seating the round reproduces the exact order these fixtures always meant.

**Treat an elaborate fixture as a finding, not a solution.** Needing a contrived
table to make a spec express an ordinary situation is evidence about the
feature, and it was here: real rounds cannot pad themselves with guests either,
which is precisely why the threshold emptied a real family's podium.

## A member id the ROUND does not carry shrinks the field, silently (#920)

The same failure has a second cause that does not need a redefinition at all,
and a fixture author hits it the first time they write one of these:

```js
roundOf(['a'], [night(['a', 'b'], ['a'], { chosenGameId: 'real' })])
//       ^^^ 'b' is in the SESSION but not in the ROUND
```

`sessionPeople` (session-people.js) intersects `session.memberIds` with
`round.members`, so `b` is not a person, the night has **one** party, and it
scores `1 − 1/1 = 0` — the solo value — for a fixture written to be a contested
win. The assertion that catches it (`byGame.real > byGame.solo`) then fails with
`0 > 0`, which reads as the implementation ignoring the field weighting rather
than as the fixture having no field in it.

There is no error and no guard: seating a stranger is exactly how a session
whose member was later removed from the round is meant to degrade. So **name
every seat in `roundOf` too**, and when a party-weighted assertion comes out at
the solo value, check the round's member list before the arithmetic.

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
