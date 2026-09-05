---
paths:
  - "public/js/lang/*.js"
  - "test/round-settings.test.js"
---

# Renaming a user-visible label makes every NEGATIVE assertion about it vacuous

`test/round-settings.test.js` guards #561's consolidation with three assertions
of the same shape — the action must *not* appear where it used to live:

```js
assert.ok(!found.includes('Spiele verschieben'), '… is back under the game grid');
```

#916 relabelled that action to „Spiele verschieben oder kopieren". `found` holds
exact label strings, so all three kept passing — and can now **never fail
again**, because the string they name is one no screen renders. The positive
assertion in the same file went red immediately and pointed at the rename; the
negative ones went quietly, permanently inert.

One of them is the grantee gate: „an owner-only action must not be offered on a
shared round". **Measured**: with the stale literal in place and
`roundCan(round, 'games.moveOut')` deleted from `showRoundSettings`, that test
stays green — 13/13. With the literal corrected it goes red, naming itself.

## The rule

**When you change a user-visible string, grep the test suite for the OLD text and
fix every hit — the ones that still pass included.** A red test tells you where a
rename landed; the ones you have to go looking for are the assertions that a
rename *satisfies*.

```bash
grep -rn "Spiele verschieben" test/
```

The general form: a negative assertion is only as strong as the currency of the
literal inside it, and a rename is exactly the edit that decouples the two while
leaving the suite green. Same failure shape as
`.claude/rules/source-scanning-guards-enumerate-shapes.md` — a guard whose
matcher stopped matching the thing it guards — with the trigger being a rename
rather than a new call shape.

**Prefer asserting the rendered label against `t('the.key')`** where the spec can
reach the dictionary, so a rename moves both sides at once. Where a literal is
clearer (as here, where the point is what a German-speaking user reads), keep the
literal and accept that this grep is the maintenance it costs.

**Related:** `.claude/rules/token-friendly-source-files.md` (the same trap for a
renamed *function or file*, where the stale pointer sits in a rule or a comment
instead of an assertion), `.claude/rules/break-the-code-on-purpose.md` (breaking
the gate on purpose is what proves the fixed assertion is discriminating again).
