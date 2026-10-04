---
paths:
  - "lib/me-projection.js"
  - "lib/routes/account.js"
  - "test/account.test.js"
---
# A new field on the user record needs a LEGACY-SHAPE spec — every fixture is born with the key

`meProjection` (`lib/me-projection.js` — it lived in `lib/routes/account.js`
until #785 gave it its own module, so that the three session-start responses
could answer it too) resolves each account preference's
default, because accounts predating a field carry **no key at all** and
`CLAUDE.md` forbids migration code. So the projection is the only thing standing
between an old account and a wrong answer:

```js
notifyRoundInvitations: user.notifyRoundInvitations !== false,   // defaults ON
bgStats:                user.bgStats === true,                   // defaults OFF
```

**The whole test suite is blind to which of those two shapes you wrote.**
`register` writes every key at creation, so every account any spec can build
already *has* the field — and for such a record `!== false` and `=== true` return
the identical value. Measured on #485: flipping `bgStats` to `!== false` left all
1705 tests green.

What that would have shipped: every account registered before the field existed
reads as **opted in**. For #485 that is a BG Stats link on the results screen of
users who never enabled it and mostly do not use the app — the exact state the
opt-in exists to prevent, on the exact population the projection exists to
protect.

## The spec that can see it

Build the genuine legacy shape through the store. `updateUser` is an
`Object.assign`, so it **cannot remove a key** — going through the repo gives you
`null`, which is a different record from an absent one:

```js
const record = store.data.users.find((u) => u.id === acc.uid);
delete record.bgStats;
store.saveData();
assert.equal('bgStats' in store.data.users.find((u) => u.id === acc.uid), false,
  'the key is really gone');            // ← without this the spec can pass vacuously

assert.equal((await getMe(acc.accessToken)).body.bgStats, false);
```

The `'key' in record` assertion is not ceremony: `delete` on the wrong object (a
snapshot rather than the live row) silently does nothing, and the spec then
re-asserts the ordinary case under a name promising otherwise.

`test/account.test.js` holds a growing set of these — grep it for
`delete record.` before adding a field, and add yours beside them.

## Which direction is dangerous

**Both**, one per shape — an absent key is `undefined`, and the two readings
disagree about it:

| Default | Absent key must read as | Wrong shape does |
|---|---|---|
| **ON (`!== false`)** | **ON** | `=== true` reads `undefined` as false — **turns the feature OFF for every pre-existing account** |
| **OFF (`=== true`)** | **OFF** | `!== false` reads `undefined` as true — **turns the feature ON for every pre-existing account** |

This section once said only the OFF row was dangerous ("absent is falsy, so it
reads ON either way"), and used it to excuse `notifyRoundInvitations`,
`notifyFriendRequests` (#618) and `statsVisible` (#1089) having no legacy spec.
That was wrong — `undefined === true` is `false`, so the opt-in shape on any of
them silences the mails and hides the statistics for every account older than
the field. The three now share one spec (`#618/#1089` in `test/account.test.js`,
reddened by flipping `statsVisible` to `=== true`); an opt-out needs its legacy
spec exactly as an opt-in does.

## Why Route 1 does not reach it either

Test-first on the projection reddens because the *field* is absent from the
response — satisfied just as well by `!== false`. The discrimination needed here
is CORRECT vs SUBTLY WRONG, which only the deliberate break produces
(`.claude/rules/break-the-code-on-purpose.md`, whose "a test that SETS the state
it asserts" section is the client-side sibling of this one).

**Related:** `.claude/rules/user-accounts.md` (why every key is written at
creation — the Postgres absent-key parity that causes this in the first place),
`.claude/rules/break-the-code-on-purpose.md`.
