# Two guards covering one case: BOTH breaks stay green, so neither is protected

<!-- scope: global — it surfaces through the break-on-purpose sweep, a discipline rather than a file you could be editing at the time -->

`.claude/rules/break-the-code-on-purpose.md` says to break the code and watch a
named test go red. #1168's sweep did exactly that and produced, three times over,
**zero red** — with the guard deleted, the feature apparently unbroken, and the
suite fully green.

Every one had the same cause: a second mechanism already covered the same case.

| Break | Why nothing reddened |
|---|---|
| `advance.cancel()` removed from `onPopstate` | a later `if (idx !== from) return;` in the callback caught the moved step anyway |
| the same call removed from `guardLeave` | `onPopstate`'s copy covered the only path the test exercised |
| the one-submission flag removed from `finish()` | the tap lock had not expired yet, so the second tap never reached it |

## Why this is worse than an ordinary vacuous test

A test that asserts nothing is at least *suspicious* when you read it. This one
is not: the assertion is real, it is about the right behaviour, and it passes for
a true reason — just not the reason you are trying to pin. So the sweep, which is
the instrument for exactly this, **reports the code as guarded** while telling
you nothing about the guard you wrote.

And it degrades quietly. Each mechanism is individually redundant, so each looks
safe to delete during a later cleanup. Delete them one at a time across two PRs,
both green, and the case ends up covered by nothing at all.

## The rule

**When a deliberate break produces no red, the finding is in the CODE, not the
test.** Ask which *other* mechanism absorbed it, then pick one to be the guard
and delete the rest. "Defence in depth" is a real strategy for layers that fail
independently — a JS check plus `pointer-events: none`, where one covers pointers
and the other covers keyboards. It is not a reason to keep two checks that fail
together, and belt-and-braces inside one code path is how a load-bearing line
becomes invisible.

Two corollaries:

- **Say in a comment that the redundant guard was deliberately left out**, at the
  place it would naturally be written. Otherwise the next reader adds it back as
  an obvious omission, and the sweep goes quiet again. `views-session.js`'s
  advance callback carries that note, with the measurement.
- **A test may be unable to reach the guard at all.** The one-submission flag
  above was shadowed by the tap lock, not by another guard, and no arrangement of
  clicks reached it — the fix was to hold the save in flight (a deferred promise
  in the stub) so the window the flag protects actually exists. If a break stays
  green because the guard is *unreachable*, either construct the state that
  reaches it or delete the guard; a guard for a state the code cannot enter is
  dead code wearing a safety label.

## Where it shows up

Anywhere a fix is written defensively — which is most places, because the second
check costs one line and feels free. Highest risk right after a security or
data-loss fix, where the instinct to add one more layer is strongest and the
consequence of an unguarded regression is worst.

**Related:** `.claude/rules/break-the-code-on-purpose.md` (the sweep this refines
— read that first; this file is about what to do when it comes back silent),
`.claude/rules/assert-the-decision-not-its-ingredients.md` (the other way a real
assertion pins the wrong thing),
`.claude/rules/source-scanning-guards-enumerate-shapes.md` (a guard whose
coverage is narrower than it reads).
