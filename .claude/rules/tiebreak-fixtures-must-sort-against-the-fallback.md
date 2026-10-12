---
paths:
  - "test/**"
  - "lib/public-stats*.js"
---
# A tiebreak test whose fixture already sorts by the FALLBACK key cannot fail

Every ordering in this repo that has to be stable ends on a **fallback** key —
the provider key on the Discover podiums (#1648), the name in `rankNames`,
insertion order in `sortSessionsByDate`. The tiebreak a test means to pin sits
*above* that fallback, so a fixture whose rows happen to sort the same way under
both keys tests the fallback and passes with the tiebreak deleted.

That is the natural fixture, which is the trap. Measured on #1648: the play-card
case named its rows `early`/`late`, the score case `hi`/`lo`, the evidence case
`deep`/`thin`, and the shelf case numbered its owner counts in key order. Every
name sorts alphabetically the same way the tiebreak orders it, so **four of
nine deliberate breaks stayed green**: the tiebreak removed outright, the owner
count, the evidence count and the raw-score order. Each assertion was correct,
and each one was answered by the provider key instead.

## The rule

**Name tied fixture rows so the fallback sorts them the OTHER way round**
(`b-early` before `a-late`), and say so in a comment at the fixture, because the
next editor will tidy the names back. Then break the tiebreak and watch the test
named for it go red. A tie fixture that the fallback already orders proves only
that *some* order is stable.

The same applies to any multi-key comparator: a fixture discriminates key N
only if keys 1…N−1 tie and key N+1 disagrees with the expected order.

**Related:** `.claude/rules/break-the-code-on-purpose.md` (the discipline that
found it), `.claude/rules/redundant-guards-make-each-other-untestable.md` (the
same silence from two guards covering one case; here the second "guard" is a
fallback key nobody thinks of as one).
