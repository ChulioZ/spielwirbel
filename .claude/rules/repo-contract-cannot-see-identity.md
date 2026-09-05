---
paths:
  - "lib/repo/**"
  - "test/support/repo-contract.js"
  - "test/repo.test.js"
---

# The repo contract clones on read, so it can never see an ALIASING bug

`test/support/repo-contract.js` is the guard that keeps the two backends
honest, and it is blind to one whole class of defect: **object identity in the
JSON backend's live tree.**

Every read goes through `clone()` (`.claude/rules/data-access-layer.md` — reads
return snapshots, deliberately, so a route cannot "work" by mutating a live
ref). So two rows holding the *same* object come back as two distinct ones, and

```js
assert.notEqual(a.categories, b.categories);   // passes with the bug in place
```

passes on both backends whether or not the bug exists. Postgres cannot have the
bug at all — every row is a fresh jsonb parse — so the contract's whole premise
("both backends must answer identically") is satisfied by a JSON backend that is
quietly wrong.

## Where it bites

Any code that builds one stored row **from another stored row**. In this backend
`data` is one shared in-memory tree, so carrying an object-valued field by
reference aliases two rounds' live objects, and an in-place edit to one silently
rewrites the other.

`createRound`'s import is the case that found it (#921). Its widened field set
carries `source`, `edition` and the `categories`/`mechanics` lists, and carried
them by reference:

```js
const from = store.findRound(src.id).games[0];
const to   = store.findRound(copy.id).games[0];
from.source === to.source          // true  ← two rounds, one object
from.categories.push('x');         // appears on the copy, in the other round
```

The expansion deep copy had guarded exactly this since #653 — its comment says
so — which is the tell: the hazard was already known and the guard simply did
not extend to the fields added later. **A copy path grows this bug by
addition**, so the moment to check is when the field set widens, not when the
path is written.

Note it is usually a *trap* rather than a live bug: every writer here replaces
the whole value rather than mutating it, so nothing is wrong today. That is
also why nothing goes red — and why it survives.

## The rule

**Deep-copy the whole row when you build one stored row from another** —
`structuredClone(row)` at the end of the builder, not a field-by-field decision
about which values happen to be objects. The per-field form is what drifts: it
is correct until someone adds a field whose value is an array.

**And put the spec where the contract cannot go.** `test/repo.test.js` has a
section for this — "the half the shared contract cannot reach" — that reaches
past the repo into `store.findRound()`. It is a JSON-backend **fixture**, not a
contract, precisely because the thing it asserts is unrepresentable in Postgres.

Two assertions, not one, or it goes vacuous the ordinary way:

```js
assert.notEqual(from[key], to[key], `${key} is the SAME live object`);
assert.deepEqual(from[key], to[key], `${key} was copied, not dropped`);
```

`notEqual` alone is satisfied by a field that was never copied at all —
`undefined !== undefined` is false, but any two absent-vs-present pair passes,
and a typo'd key name passes trivially.

**Related:** `.claude/rules/data-access-layer.md` (why reads clone — the
property that makes this invisible), `.claude/rules/postgres-backend.md`
(absent-key parity, the *other* shape the contract does catch),
`.claude/rules/break-the-code-on-purpose.md` (this was found by reading the
diff, not by a red test — no test could have been red).
